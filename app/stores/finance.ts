/**
 * Estado do módulo FINANÇAS: gastos (1.7.0) e, na 1.7.1, entradas, contas a pagar com
 * "Me lembre de pagar", recorrências (assinaturas, contas, salário), saldo inicial e a
 * importação de extratos.
 *
 * Os dados ficam em finance/finance.json (lib/finance/repository.ts); as regras, em
 * lib/finance/*.ts. Valores em centavos (inteiros). As categorias são as compartilhadas
 * do app (stores/categories.ts): a lista do finance.json diz quais aparecem aqui.
 * Os lançamentos podem ser mencionados nas notas e nas tarefas (stores/mentions.ts); este
 * módulo não conhece os outros.
 *
 * Recorrências: as ocorrências até hoje viram lançamentos (pendentes até você confirmar)
 * quando o app abre e quando o dia vira (`materialize`); as seguintes são só previsões
 * (lib/finance/bills.ts). Cada ocorrência tem um id fixo (recorrência + data prevista),
 * então nada se repete ao abrir de novo ou em outro aparelho.
 */
import { computed, reactive, watch } from 'vue'
import { errorMessage } from '#shared/ipc'
import { requestCategoryRemoval } from '~/composables/useCategoryActions'
import { confirmDialog } from '~/composables/useDialog'
import { notifyError, showToast } from '~/composables/useToasts'
import { useToday } from '~/composables/useToday'
import { dueReminders, upcoming, type UpcomingItem } from '~/lib/finance/bills'
import { createCategorizer, type CategorizeInput, type CategorySuggestion } from '~/lib/finance/categorize'
import type { PaletteColor } from '~/lib/colors'
import type { CategorySource } from '~/lib/category-source'
import { addDays, addMonths, formatDateBR, formatShortDate, isISODate, type ISODate } from '~/lib/dates'
import { formatMoney } from '~/lib/finance/format'
import {
  MAX_DESCRIPTION,
  MAX_NOTES,
  serializeFinance,
  type EntryKind,
  type Expense,
  type ExpenseSort,
  type FinanceCategory,
  type ImportBatch,
  type OpeningBalance,
} from '~/lib/finance/model'
import {
  occurrenceBefore,
  occurrenceId,
  occurrenceKey,
  occurrencesBetween,
  pendingGeneration,
  stepFrom,
  versionAt,
  withFutureChange,
  type Frequency,
  type Recurrence,
} from '~/lib/finance/recurrence'
import { financeRepository as repo } from '~/lib/finance/repository'
import { DEFAULT_FINANCE_SETTINGS, normalizeFinanceSettings, type FinanceSettings } from '~/lib/finance/settings'
import { hasDesktopApi, isAndroid } from '~/lib/platform'
import { readDeviceState, writeDeviceState } from '~/lib/storage/device-state'
import { DATA_PATHS } from '~/lib/storage/paths'
import { periodOf, type Period } from '~/lib/timer/stats'
import { createId, debounce, SerialQueue } from '~/lib/utils/async'
import { registerCategoryModule, useCategoriesStore, type SharedCategory } from './categories'
import { useModulesStore } from './modules'
import { onSettingsChange, settingsSection, updateSettingsSection } from './settings'

/** As áreas do módulo: lançamentos (registrar, histórico, importar), contas e o painel. */
export type FinanceTab = 'expenses' | 'bills' | 'dashboard'
const TABS: readonly FinanceTab[] = ['expenses', 'bills', 'dashboard']
const SORTS: readonly ExpenseSort[] = ['date-desc', 'date-asc', 'amount-desc', 'amount-asc']

/** Até quando a projeção do saldo olha as contas e entradas futuras. */
export type ForecastHorizon = 'month' | '30' | '90'
const HORIZONS: readonly ForecastHorizon[] = ['month', '30', '90']

export interface ExpenseInput {
  /** Gasto (padrão) ou entrada. */
  kind?: EntryKind
  description: string
  amount: number
  date: ISODate
  categoryId: string | null
  notes?: string
  /** Pendente (a pagar ou a receber) em vez de já pago. */
  pending?: boolean
  /** "Me lembre de pagar" (deixa o gasto pendente até você confirmar). */
  remind?: boolean
}

export interface RecurrenceInput {
  kind: EntryKind
  description: string
  amount: number
  categoryId: string | null
  notes?: string
  remind?: boolean
  frequency: Frequency
  /** Data do primeiro pagamento (ou recebimento). */
  firstDate: ISODate
  /** null = até você encerrar. */
  endDate: ISODate | null
  /** As ocorrências que já passaram (primeira data no passado) entram como pagas. */
  pastAsDone?: boolean
}

/** O que mudar numa recorrência. Valor, frequência e data da próxima pedem o alcance. */
export interface RecurrencePatch {
  description?: string
  categoryId?: string | null
  notes?: string
  remind?: boolean
  endDate?: ISODate | null
  amount?: number
  frequency?: Frequency
  /** Nova data da próxima ocorrência. */
  nextDate?: ISODate
}

/** "next" = só a próxima ocorrência; "future" = a próxima e as seguintes. */
export type ChangeScope = 'next' | 'future'

/** Uma transação do extrato, revisada na prévia, para importar. */
export interface ImportRow {
  kind: EntryKind
  date: ISODate
  description: string
  amount: number
  categoryId: string | null
  externalId: string | null
  /** Em vez de criar: confirma o pagamento desta conta pendente (o extrato mostra que foi paga). */
  confirms?: string | null
}

const { today } = useToday()

const state = reactive({
  loaded: false,
  /** finance.json com erro: nada é gravado até resolver. */
  error: null as string | null,
  categories: [] as FinanceCategory[],
  /** Gastos e entradas. */
  expenses: [] as Expense[],
  recurrences: [] as Recurrence[],
  imports: [] as ImportBatch[],
  openingBalance: null as OpeningBalance | null,
  settings: { ...DEFAULT_FINANCE_SETTINGS } as FinanceSettings,
  // Tela (deste aparelho)
  tab: 'expenses' as FinanceTab,
  /** Período do histórico e do painel (null = todos, só no histórico). */
  period: null as Period | null,
  /** Período do painel (sempre um período). */
  dashboardPeriod: null as Period | null,
  /** Filtro de categorias do histórico (1.7.2: várias); vazio = todas, null = sem categoria. */
  categoryFilter: [] as (string | null)[],
  /** Histórico: gastos, entradas ou os dois. */
  kind: 'all' as EntryKind | 'all',
  search: '',
  sort: 'date-desc' as ExpenseSort,
  horizon: 'month' as ForecastHorizon,
  /** Lançamento aberto para ver/editar (null = nenhum). */
  editing: null as string | null,
  /** Recorrência aberta para editar ('new:expense' / 'new:income' = criando). */
  editingRecurrence: null as string | null,
  /** Importar extrato aberto. */
  importOpen: false,
  /** Lançamento a mostrar no histórico (uma menção foi aberta): a lista rola até ele e o destaca. */
  reveal: null as { id: string; seq: number } | null,
})

let lastRaw: string | null = null
const queue = new SerialQueue()

function snapshot(): string {
  return serializeFinance({
    categories: state.categories,
    expenses: state.expenses,
    recurrences: state.recurrences,
    imports: state.imports,
    openingBalance: state.openingBalance,
  })
}

const empty = () => !state.expenses.length && !state.categories.length && !state.recurrences.length && !state.imports.length && !state.openingBalance

function persist(): Promise<void> {
  return queue
    .run('finance', async () => {
      if (state.error) return
      // Nada guardado ainda e nada para guardar: o arquivo não é criado
      if (lastRaw === null && empty()) return
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

/** Algo mudou nos lançamentos: grava e avisa as categorias (contagens, "onde é usada"). */
function changed(): void {
  scheduleSave()
  useCategoriesStore().touch()
}

function guard(): boolean {
  if (!state.error) return true
  notifyError('As Finanças não podem ser alteradas enquanto o finance.json estiver com erro.')
  return false
}

// ── Tela deste aparelho ─────────────────────────────────────────────────────

function saveDeviceState(): void {
  writeDeviceState('finance', { tab: state.tab, sort: state.sort, horizon: state.horizon })
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

function setHorizon(horizon: ForecastHorizon): void {
  state.horizon = horizon
  saveDeviceState()
}

/** O último dia que a projeção considera. */
const horizonEnd = computed<ISODate>(() => {
  if (state.horizon === '30') return addDays(today.value, 30)
  if (state.horizon === '90') return addDays(today.value, 90)
  return addDays(addMonths(`${today.value.slice(0, 7)}-01`, 1), -1)
})

// ── Configurações (settings.json do workspace) ──────────────────────────────

function updateSettings(patch: Partial<FinanceSettings>): void {
  Object.assign(state.settings, patch)
  updateSettingsSection('finance', { ...state.settings })
}

onSettingsChange((changed) => {
  if (changed.has('finance')) state.settings = normalizeFinanceSettings(settingsSection('finance'))
})

// ── Carregamento ────────────────────────────────────────────────────────────

function adopt(data: { categories: FinanceCategory[]; expenses: Expense[]; recurrences: Recurrence[]; imports: ImportBatch[]; openingBalance: OpeningBalance | null }): void {
  state.categories = data.categories
  state.expenses = data.expenses
  state.recurrences = data.recurrences
  state.imports = data.imports
  state.openingBalance = data.openingBalance
  state.categoryFilter = state.categoryFilter.filter((id) => id === null || data.categories.some((category) => category.id === id))
  if (state.editing && !data.expenses.some((expense) => expense.id === state.editing)) state.editing = null
  if (state.editingRecurrence && !state.editingRecurrence.startsWith('new:') && !data.recurrences.some((item) => item.id === state.editingRecurrence)) state.editingRecurrence = null
  materialize()
}

async function load(): Promise<void> {
  try {
    state.settings = normalizeFinanceSettings(settingsSection('finance'))
    const view = readDeviceState('finance') ?? {}
    if (TABS.includes(view.tab as FinanceTab)) state.tab = view.tab as FinanceTab
    if (SORTS.includes(view.sort as ExpenseSort)) state.sort = view.sort as ExpenseSort
    if (HORIZONS.includes(view.horizon as ForecastHorizon)) state.horizon = view.horizon as ForecastHorizon
    state.period = periodOf('month', today.value, state.settings.weekStart)
    state.dashboardPeriod = periodOf('month', today.value, state.settings.weekStart)
    const result = await repo.load()
    if (result.status === 'invalid') {
      state.error = result.error
    } else {
      lastRaw = result.raw
      state.error = null
      adopt(result.data)
      if (result.raw) void repo.backup(result.raw).catch((error) => console.warn('[4notes] Backup das Finanças falhou:', error))
    }
  } catch (error) {
    state.error = errorMessage(error)
  }
  state.loaded = true
  remindSoon()
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
  lastRaw = raw
  state.error = null
  adopt(result.data)
  remindSoon()
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

function findRecurrence(id: string | null | undefined): Recurrence | undefined {
  return id ? state.recurrences.find((item) => item.id === id) : undefined
}

function categoryOf(expense: Pick<Expense, 'categoryId'>): FinanceCategory | null {
  return expense.categoryId ? (categoryById.value.get(expense.categoryId) ?? null) : null
}

function categoryName(id: string | null | undefined): string {
  return (id && categoryById.value.get(id)?.name) || 'Sem categoria'
}

const kindNoun = (kind: EntryKind) => (kind === 'income' ? 'Entrada' : 'Gasto')

/** "Feira · R$ 52,30" (para avisos e menções). */
const expenseLabel = (expense: Pick<Expense, 'description' | 'amount' | 'kind'>) => `${expense.description || kindNoun(expense.kind)} · ${formatMoney(expense.amount)}`

/** As contas e entradas que ainda vão acontecer até a data (pendentes, vencidas e previstas). */
function upcomingUntil(to: ISODate): UpcomingItem[] {
  return upcoming(state.expenses, state.recurrences, to)
}

/** Contas com "Me lembre de pagar" que vencem hoje ou já venceram. */
const reminders = computed(() => dueReminders(state.expenses, today.value))

/** Lançamentos com observações (para achar as menções "#" dentro delas). */
function notedRecords(): { notes: string; path: string; title: string; where: string }[] {
  return state.expenses
    .filter((expense) => expense.notes.trim())
    .map((expense) => ({
      notes: expense.notes,
      path: `${DATA_PATHS.financeFile}#${expense.id}`,
      title: expense.description || kindNoun(expense.kind),
      where: `${kindNoun(expense.kind)} · ${formatShortDate(expense.date, today.value)} · ${formatMoney(expense.amount)}`,
    }))
}

// ── Recorrências: ocorrências viram lançamentos ─────────────────────────────

/** O lançamento de uma ocorrência (pendente; com `done`, já pago naquele dia). */
function occurrenceEntry(recurrence: Recurrence, occurrence: ISODate, amount: number, now: string, extra: Partial<Expense> = {}): Expense {
  return {
    id: occurrenceId(recurrence.id, occurrence),
    kind: recurrence.kind,
    description: recurrence.description,
    amount,
    date: occurrence,
    categoryId: recurrence.categoryId && categoryById.value.has(recurrence.categoryId) ? recurrence.categoryId : null,
    notes: recurrence.notes,
    status: 'pending',
    doneOn: null,
    remind: recurrence.kind === 'expense' && recurrence.remind,
    recurrenceId: recurrence.id,
    occurrence,
    importId: null,
    externalId: null,
    createdAt: now,
    updatedAt: now,
    ...extra,
  }
}

/**
 * As ocorrências até hoje que ainda não são lançamentos passam a ser (pendentes). Roda ao
 * abrir, ao reler o arquivo, quando o dia vira e depois de criar ou mudar uma recorrência.
 * O id fixo + as chaves (recorrência|data) garantem que nada se repete.
 */
function materialize(): void {
  if (state.error || !state.recurrences.length) return
  const keys = new Set(state.expenses.flatMap((entry) => (entry.recurrenceId && entry.occurrence ? [occurrenceKey(entry.recurrenceId, entry.occurrence)] : [])))
  const ids = new Set(state.expenses.map((entry) => entry.id))
  const now = new Date().toISOString()
  let added = false
  for (const recurrence of state.recurrences) {
    const { due, until } = pendingGeneration(recurrence, today.value, keys)
    for (const item of due) {
      const entry = occurrenceEntry(recurrence, item.occurrence, item.amount, now)
      if (ids.has(entry.id)) continue
      ids.add(entry.id)
      keys.add(occurrenceKey(recurrence.id, item.occurrence))
      state.expenses.push(entry)
      added = true
    }
    if (until !== recurrence.generatedUntil) {
      recurrence.generatedUntil = until
      added = true
    }
  }
  if (added) changed()
}

watch(today, () => {
  if (!state.loaded) return
  materialize()
  remindSoon()
})

// ── Ações: lançamentos ──────────────────────────────────────────────────────

function clean(input: Partial<ExpenseInput>): Partial<ExpenseInput> {
  const next: Partial<ExpenseInput> = {}
  if (input.description !== undefined) next.description = input.description.trim().slice(0, MAX_DESCRIPTION)
  if (input.amount !== undefined) next.amount = Math.round(input.amount)
  if (input.date !== undefined) next.date = input.date
  if (input.categoryId !== undefined) next.categoryId = input.categoryId && categoryById.value.has(input.categoryId) ? input.categoryId : null
  if (input.notes !== undefined) next.notes = input.notes.slice(0, MAX_NOTES)
  if (input.remind !== undefined) next.remind = input.remind
  return next
}

/** Registra um gasto (ou uma entrada). null = valor ou data inválidos (o formulário já avisa antes). */
function addExpense(input: ExpenseInput): Expense | null {
  if (!guard()) return null
  const values = clean(input)
  if (!values.amount || values.amount <= 0 || !isISODate(values.date)) return null
  const now = new Date().toISOString()
  const kind = input.kind ?? 'expense'
  const remind = kind === 'expense' && input.remind === true
  const pending = remind || input.pending === true
  const expense: Expense = {
    id: createId(kind === 'income' ? 'i' : 'e'),
    kind,
    description: values.description ?? '',
    amount: values.amount,
    date: values.date!,
    categoryId: values.categoryId ?? null,
    notes: values.notes ?? '',
    status: pending ? 'pending' : 'done',
    doneOn: null,
    remind,
    recurrenceId: null,
    occurrence: null,
    importId: null,
    externalId: null,
    createdAt: now,
    updatedAt: now,
  }
  state.expenses.push(expense)
  changed()
  remindSoon()
  return state.expenses.at(-1)!
}

function updateExpense(id: string, patch: Partial<ExpenseInput>): boolean {
  const index = state.expenses.findIndex((expense) => expense.id === id)
  if (index < 0 || !guard()) return false
  const values = clean(patch)
  if (values.amount !== undefined && values.amount <= 0) return false
  if (values.date !== undefined && !isISODate(values.date)) return false
  const current = state.expenses[index]!
  const next = { ...current, ...values, updatedAt: new Date().toISOString() } as Expense
  if (current.kind === 'income') next.remind = false
  state.expenses.splice(index, 1, next)
  changed()
  return true
}

function replaceEntry(id: string, patch: Partial<Expense>): Expense | null {
  const index = state.expenses.findIndex((expense) => expense.id === id)
  if (index < 0) return null
  const next = { ...state.expenses[index]!, ...patch, updatedAt: new Date().toISOString() }
  state.expenses.splice(index, 1, next)
  changed()
  return next
}

/**
 * Confirma o pagamento (ou o recebimento): deixa de ser pendente e conta no dia `on`
 * (hoje, se não disser). Tem Desfazer.
 */
function confirmEntry(id: string, on: ISODate = today.value): boolean {
  const entry = findExpense(id)
  if (!entry || entry.status === 'done' || !isISODate(on) || !guard()) return false
  const before = { status: entry.status, doneOn: entry.doneOn }
  replaceEntry(id, { status: 'done', doneOn: on })
  showToast({
    message: `${entry.kind === 'income' ? 'Recebido' : 'Pago'}: ${expenseLabel(entry)}${on !== today.value ? ` (${formatDateBR(on)})` : ''}`,
    icon: 'check',
    tone: 'success',
    action: { label: 'Desfazer', run: () => void replaceEntry(id, before) },
  })
  return true
}

/** Volta a ser pendente (desfaz a confirmação). */
function unconfirmEntry(id: string): boolean {
  const entry = findExpense(id)
  if (!entry || entry.status !== 'done' || !guard()) return false
  replaceEntry(id, { status: 'pending', doneOn: null })
  remindSoon()
  return true
}

/** Pula esta ocorrência (não vai ser paga): sai das contas e dos saldos, mas fica no histórico. */
function skipEntry(id: string): boolean {
  const entry = findExpense(id)
  if (!entry || entry.status !== 'pending' || !guard()) return false
  replaceEntry(id, { status: 'cancelled', doneOn: null })
  showToast({
    message: `Pulada: ${expenseLabel(entry)} (${formatDateBR(entry.date)})`,
    icon: 'skip',
    action: { label: 'Desfazer', run: () => void replaceEntry(id, { status: 'pending' }) },
  })
  return true
}

/** Uma pulada volta a ser pendente. */
function restoreEntry(id: string): boolean {
  const entry = findExpense(id)
  if (!entry || entry.status !== 'cancelled' || !guard()) return false
  replaceEntry(id, { status: 'pending' })
  return true
}

/** Uma conta da lista de próximas: a já lançada, ou a prevista (que passa a existir agora). */
function ensureEntry(item: UpcomingItem): Expense | null {
  if (item.stored) return findExpense(item.id) ?? null
  const recurrence = findRecurrence(item.recurrenceId)
  if (!recurrence || !item.occurrence || !guard()) return null
  const existing = findExpense(occurrenceId(recurrence.id, item.occurrence))
  if (existing) return existing
  const entry = occurrenceEntry(recurrence, item.occurrence, item.amount, new Date().toISOString(), { date: item.date })
  state.expenses.push(entry)
  changed()
  return state.expenses.at(-1)!
}

/** Pagar (ou receber) uma conta da lista, inclusive uma prevista (adiantado). */
function confirmUpcoming(item: UpcomingItem, on: ISODate = today.value): boolean {
  const entry = ensureEntry(item)
  return entry ? confirmEntry(entry.id, on) : false
}

function skipUpcoming(item: UpcomingItem): boolean {
  const entry = ensureEntry(item)
  return entry ? skipEntry(entry.id) : false
}

/** Exclui (com Desfazer). */
function deleteExpense(id: string): void {
  const index = state.expenses.findIndex((expense) => expense.id === id)
  if (index < 0 || !guard()) return
  const [removed] = state.expenses.splice(index, 1)
  if (state.editing === id) state.editing = null
  changed()
  showToast({
    message: `${kindNoun(removed!.kind)} excluíd${removed!.kind === 'income' ? 'a' : 'o'}: ${expenseLabel(removed!)}`,
    icon: 'trash',
    action: {
      label: 'Desfazer',
      run: () => {
        if (findExpense(removed!.id)) return
        state.expenses.splice(Math.min(index, state.expenses.length), 0, removed!)
        changed()
      },
    },
  })
}

/** Excluir pela interface: pergunta antes (e o aviso ainda tem Desfazer). */
async function requestDeleteExpense(id: string): Promise<boolean> {
  const expense = findExpense(id)
  if (!expense) return false
  const income = expense.kind === 'income'
  const ok = await confirmDialog({
    title: income ? 'Excluir a entrada?' : 'Excluir o gasto?',
    message: `${expenseLabel(expense)} (${formatDateBR(expense.date)}). ${income ? 'A entrada sai' : 'O gasto sai'} do histórico, dos saldos e dos gráficos.${
      expense.recurrenceId && expense.status === 'pending' ? ' Para não pagar só esta vez, use "Pular esta".' : ''
    }`,
    confirmLabel: 'Excluir',
    danger: true,
  })
  if (!ok || !findExpense(id)) return false
  deleteExpense(id)
  return true
}

/** Registra de novo o mesmo lançamento, hoje (ex.: um café que se repete). */
function repeatExpense(id: string): Expense | null {
  const expense = findExpense(id)
  if (!expense) return null
  const copy = addExpense({ kind: expense.kind, description: expense.description, amount: expense.amount, date: today.value, categoryId: expense.categoryId, notes: expense.notes })
  if (copy) showToast({ message: `Registrado de novo hoje: ${expenseLabel(copy)}`, icon: 'check', tone: 'success' })
  return copy
}

function openExpense(id: string | null): void {
  state.editing = id && findExpense(id) ? id : null
}

/**
 * Mostra o lançamento no histórico (uma menção foi aberta): vai para os lançamentos, tira
 * os filtros que o escondem, vai para o mês dele e o destaca.
 */
function revealExpense(id: string): boolean {
  const expense = findExpense(id)
  if (!expense) return false
  setTab('expenses')
  state.search = ''
  if (state.kind !== 'all' && state.kind !== expense.kind) state.kind = 'all'
  if (state.categoryFilter.length && !state.categoryFilter.includes(expense.categoryId && categoryById.value.has(expense.categoryId) ? expense.categoryId : null)) state.categoryFilter = []
  if (state.period && (expense.date < state.period.from || expense.date > state.period.to)) state.period = periodOf('month', expense.date, state.settings.weekStart)
  state.reveal = { id, seq: (state.reveal?.seq ?? 0) + 1 }
  return true
}

// ── Ações: recorrências ─────────────────────────────────────────────────────

/** Cria a recorrência; as ocorrências até hoje já aparecem (pendentes ou, se pedido, pagas). */
function addRecurrence(input: RecurrenceInput): Recurrence | null {
  if (!guard()) return null
  const amount = Math.round(input.amount)
  if (!amount || amount <= 0 || !isISODate(input.firstDate)) return null
  if (input.endDate && (!isISODate(input.endDate) || input.endDate < input.firstDate)) return null
  const now = new Date().toISOString()
  const recurrence: Recurrence = {
    id: createId('r'),
    kind: input.kind,
    description: input.description.trim().slice(0, MAX_DESCRIPTION),
    categoryId: input.categoryId && categoryById.value.has(input.categoryId) ? input.categoryId : null,
    notes: (input.notes ?? '').slice(0, MAX_NOTES),
    remind: input.kind === 'expense' && input.remind === true,
    versions: [{ from: input.firstDate, amount, frequency: input.frequency, anchor: input.firstDate }],
    endDate: input.endDate,
    stoppedAt: null,
    generatedUntil: null,
    createdAt: now,
    updatedAt: now,
  }
  state.recurrences.push(recurrence)
  const stored = state.recurrences.at(-1)!
  // As que já passaram (antes de hoje) podem entrar como pagas
  if (input.pastAsDone) {
    for (const item of occurrencesBetween(stored, input.firstDate, addDays(today.value, -1), 1000)) {
      state.expenses.push(occurrenceEntry(stored, item.occurrence, item.amount, now, { status: 'done', doneOn: null }))
    }
  }
  materialize()
  changed()
  remindSoon()
  return stored
}

/** A próxima ocorrência que ainda vai acontecer (de hoje em diante, nem paga nem pulada). */
function nextOccurrence(recurrence: Recurrence): { occurrence: ISODate; amount: number; entry: Expense | null } | null {
  const stored = new Map(state.expenses.filter((entry) => entry.recurrenceId === recurrence.id && entry.occurrence).map((entry) => [entry.occurrence!, entry]))
  for (const item of occurrencesBetween(recurrence, today.value, addMonths(today.value, 25), 60)) {
    const entry = stored.get(item.occurrence) ?? null
    if (entry && entry.status !== 'pending') continue
    return { ...item, entry }
  }
  return null
}

/**
 * Muda uma recorrência. Descrição, categoria, observações, lembrete e data final valem
 * para ela e para as ocorrências ainda pendentes; valor, frequência e data da próxima
 * valem para `scope`: só a próxima ocorrência, ou a próxima e as seguintes (as já pagas
 * nunca mudam).
 */
function updateRecurrence(id: string, patch: RecurrencePatch, scope: ChangeScope = 'future'): boolean {
  const recurrence = findRecurrence(id)
  if (!recurrence || !guard()) return false
  if (patch.amount !== undefined && (!Number.isFinite(patch.amount) || Math.round(patch.amount) <= 0)) return false
  if (patch.nextDate !== undefined && !isISODate(patch.nextDate)) return false
  if (patch.endDate && (!isISODate(patch.endDate) || patch.endDate < recurrence.versions[0]!.anchor)) return false
  const now = new Date().toISOString()
  // Campos que valem para a recorrência e para as pendentes
  const shared: Partial<Expense> = {}
  if (patch.description !== undefined) recurrence.description = shared.description = patch.description.trim().slice(0, MAX_DESCRIPTION)
  if (patch.categoryId !== undefined) recurrence.categoryId = shared.categoryId = patch.categoryId && categoryById.value.has(patch.categoryId) ? patch.categoryId : null
  if (patch.notes !== undefined) recurrence.notes = patch.notes.slice(0, MAX_NOTES)
  if (patch.remind !== undefined) recurrence.remind = shared.remind = recurrence.kind === 'expense' && patch.remind
  if (Object.keys(shared).length) {
    state.expenses = state.expenses.map((entry) => (entry.recurrenceId === id && entry.status === 'pending' ? { ...entry, ...shared, updatedAt: now } : entry))
  }

  // Valor, frequência ou data da próxima
  const amount = patch.amount !== undefined ? Math.round(patch.amount) : undefined
  const next = nextOccurrence(recurrence)
  const current = next ? versionAt(recurrence, next.occurrence) : null
  const reschedule =
    next &&
    current &&
    ((amount !== undefined && amount !== (next.entry?.amount ?? next.amount)) ||
      (patch.frequency !== undefined && patch.frequency !== current.frequency) ||
      (patch.nextDate !== undefined && patch.nextDate !== (next.entry?.date ?? next.occurrence)))
  if (reschedule && next && current) {
    if (scope === 'next') {
      // Só a próxima: a ocorrência muda (valor e/ou data); a regra continua igual
      let date = patch.nextDate ?? next.entry?.date ?? next.occurrence
      if (patch.nextDate === undefined && patch.frequency && patch.frequency !== current.frequency) {
        const previous = occurrenceBefore(recurrence, next.occurrence)
        if (previous) date = stepFrom(previous.occurrence, patch.frequency)
      }
      const values = { amount: amount ?? next.entry?.amount ?? next.amount, date }
      if (next.entry) replaceEntry(next.entry.id, values)
      else state.expenses.push(occurrenceEntry(recurrence, next.occurrence, values.amount, now, { date: values.date }))
    } else {
      recurrence.versions = withFutureChange(recurrence, next.occurrence, { amount, frequency: patch.frequency, date: patch.nextDate })
      const from = recurrence.versions.at(-1)!.from
      const moved = patch.frequency !== undefined || patch.nextDate !== undefined
      const mine = state.expenses.filter((entry) => entry.recurrenceId === id && entry.status === 'pending' && entry.occurrence && entry.occurrence >= from)
      const last = mine.reduce((latest, entry) => (entry.occurrence! > latest ? entry.occurrence! : latest), from)
      const schedule = new Map(occurrencesBetween(recurrence, from, last, 2000).map((item) => [item.occurrence, item.amount]))
      // As pendentes daqui para a frente acompanham; as que saíram da agenda deixam de existir
      state.expenses = state.expenses.flatMap((entry) => {
        if (!mine.includes(entry)) return [entry]
        const value = schedule.get(entry.occurrence!)
        if (value === undefined) return []
        return [{ ...entry, amount: value, date: moved ? entry.occurrence! : entry.date, updatedAt: now }]
      })
    }
  }

  // Data final: depois dela nada novo; as pendentes depois dela são puladas
  if (patch.endDate !== undefined) {
    recurrence.endDate = patch.endDate
    if (patch.endDate) {
      state.expenses = state.expenses.map((entry) =>
        entry.recurrenceId === id && entry.status === 'pending' && entry.occurrence && entry.occurrence > patch.endDate! ? { ...entry, status: 'cancelled', updatedAt: now } : entry,
      )
    }
    if (!patch.endDate) recurrence.stoppedAt = null
  }
  recurrence.updatedAt = now
  materialize()
  changed()
  remindSoon()
  return true
}

/** Encerra ("até eu remover"): nada novo depois de hoje; as que já existem ficam (com Desfazer). */
function stopRecurrence(id: string): boolean {
  const recurrence = findRecurrence(id)
  if (!recurrence || !guard()) return false
  const before = { endDate: recurrence.endDate, stoppedAt: recurrence.stoppedAt }
  recurrence.endDate = recurrence.endDate && recurrence.endDate < today.value ? recurrence.endDate : today.value
  recurrence.stoppedAt = new Date().toISOString()
  recurrence.updatedAt = recurrence.stoppedAt
  changed()
  showToast({
    message: `Recorrência encerrada: ${recurrence.description || kindNoun(recurrence.kind)}. O histórico continua.`,
    icon: 'repeat',
    action: {
      label: 'Desfazer',
      run: () => {
        const current = findRecurrence(id)
        if (!current) return
        Object.assign(current, before, { updatedAt: new Date().toISOString() })
        materialize()
        changed()
      },
    },
  })
  return true
}

/**
 * Exclui a recorrência: a configuração e as ocorrências pendentes ou puladas somem; as
 * pagas ficam no histórico (como lançamentos comuns). Com Desfazer.
 */
async function requestDeleteRecurrence(id: string): Promise<boolean> {
  const recurrence = findRecurrence(id)
  if (!recurrence) return false
  const mine = state.expenses.filter((entry) => entry.recurrenceId === id)
  const done = mine.filter((entry) => entry.status === 'done').length
  const open = mine.length - done
  const ok = await confirmDialog({
    title: 'Excluir a recorrência?',
    message: `${recurrence.description || kindNoun(recurrence.kind)}: nenhuma ocorrência nova.${open ? ` ${open} ${open === 1 ? 'pendente (ou pulada) sai' : 'pendentes (ou puladas) saem'} da lista.` : ''}${
      done ? ` ${done} ${done === 1 ? 'paga continua' : 'pagas continuam'} no histórico.` : ''
    } Para só parar de gerar, use "Encerrar".`,
    confirmLabel: 'Excluir',
    danger: true,
  })
  if (!ok || !findRecurrence(id) || !guard()) return false
  const snapshotRecurrences = [...state.recurrences]
  const snapshotEntries = [...state.expenses]
  state.recurrences = state.recurrences.filter((item) => item.id !== id)
  state.expenses = state.expenses.flatMap((entry) => {
    if (entry.recurrenceId !== id) return [entry]
    return entry.status === 'done' ? [{ ...entry, recurrenceId: null, occurrence: null }] : []
  })
  if (state.editingRecurrence === id) state.editingRecurrence = null
  changed()
  showToast({
    message: `Recorrência excluída: ${recurrence.description || kindNoun(recurrence.kind)}`,
    icon: 'trash',
    action: {
      label: 'Desfazer',
      run: () => {
        if (findRecurrence(id)) return
        state.recurrences = snapshotRecurrences
        state.expenses = snapshotEntries
        changed()
      },
    },
  })
  return true
}

function openRecurrence(id: string | null): void {
  state.editingRecurrence = id && (id.startsWith('new:') || findRecurrence(id)) ? id : null
}

// ── Saldo inicial ───────────────────────────────────────────────────────────

function setOpeningBalance(value: OpeningBalance | null): boolean {
  if (!guard()) return false
  if (value && (!isISODate(value.date) || !Number.isFinite(value.amount))) return false
  state.openingBalance = value ? { amount: Math.round(value.amount), date: value.date } : null
  scheduleSave()
  return true
}

// ── Importar extrato ────────────────────────────────────────────────────────

/**
 * Adiciona as transações revisadas na prévia. As que mostram o pagamento de uma conta
 * pendente (`confirms`) confirmam essa conta em vez de criar outra. O arquivo não é
 * guardado: fica o nome dele e quando foi importado. Com Desfazer.
 */
function importEntries(rows: ImportRow[], origin: { file: string; format: 'csv' | 'ofx' | 'bank' }): { added: number; confirmed: number } | null {
  if (!guard() || !rows.length) return null
  const now = new Date().toISOString()
  const batch: ImportBatch = { id: createId('x'), file: origin.file.slice(0, 255), format: origin.format, importedAt: now, count: 0 }
  const before = { expenses: [...state.expenses], imports: [...state.imports] }
  let added = 0
  let confirmed = 0
  const next = [...state.expenses]
  for (const row of rows) {
    if (!isISODate(row.date) || !Number.isFinite(row.amount) || row.amount <= 0) continue
    const target = row.confirms ? next.findIndex((entry) => entry.id === row.confirms && entry.status === 'pending') : -1
    if (target >= 0) {
      next[target] = { ...next[target]!, status: 'done', doneOn: row.date, importId: batch.id, externalId: row.externalId ?? next[target]!.externalId, updatedAt: now }
      confirmed++
      continue
    }
    next.push({
      id: createId(row.kind === 'income' ? 'i' : 'e'),
      kind: row.kind,
      description: row.description.trim().slice(0, MAX_DESCRIPTION),
      amount: Math.round(row.amount),
      date: row.date,
      categoryId: row.categoryId && categoryById.value.has(row.categoryId) ? row.categoryId : null,
      notes: '',
      status: 'done',
      doneOn: null,
      remind: false,
      recurrenceId: null,
      occurrence: null,
      importId: batch.id,
      externalId: row.externalId,
      createdAt: now,
      updatedAt: now,
    })
    added++
  }
  if (!added && !confirmed) return null
  batch.count = added + confirmed
  state.expenses = next
  state.imports.push(batch)
  changed()
  showToast({
    message: `${origin.format === 'bank' ? `Do banco (${origin.file})` : 'Extrato importado'}: ${added} ${added === 1 ? 'lançamento' : 'lançamentos'}${confirmed ? ` e ${confirmed} ${confirmed === 1 ? 'conta confirmada' : 'contas confirmadas'}` : ''}.`,
    icon: 'check',
    tone: 'success',
    duration: 8000,
    action: {
      label: 'Desfazer',
      run: () => {
        if (!state.imports.some((item) => item.id === batch.id)) return
        // Só o que veio desta importação (o que você fez depois continua)
        const original = new Map(before.expenses.map((entry) => [entry.id, entry]))
        state.expenses = state.expenses.flatMap((entry) => {
          if (entry.importId !== batch.id) return [entry]
          const was = original.get(entry.id)
          return was ? [was] : []
        })
        state.imports = state.imports.filter((item) => item.id !== batch.id)
        changed()
      },
    },
  })
  return { added, confirmed }
}

/** Lançamentos seus que são uma transação do banco: guardam o id dela (a próxima busca não traz de novo). */
function linkExternalIds(links: { entryId: string; externalId: string }[]): number {
  if (!links.length || !guard()) return 0
  const byId = new Map(links.map((link) => [link.entryId, link.externalId]))
  let count = 0
  state.expenses = state.expenses.map((entry) => {
    const externalId = byId.get(entry.id)
    if (!externalId || entry.externalId === externalId) return entry
    count++
    return { ...entry, externalId, updatedAt: new Date().toISOString() }
  })
  if (count) changed()
  return count
}

function importName(id: string | null): string | null {
  const batch = id ? state.imports.find((item) => item.id === id) : undefined
  return batch ? `${batch.file} (${formatDateBR(batch.importedAt.slice(0, 10))})` : null
}

// ── Lembretes ("Me lembre de pagar") ────────────────────────────────────────
//
// O app não roda em segundo plano: os lembretes aparecem quando ele está aberto (ao
// abrir e quando o dia vira). Um aviso no app (com "Ver") e, no computador, também o
// aviso do sistema (o mesmo do Timer) se o app não está em primeiro plano. Cada conta
// avisa uma vez por dia (guardado neste aparelho). No celular, o ponto no ícone das
// Finanças e a lista de contas mostram o que vence.

let remindTimer: ReturnType<typeof setTimeout> | null = null
function remindSoon(): void {
  if (remindTimer || typeof window === 'undefined') return
  remindTimer = setTimeout(() => {
    remindTimer = null
    remind()
  }, 1500)
}

function remind(): void {
  // Módulo desativado: sem avisos (os dados continuam)
  if (!state.loaded || state.error || !useModulesStore().isEnabled('finance')) return
  const due = reminders.value
  if (!due.length) return
  const seen = readDeviceState('finance-reminders') ?? {}
  const day = today.value
  const already = seen.day === day && Array.isArray(seen.ids) ? new Set(seen.ids as string[]) : new Set<string>()
  const fresh = due.filter((entry) => !already.has(entry.id))
  if (!fresh.length) return
  writeDeviceState('finance-reminders', { day, ids: [...already, ...fresh.map((entry) => entry.id)] })
  const overdue = fresh.filter((entry) => entry.date < day).length
  const names = fresh.slice(0, 3).map((entry) => entry.description || 'Conta')
  const message =
    fresh.length === 1
      ? `${overdue ? 'Conta vencida' : 'Conta para pagar hoje'}: ${expenseLabel(fresh[0]!)}`
      : `${fresh.length} contas para pagar${overdue ? ` (${overdue} vencida${overdue === 1 ? '' : 's'})` : ' hoje'}: ${names.join(', ')}${fresh.length > 3 ? '…' : ''}`
  showToast({
    message,
    icon: 'bell',
    duration: 10000,
    action: {
      label: 'Ver',
      run: async () => {
        await navigateTo('/finance')
        setTab('bills')
      },
    },
  })
  systemNotice('Finanças', message)
}

function systemNotice(title: string, body: string): void {
  if (!state.settings.notify || !hasDesktopApi() || isAndroid() || typeof window === 'undefined' || !('Notification' in window)) return
  if (document.visibilityState === 'visible' && document.hasFocus()) return
  try {
    if (Notification.permission !== 'granted') return
    const notice = new Notification(title, { body, silent: false, tag: '4notes-finance' })
    notice.onclick = () => window.focus()
  } catch {
    // sem avisos do sistema (o aviso continua no app)
  }
}

// ── Categorias ──────────────────────────────────────────────────────────────
//
// As categorias são as compartilhadas do app (stores/categories.ts): a lista do
// finance.json diz quais aparecem aqui (e em que ordem), com uma cópia do nome e da cor.

const shared = useCategoriesStore()

// ── Categoria automática (1.7.2) ────────────────────────────────────────────

/** Sugere a categoria (das que você já tem) a partir do histórico, de um dicionário e da categoria padrão (lib/finance/categorize.ts). */
const categorizer = computed(() => {
  const members = new Set(state.categories.map((category) => category.id))
  const candidates = [
    ...state.categories.map((category) => ({ id: category.id, name: shared.findCategory(category.id)?.name ?? category.name, member: true })),
    ...shared.state.categories.filter((category) => !members.has(category.id)).map((category) => ({ id: category.id, name: category.name, member: false })),
  ]
  return createCategorizer(state.expenses, candidates, { defaultCategory: state.settings.defaultCategory })
})

function suggestCategory(input: CategorizeInput): CategorySuggestion | null {
  if (!input.description.trim() && !input.hints?.some(Boolean)) {
    const fallback = state.settings.defaultCategory
    return input.kind === 'expense' && fallback && shared.findCategory(fallback) ? { id: fallback, source: 'default' } : null
  }
  return categorizer.value(input)
}

/** A categoria sugerida pronta para gravar: uma do app que ainda não está nas Finanças entra nelas. */
function ensureCategory(id: string | null): string | null {
  if (!id || categoryById.value.has(id)) return id
  return attachCategory(id)?.id ?? null
}

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

/**
 * "Feira #Mercado" digitado sem escolher na lista do "#": um "#Nome" de uma categoria que
 * existe sai do texto e vira a categoria (a primeira, se houver mais de uma).
 */
function takeHashCategory(text: string): { text: string; categoryId: string | null } {
  let categoryId: string | null = null
  const next = text
    .replace(/(^|\s)#([^\s#]{1,40})(?=\s|$)/g, (match, space: string, name: string) => {
      if (categoryId) return match
      const category = shared.findByName(name)
      if (!category) return match
      categoryId = attachShared(category).id
      return space
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { text: categoryId ? next : text, categoryId }
}

/** "Usar categoria existente": uma categoria do app passa a aparecer nas Finanças. */
function attachCategory(id: string): FinanceCategory | null {
  const category = shared.findCategory(id)
  return category ? attachShared(category) : null
}

function updateCategory(id: string, patch: { name?: string; color?: PaletteColor }): Promise<boolean> {
  return shared.updateCategory(id, patch)
}

/** Tira a categoria das Finanças: os lançamentos (e as recorrências) dela ficam sem categoria. */
function detachCategory(id: string): void {
  state.categories = state.categories.filter((category) => category.id !== id)
  state.expenses = state.expenses.map((expense) => (expense.categoryId === id ? { ...expense, categoryId: null } : expense))
  for (const recurrence of state.recurrences) if (recurrence.categoryId === id) recurrence.categoryId = null
  state.categoryFilter = state.categoryFilter.filter((item) => item !== id)
  scheduleSave()
}

/** Os lançamentos, as recorrências (e o lugar na lista) de `fromId` passam para `to`. */
function remapCategory(fromId: string, to: SharedCategory): void {
  let used = false
  state.expenses = state.expenses.map((expense) => {
    if (expense.categoryId !== fromId) return expense
    used = true
    return { ...expense, categoryId: to.id }
  })
  for (const recurrence of state.recurrences) {
    if (recurrence.categoryId !== fromId) continue
    recurrence.categoryId = to.id
    used = true
  }
  const index = state.categories.findIndex((category) => category.id === fromId)
  if (index >= 0) {
    if (state.categories.some((category) => category.id === to.id)) state.categories.splice(index, 1)
    else state.categories.splice(index, 1, { id: to.id, name: to.name, color: to.color, createdAt: state.categories[index]!.createdAt })
  } else if (used) {
    attachShared(to)
  }
  if (state.categoryFilter.includes(fromId)) state.categoryFilter = [...new Set(state.categoryFilter.map((item) => (item === fromId ? to.id : item)))]
  scheduleSave()
}

/** Pede o que fazer com os lançamentos e exclui a categoria (das Finanças ou do app). Nenhum lançamento é apagado. */
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
        title: expense.description || (expense.kind === 'income' ? 'Entrada sem descrição' : 'Gasto sem descrição'),
        detail: `${expense.kind === 'income' ? 'Entrada · ' : ''}${formatShortDate(expense.date, today.value)} · ${formatMoney(expense.amount)}${expense.status === 'pending' ? ' · pendente' : ''}`,
        path: `${DATA_PATHS.financeFile}#${expense.id}`,
        done: expense.status === 'cancelled',
      })),
  counts: () => {
    const counts = new Map<string, number>()
    for (const expense of state.expenses) if (expense.categoryId) counts.set(expense.categoryId, (counts.get(expense.categoryId) ?? 0) + 1)
    return counts
  },
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
    horizonEnd,
    reminders,
    categorySource,
    suggestCategory,
    ensureCategory,
    linkExternalIds,
    categoryById,
    knownCategoryIds,
    findExpense,
    findRecurrence,
    categoryOf,
    categoryName,
    expenseLabel,
    kindNoun,
    upcomingUntil,
    nextOccurrence,
    notedRecords,
    importName,
    load,
    retry,
    flush,
    refreshFromDisk,
    setTab,
    setSort,
    setHorizon,
    updateSettings,
    addExpense,
    updateExpense,
    confirmEntry,
    unconfirmEntry,
    skipEntry,
    restoreEntry,
    confirmUpcoming,
    skipUpcoming,
    deleteExpense,
    requestDeleteExpense,
    repeatExpense,
    openExpense,
    revealExpense,
    addRecurrence,
    updateRecurrence,
    stopRecurrence,
    requestDeleteRecurrence,
    openRecurrence,
    setOpeningBalance,
    importEntries,
    addCategory,
    attachCategory,
    takeHashCategory,
    updateCategory,
    requestDeleteCategory,
    moveCategory,
    revealFile: () => repo.reveal(),
  }
}
