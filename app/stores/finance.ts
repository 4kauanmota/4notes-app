/**
 * Estado do módulo FINANÇAS (1.7.0): os gastos (registro, histórico e painel).
 *
 * Os dados ficam em finance/finance.json (lib/finance/repository.ts); as regras, em
 * lib/finance/*.ts. Valores em centavos (inteiros). As categorias são as compartilhadas
 * do app (stores/categories.ts): a lista do finance.json diz quais aparecem aqui.
 * Os gastos podem ser mencionados nas notas e nas tarefas (stores/mentions.ts); este
 * módulo não conhece os outros.
 */
import { computed, reactive } from 'vue'
import { errorMessage } from '#shared/ipc'
import { requestCategoryRemoval } from '~/composables/useCategoryActions'
import { confirmDialog } from '~/composables/useDialog'
import { notifyError, showToast } from '~/composables/useToasts'
import { useToday } from '~/composables/useToday'
import type { PaletteColor } from '~/lib/colors'
import type { CategorySource } from '~/lib/category-source'
import { formatDateBR, formatShortDate, isISODate, type ISODate } from '~/lib/dates'
import { formatMoney } from '~/lib/finance/format'
import { MAX_DESCRIPTION, MAX_NOTES, serializeFinance, type Expense, type ExpenseSort, type FinanceCategory } from '~/lib/finance/model'
import { financeRepository as repo } from '~/lib/finance/repository'
import { DEFAULT_FINANCE_SETTINGS, normalizeFinanceSettings, type FinanceSettings } from '~/lib/finance/settings'
import { readDeviceState, writeDeviceState } from '~/lib/storage/device-state'
import { DATA_PATHS } from '~/lib/storage/paths'
import { periodOf, type Period } from '~/lib/timer/stats'
import { createId, debounce, SerialQueue } from '~/lib/utils/async'
import { registerCategoryModule, useCategoriesStore, type SharedCategory } from './categories'
import { onSettingsChange, settingsSection, updateSettingsSection } from './settings'

/** As áreas do módulo: os gastos (registrar + histórico) e o painel (gráficos). */
export type FinanceTab = 'expenses' | 'dashboard'
const TABS: readonly FinanceTab[] = ['expenses', 'dashboard']
const SORTS: readonly ExpenseSort[] = ['date-desc', 'date-asc', 'amount-desc', 'amount-asc']

export interface ExpenseInput {
  description: string
  amount: number
  date: ISODate
  categoryId: string | null
  notes?: string
}

const { today } = useToday()

const state = reactive({
  loaded: false,
  /** finance.json com erro: nada é gravado até resolver. */
  error: null as string | null,
  categories: [] as FinanceCategory[],
  expenses: [] as Expense[],
  settings: { ...DEFAULT_FINANCE_SETTINGS } as FinanceSettings,
  // Tela (deste aparelho)
  tab: 'expenses' as FinanceTab,
  /** Período do histórico e do painel (null = todos, só no histórico). */
  period: null as Period | null,
  /** Período do painel (sempre um período). */
  dashboardPeriod: null as Period | null,
  /** undefined = todas as categorias; null = sem categoria. */
  category: undefined as string | null | undefined,
  search: '',
  sort: 'date-desc' as ExpenseSort,
  /** Gasto aberto para ver/editar (null = nenhum). */
  editing: null as string | null,
  /** Gasto a mostrar no histórico (uma menção foi aberta): a lista rola até ele e o destaca. */
  reveal: null as { id: string; seq: number } | null,
})

let lastRaw: string | null = null
const queue = new SerialQueue()

function snapshot(): string {
  return serializeFinance({ categories: state.categories, expenses: state.expenses })
}

function persist(): Promise<void> {
  return queue
    .run('finance', async () => {
      if (state.error) return
      // Nada guardado ainda e nada para guardar: o arquivo não é criado
      if (lastRaw === null && !state.expenses.length && !state.categories.length) return
      const raw = snapshot()
      if (raw === lastRaw) return
      await repo.save(raw)
      lastRaw = raw
    })
    .catch((error) => notifyError(`Não foi possível salvar as Finanças: ${errorMessage(error)}`, error))
}

const scheduleSave = debounce(() => void persist(), 250)

async function flush(): Promise<void> {
  scheduleSave.flush()
  await queue.idle()
}

// ── Tela deste aparelho ─────────────────────────────────────────────────────

function saveDeviceState(): void {
  writeDeviceState('finance', { tab: state.tab, sort: state.sort })
}

function setTab(tab: FinanceTab): void {
  if (state.tab === tab) return
  state.tab = tab
  saveDeviceState()
}

function setSort(sort: ExpenseSort): void {
  state.sort = sort
  saveDeviceState()
}

// ── Configurações (settings.json do workspace) ──────────────────────────────

function updateSettings(patch: Partial<FinanceSettings>): void {
  Object.assign(state.settings, patch)
  updateSettingsSection('finance', { ...state.settings })
}

onSettingsChange((changed) => {
  if (changed.has('finance')) state.settings = normalizeFinanceSettings(settingsSection('finance'))
})

// ── Carregamento ────────────────────────────────────────────────────────────

function adopt(data: { categories: FinanceCategory[]; expenses: Expense[] }): void {
  state.categories = data.categories
  state.expenses = data.expenses
  if (state.category && !data.categories.some((category) => category.id === state.category)) state.category = undefined
  if (state.editing && !data.expenses.some((expense) => expense.id === state.editing)) state.editing = null
}

async function load(): Promise<void> {
  try {
    state.settings = normalizeFinanceSettings(settingsSection('finance'))
    const view = readDeviceState('finance') ?? {}
    if (TABS.includes(view.tab as FinanceTab)) state.tab = view.tab as FinanceTab
    if (SORTS.includes(view.sort as ExpenseSort)) state.sort = view.sort as ExpenseSort
    state.period = periodOf('month', today.value, state.settings.weekStart)
    state.dashboardPeriod = periodOf('month', today.value, state.settings.weekStart)
    const result = await repo.load()
    if (result.status === 'invalid') {
      state.error = result.error
    } else {
      adopt(result.data)
      lastRaw = result.raw
      state.error = null
      if (result.raw) void repo.backup(result.raw).catch((error) => console.warn('[4notes] Backup das Finanças falhou:', error))
    }
  } catch (error) {
    state.error = errorMessage(error)
  }
  state.loaded = true
}

/** Relê o finance.json se ele mudou fora do app (outro aparelho, edição à mão). */
async function refreshFromDisk(): Promise<void> {
  if (!state.loaded || scheduleSave.pending() || queue.busy) return
  const raw = await repo.readRaw().catch(() => undefined)
  if (raw === undefined || raw === lastRaw) return
  if (raw === null) {
    // Apagado fora do app: grava de novo o que está na memória (se havia algo)
    if (!state.error && lastRaw !== null) {
      lastRaw = null
      void persist()
    }
    return
  }
  const result = await repo.load()
  if (result.status === 'invalid') {
    state.error = `O arquivo finance.json foi alterado fora do app e agora contém um erro (${result.error}).`
    return
  }
  adopt(result.data)
  lastRaw = raw
  state.error = null
}

async function retry(): Promise<void> {
  state.error = null
  await load()
}

// ── Consultas ───────────────────────────────────────────────────────────────

const categoryById = computed(() => new Map(state.categories.map((category) => [category.id, category])))
const knownCategoryIds = computed(() => new Set(state.categories.map((category) => category.id)))

function findExpense(id: string | null | undefined): Expense | undefined {
  return id ? state.expenses.find((expense) => expense.id === id) : undefined
}

function categoryOf(expense: Expense): FinanceCategory | null {
  return expense.categoryId ? (categoryById.value.get(expense.categoryId) ?? null) : null
}

function categoryName(id: string | null | undefined): string {
  return (id && categoryById.value.get(id)?.name) || 'Sem categoria'
}

/** "Feira · R$ 52,30" (para avisos e menções). */
const expenseLabel = (expense: Expense) => `${expense.description || 'Gasto'} · ${formatMoney(expense.amount)}`

// ── Ações: gastos ───────────────────────────────────────────────────────────

function clean(input: Partial<ExpenseInput>): Partial<ExpenseInput> {
  const next: Partial<ExpenseInput> = {}
  if (input.description !== undefined) next.description = input.description.trim().slice(0, MAX_DESCRIPTION)
  if (input.amount !== undefined) next.amount = Math.round(input.amount)
  if (input.date !== undefined) next.date = input.date
  if (input.categoryId !== undefined) next.categoryId = input.categoryId && categoryById.value.has(input.categoryId) ? input.categoryId : null
  if (input.notes !== undefined) next.notes = input.notes.slice(0, MAX_NOTES)
  return next
}

/** Registra um gasto. null = valor ou data inválidos (o formulário já avisa antes). */
function addExpense(input: ExpenseInput): Expense | null {
  if (state.error) {
    notifyError('As Finanças não podem ser alteradas enquanto o finance.json estiver com erro.')
    return null
  }
  const values = clean(input)
  if (!values.amount || values.amount <= 0 || !isISODate(values.date)) return null
  const now = new Date().toISOString()
  const expense: Expense = {
    id: createId('e'),
    description: values.description ?? '',
    amount: values.amount,
    date: values.date!,
    categoryId: values.categoryId ?? null,
    notes: values.notes ?? '',
    createdAt: now,
    updatedAt: now,
  }
  state.expenses.push(expense)
  scheduleSave()
  useCategoriesStore().touch()
  return state.expenses.at(-1)!
}

function updateExpense(id: string, patch: Partial<ExpenseInput>): boolean {
  const index = state.expenses.findIndex((expense) => expense.id === id)
  if (index < 0) return false
  const values = clean(patch)
  if (values.amount !== undefined && values.amount <= 0) return false
  if (values.date !== undefined && !isISODate(values.date)) return false
  const next = { ...state.expenses[index]!, ...values, updatedAt: new Date().toISOString() } as Expense
  state.expenses.splice(index, 1, next)
  scheduleSave()
  useCategoriesStore().touch()
  return true
}

/** Exclui (com Desfazer). */
function deleteExpense(id: string): void {
  const index = state.expenses.findIndex((expense) => expense.id === id)
  if (index < 0) return
  const [removed] = state.expenses.splice(index, 1)
  if (state.editing === id) state.editing = null
  scheduleSave()
  useCategoriesStore().touch()
  showToast({
    message: `Gasto excluído: ${expenseLabel(removed!)}`,
    icon: 'trash',
    action: {
      label: 'Desfazer',
      run: () => {
        if (findExpense(removed!.id)) return
        state.expenses.splice(Math.min(index, state.expenses.length), 0, removed!)
        scheduleSave()
        useCategoriesStore().touch()
      },
    },
  })
}

/** Excluir pela interface: pergunta antes (e o aviso ainda tem Desfazer). */
async function requestDeleteExpense(id: string): Promise<boolean> {
  const expense = findExpense(id)
  if (!expense) return false
  const ok = await confirmDialog({
    title: 'Excluir o gasto?',
    message: `${expenseLabel(expense)} (${formatDateBR(expense.date)}). O gasto sai do histórico e dos gráficos.`,
    confirmLabel: 'Excluir',
    danger: true,
  })
  if (!ok || !findExpense(id)) return false
  deleteExpense(id)
  return true
}

/** Registra de novo o mesmo gasto, hoje (ex.: um café que se repete). */
function repeatExpense(id: string): Expense | null {
  const expense = findExpense(id)
  if (!expense) return null
  const copy = addExpense({ description: expense.description, amount: expense.amount, date: today.value, categoryId: expense.categoryId, notes: expense.notes })
  if (copy) showToast({ message: `Registrado de novo hoje: ${expenseLabel(copy)}`, icon: 'check', tone: 'success' })
  return copy
}

function openExpense(id: string | null): void {
  state.editing = id && findExpense(id) ? id : null
}

/**
 * Mostra o gasto no histórico (uma menção foi aberta): vai para a área dos gastos, tira
 * os filtros que o escondem, vai para o mês dele e o destaca.
 */
function revealExpense(id: string): boolean {
  const expense = findExpense(id)
  if (!expense) return false
  setTab('expenses')
  state.search = ''
  if (state.category !== undefined && state.category !== (expense.categoryId && categoryById.value.has(expense.categoryId) ? expense.categoryId : null)) state.category = undefined
  if (state.period && (expense.date < state.period.from || expense.date > state.period.to)) state.period = periodOf('month', expense.date, state.settings.weekStart)
  state.reveal = { id, seq: (state.reveal?.seq ?? 0) + 1 }
  return true
}

// ── Categorias ──────────────────────────────────────────────────────────────
//
// As categorias são as compartilhadas do app (stores/categories.ts): a lista do
// finance.json diz quais aparecem aqui (e em que ordem), com uma cópia do nome e da cor.

const shared = useCategoriesStore()

function attachShared(category: SharedCategory): FinanceCategory {
  const existing = categoryById.value.get(category.id)
  if (existing) return existing
  state.categories.push({ id: category.id, name: category.name, color: category.color, createdAt: new Date().toISOString() })
  scheduleSave()
  shared.touch()
  return state.categories.at(-1)!
}

/** Categoria nova (no app inteiro) já nas Finanças; com um nome que já existe no app, usa aquela. */
function addCategory(name: string, color: PaletteColor): FinanceCategory | null {
  const category = shared.findByName(name) ?? shared.createCategory({ name, color })
  return category ? attachShared(category) : null
}

/** "Usar categoria existente": uma categoria do app passa a aparecer nas Finanças. */
function attachCategory(id: string): FinanceCategory | null {
  const category = shared.findCategory(id)
  return category ? attachShared(category) : null
}

function updateCategory(id: string, patch: { name?: string; color?: PaletteColor }): Promise<boolean> {
  return shared.updateCategory(id, patch)
}

/** Tira a categoria das Finanças: os gastos dela ficam sem categoria. */
function detachCategory(id: string): void {
  state.categories = state.categories.filter((category) => category.id !== id)
  state.expenses = state.expenses.map((expense) => (expense.categoryId === id ? { ...expense, categoryId: null } : expense))
  if (state.category === id) state.category = undefined
  scheduleSave()
}

/** Os gastos (e o lugar na lista) de `fromId` passam para `to`. */
function remapCategory(fromId: string, to: SharedCategory): void {
  let used = false
  state.expenses = state.expenses.map((expense) => {
    if (expense.categoryId !== fromId) return expense
    used = true
    return { ...expense, categoryId: to.id }
  })
  const index = state.categories.findIndex((category) => category.id === fromId)
  if (index >= 0) {
    if (state.categories.some((category) => category.id === to.id)) state.categories.splice(index, 1)
    else state.categories.splice(index, 1, { id: to.id, name: to.name, color: to.color, createdAt: state.categories[index]!.createdAt })
  } else if (used) {
    attachShared(to)
  }
  if (state.category === fromId) state.category = to.id
  scheduleSave()
}

/** Pede o que fazer com os gastos e exclui a categoria (das Finanças ou do app). Nenhum gasto é apagado. */
function requestDeleteCategory(id: string): Promise<boolean> {
  return requestCategoryRemoval(id, 'finance')
}

/** Sobe (−1) ou desce (+1) uma categoria na lista. */
function moveCategory(id: string, delta: number): void {
  const from = state.categories.findIndex((category) => category.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= state.categories.length) return
  const [category] = state.categories.splice(from, 1)
  state.categories.splice(to, 0, category!)
  scheduleSave()
}

registerCategoryModule({
  id: 'finance',
  ready: () => state.loaded && !state.error,
  members: () => state.categories.map((category) => ({ id: category.id, name: category.name, color: category.color })),
  records: (id) =>
    state.expenses
      .filter((expense) => expense.categoryId === id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((expense) => ({
        id: expense.id,
        title: expense.description || 'Gasto sem descrição',
        detail: `${formatShortDate(expense.date, today.value)} · ${formatMoney(expense.amount)}`,
        path: `${DATA_PATHS.financeFile}#${expense.id}`,
      })),
  sync: (category) => {
    const mine = categoryById.value.get(category.id)
    if (mine && (mine.name !== category.name || mine.color !== category.color)) {
      mine.name = category.name
      mine.color = category.color
      scheduleSave()
    }
    return true
  },
  attach: (category) => !!attachShared(category),
  remap: (from, to) => {
    if (from.id) remapCategory(from.id, to)
    return true
  },
  detach: (from) => {
    if (from.id) detachCategory(from.id)
    return true
  },
})

/** As categorias das Finanças no formato do diálogo de categoria (o mesmo das Tarefas e do Timer). */
const categorySource: CategorySource = {
  module: 'finance',
  get categories() {
    return state.categories
  },
  add: (name, color) => addCategory(name, color),
  attach: (id) => attachCategory(id),
  update: (id, patch) => updateCategory(id, patch),
  requestDelete: (id) => requestDeleteCategory(id),
}

export function useFinanceStore() {
  return {
    state,
    today,
    categorySource,
    categoryById,
    knownCategoryIds,
    findExpense,
    categoryOf,
    categoryName,
    expenseLabel,
    load,
    retry,
    flush,
    refreshFromDisk,
    setTab,
    setSort,
    updateSettings,
    addExpense,
    updateExpense,
    deleteExpense,
    requestDeleteExpense,
    repeatExpense,
    openExpense,
    revealExpense,
    addCategory,
    attachCategory,
    updateCategory,
    requestDeleteCategory,
    moveCategory,
    revealFile: () => repo.reveal(),
  }
}
