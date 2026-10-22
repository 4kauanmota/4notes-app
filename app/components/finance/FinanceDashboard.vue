<script setup lang="ts">
/**
 * Finanças › painel (1.7.0): para entender para onde vai o dinheiro, sempre com os
 * gastos registrados (nada de exemplo). Responde ao período e à categoria escolhidos.
 *
 * - Resumo: total, quantidade, valor médio por gasto e média por dia (com a variação
 *   em relação ao período anterior equivalente).
 * - Gastos ao longo do tempo (por dia, semana ou mês), comparando com o anterior se quiser.
 * - Por categoria (rosca), dias com mais gastos e os maiores gastos.
 * - Comparação: o período × o anterior equivalente (com o atual em andamento, só o
 *   mesmo trecho dos dois), por categoria: o que aumentou e o que diminuiu.
 * Os gráficos são os do Timer (components/timer/), com valores em dinheiro.
 */
import { computed, ref, watch } from 'vue'
import { paletteVar } from '~/lib/colors'
import { formatMoney, formatSignedMoney, MONEY_FORMAT } from '~/lib/finance/format'
import { filterExpenses, type Expense } from '~/lib/finance/model'
import {
  byCategory,
  compareSpending,
  dayTitle,
  defaultStep,
  evolution,
  evolutionSteps,
  STEP_LABELS,
  summarize,
  topDays,
  topExpenses,
  type EvolutionStep,
} from '~/lib/finance/stats'
import { formatPercent } from '~/lib/timer/format'
import { periodLabel, periodOf, shiftPeriod, type Period } from '~/lib/timer/stats'
import { useFinanceStore } from '~/stores/finance'

const emit = defineEmits<{ add: [] }>()
const finance = useFinanceStore()
const today = finance.today
const weekStart = computed(() => finance.state.settings.weekStart)

const period = computed<Period>({
  get: () => finance.state.dashboardPeriod ?? periodOf('month', today.value, weekStart.value),
  set: (value) => (finance.state.dashboardPeriod = value),
})
const categoryChoice = ref('all')
const categoryFilter = computed(() => (categoryChoice.value === 'all' ? undefined : categoryChoice.value === 'none' ? null : categoryChoice.value))

/** Os gastos com o filtro de categoria (o período é aplicado em cada conta). */
const scoped = computed(() =>
  filterExpenses(finance.state.expenses, { category: categoryFilter.value, knownCategories: finance.knownCategoryIds.value }),
)
const inside = computed(() => filterExpenses(scoped.value, { from: period.value.from, to: period.value.to }))

const label = computed(() => periodLabel(period.value, today.value))
const previousPeriod = computed(() => shiftPeriod(period.value, -1, weekStart.value))
const previousLabel = computed(() => periodLabel(previousPeriod.value, today.value))

// ── Resumo ──────────────────────────────────────────────────────────────────

const summary = computed(() => summarize(inside.value, period.value, today.value))
const comparison = computed(() => {
  void today.value // o dia virou: o trecho comparado muda
  return compareSpending(scoped.value, period.value, Date.now(), weekStart.value, finance.knownCategoryIds.value)
})

const totalDelta = computed(() => {
  const c = comparison.value
  if (!c.current && !c.previous) return null
  const dir = c.diff === 0 ? 'same' : c.diff > 0 ? 'up' : 'down'
  const text = c.pct !== null ? `${formatPercent(c.pct)} vs. ${previousLabel.value.toLowerCase()}` : c.current ? `antes: nada registrado` : `antes: ${formatMoney(c.previous)}`
  return { dir, text }
})

// ── Evolução ────────────────────────────────────────────────────────────────

const steps = computed(() => evolutionSteps(period.value))
const step = ref<EvolutionStep | null>(defaultStep(period.value))
watch(
  () => `${period.value.kind}|${period.value.from}|${period.value.to}`,
  () => {
    if (!step.value || !steps.value.includes(step.value)) step.value = defaultStep(period.value)
  },
)
const stepOptions = computed(() => steps.value.map((value) => ({ value, label: STEP_LABELS[value] })))
const overlay = ref(false)
const showTable = ref(false)

const points = computed(() => (step.value ? evolution(scoped.value, period.value, step.value, today.value, weekStart.value) : []))
/** O período anterior nas mesmas posições (um mês mais curto fica com zeros no fim). */
const previousPoints = computed(() => {
  if (!overlay.value || !step.value) return null
  const previous = evolution(scoped.value, previousPeriod.value, step.value, today.value, weekStart.value)
  return points.value.map((_, index) => previous[index]?.ms ?? 0)
})
const evolutionTitle = computed(() => (step.value === 'month' ? 'Gastos por mês' : step.value === 'week' ? 'Gastos por semana' : 'Gastos por dia'))

// ── Categorias, dias e maiores gastos ───────────────────────────────────────

function categoryColor(id: string | null): string {
  const category = id ? finance.categoryById.value.get(id) : null
  return category ? paletteVar(category.color) : 'var(--cat-gray)'
}

const categories = computed(() => byCategory(inside.value, finance.knownCategoryIds.value))
const donutItems = computed(() =>
  categories.value.map((item) => ({ key: item.categoryId ?? '__none', label: finance.categoryName(item.categoryId), color: categoryColor(item.categoryId), ms: item.total })),
)
const dayRows = computed(() =>
  topDays(inside.value, 7).map((item) => ({
    key: item.date,
    label: dayTitle(item.date),
    detail: `${item.count} ${item.count === 1 ? 'gasto' : 'gastos'}`,
    color: 'var(--primary)',
    ms: item.total,
  })),
)
const biggest = computed(() => topExpenses(inside.value, 8))
const biggestMax = computed(() => Math.max(1, ...biggest.value.map((expense) => expense.amount)))

// ── Comparação ──────────────────────────────────────────────────────────────

const direction = (diff: number) => (diff === 0 ? 'same' : diff > 0 ? 'up' : 'down')
const changeText = (current: number, previous: number, pct: number | null) => (pct !== null ? formatPercent(pct) : current > 0 && previous === 0 ? 'novo' : '')
const partialNote = computed(() => {
  const c = comparison.value
  if (!c.partial) return null
  const day = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/')
  return `${label.value} vai até hoje (${day(c.currentUntil)}): a comparação usa o mesmo trecho de ${previousLabel.value.toLowerCase()} (até ${day(c.previousUntil)}).`
})
const up = computed(() => comparison.value.categories.filter((item) => item.diff > 0).slice(0, 5))
const down = computed(() => comparison.value.categories.filter((item) => item.diff < 0).slice(0, 5))
const maxCategory = computed(() => Math.max(1, ...comparison.value.categories.map((item) => Math.max(item.current, item.previous))))

function open(expense: Expense) {
  finance.openExpense(expense.id)
}

const navRef = ref<{ shift: (delta: number) => void }>()
defineExpose({ shiftPeriod: (delta: number) => navRef.value?.shift(delta) })
</script>

<template>
  <div class="dashboard">
    <div class="filters">
      <PeriodNav ref="navRef" v-model="period" :week-start="weekStart" :today="today" />
      <select v-model="categoryChoice" class="select sm" aria-label="Categoria" data-filter="dashboard-category">
        <option value="all">Todas as categorias</option>
        <option value="none">Sem categoria</option>
        <option v-for="category in finance.state.categories" :key="category.id" :value="category.id">{{ category.name }}</option>
      </select>
    </div>

    <div v-if="!finance.state.expenses.length" class="dash-empty">
      <AppIcon name="chart" :size="32" />
      <h3>Ainda não há gastos registrados</h3>
      <p>
        O painel usa só os seus gastos: o total do período, a evolução, as categorias, os dias e os maiores gastos, e a comparação com o período anterior.
        Registre o primeiro e ele aparece aqui.
      </p>
      <button type="button" class="btn btn-primary" @click="emit('add')"><AppIcon name="plus" :size="15" /> Registrar um gasto</button>
    </div>

    <template v-else>
      <div class="tiles">
        <div class="tile">
          <span class="tile-label">Total gasto</span>
          <strong class="tile-value" data-stat="total">{{ formatMoney(summary.total) }}</strong>
          <span v-if="totalDelta" class="tile-delta" :class="totalDelta.dir">
            <AppIcon v-if="totalDelta.dir !== 'same'" :name="totalDelta.dir === 'up' ? 'arrow-up' : 'arrow-down'" :size="12" />
            {{ totalDelta.text }}
          </span>
        </div>
        <div class="tile">
          <span class="tile-label">Gastos</span>
          <strong class="tile-value" data-stat="count">{{ summary.count }}</strong>
          <span class="tile-delta same">antes: {{ comparison.previousCount }}</span>
        </div>
        <div class="tile">
          <span class="tile-label">Valor médio por gasto</span>
          <strong class="tile-value" data-stat="average">{{ summary.average !== null ? formatMoney(summary.average) : '—' }}</strong>
          <span v-if="categories[0] && summary.total" class="tile-delta same">
            {{ Math.round((categories[0].total / summary.total) * 100) }}% em {{ finance.categoryName(categories[0].categoryId) }}
          </span>
        </div>
        <div class="tile">
          <span class="tile-label">Média por dia</span>
          <strong class="tile-value" data-stat="per-day">{{ summary.perDay !== null ? formatMoney(summary.perDay) : '—' }}</strong>
          <span v-if="summary.days" class="tile-delta same">{{ summary.days }} {{ summary.days === 1 ? 'dia' : 'dias' }}{{ period.to >= today && period.from <= today ? ' até hoje' : '' }}</span>
        </div>
      </div>

      <!-- Evolução -->
      <section class="card" data-section="evolution">
        <header class="card-head">
          <h3>{{ step ? evolutionTitle : 'Gastos ao longo do tempo' }}</h3>
          <div v-if="step" class="card-actions">
            <UiSegmented v-if="stepOptions.length > 1" v-model="step" :options="stepOptions" size="sm" aria-label="Agrupar por" />
            <label class="check"><input v-model="overlay" type="checkbox" data-action="overlay-previous" /> Comparar com o anterior</label>
            <button type="button" class="btn btn-sm btn-ghost" :aria-pressed="showTable" @click="showTable = !showTable">
              <AppIcon :name="showTable ? 'chart' : 'list'" :size="14" /> {{ showTable ? 'Gráfico' : 'Tabela' }}
            </button>
          </div>
        </header>
        <p v-if="!step" class="card-empty">Escolha uma semana, um mês, um ano ou um intervalo para ver a evolução.</p>
        <p v-else-if="!points.some((point) => point.ms > 0) && (!previousPoints || !previousPoints.some((value) => value > 0))" class="card-empty">
          Nenhum gasto em {{ label.toLowerCase() === 'hoje' ? 'hoje' : label }}.
        </p>
        <table v-else-if="showTable" class="table">
          <thead>
            <tr>
              <th>{{ step === 'month' ? 'Mês' : step === 'week' ? 'Semana' : 'Dia' }}</th>
              <th>{{ label }}</th>
              <th v-if="previousPoints">{{ previousLabel }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(point, index) in points" :key="point.key" :class="{ future: point.future }">
              <td>{{ point.title }}</td>
              <td>{{ point.future && !point.ms ? '—' : formatMoney(point.ms) }}</td>
              <td v-if="previousPoints">{{ formatMoney(previousPoints[index] ?? 0) }}</td>
            </tr>
          </tbody>
        </table>
        <TimerColumns v-else :points="points" :previous="previousPoints" :current-label="label" :previous-label="previousLabel" :format="MONEY_FORMAT" />
      </section>

      <div class="grid-2">
        <section class="card donut-card" data-section="categories">
          <header class="card-head"><h3>Por categoria</h3></header>
          <TimerDonut v-if="summary.total > 0" :items="donutItems" :total="summary.total" :format="MONEY_FORMAT" total-label="no período" aria-label="Gastos por categoria" />
          <p v-else class="card-empty">Nenhum gasto neste período.</p>
        </section>
        <section class="card" data-section="top-days">
          <header class="card-head"><h3>Dias com mais gastos</h3></header>
          <TimerBarList :rows="dayRows" :limit="7" :format="MONEY_FORMAT" empty-label="Nenhum gasto neste período." />
        </section>
      </div>

      <section class="card" data-section="biggest">
        <header class="card-head"><h3>Maiores gastos</h3></header>
        <ol v-if="biggest.length" class="biggest">
          <li v-for="expense in biggest" :key="expense.id">
            <button type="button" class="big-row" :data-expense="expense.id" @click="open(expense)">
              <span class="big-line">
                <span class="big-name">{{ expense.description || 'Sem descrição' }}</span>
                <span class="big-meta">{{ dayTitle(expense.date) }} · {{ finance.categoryName(expense.categoryId) }}</span>
                <span class="big-value">{{ formatMoney(expense.amount) }}</span>
              </span>
              <span class="track"><i :style="{ width: `${Math.max(1.5, (expense.amount / biggestMax) * 100)}%`, background: categoryColor(expense.categoryId) }" /></span>
            </button>
          </li>
        </ol>
        <p v-else class="card-empty">Nenhum gasto neste período.</p>
      </section>

      <!-- Comparação -->
      <section class="card" data-section="comparison">
        <header class="card-head">
          <h3>{{ label }} × {{ previousLabel }}</h3>
        </header>
        <p v-if="partialNote" class="note"><AppIcon name="info" :size="13" /> {{ partialNote }}</p>
        <p v-if="!comparison.current && !comparison.previous" class="card-empty">Nenhum gasto nos dois períodos: nada para comparar.</p>
        <template v-else>
          <div class="figures">
            <div class="figure">
              <span class="fig-label">{{ label }}</span>
              <strong class="fig-value" data-compare="current">{{ formatMoney(comparison.current) }}</strong>
              <span class="fig-sub">{{ comparison.currentCount }} {{ comparison.currentCount === 1 ? 'gasto' : 'gastos' }}</span>
            </div>
            <div class="figure">
              <span class="fig-label">{{ previousLabel }}</span>
              <strong class="fig-value muted-value" data-compare="previous">{{ formatMoney(comparison.previous) }}</strong>
              <span class="fig-sub">{{ comparison.previousCount }} {{ comparison.previousCount === 1 ? 'gasto' : 'gastos' }}</span>
            </div>
            <div class="figure">
              <span class="fig-label">Diferença</span>
              <strong class="fig-value" :class="direction(comparison.diff)" data-compare="diff">
                <AppIcon v-if="comparison.diff !== 0" :name="comparison.diff > 0 ? 'arrow-up' : 'arrow-down'" :size="16" />
                {{ formatSignedMoney(comparison.diff) }}
              </strong>
              <span class="fig-sub" data-compare="pct">{{ comparison.pct !== null ? formatPercent(comparison.pct) : comparison.current > 0 ? 'antes: nada registrado' : '' }}</span>
            </div>
          </div>

          <h4 class="sub-title">Por categoria</h4>
          <div class="legend" aria-hidden="true">
            <span><i class="key current" /> {{ label }} (na cor da categoria)</span>
            <span><i class="key previous" /> {{ previousLabel }}</span>
          </div>
          <ul class="cat-rows">
            <li v-for="item in comparison.categories" :key="item.categoryId ?? ''">
              <div class="cat-line">
                <span class="cat-name"><i class="dot" :style="{ background: categoryColor(item.categoryId) }" />{{ finance.categoryName(item.categoryId) }}</span>
                <span class="cat-values">
                  {{ formatMoney(item.current) }} <span class="vs">× {{ formatMoney(item.previous) }}</span>
                </span>
                <span class="cat-change" :class="direction(item.diff)">{{ changeText(item.current, item.previous, item.pct) }}</span>
              </div>
              <div class="pair">
                <div class="bar"><i :style="{ width: `${(item.current / maxCategory) * 100}%`, background: categoryColor(item.categoryId) }" /></div>
                <div class="bar"><i class="previous" :style="{ width: `${(item.previous / maxCategory) * 100}%` }" /></div>
              </div>
            </li>
          </ul>

          <div v-if="up.length || down.length" class="movers">
            <div>
              <h4 class="sub-title"><AppIcon name="arrow-up" :size="14" /> Aumentaram</h4>
              <ul v-if="up.length" class="mover-list">
                <li v-for="item in up" :key="item.categoryId ?? ''">
                  <i class="dot" :style="{ background: categoryColor(item.categoryId) }" />
                  <span class="mover-name">{{ finance.categoryName(item.categoryId) }}</span>
                  <span class="mover-delta">{{ formatSignedMoney(item.diff) }}</span>
                </li>
              </ul>
              <p v-else class="none">Nenhuma categoria.</p>
            </div>
            <div>
              <h4 class="sub-title"><AppIcon name="arrow-down" :size="14" /> Diminuíram</h4>
              <ul v-if="down.length" class="mover-list">
                <li v-for="item in down" :key="item.categoryId ?? ''">
                  <i class="dot" :style="{ background: categoryColor(item.categoryId) }" />
                  <span class="mover-name">{{ finance.categoryName(item.categoryId) }}</span>
                  <span class="mover-delta">{{ formatSignedMoney(item.diff) }}</span>
                </li>
              </ul>
              <p v-else class="none">Nenhuma categoria.</p>
            </div>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 14px;
  --chart-previous: color-mix(in srgb, var(--text-3) 55%, transparent);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
}
.select.sm {
  width: auto;
  min-height: 32px;
  padding-top: 4px;
  padding-bottom: 4px;
  font-size: 13px;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 14px 16px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-2);
}
.tile-label {
  font-size: 12.5px;
  color: var(--text-3);
}
.tile-value {
  overflow: hidden;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.tile-delta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  overflow: hidden;
  font-size: 12px;
  color: var(--text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Gastar mais é o "alerta" aqui: subiu em vermelho, caiu em verde */
.tile-delta.up,
.fig-value.up,
.cat-change.up {
  color: var(--danger);
}
.tile-delta.down,
.fig-value.down,
.cat-change.down {
  color: var(--success, var(--cat-green));
}
.tile-delta.same {
  color: var(--text-3);
}
.card {
  padding: 16px 18px 18px;
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
  container-type: inline-size;
}
.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  margin-bottom: 12px;
}
.card-head h3 {
  font-size: 14px;
  font-weight: 650;
}
.card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-2);
  cursor: pointer;
}
.check input {
  accent-color: var(--primary);
}
.card-empty {
  padding: 18px 0;
  font-size: 13px;
  color: var(--text-3);
  text-align: center;
}
.grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.table th {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  color: var(--text-3);
  font-weight: 600;
  text-align: left;
}
.table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
}
.table tr.future td {
  color: var(--text-3);
}
.table th:not(:first-child),
.table td:not(:first-child) {
  text-align: right;
}
.biggest {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.big-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.big-row:hover {
  background: var(--hover);
}
.big-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.big-name {
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.big-meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.big-value {
  flex: none;
  font-size: 13.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.track {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: var(--surface-3);
  overflow: hidden;
}
.track i {
  display: block;
  height: 100%;
  border-radius: 3px;
}
.note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 12.5px;
  color: var(--text-3);
}
.note .app-icon {
  margin-top: 2px;
}
.figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.figure {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 10px 12px;
  border-radius: var(--r-lg);
  background: var(--surface-3);
}
.fig-label,
.fig-sub {
  overflow: hidden;
  font-size: 12px;
  color: var(--text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fig-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 18px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.muted-value {
  color: var(--text-2);
}
.sub-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 16px 0 6px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-bottom: 8px;
  font-size: 11.5px;
  color: var(--text-3);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.key {
  width: 12px;
  height: 6px;
  border-radius: 3px;
}
.key.current {
  background: var(--primary);
}
.key.previous {
  background: var(--chart-previous);
}
.cat-rows,
.mover-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cat-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
}
.cat-name {
  display: inline-flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cat-values {
  flex: none;
  font-variant-numeric: tabular-nums;
}
.vs {
  color: var(--text-3);
}
.cat-change {
  flex: none;
  min-width: 48px;
  font-size: 12px;
  font-weight: 650;
  text-align: right;
}
.cat-change.same {
  color: var(--text-3);
}
.pair {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}
.bar {
  height: 5px;
  border-radius: 3px;
  background: var(--surface-3);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 3px;
}
.bar i.previous {
  background: var(--chart-previous);
}
.dot {
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
}
.movers {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.mover-list li {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}
.mover-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mover-delta {
  flex: none;
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}
.none {
  font-size: 13px;
  color: var(--text-3);
}
.dash-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 56px 20px;
  text-align: center;
  color: var(--text-3);
}
.dash-empty h3 {
  color: var(--text);
  font-size: 15px;
}
.dash-empty p {
  max-width: 480px;
  font-size: 13px;
  line-height: 1.55;
}
.dash-empty .btn {
  margin-top: 6px;
}
@media (max-width: 980px) {
  .tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 760px) {
  .grid-2,
  .movers {
    grid-template-columns: minmax(0, 1fr);
  }
}
@container (max-width: 520px) {
  .figures {
    grid-template-columns: minmax(0, 1fr);
  }
}
html[data-layout='compact'] .card {
  padding: 14px 12px 16px;
  border-radius: var(--r-lg);
}
html[data-layout='compact'] .tile {
  padding: 12px;
}
html[data-layout='compact'] .tile-value {
  font-size: 19px;
}
html[data-layout='compact'] .tile-delta {
  white-space: normal;
}
html[data-layout='compact'] .big-line {
  flex-wrap: wrap;
}
html[data-layout='compact'] .big-meta {
  order: 3;
  flex-basis: 100%;
}
</style>
