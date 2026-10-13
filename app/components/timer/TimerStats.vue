<script setup lang="ts">
/**
 * Timer › Estatísticas: para onde o seu tempo foi — só com o que está no histórico
 * (nada de dados de exemplo). Um período (dia, semana, mês, ano ou intervalo) e uma
 * categoria escolhidos em cima valem para tudo embaixo:
 *  - números do período (total, sessões, duração média, o dia com mais tempo);
 *  - evolução (colunas), com o período anterior lado a lado se quiser, e a tabela;
 *  - distribuição por categoria e tempo por atividade;
 *  - comparação com o período anterior equivalente;
 *  - "Detalhado": quando você registra tempo (dias × horas, partes do dia, dias da
 *    semana) e a tabela por categoria.
 * A sessão em andamento entra quando for finalizada.
 */
import { computed, ref } from 'vue'
import { useNow } from '~/composables/useNow'
import { useToday } from '~/composables/useToday'
import { paletteVar } from '~/lib/colors'
import { formatDuration, formatPercent, formatTimeOfDay } from '~/lib/timer/format'
import {
  aggregate,
  busiestDay,
  compare,
  comparisonRanges,
  evolution,
  evolutionUnit,
  partsOfDay,
  periodBounds,
  periodLabel,
  periodOf,
  weekdayName,
  weekdayOrder,
  type CategoryFilter,
  type Period,
} from '~/lib/timer/stats'
import { useTimerStore } from '~/stores/timer'

const emit = defineEmits<{ session: [] }>()
const timer = useTimerStore()
const { today } = useToday()
const nowRef = useNow()

const weekStart = computed(() => timer.state.settings.weekStart)
const period = ref<Period>(periodOf('week', today.value, timer.state.settings.weekStart))
const categoryChoice = ref('all')
const view = ref<'summary' | 'detailed'>('summary')
const overlay = ref(false)
const showTable = ref(false)

const VIEWS = [
  { value: 'summary' as const, label: 'Resumo' },
  { value: 'detailed' as const, label: 'Detalhado' },
]

/** "Agora" para os cálculos (o relógio do Timer quando está contando; senão, a cada 30 s). */
const now = computed(() => Math.max(nowRef.value, timer.state.now))

const categoryFilter = computed<CategoryFilter>(() =>
  categoryChoice.value === 'all' ? undefined : categoryChoice.value === 'none' ? null : categoryChoice.value,
)
const options = computed(() => ({ category: categoryFilter.value, knownCategories: timer.knownCategoryIds.value }))
const sessions = computed(() => timer.state.sessions)

const data = computed(() => aggregate(sessions.value, periodBounds(period.value), options.value))
const ranges = computed(() => comparisonRanges(period.value, now.value, weekStart.value))
const comparison = computed(() =>
  compare(sessions.value, ranges.value, {
    ...options.value,
    categoryName: (id) => timer.categoryName(id),
  }),
)
const points = computed(() => evolution(sessions.value, period.value, now.value, options.value))
const previousPoints = computed(() => {
  if (!overlay.value) return null
  const previous = evolution(sessions.value, ranges.value.previousPeriod, now.value, options.value)
  return points.value.map((_, index) => previous[index]?.ms ?? 0)
})

const label = computed(() => periodLabel(period.value, today.value))
const previousLabel = computed(() => periodLabel(ranges.value.previousPeriod, today.value))
const unit = computed(() => evolutionUnit(period.value))

const categoryColor = (id: string | null) => {
  const category = id ? timer.categoryById.value.get(id) : null
  return category ? paletteVar(category.color) : 'var(--cat-gray)'
}

/** Período em andamento: a comparação vai só até agora, nos dois períodos. */
const partialNote = computed(() => {
  if (!ranges.value.partial) return null
  const until = new Date(ranges.value.current[1])
  const time = formatTimeOfDay(until.getTime())
  const point =
    period.value.kind === 'day'
      ? `até as ${time}`
      : period.value.kind === 'week'
        ? `até ${weekdayName(until.getDay(), true)} ${time}`
        : `até ${until.getDate()}/${String(until.getMonth() + 1).padStart(2, '0')} ${time}`
  const previous = previousLabel.value.replace(/\.$/, '')
  return `O período ainda não acabou: comparando ${point} com o mesmo trecho de ${previous}.`
})

// ── Números do período ──────────────────────────────────────────────────────

const busiest = computed(() => {
  if (period.value.kind === 'day') {
    let best = -1
    data.value.hours.forEach((ms, hour) => {
      if (ms > 0 && (best < 0 || ms > data.value.hours[best]!)) best = hour
    })
    return best < 0
      ? null
      : {
          title: 'Hora com mais tempo',
          value: `${best}h – ${best + 1}h`,
          detail: formatDuration(data.value.hours[best]!, { seconds: false }),
        }
  }
  const day = busiestDay(data.value.days)
  if (!day) return null
  const [y, m, d] = day.day.split('-').map(Number) as [number, number, number]
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return {
    title: 'Dia com mais tempo',
    value: `${weekdayName(weekday, true)}, ${d}/${String(m).padStart(2, '0')}`,
    detail: formatDuration(day.ms, { seconds: false }),
  }
})

const topCategory = computed(() => {
  const first = data.value.categories[0]
  if (!first || data.value.total <= 0) return null
  return { name: timer.categoryName(first.categoryId), share: first.ms / data.value.total }
})

/** Variação do total em relação ao período anterior equivalente (sem "+∞%"). */
const totalDelta = computed(() => {
  const { pct, current, previous } = comparison.value
  if (pct !== null)
    return { text: `${formatPercent(pct)} vs. ${previousLabel.value}`, dir: pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : 'same' }
  if (current.total > 0 && previous.total <= 0) return { text: `antes: nada registrado`, dir: 'same' }
  return null
})

// ── Gráficos ────────────────────────────────────────────────────────────────

const donutItems = computed(() =>
  data.value.categories.map((item) => ({
    key: item.categoryId ?? '',
    label: timer.categoryName(item.categoryId),
    color: categoryColor(item.categoryId),
    ms: item.ms,
  })),
)
const activityRows = computed(() =>
  data.value.activities.map((item) => ({
    key: item.key,
    label: item.activity,
    detail: `${timer.categoryName(item.categoryId)} · ${item.sessions} ${item.sessions === 1 ? 'sessão' : 'sessões'}`,
    color: categoryColor(item.categoryId),
    ms: item.ms,
  })),
)
const partRows = computed(() =>
  partsOfDay(data.value.hours).map((part) => ({ key: part.id, label: part.label, color: 'var(--primary)', ms: part.ms })),
)
const weekdayRows = computed(() =>
  weekdayOrder(weekStart.value).map((day) => ({
    key: String(day),
    label: weekdayName(day),
    color: 'var(--primary)',
    ms: data.value.weekdays[day]!,
  })),
)
const categoryTable = computed(() =>
  data.value.categories.map((item) => ({
    ...item,
    name: timer.categoryName(item.categoryId),
    share: data.value.total > 0 ? item.ms / data.value.total : 0,
    average: item.sessions ? item.ms / item.sessions : 0,
  })),
)

const evolutionTitle = computed(() =>
  unit.value === 'hour' ? 'Tempo por hora' : unit.value === 'month' ? 'Tempo por mês' : 'Tempo por dia',
)
const hasAny = computed(() => sessions.value.some((session) => session.duration > 0))

const navRef = ref<{ shift: (delta: number) => void }>()
defineExpose({ shiftPeriod: (delta: number) => navRef.value?.shift(delta) })
</script>

<template>
  <div class="stats">
    <div class="filters">
      <PeriodNav ref="navRef" v-model="period" :week-start="weekStart" :today="today" />
      <div class="filters-side">
        <select v-model="categoryChoice" class="select sm" aria-label="Categoria">
          <option value="all">Todas as categorias</option>
          <option value="none">Sem categoria</option>
          <option v-for="category in timer.state.categories" :key="category.id" :value="category.id">{{ category.name }}</option>
        </select>
        <UiSegmented v-model="view" :options="VIEWS" size="sm" aria-label="Visão" />
      </div>
    </div>

    <div v-if="!hasAny" class="stats-empty">
      <AppIcon name="chart" :size="32" />
      <h3>Ainda não há tempo registrado</h3>
      <p>Os gráficos usam só as suas sessões. Finalize a primeira e ela aparece aqui.</p>
      <button type="button" class="btn btn-primary" @click="emit('session')"><AppIcon name="play" :size="15" /> Começar uma sessão</button>
    </div>

    <template v-else>
      <p v-if="timer.state.active" class="live-note">
        <AppIcon name="info" :size="13" /> A sessão em andamento entra nas estatísticas quando for finalizada.
      </p>

      <!-- Números do período -->
      <div class="tiles">
        <div class="tile">
          <span class="tile-label">Tempo total</span>
          <strong class="tile-value" data-stat="total">{{ formatDuration(data.total, { seconds: false }) }}</strong>
          <span v-if="totalDelta" class="tile-delta" :class="totalDelta.dir">
            <AppIcon v-if="totalDelta.dir !== 'same'" :name="totalDelta.dir === 'up' ? 'arrow-up' : 'arrow-down'" :size="12" />
            {{ totalDelta.text }}
          </span>
        </div>
        <div class="tile">
          <span class="tile-label">Sessões</span>
          <strong class="tile-value" data-stat="sessions">{{ data.sessions }}</strong>
          <span class="tile-delta same">antes: {{ comparison.previous.sessions }}</span>
        </div>
        <div class="tile">
          <span class="tile-label">Duração média</span>
          <strong class="tile-value" data-stat="average">{{
            data.sessions ? formatDuration(data.average, { seconds: false }) : '—'
          }}</strong>
          <span v-if="topCategory" class="tile-delta same">{{ Math.round(topCategory.share * 100) }}% em {{ topCategory.name }}</span>
        </div>
        <div class="tile">
          <span class="tile-label">{{ busiest?.title ?? (period.kind === 'day' ? 'Hora com mais tempo' : 'Dia com mais tempo') }}</span>
          <strong class="tile-value">{{ busiest?.value ?? '—' }}</strong>
          <span v-if="busiest" class="tile-delta same">{{ busiest.detail }}</span>
        </div>
      </div>

      <!-- Evolução -->
      <section class="card">
        <header class="card-head">
          <h3>{{ evolutionTitle }}</h3>
          <div class="card-actions">
            <label class="check"><input v-model="overlay" type="checkbox" data-action="overlay-previous" /> Comparar com o anterior</label>
            <button type="button" class="btn btn-sm btn-ghost" :aria-pressed="showTable" @click="showTable = !showTable">
              <AppIcon :name="showTable ? 'chart' : 'list'" :size="14" /> {{ showTable ? 'Gráfico' : 'Tabela' }}
            </button>
          </div>
        </header>
        <p v-if="data.total <= 0 && (!previousPoints || !previousPoints.some((ms) => ms > 0))" class="card-empty">
          Nenhum tempo registrado em {{ label.toLowerCase() === 'hoje' ? 'hoje' : label }}.
        </p>
        <table v-else-if="showTable" class="table">
          <thead>
            <tr>
              <th>{{ unit === 'hour' ? 'Hora' : unit === 'month' ? 'Mês' : 'Dia' }}</th>
              <th>{{ label }}</th>
              <th v-if="previousPoints">{{ previousLabel }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(point, index) in points" :key="point.key" :class="{ future: point.future }">
              <td>{{ point.title }}</td>
              <td>{{ point.future ? '—' : formatDuration(point.ms, { seconds: false }) }}</td>
              <td v-if="previousPoints">{{ formatDuration(previousPoints[index] ?? 0, { seconds: false }) }}</td>
            </tr>
          </tbody>
        </table>
        <TimerColumns v-else :points="points" :previous="previousPoints" :current-label="label" :previous-label="previousLabel" />
      </section>

      <div class="grid-2">
        <section class="card donut-card">
          <header class="card-head"><h3>Por categoria</h3></header>
          <TimerDonut v-if="data.total > 0" :items="donutItems" :total="data.total" />
          <p v-else class="card-empty">Sem tempo neste período.</p>
        </section>
        <section class="card">
          <header class="card-head"><h3>Por atividade</h3></header>
          <TimerBarList :rows="activityRows" :limit="7" empty-label="Sem tempo neste período." />
        </section>
      </div>

      <!-- Comparação -->
      <section class="card" data-section="comparison">
        <header class="card-head">
          <h3>{{ label }} × {{ previousLabel }}</h3>
        </header>
        <TimerCompare
          :comparison="comparison"
          :current-label="label"
          :previous-label="previousLabel"
          :partial-note="partialNote"
          :category-color="categoryColor"
        />
      </section>

      <!-- Detalhado -->
      <template v-if="view === 'detailed'">
        <section v-if="period.kind !== 'day'" class="card">
          <header class="card-head"><h3>Quando você registra tempo</h3></header>
          <TimerHeatmap :heat="data.heat" :week-start="weekStart" />
        </section>
        <div class="grid-2">
          <section class="card">
            <header class="card-head"><h3>Partes do dia</h3></header>
            <TimerBarList :rows="partRows" :limit="4" />
          </section>
          <section class="card">
            <header class="card-head"><h3>Dias da semana</h3></header>
            <TimerBarList :rows="weekdayRows" :limit="7" />
          </section>
        </div>
        <section class="card">
          <header class="card-head"><h3>Categorias em números</h3></header>
          <table v-if="categoryTable.length" class="table">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Tempo</th>
                <th>%</th>
                <th>Sessões</th>
                <th>Média</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in categoryTable" :key="row.categoryId ?? ''">
                <td><i class="dot" :style="{ background: categoryColor(row.categoryId) }" /> {{ row.name }}</td>
                <td>{{ formatDuration(row.ms, { seconds: false }) }}</td>
                <td>{{ Math.round(row.share * 100) }}%</td>
                <td>{{ row.sessions }}</td>
                <td>{{ formatDuration(row.average, { seconds: false }) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="card-empty">Sem tempo neste período.</p>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.stats {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
}
.filters-side {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.select.sm {
  width: auto;
  min-height: 32px;
  padding-top: 4px;
  padding-bottom: 4px;
  font-size: 13px;
}
.live-note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-3);
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
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
}
.stats-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 56px 20px;
  text-align: center;
  color: var(--text-3);
}
.stats-empty h3 {
  color: var(--text);
  font-size: 15px;
}
.stats-empty p {
  max-width: 420px;
  font-size: 13px;
}
.stats-empty .btn {
  margin-top: 6px;
}
@media (max-width: 980px) {
  .tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 760px) {
  .grid-2 {
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
/* Celular: o texto de baixo do número quebra em vez de cortar */
html[data-layout='compact'] .tile-delta {
  white-space: normal;
}
</style>
