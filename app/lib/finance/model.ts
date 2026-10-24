/**
 * Modelo de dados das Finanças (1.7.0; entradas, contas a pagar, recorrências, saldo
 * inicial e extratos importados na 1.7.1) + regras puras (sem Vue, sem disco).
 *
 * Tudo fica em <workspace>/finance/finance.json:
 * {
 *   "app": "4notes", "version": 2, "currency": "BRL",
 *   "openingBalance": { "amount": 150000, "date": "2026-10-01" },      ← opcional
 *   "categories": [{ "id": "mercado", "name": "Mercado", "color": "green", "createdAt": "…" }],
 *   "expenses": [{ "id": "e_k3j9x0a2qm", "description": "Feira", "amount": 5230, "date": "2026-10-21",
 *                  "categoryId": "mercado", "notes": "", "createdAt": "…", "updatedAt": "…" },
 *                { "id": "r_x1_20261105", "description": "Aluguel", "amount": 180000, "date": "2026-11-05",
 *                  "status": "pending", "remind": true, "recurrenceId": "r_x1", "occurrence": "2026-11-05", … }],
 *   "incomes": [{ "id": "i_…", "description": "Salário", "amount": 500000, "date": "2026-10-05", … }],
 *   "recurrences": [{ "id": "r_x1", "kind": "expense", "description": "Aluguel", "versions": [
 *                     { "from": "2026-01-05", "amount": 180000, "frequency": "monthly", "anchor": "2026-01-05" }],
 *                     "endDate": null, "generatedUntil": "2026-10-23", … }],
 *   "imports": [{ "id": "x_…", "file": "extrato-outubro.ofx", "format": "ofx", "importedAt": "…", "count": 42 }]
 * }
 *
 * - `amount` em centavos (inteiro, sempre positivo): R$ 52,30 = 5230. Gasto ou entrada
 *   é a lista em que o lançamento está (expenses × incomes), nunca o sinal.
 * - `date` é o dia do lançamento; numa conta a pagar (ou entrada prevista), o vencimento.
 * - `status`: "done" (pago/recebido, o padrão quando não aparece), "pending" (a pagar ou a
 *   receber: vencido se a data já passou) ou "cancelled" (ocorrência pulada: não conta).
 *   `doneOn` é o dia em que o pagamento (ou recebimento) foi confirmado: o dinheiro conta
 *   nesse dia.
 * - Os campos novos só aparecem no arquivo quando têm valor: um gasto comum continua
 *   igual ao da 1.7.0.
 * - Extratos importados: o arquivo não é copiado; cada lançamento guarda de qual
 *   importação veio (`importId`) e, no OFX, o identificador do banco (`externalId`).
 * - As categorias são as compartilhadas do app (stores/categories.ts): a lista daqui diz
 *   quais aparecem nas Finanças (e em que ordem), com uma cópia do nome e da cor.
 */
import { isPaletteColor, type PaletteColor } from '../colors'
import { isISODate, type ISODate } from '../dates'
import { CURRENCY, MAX_AMOUNT } from './format'
import { normalizeVersion, type Recurrence } from './recurrence'

export interface FinanceCategory {
  id: string
  name: string
  color: PaletteColor
  createdAt: string
}

export type EntryKind = 'expense' | 'income'
export type EntryStatus = 'done' | 'pending' | 'cancelled'

/** Um lançamento: gasto ou entrada. */
export interface Expense {
  id: string
  kind: EntryKind
  description: string
  /** Centavos (inteiro, maior que zero). */
  amount: number
  date: ISODate
  categoryId: string | null
  /** Observações (Markdown, como as notas; opcional). */
  notes: string
  status: EntryStatus
  /** Dia em que o pagamento (ou o recebimento) foi confirmado. */
  doneOn: ISODate | null
  /** "Me lembre de pagar". */
  remind: boolean
  /** Ocorrência de uma recorrência: qual e a data prevista dela. */
  recurrenceId: string | null
  occurrence: ISODate | null
  /** Veio de um extrato importado (qual importação) e o id da transação no banco (OFX). */
  importId: string | null
  externalId: string | null
  createdAt: string
  updatedAt: string
}

/** Um extrato importado (o arquivo em si não é guardado). */
export interface ImportBatch {
  id: string
  file: string
  format: 'csv' | 'ofx'
  importedAt: string
  count: number
}

/** Saldo da conta num dia (no fim dele): a base do saldo realizado. */
export interface OpeningBalance {
  /** Centavos, com sinal (pode estar negativo). */
  amount: number
  date: ISODate
}

export interface FinanceData {
  categories: FinanceCategory[]
  /** Gastos e entradas (o `kind` diz qual). */
  expenses: Expense[]
  recurrences: Recurrence[]
  imports: ImportBatch[]
  openingBalance: OpeningBalance | null
}

export const MAX_DESCRIPTION = 200
export const MAX_NOTES = 4000

export function defaultFinanceData(): FinanceData {
  return { categories: [], expenses: [], recurrences: [], imports: [], openingBalance: null }
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
const id = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const date = (value: unknown) => (isISODate(value) ? value : null)

function normalizeCategory(raw: unknown, now: string): FinanceCategory | null {
  if (!isObject(raw)) return null
  const id = str(raw.id).trim()
  const name = str(raw.name).trim()
  if (!id || !name) return null
  return { id, name, color: isPaletteColor(raw.color) ? raw.color : 'gray', createdAt: str(raw.createdAt, now) }
}

/** Valor de um gasto lido do arquivo: centavos inteiros (um número com casas é arredondado). */
function amountOf(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN
  if (!Number.isFinite(number)) return null
  const cents = Math.round(number)
  return cents > 0 && cents <= MAX_AMOUNT ? cents : null
}

const STATUSES: readonly EntryStatus[] = ['done', 'pending', 'cancelled']

function normalizeEntry(raw: unknown, kind: EntryKind, now: string): Expense | null {
  if (!isObject(raw)) return null
  const entryId = str(raw.id).trim()
  const amount = amountOf(raw.amount)
  const day = str(raw.date)
  if (!entryId || amount === null || !isISODate(day)) return null
  const createdAt = str(raw.createdAt, now)
  const status = STATUSES.includes(raw.status as EntryStatus) ? (raw.status as EntryStatus) : 'done'
  const recurrenceId = id(raw.recurrenceId)
  return {
    id: entryId,
    kind,
    description: str(raw.description).trim().slice(0, MAX_DESCRIPTION),
    amount,
    date: day,
    categoryId: typeof raw.categoryId === 'string' && raw.categoryId ? raw.categoryId : null,
    notes: str(raw.notes).slice(0, MAX_NOTES),
    status,
    doneOn: status === 'done' ? date(raw.doneOn) : null,
    remind: raw.remind === true,
    recurrenceId,
    occurrence: recurrenceId ? (date(raw.occurrence) ?? day) : null,
    importId: id(raw.importId),
    externalId: id(raw.externalId),
    createdAt,
    updatedAt: str(raw.updatedAt, createdAt),
  }
}

function normalizeRecurrence(raw: unknown, now: string): Recurrence | null {
  if (!isObject(raw)) return null
  const recurrenceId = id(raw.id)
  const versions = (Array.isArray(raw.versions) ? raw.versions : [])
    .map((item) => normalizeVersion(item, MAX_AMOUNT))
    .filter((item) => item !== null)
    .sort((a, b) => a.from.localeCompare(b.from))
  if (!recurrenceId || !versions.length) return null
  // A primeira versão começa na primeira ocorrência
  versions[0] = { ...versions[0]!, from: versions[0]!.anchor < versions[0]!.from ? versions[0]!.anchor : versions[0]!.from }
  const createdAt = str(raw.createdAt, now)
  return {
    id: recurrenceId,
    kind: raw.kind === 'income' ? 'income' : 'expense',
    description: str(raw.description).trim().slice(0, MAX_DESCRIPTION),
    categoryId: typeof raw.categoryId === 'string' && raw.categoryId ? raw.categoryId : null,
    notes: str(raw.notes).slice(0, MAX_NOTES),
    remind: raw.remind === true,
    versions,
    endDate: date(raw.endDate),
    stoppedAt: typeof raw.stoppedAt === 'string' && raw.stoppedAt ? raw.stoppedAt : null,
    generatedUntil: date(raw.generatedUntil),
    createdAt,
    updatedAt: str(raw.updatedAt, createdAt),
  }
}

function normalizeImport(raw: unknown, now: string): ImportBatch | null {
  if (!isObject(raw)) return null
  const batchId = id(raw.id)
  if (!batchId) return null
  return {
    id: batchId,
    file: str(raw.file).slice(0, 255),
    format: raw.format === 'ofx' ? 'ofx' : 'csv',
    importedAt: str(raw.importedAt, now),
    count: typeof raw.count === 'number' && raw.count >= 0 ? Math.round(raw.count) : 0,
  }
}

function normalizeOpening(raw: unknown): OpeningBalance | null {
  if (!isObject(raw) || !isISODate(raw.date) || typeof raw.amount !== 'number' || !Number.isFinite(raw.amount)) return null
  const amount = Math.round(raw.amount)
  return Math.abs(amount) <= MAX_AMOUNT ? { amount, date: raw.date } : null
}

/** Sem repetidos (cópia, conflito de sincronização): o primeiro de cada id fica. */
function unique<T extends { id: string }>(items: (T | null)[]): T[] {
  const seen = new Set<string>()
  const list: T[] = []
  for (const item of items) {
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    list.push(item)
  }
  return list
}

/**
 * Lê o finance.json de forma tolerante (arquivo editado à mão): registros sem id, sem
 * valor válido ou sem data ficam de fora; ids repetidos (cópia, conflito de
 * sincronização) ficam uma vez só.
 */
export function normalizeFinanceFile(raw: unknown, now = new Date().toISOString()): FinanceData {
  if (!isObject(raw)) throw new Error('O arquivo não tem o formato esperado.')
  const list = (value: unknown) => (Array.isArray(value) ? value : [])
  const categories = unique(list(raw.categories).map((item) => normalizeCategory(item, now)))
  const expenses = unique([
    ...list(raw.expenses).map((item) => normalizeEntry(item, 'expense', now)),
    ...list(raw.incomes).map((item) => normalizeEntry(item, 'income', now)),
  ])
  const recurrences = unique(list(raw.recurrences).map((item) => normalizeRecurrence(item, now)))
  const imports = unique(list(raw.imports).map((item) => normalizeImport(item, now)))
  return { categories, expenses, recurrences, imports, openingBalance: normalizeOpening(raw.openingBalance) }
}

/** O lançamento como fica no arquivo: os campos novos só quando têm valor. */
function entryFile(entry: Expense): Record<string, unknown> {
  const file: Record<string, unknown> = {
    id: entry.id,
    description: entry.description,
    amount: entry.amount,
    date: entry.date,
    categoryId: entry.categoryId,
    notes: entry.notes,
  }
  if (entry.status !== 'done') file.status = entry.status
  if (entry.doneOn) file.doneOn = entry.doneOn
  if (entry.remind) file.remind = true
  if (entry.recurrenceId) {
    file.recurrenceId = entry.recurrenceId
    file.occurrence = entry.occurrence
  }
  if (entry.importId) file.importId = entry.importId
  if (entry.externalId) file.externalId = entry.externalId
  file.createdAt = entry.createdAt
  file.updatedAt = entry.updatedAt
  return file
}

export function serializeFinance(data: FinanceData): string {
  const file: Record<string, unknown> = { app: '4notes', version: 2, currency: CURRENCY }
  if (data.openingBalance) file.openingBalance = data.openingBalance
  file.categories = data.categories
  file.expenses = data.expenses.filter((entry) => entry.kind === 'expense').map(entryFile)
  file.incomes = data.expenses.filter((entry) => entry.kind === 'income').map(entryFile)
  file.recurrences = data.recurrences
  file.imports = data.imports
  return `${JSON.stringify(file, null, 2)}\n`
}

// ── Situação (pago, pendente, vencido) ──────────────────────────────────────

export type EntryState = 'done' | 'pending' | 'overdue' | 'cancelled'

/** Pago/recebido, pendente, vencido (pendente com a data já passada) ou pulado. */
export function entryState(entry: Expense, today: ISODate): EntryState {
  if (entry.status === 'pending') return entry.date < today ? 'overdue' : 'pending'
  return entry.status
}

/** O dia em que o dinheiro saiu (ou entrou): o da confirmação, se houve; senão, o do lançamento. */
export const cashDate = (entry: Expense): ISODate => (entry.status === 'done' && entry.doneOn ? entry.doneOn : entry.date)

/** Gastos que já saíram de verdade (pagos), cada um no dia em que foi pago: a base do histórico de gastos e dos gráficos. */
export function paidExpenses(entries: readonly Expense[]): Expense[] {
  return entries.filter((entry) => entry.kind === 'expense' && entry.status === 'done').map((entry) => (entry.doneOn && entry.doneOn !== entry.date ? { ...entry, date: entry.doneOn } : entry))
}

/** Rótulos da situação de cada tipo. */
export function stateLabel(kind: EntryKind, state: EntryState): string {
  if (state === 'cancelled') return 'Pulada'
  if (state === 'overdue') return kind === 'income' ? 'Atrasada' : 'Vencido'
  if (state === 'pending') return kind === 'income' ? 'A receber' : 'Pendente'
  return kind === 'income' ? 'Recebido' : 'Pago'
}

// ── Consultas (histórico) ───────────────────────────────────────────────────

export type ExpenseSort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'

export const SORT_LABELS: Record<ExpenseSort, string> = {
  'date-desc': 'Mais recentes',
  'date-asc': 'Mais antigos',
  'amount-desc': 'Maior valor',
  'amount-asc': 'Menor valor',
}

export const foldText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR')

/** Filtro de categoria: undefined = todas; null = sem categoria; texto = essa categoria. */
export type ExpenseCategoryFilter = string | null | undefined

export interface ExpenseFilter {
  /** Período (datas do calendário, inclusive); null = todos. */
  from?: ISODate | null
  to?: ISODate | null
  category?: ExpenseCategoryFilter
  /** Busca na descrição (e nas observações), sem diferenciar acentos e maiúsculas. */
  search?: string
  /** Ids das categorias que existem (uma categoria que sumiu conta como "sem categoria"). */
  knownCategories?: ReadonlySet<string>
  /** Só gastos ou só entradas (undefined = os dois). */
  kind?: EntryKind
}

/** A categoria do gasto que vale (null se não tem ou se ela não existe mais). */
export function effectiveCategory(expense: Expense, known?: ReadonlySet<string>): string | null {
  return expense.categoryId && (!known || known.has(expense.categoryId)) ? expense.categoryId : null
}

export function filterExpenses(expenses: readonly Expense[], filter: ExpenseFilter): Expense[] {
  const words = foldText(filter.search ?? '')
    .split(/\s+/)
    .filter(Boolean)
  return expenses.filter((expense) => {
    if (filter.from && expense.date < filter.from) return false
    if (filter.to && expense.date > filter.to) return false
    if (filter.kind && expense.kind !== filter.kind) return false
    if (filter.category !== undefined && effectiveCategory(expense, filter.knownCategories) !== filter.category) return false
    if (words.length) {
      const haystack = foldText(`${expense.description} ${expense.notes}`)
      if (!words.every((word) => haystack.includes(word))) return false
    }
    return true
  })
}

/** Ordena (desempate: o registrado por último primeiro). */
export function sortExpenses(expenses: readonly Expense[], sort: ExpenseSort): Expense[] {
  const tie = (a: Expense, b: Expense) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
  return [...expenses].sort((a, b) => {
    switch (sort) {
      case 'date-asc':
        return a.date.localeCompare(b.date) || -tie(a, b)
      case 'amount-desc':
        return b.amount - a.amount || b.date.localeCompare(a.date) || tie(a, b)
      case 'amount-asc':
        return a.amount - b.amount || b.date.localeCompare(a.date) || tie(a, b)
      default:
        return b.date.localeCompare(a.date) || tie(a, b)
    }
  })
}

export const totalOf = (expenses: readonly Expense[]) => expenses.reduce((sum, expense) => sum + expense.amount, 0)

/** Agrupa (já ordenados por data) por dia, para a lista do histórico. */
export function groupByDay(expenses: readonly Expense[]): { date: ISODate; expenses: Expense[]; total: number }[] {
  const groups: { date: ISODate; expenses: Expense[]; total: number }[] = []
  for (const expense of expenses) {
    const last = groups.at(-1)
    if (last && last.date === expense.date) {
      last.expenses.push(expense)
      last.total += expense.amount
    } else {
      groups.push({ date: expense.date, expenses: [expense], total: expense.amount })
    }
  }
  return groups
}

/** Descrições já usadas (as mais recentes primeiro), para sugerir ao digitar. */
export function recentDescriptions(expenses: readonly Expense[], limit = 30, kind: EntryKind = 'expense'): { description: string; categoryId: string | null }[] {
  const seen = new Set<string>()
  const list: { description: string; categoryId: string | null }[] = []
  for (const expense of sortExpenses(expenses, 'date-desc')) {
    if (expense.kind !== kind) continue
    const key = foldText(expense.description.trim())
    if (!key || seen.has(key)) continue
    seen.add(key)
    list.push({ description: expense.description, categoryId: expense.categoryId })
    if (list.length >= limit) break
  }
  return list
}
