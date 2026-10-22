<script setup lang="ts">
/**
 * Finanças › histórico (1.7.0): os gastos registrados, por dia (ou pelo valor).
 * Período (com ‹ › para o anterior e o próximo, ou "Tudo"), busca na descrição,
 * categoria e ordem; o total do que está na tela fica em cima. Clique num gasto para
 * ver e editar; botão direito: abrir, repetir hoje, categoria, ver menções, excluir.
 * Abrir uma menção a um gasto (stores/mentions.ts) traz ele para a tela e o destaca.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { separator, showContextMenu, type MenuItemSpec } from '~/composables/useContextMenu'
import { paletteVar } from '~/lib/colors'
import { formatDateBR, relativeDayLabel, type ISODate } from '~/lib/dates'
import { formatMoney } from '~/lib/finance/format'
import { filterExpenses, groupByDay, SORT_LABELS, sortExpenses, totalOf, type Expense, type ExpenseSort } from '~/lib/finance/model'
import { weekdayName } from '~/lib/timer/stats'
import { expenseSubject, showMentionsOf } from '~/stores/mentions'
import { useFinanceStore } from '~/stores/finance'

const emit = defineEmits<{ add: [] }>()
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
const sort = computed({
  get: () => finance.state.sort,
  set: (value: ExpenseSort) => finance.setSort(value),
})
const SORTS = Object.entries(SORT_LABELS) as [ExpenseSort, string][]

const filtered = computed(() =>
  filterExpenses(finance.state.expenses, {
    from: period.value?.from ?? null,
    to: period.value?.to ?? null,
    category: finance.state.category,
    search: finance.state.search,
    knownCategories: finance.knownCategoryIds.value,
  }),
)
const sorted = computed(() => sortExpenses(filtered.value, sort.value))
const byDay = computed(() => sort.value === 'date-desc' || sort.value === 'date-asc')
const visible = computed(() => sorted.value.slice(0, limit.value))
const groups = computed(() => (byDay.value ? groupByDay(visible.value) : [{ date: '', expenses: visible.value, total: 0 }]))
/** Total de cada dia com todos os gastos dele (não só os que já estão na tela). */
const dayTotals = computed(() => {
  const map = new Map<ISODate, number>()
  for (const expense of filtered.value) map.set(expense.date, (map.get(expense.date) ?? 0) + expense.amount)
  return map
})

watch([period, () => finance.state.search, () => finance.state.category, sort], () => (limit.value = 150))

const totals = computed(() => ({ count: filtered.value.length, total: totalOf(filtered.value) }))
const hasFilters = computed(() => !!finance.state.search.trim() || finance.state.category !== undefined)

function clearFilters() {
  finance.state.search = ''
  finance.state.category = undefined
}

function dayLabel(day: ISODate): { label: string; detail: string } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const relative = relativeDayLabel(day, today.value)
  const named = relative === 'Hoje' || relative === 'Ontem'
  return { label: named ? relative : `${weekdayName(weekday)}, ${formatDateBR(day)}`, detail: named ? formatDateBR(day) : '' }
}

function categoryColor(expense: Expense): string | null {
  const category = finance.categoryOf(expense)
  return category ? paletteVar(category.color) : null
}

async function rowMenu(expense: Expense) {
  const current = finance.categoryOf(expense)
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
  const choice = await showContextMenu([
    { id: 'open', label: 'Abrir' },
    { id: 'repeat', label: 'Repetir hoje' },
    { label: 'Categoria', submenu: categoryItems },
    { id: 'mentions', label: 'Ver menções' },
    separator,
    { id: 'delete', label: 'Excluir…', danger: true },
  ])
  if (!choice) return
  if (choice === 'open') finance.openExpense(expense.id)
  else if (choice === 'repeat') finance.repeatExpense(expense.id)
  else if (choice === 'mentions') showMentionsOf(expenseSubject(expense))
  else if (choice === 'delete') void finance.requestDeleteExpense(expense.id)
  else if (choice.startsWith('category:')) finance.updateExpense(expense.id, { categoryId: choice.slice('category:'.length) || null })
}

// ── Abrir um gasto mencionado ───────────────────────────────────────────────

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
      <PeriodNav ref="navRef" v-model="period" :week-start="finance.state.settings.weekStart" :today="today" allow-all all-label="Todos os gastos" />
      <div class="filters">
        <label class="search">
          <AppIcon name="search" :size="15" />
          <input ref="searchInput" v-model="finance.state.search" class="search-input" placeholder="Buscar pela descrição" aria-label="Buscar gastos" />
          <button v-if="finance.state.search" type="button" class="icon-btn sm" aria-label="Limpar busca" @click="finance.state.search = ''">
            <AppIcon name="x" :size="13" />
          </button>
        </label>
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

    <div v-if="!finance.state.expenses.length" class="history-empty">
      <AppIcon name="wallet" :size="30" />
      <h3>Nenhum gasto registrado ainda</h3>
      <p>Digite o valor e a descrição no formulário acima e aperte Enter. Os gastos ficam aqui, por dia, com o total do período.</p>
      <button type="button" class="btn btn-primary" @click="emit('add')"><AppIcon name="plus" :size="15" /> Registrar um gasto</button>
    </div>
    <div v-else-if="!filtered.length" class="history-empty">
      <AppIcon name="search" :size="28" />
      <h3>Nenhum gasto {{ hasFilters ? 'com esses filtros' : 'neste período' }}</h3>
      <button v-if="hasFilters" type="button" class="btn btn-sm" @click="clearFilters">Limpar filtros</button>
    </div>
    <template v-else>
      <p class="summary" data-history-total>
        <strong>{{ formatMoney(totals.total) }}</strong> em {{ totals.count }} {{ totals.count === 1 ? 'gasto' : 'gastos' }}
        <template v-if="totals.count > 1"> · média de {{ formatMoney(Math.round(totals.total / totals.count)) }}</template>
      </p>
      <section v-for="group in groups" :key="group.date || 'all'" class="group">
        <h3 v-if="group.date" class="group-head">
          <span class="group-label">{{ dayLabel(group.date).label }}</span>
          <span v-if="dayLabel(group.date).detail" class="group-detail">{{ dayLabel(group.date).detail }}</span>
          <span class="group-total">{{ formatMoney(dayTotals.get(group.date) ?? group.total) }}</span>
        </h3>
        <ul class="rows">
          <li v-for="expense in group.expenses" :key="expense.id">
            <button
              type="button"
              class="row"
              :class="{ flash: flashId === expense.id }"
              :data-expense="expense.id"
              @click="finance.openExpense(expense.id)"
              @contextmenu.prevent="rowMenu(expense)"
            >
              <span class="cat-mark" :style="{ '--c': categoryColor(expense) ?? 'var(--surface-3)' }"><AppIcon name="wallet" :size="15" /></span>
              <span class="main">
                <span class="description" :class="{ unnamed: !expense.description }">{{ expense.description || 'Sem descrição' }}</span>
                <span class="meta">
                  <span v-if="!byDay" class="day">{{ formatDateBR(expense.date) }}</span>
                  <span class="cat">
                    <CategoryDot :color="finance.categoryOf(expense)?.color ?? null" :size="7" />
                    {{ finance.categoryName(expense.categoryId) }}
                  </span>
                  <span v-if="expense.notes" class="has-notes" :data-tip="expense.notes.slice(0, 200)"><AppIcon name="edit" :size="12" /></span>
                </span>
              </span>
              <span class="amount">{{ formatMoney(expense.amount) }}</span>
            </button>
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
</style>
