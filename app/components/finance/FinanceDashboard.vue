<script setup lang="ts">
/**
 * Finanças › painel (1.7.0; saldo na 1.7.1): para entender para onde vai o dinheiro,
 * sempre com os lançamentos registrados (nada de exemplo).
 *
 * - Saldo (1.7.1): o REALIZADO (saldo inicial, se você informou, + entradas recebidas −
 *   gastos pagos, até hoje; sem saldo inicial é só uma estimativa) e o PROJETADO (o
 *   realizado − vencidos, pendentes e as próximas contas + as entradas previstas, até a
 *   data escolhida); no período: entradas recebidas e gastos pagos. Uma conta pendente
 *   nunca é descontada como se estivesse paga. O saldo é da conta toda (sem o filtro de
 *   categoria).
 * - Os gráficos usam os gastos PAGOS, cada um no dia em que foi pago, e respondem ao
 *   período e à categoria escolhidos.
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
import { formatDateBR } from '~/lib/dates'
import { balanceSummary, cashFlow } from '~/lib/finance/bills'
import { formatAmountInput, formatMoney, formatSignedMoney, MONEY_FORMAT, parseAmount } from '~/lib/finance/format'
import { filterExpenses, paidExpenses, type Expense } from '~/lib/finance/model'
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
import { useFinanceStore, type ForecastHorizon } from '~/stores/finance'

const emit = defineEmits<{ add: [] }>()
const finance = useFinanceStore()
const today = finance.today
const weekStart = computed(() => finance.state.settings.weekStart)

const period = computed<Period>({
  get: () => finance.state.dashboardPeriod ?? periodOf('month', today.value, weekStart.value),
  set: (value) => (finance.state.dashboardPeriod = value),
})
const categoryChoice = ref<(string | null)[]>([])
const categoryFilter = computed(() => categoryChoice.value)

/** Os gastos pagos (no dia do pagamento) com o filtro de categoria (o período é aplicado em cada conta). */
const paid = computed(() => paidExpenses(finance.state.expenses))
const scoped = computed(() => filterExpenses(paid.value, { category: categoryFilter.value, knownCategories: finance.knownCategoryIds.value }))
const hasAnything = computed(() => !!finance.state.expenses.length || !!finance.state.recurrences.length || !!finance.state.openingBalance)

// ── Saldo ───────────────────────────────────────────────────────────────────

const horizon = computed({
  get: () => finance.state.horizon,
  set: (value: ForecastHorizon) => finance.setHorizon(value),
})
const HORIZONS = [
  { value: 'month' as const, label: 'Fim do mês' },
  { value: '30' as const, label: '30 dias' },
  { value: '90' as const, label: '90 dias' },
]
const balance = computed(() => balanceSummary(finance.state.expenses, finance.state.recurrences, finance.state.openingBalance, today.value, finance.horizonEnd.value))
const flow = computed(() => cashFlow(finance.state.expenses, period.value.from, period.value.to))

const editingOpening = ref(false)
const openingText = ref('')
const openingDate = ref('')
const openingError = ref<string | null>(null)

function startOpening() {
  const current = finance.state.openingBalance
  openingText.value = current ? `${current.amount < 0 ? '-' : ''}${formatAmountInput(Math.abs(current.amount))}` : ''
  openingDate.value = current?.date ?? today.value
  openingError.value = null
  editingOpening.value = true
}

/** "1.234,56", "-80,00", "0" → centavos com sinal (null = inválido). */
function parseBalance(text: string): number | null {
  const trimmed = text.trim()
  const negative = /^[-−]/.test(trimmed)
  const rest = trimmed.replace(/^[-−]\s*/, '')
  if (/^(R\$\s*)?0+([.,]0{1,2})?$/i.test(rest)) return 0
  const value = parseAmount(rest)
  return value === null ? null : negative ? -value : value
}

function saveOpening() {
  const amount = parseBalance(openingText.value)
  if (amount === null) {
    openingError.value = 'Valor inválido. Exemplos: 1.500,00 ou -80,00.'
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDate.value)) {
    openingError.value = 'Escolha o dia desse saldo.'
    return
  }
  if (finance.setOpeningBalance({ amount, date: openingDate.value })) editingOpening.value = false
}

function clearOpening() {
  if (finance.setOpeningBalance(null)) editingOpening.value = false
}
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
      <CategorySelect v-model="categoryChoice" module="finance" multiple size="sm" label="Filtrar por categoria" data-filter="dashboard-category" />
    </div>

    <div v-if="!hasAnything" class="dash-empty">
      <AppIcon name="chart" :size="32" />
      <h3>Ainda não há lançamentos</h3>
      <p>
        O painel usa só os seus registros: o saldo (realizado e projetado), o total do período, a evolução, as categorias, os dias e os maiores gastos, e a
        comparação com o período anterior. Registre o primeiro e ele aparece aqui.
      </p>
      <button type="button" class="btn btn-primary" @click="emit('add')"><AppIcon name="plus" :size="15" /> Registrar</button>
    </div>

    <template v-else>
      <!-- Saldo -->
      <section class="card balance-card" data-section="balance">
        <header class="card-head">
          <h3>Saldo</h3>
          <div class="card-actions">
            <UiSegmented v-model="horizon" :options="HORIZONS" size="sm" aria-label="Projeção até" data-field="dashboard-horizon" />
            <button type="button" class="btn btn-sm btn-ghost" data-action="opening-balance" @click="startOpening">
              <AppIcon name="edit" :size="13" /> {{ finance.state.openingBalance ? 'Saldo inicial' : 'Informar saldo inicial' }}
            </button>
          </div>
        </header>
        <form v-if="editingOpening" class="opening" data-opening-form @submit.prevent="saveOpening">
          <p class="opening-help">O saldo da sua conta num dia (no fim dele). Os lançamentos depois desse dia entram na conta.</p>
          <div class="opening-row">
            <label class="opening-field">
              <span>Saldo</span>
              <span class="amount-box"><span class="currency">R$</span><input v-model="openingText" class="amount-input" inputmode="decimal" autocomplete="off" placeholder="0,00" data-field="opening-amount" @input="openingError = null" /></span>
            </label>
            <label class="opening-field">
              <span>Em</span>
              <input v-model="openingDate" class="input" type="date" data-field="opening-date" />
            </label>
            <div class="opening-actions">
              <button v-if="finance.state.openingBalance" type="button" class="btn btn-sm btn-ghost" @click="clearOpening">Remover</button>
              <button type="button" class="btn btn-sm btn-ghost" @click="editingOpening = false">Cancelar</button>
              <button type="submit" class="btn btn-sm btn-primary" data-action="save-opening">Salvar</button>
            </div>
          </div>
          <p v-if="openingError" class="opening-error" role="alert">{{ openingError }}</p>
        </form>
        <div class="balance-figures">
          <div class="bfig">
            <span class="bfig-label">Saldo realizado <span v-if="balance.estimated" class="estimate" data-balance-estimate>estimativa</span></span>
            <strong class="bfig-value" :class="{ negative: balance.realized < 0 }" data-balance="realized">{{ formatMoney(balance.realized) }}</strong>
            <span class="bfig-sub">
              {{
                balance.estimated
                  ? 'Só com o que você registrou (sem saldo inicial): não é o saldo do banco.'
                  : `Saldo de ${formatDateBR(balance.since!)} + o que entrou − o que foi pago depois, até hoje.`
              }}
            </span>
          </div>
          <div class="bfig">
            <span class="bfig-label">Saldo projetado até {{ formatDateBR(balance.until) }}</span>
            <strong class="bfig-value projected" :class="{ negative: balance.projected < 0 }" data-balance="projected">{{ formatMoney(balance.projected) }}</strong>
            <span class="bfig-sub">Depois das contas pendentes e vencidas, das próximas e das entradas previstas.</span>
          </div>
        </div>
        <dl class="breakdown">
          <div><dt>Entradas recebidas · {{ label.toLowerCase() }}</dt><dd class="positive" data-balance="received">+{{ formatMoney(flow.received) }}</dd></div>
          <div><dt>Gastos pagos · {{ label.toLowerCase() }}</dt><dd data-balance="paid">{{ formatMoney(flow.paid) }}</dd></div>
          <div><dt>Pendentes (a vencer até {{ formatDateBR(balance.until).slice(0, 5) }})</dt><dd data-balance="pending">{{ formatMoney(balance.pending) }} <span class="count">{{ balance.pendingCount }}</span></dd></div>
          <div><dt>Vencidas</dt><dd :class="{ negative: balance.overdue > 0 }" data-balance="overdue">{{ formatMoney(balance.overdue) }} <span class="count">{{ balance.overdueCount }}</span></dd></div>
          <div><dt>Comprometido com pagamentos</dt><dd data-balance="committed">{{ formatMoney(balance.committed) }}</dd></div>
          <div><dt>Entradas previstas</dt><dd class="positive" data-balance="expected">+{{ formatMoney(balance.expected) }}</dd></div>
        </dl>
      </section>

      <div class="tiles" data-section="spending">
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
.balance-card {
  background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 7%, var(--surface)), var(--surface) 60%);
}
.balance-figures {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 18px;
}
.bfig {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.bfig-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-3);
}
.estimate {
  padding: 0 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--text-2);
  font-size: 11px;
  line-height: 17px;
}
.bfig-value {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}
.bfig-value.projected {
  color: var(--text-2);
}
.bfig-sub {
  font-size: 12px;
  color: var(--text-3);
}
.negative {
  color: var(--danger) !important;
}
.positive {
  color: var(--success);
}
.breakdown {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
  margin: 14px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.breakdown > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 0;
  font-size: 13px;
}
.breakdown dt {
  min-width: 0;
  color: var(--text-2);
}
.breakdown dd {
  flex: none;
  margin: 0;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.count {
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-3);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
}
.opening {
  margin-bottom: 14px;
  padding: 12px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-2);
}
.opening-help {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-3);
}
.opening-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}
.opening-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text-3);
}
.opening-field .input {
  height: 34px;
}
.amount-box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
}
.amount-box:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}
.currency {
  color: var(--text-3);
  font-weight: 650;
}
.amount-input {
  width: 120px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.opening-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.opening-error {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--danger);
}
@container (max-width: 520px) {
  .balance-figures,
  .breakdown {
    grid-template-columns: 1fr;
  }
}
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
