<script setup lang="ts">
/**
 * Finanças › lançamentos › histórico (1.7.0; entradas, contas e extratos na 1.7.1): os
 * gastos e as entradas, por dia (ou pelo valor). Período (com ‹ › para o anterior e o
 * próximo, ou "Tudo"), busca, gasto/entrada, categoria e ordem; os totais do que está na
 * tela ficam em cima.
 *
 * - Um lançamento pago conta no dia em que foi pago (o vencimento aparece embaixo);
 *   pendentes e vencidos aparecem marcados, com "Pagar" na própria linha.
 * - As próximas ocorrências das recorrências dentro do período aparecem em "Previstas".
 * Clique num lançamento para ver e editar; botão direito: abrir, pagar, pular, repetir,
 * categoria, ver menções, excluir. Abrir uma menção a um lançamento traz ele para a tela.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { separator, showContextMenu, type MenuItemSpec } from '~/composables/useContextMenu'
import { paletteVar } from '~/lib/colors'
import { addDays, formatDateBR, relativeDayLabel, type ISODate } from '~/lib/dates'
import { formatMoney } from '~/lib/finance/format'
import { entryState, filterExpenses, groupByDay, SORT_LABELS, sortExpenses, stateLabel, type EntryKind, type Expense, type ExpenseSort } from '~/lib/finance/model'
import type { UpcomingItem } from '~/lib/finance/bills'
import { weekdayName } from '~/lib/timer/stats'
import { expenseSubject, showMentionsOf } from '~/stores/mentions'
import { useFinanceStore } from '~/stores/finance'

const emit = defineEmits<{ add: []; import: [] }>()
const finance = useFinanceStore()
const today = finance.today

const searchInput = ref<HTMLInputElement>()
const limit = ref(150)

const period = computed({
  get: () => finance.state.period,
  set: (value) => (finance.state.period = value),
})
const categoryChoice = computed({
  get: () => (finance.state.category === undefined ? 'all' : finance.state.category === null ? 'none' : finance.state.category),
  set: (value: string) => (finance.state.category = value === 'all' ? undefined : value === 'none' ? null : value),
})
const kindChoice = computed({
  get: () => finance.state.kind,
  set: (value: EntryKind | 'all') => (finance.state.kind = value),
})
const sort = computed({
  get: () => finance.state.sort,
  set: (value: ExpenseSort) => finance.setSort(value),
})
const SORTS = Object.entries(SORT_LABELS) as [ExpenseSort, string][]

/** Cada lançamento no dia em que o dinheiro mexeu (o pago, no dia do pagamento). */
const view = computed(() => finance.state.expenses.map((entry) => (entry.status === 'done' && entry.doneOn && entry.doneOn !== entry.date ? { ...entry, date: entry.doneOn } : entry)))
const filtered = computed(() =>
  filterExpenses(view.value, {
    from: period.value?.from ?? null,
    to: period.value?.to ?? null,
    category: finance.state.category,
    search: finance.state.search,
    knownCategories: finance.knownCategoryIds.value,
    kind: finance.state.kind === 'all' ? undefined : finance.state.kind,
  }),
)
const sorted = computed(() => sortExpenses(filtered.value, sort.value))
const byDay = computed(() => sort.value === 'date-desc' || sort.value === 'date-asc')
const visible = computed(() => sorted.value.slice(0, limit.value))
const groups = computed(() => (byDay.value ? groupByDay(visible.value) : [{ date: '', expenses: visible.value, total: 0 }]))
/** Totais de cada dia (com todos os lançamentos dele, não só os que já estão na tela): saídas e entradas. */
const dayTotals = computed(() => {
  const map = new Map<ISODate, { out: number; in: number }>()
  for (const entry of filtered.value) {
    if (entry.status === 'cancelled') continue
    const item = map.get(entry.date) ?? { out: 0, in: 0 }
    if (entry.kind === 'income') item.in += entry.amount
    else item.out += entry.amount
    map.set(entry.date, item)
  }
  return map
})

watch([period, () => finance.state.search, () => finance.state.category, () => finance.state.kind, sort], () => (limit.value = 150))

const totals = computed(() => {
  const result = { count: filtered.value.length, paid: 0, paidCount: 0, received: 0, receivedCount: 0, pending: 0, pendingCount: 0 }
  for (const entry of filtered.value) {
    if (entry.status === 'cancelled') continue
    if (entry.status === 'pending') {
      if (entry.kind === 'expense') {
        result.pending += entry.amount
        result.pendingCount++
      }
    } else if (entry.kind === 'income') {
      result.received += entry.amount
      result.receivedCount++
    } else {
      result.paid += entry.amount
      result.paidCount++
    }
  }
  return result
})
const hasFilters = computed(() => !!finance.state.search.trim() || finance.state.category !== undefined || finance.state.kind !== 'all')

function clearFilters() {
  finance.state.search = ''
  finance.state.category = undefined
  finance.state.kind = 'all'
}

/** As ocorrências previstas (ainda não lançadas) dentro do período, de amanhã em diante. */
const forecast = computed<UpcomingItem[]>(() => {
  const range = period.value
  if (!range || range.to <= today.value) return []
  const from = range.from > today.value ? range.from : addDays(today.value, 1)
  const search = finance.state.search.trim().toLocaleLowerCase('pt-BR')
  return finance
    .upcomingUntil(range.to)
    .filter((item) => !item.stored && item.date >= from)
    .filter((item) => finance.state.kind === 'all' || item.kind === finance.state.kind)
    .filter((item) => finance.state.category === undefined || (item.categoryId && finance.knownCategoryIds.value.has(item.categoryId) ? item.categoryId : null) === finance.state.category)
    .filter((item) => !search || item.description.toLocaleLowerCase('pt-BR').includes(search))
})
const showForecast = ref(true)

function dayLabel(day: ISODate): { label: string; detail: string } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const relative = relativeDayLabel(day, today.value)
  const named = relative === 'Hoje' || relative === 'Ontem' || relative === 'Amanhã'
  return { label: named ? relative : `${weekdayName(weekday)}, ${formatDateBR(day)}`, detail: named ? formatDateBR(day) : '' }
}

function categoryColor(entry: Pick<Expense, 'categoryId'>): string | null {
  const category = finance.categoryOf(entry)
  return category ? paletteVar(category.color) : null
}

const original = (entry: Expense) => finance.findExpense(entry.id) ?? entry
const stateOf = (entry: Expense) => entryState(original(entry), today.value)

function pay(entry: Expense) {
  finance.confirmEntry(entry.id)
}

async function rowMenu(entry: Expense) {
  const current = finance.categoryOf(entry)
  const real = original(entry)
  const categoryItems: MenuItemSpec[] = [
    { id: 'category:', label: 'Sem categoria', type: 'radio', checked: !current },
    ...finance.state.categories.map((category) => ({
      id: `category:${category.id}`,
      label: category.name,
      type: 'radio' as const,
      checked: current?.id === category.id,
      swatch: paletteVar(category.color),
    })),
  ]
  const income = real.kind === 'income'
  const choice = await showContextMenu([
    { id: 'open', label: 'Abrir' },
    ...(real.status === 'pending' ? [{ id: 'pay', label: income ? 'Recebi' : 'Confirmar pagamento' }] : []),
    ...(real.status === 'pending' && real.recurrenceId ? [{ id: 'skip', label: 'Pular esta' }] : []),
    ...(real.status === 'cancelled' ? [{ id: 'restore', label: 'Voltar a pendente' }] : []),
    ...(real.recurrenceId && finance.findRecurrence(real.recurrenceId) ? [{ id: 'recurrence', label: 'Abrir a recorrência' }] : [{ id: 'repeat', label: 'Repetir hoje' }]),
    { label: 'Categoria', submenu: categoryItems },
    { id: 'mentions', label: 'Ver menções' },
    separator,
    { id: 'delete', label: 'Excluir…', danger: true },
  ])
  if (!choice) return
  if (choice === 'open') finance.openExpense(entry.id)
  else if (choice === 'pay') finance.confirmEntry(entry.id)
  else if (choice === 'skip') finance.skipEntry(entry.id)
  else if (choice === 'restore') finance.restoreEntry(entry.id)
  else if (choice === 'recurrence') finance.openRecurrence(real.recurrenceId)
  else if (choice === 'repeat') finance.repeatExpense(entry.id)
  else if (choice === 'mentions') showMentionsOf(expenseSubject(real))
  else if (choice === 'delete') void finance.requestDeleteExpense(entry.id)
  else if (choice.startsWith('category:')) finance.updateExpense(entry.id, { categoryId: choice.slice('category:'.length) || null })
}

// ── Abrir um lançamento mencionado ──────────────────────────────────────────

const flashId = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null

async function revealRequested(): Promise<void> {
  const request = finance.state.reveal
  if (!request) return
  finance.state.reveal = null
  const expense = finance.findExpense(request.id)
  if (!expense) return
  await nextTick()
  const index = sorted.value.findIndex((item) => item.id === expense.id)
  if (index >= limit.value) limit.value = index + 50
  await nextTick()
  document.querySelector(`.finance-history [data-expense="${CSS.escape(expense.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  flashId.value = expense.id
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flashId.value = null), 1800)
}
watch(() => finance.state.reveal?.seq, () => void revealRequested(), { immediate: true })

const navRef = ref<{ shift: (delta: number) => void }>()
defineExpose({
  shiftPeriod: (delta: number) => navRef.value?.shift(delta),
  focusSearch: () => searchInput.value?.focus(),
})
</script>

<template>
  <div class="finance-history">
    <div class="toolbar">
      <div class="toolbar-top">
        <PeriodNav ref="navRef" v-model="period" :week-start="finance.state.settings.weekStart" :today="today" allow-all all-label="Todos os lançamentos" />
        <button type="button" class="btn btn-sm import-btn" data-action="import-statement" @click="emit('import')">
          <AppIcon name="upload" :size="14" /> Importar extrato
        </button>
      </div>
      <div class="filters">
        <label class="search">
          <AppIcon name="search" :size="15" />
          <input ref="searchInput" v-model="finance.state.search" class="search-input" placeholder="Buscar pela descrição" aria-label="Buscar lançamentos" />
          <button v-if="finance.state.search" type="button" class="icon-btn sm" aria-label="Limpar busca" @click="finance.state.search = ''">
            <AppIcon name="x" :size="13" />
          </button>
        </label>
        <select v-model="kindChoice" class="select sm" aria-label="Gastos ou entradas" data-filter="kind">
          <option value="all">Gastos e entradas</option>
          <option value="expense">Só gastos</option>
          <option value="income">Só entradas</option>
        </select>
        <select v-model="categoryChoice" class="select sm" aria-label="Categoria" data-filter="category">
          <option value="all">Todas as categorias</option>
          <option value="none">Sem categoria</option>
          <option v-for="category in finance.state.categories" :key="category.id" :value="category.id">{{ category.name }}</option>
        </select>
        <select v-model="sort" class="select sm" aria-label="Ordem" data-filter="sort">
          <option v-for="[value, label] in SORTS" :key="value" :value="value">{{ label }}</option>
        </select>
      </div>
    </div>

    <!-- Previstas (recorrências) dentro do período -->
    <section v-if="forecast.length" class="forecast" data-history-forecast>
      <button type="button" class="forecast-head" :aria-expanded="showForecast" @click="showForecast = !showForecast">
        <AppIcon name="repeat" :size="14" />
        <span>Previstas neste período</span>
        <span class="forecast-count">{{ forecast.length }}</span>
        <AppIcon :name="showForecast ? 'chevron-up' : 'chevron-down'" :size="14" class="forecast-chevron" />
      </button>
      <ul v-if="showForecast" class="rows">
        <li v-for="item in forecast.slice(0, 12)" :key="item.id">
          <button type="button" class="row ghost" :data-forecast="item.id" @click="finance.openRecurrence(item.recurrenceId)">
            <span class="cat-mark" :style="{ '--c': categoryColor(item) ?? 'var(--surface-3)' }"><AppIcon :name="item.kind === 'income' ? 'money-in' : 'repeat'" :size="15" /></span>
            <span class="main">
              <span class="description">{{ item.description || finance.kindNoun(item.kind) }}</span>
              <span class="meta">
                <span class="day">{{ dayLabel(item.date).label }}</span>
                <span class="badge forecast-badge">Prevista</span>
              </span>
            </span>
            <span class="amount" :class="{ positive: item.kind === 'income' }">{{ item.kind === 'income' ? '+' : '' }}{{ formatMoney(item.amount) }}</span>
          </button>
        </li>
      </ul>
    </section>

    <div v-if="!finance.state.expenses.length" class="history-empty">
      <AppIcon name="wallet" :size="30" />
      <h3>Nenhum lançamento ainda</h3>
      <p>Digite o valor e a descrição no formulário acima e aperte Enter (gasto ou entrada). Ou importe o extrato do banco (CSV ou OFX).</p>
      <div class="empty-actions">
        <button type="button" class="btn btn-primary" @click="emit('add')"><AppIcon name="plus" :size="15" /> Registrar</button>
        <button type="button" class="btn" @click="emit('import')"><AppIcon name="upload" :size="15" /> Importar extrato</button>
      </div>
    </div>
    <div v-else-if="!filtered.length" class="history-empty">
      <AppIcon name="search" :size="28" />
      <h3>Nenhum lançamento {{ hasFilters ? 'com esses filtros' : 'neste período' }}</h3>
      <button v-if="hasFilters" type="button" class="btn btn-sm" @click="clearFilters">Limpar filtros</button>
    </div>
    <template v-else>
      <p class="summary" data-history-total>
        <template v-if="totals.paidCount || !totals.receivedCount">
          <strong data-total="paid">{{ formatMoney(totals.paid) }}</strong> em {{ totals.paidCount }} {{ totals.paidCount === 1 ? 'gasto' : 'gastos' }}
        </template>
        <template v-if="totals.receivedCount">
          <span v-if="totals.paidCount" class="sep">·</span>
          <strong class="positive" data-total="received">+{{ formatMoney(totals.received) }}</strong> em {{ totals.receivedCount }}
          {{ totals.receivedCount === 1 ? 'entrada' : 'entradas' }}
        </template>
        <template v-if="totals.pendingCount">
          <span class="sep">·</span>
          <span class="pending-total" data-total="pending">{{ formatMoney(totals.pending) }} {{ totals.pendingCount === 1 ? 'pendente' : 'pendentes' }}</span>
        </template>
      </p>
      <section v-for="group in groups" :key="group.date || 'all'" class="group">
        <h3 v-if="group.date" class="group-head">
          <span class="group-label">{{ dayLabel(group.date).label }}</span>
          <span v-if="dayLabel(group.date).detail" class="group-detail">{{ dayLabel(group.date).detail }}</span>
          <span class="group-total">
            <span v-if="dayTotals.get(group.date)?.in" class="positive">+{{ formatMoney(dayTotals.get(group.date)!.in) }}</span>
            <span v-if="dayTotals.get(group.date)?.out || !dayTotals.get(group.date)?.in">{{ formatMoney(dayTotals.get(group.date)?.out ?? 0) }}</span>
          </span>
        </h3>
        <ul class="rows">
          <li v-for="expense in group.expenses" :key="expense.id">
            <div
              role="button"
              tabindex="0"
              class="row"
              :class="[{ flash: flashId === expense.id, income: expense.kind === 'income' }, stateOf(expense)]"
              :data-expense="expense.id"
              :data-state="stateOf(expense)"
              @click="finance.openExpense(expense.id)"
              @keydown.enter.prevent="finance.openExpense(expense.id)"
              @contextmenu.prevent="rowMenu(expense)"
            >
              <span class="cat-mark" :style="{ '--c': categoryColor(expense) ?? 'var(--surface-3)' }">
                <AppIcon :name="expense.kind === 'income' ? 'money-in' : 'wallet'" :size="15" />
              </span>
              <span class="main">
                <span class="description" :class="{ unnamed: !expense.description }">{{ expense.description || 'Sem descrição' }}</span>
                <span class="meta">
                  <span v-if="!byDay" class="day">{{ formatDateBR(expense.date) }}</span>
                  <span v-if="stateOf(expense) !== 'done'" class="badge" :class="stateOf(expense)">{{ stateLabel(expense.kind, stateOf(expense)) }}</span>
                  <span v-else-if="original(expense).date !== expense.date" class="due">venc. {{ formatDateBR(original(expense).date) }}</span>
                  <span class="cat">
                    <CategoryDot :color="finance.categoryOf(expense)?.color ?? null" :size="7" />
                    {{ finance.categoryName(expense.categoryId) }}
                  </span>
                  <span v-if="expense.recurrenceId" class="icon-meta" data-tip="Recorrente"><AppIcon name="repeat" :size="12" /></span>
                  <span v-if="expense.remind && expense.status === 'pending'" class="icon-meta" data-tip="Me lembre de pagar"><AppIcon name="bell" :size="12" /></span>
                  <span v-if="expense.importId" class="icon-meta" :data-tip="`Do extrato ${finance.importName(expense.importId) ?? ''}`"><AppIcon name="upload" :size="12" /></span>
                  <span v-if="expense.notes" class="icon-meta" :data-tip="expense.notes.slice(0, 200)"><AppIcon name="edit" :size="12" /></span>
                </span>
              </span>
              <button
                v-if="expense.status === 'pending'"
                type="button"
                class="btn btn-sm pay-btn"
                data-action="pay"
                :data-tip="expense.kind === 'income' ? 'Confirmar que recebeu (hoje)' : 'Confirmar o pagamento (hoje)'"
                @click.stop="pay(expense)"
              >
                <AppIcon name="check" :size="13" /> {{ expense.kind === 'income' ? 'Recebi' : 'Pagar' }}
              </button>
              <span class="amount" :class="{ positive: expense.kind === 'income' }">{{ expense.kind === 'income' ? '+' : '' }}{{ formatMoney(expense.amount) }}</span>
            </div>
          </li>
        </ul>
      </section>
      <button v-if="totals.count > limit" type="button" class="btn btn-sm show-more" @click="limit += 300">Mostrar mais ({{ totals.count - limit }})</button>
    </template>
  </div>
</template>

<style scoped>
.finance-history {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 220px;
  min-width: 0;
  height: 34px;
  padding: 0 6px 0 10px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-3);
}
.search:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13.5px;
}
.select.sm {
  width: auto;
  min-height: 34px;
  padding-top: 5px;
  padding-bottom: 5px;
  font-size: 13px;
}
.summary {
  font-size: 13px;
  color: var(--text-3);
}
.summary strong {
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 4px;
  padding: 0 10px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.group-detail {
  font-weight: 500;
  color: var(--text-3);
}
.group-total {
  margin-left: auto;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: var(--r-lg);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast);
}
html[data-touch] .row {
  padding: 11px 10px;
}
.row:hover {
  background: var(--hover);
}
.row.flash {
  animation: row-flash 1.6s var(--ease-out);
}
@keyframes row-flash {
  0%,
  35% {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-strong) 50%, transparent);
  }
}
.cat-mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--c) 18%, var(--surface-2));
  color: color-mix(in srgb, var(--c) 70%, var(--text-2));
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.description {
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.description.unnamed {
  color: var(--text-3);
  font-style: italic;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 12px;
  font-size: 12px;
  color: var(--text-3);
}
.cat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.day {
  font-variant-numeric: tabular-nums;
}
.has-notes {
  display: inline-flex;
}
.amount {
  flex: none;
  font-size: 14px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.show-more {
  align-self: center;
}
.history-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 20px;
  text-align: center;
  color: var(--text-3);
}
.history-empty h3 {
  color: var(--text);
  font-size: 15px;
}
.history-empty p {
  max-width: 440px;
  font-size: 13px;
}
.history-empty .btn {
  margin-top: 6px;
}

.toolbar-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.import-btn {
  flex: none;
}
.sep {
  margin: 0 6px;
}
.positive {
  color: var(--success);
}
.pending-total {
  color: var(--primary-text);
  font-weight: 600;
}
.group-total {
  display: inline-flex;
  gap: 8px;
}
.badge {
  padding: 0 7px;
  border-radius: 999px;
  background: var(--surface-3);
  font-size: 11px;
  font-weight: 650;
  line-height: 18px;
  color: var(--text-2);
}
.badge.pending {
  background: var(--primary-soft);
  color: var(--primary-text);
}
.badge.overdue {
  background: var(--danger-soft);
  color: var(--danger);
}
.badge.cancelled {
  text-decoration: line-through;
}
.forecast-badge {
  border: 1px dashed var(--border-strong);
  background: transparent;
}
.due {
  font-variant-numeric: tabular-nums;
}
.icon-meta {
  display: inline-flex;
}
.row.cancelled .description,
.row.cancelled .amount {
  text-decoration: line-through;
  color: var(--text-3);
}
.row.overdue .amount {
  color: var(--danger);
}
.row.ghost {
  opacity: 0.85;
}
.row.ghost .cat-mark {
  background: transparent;
  border: 1px dashed color-mix(in srgb, var(--c) 60%, var(--border-strong));
}
.pay-btn {
  flex: none;
  height: 28px;
}
html[data-touch] .pay-btn {
  height: 36px;
}
.forecast {
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-lg);
  padding: 4px;
}
.forecast-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
}
.forecast-count {
  padding: 0 7px;
  border-radius: 999px;
  background: var(--surface-3);
  font-size: 11px;
}
.forecast-chevron {
  margin-left: auto;
}
.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
html[data-layout='compact'] .pay-btn {
  padding: 0 8px;
}
</style>
