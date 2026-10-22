/**
 * Modelo de dados das Finanças (1.7.0) + regras puras (sem Vue, sem disco).
 *
 * Tudo fica em <workspace>/finance/finance.json:
 * {
 *   "app": "4notes", "version": 1, "currency": "BRL",
 *   "categories": [{ "id": "mercado", "name": "Mercado", "color": "green", "createdAt": "…" }],
 *   "expenses": [{ "id": "e_k3j9x0a2qm", "description": "Feira", "amount": 5230, "date": "2026-10-21",
 *                  "categoryId": "mercado", "notes": "", "createdAt": "…", "updatedAt": "…" }]
 * }
 *
 * - `amount` em centavos (inteiro): R$ 52,30 = 5230.
 * - `date` é o dia do gasto (do calendário, sem hora).
 * - As categorias são as compartilhadas do app (stores/categories.ts): a lista daqui diz
 *   quais aparecem nas Finanças (e em que ordem), com uma cópia do nome e da cor.
 */
import { isPaletteColor, type PaletteColor } from '../colors'
import { isISODate, type ISODate } from '../dates'
import { CURRENCY, MAX_AMOUNT } from './format'

export interface FinanceCategory {
  id: string
  name: string
  color: PaletteColor
  createdAt: string
}

export interface Expense {
  id: string
  description: string
  /** Centavos (inteiro, maior que zero). */
  amount: number
  date: ISODate
  categoryId: string | null
  /** Observações (texto livre, opcional). */
  notes: string
  createdAt: string
  updatedAt: string
}

export interface FinanceData {
  categories: FinanceCategory[]
  expenses: Expense[]
}

export const MAX_DESCRIPTION = 200
export const MAX_NOTES = 4000

export function defaultFinanceData(): FinanceData {
  return { categories: [], expenses: [] }
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

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

function normalizeExpense(raw: unknown, now: string): Expense | null {
  if (!isObject(raw)) return null
  const id = str(raw.id).trim()
  const amount = amountOf(raw.amount)
  const date = str(raw.date)
  if (!id || amount === null || !isISODate(date)) return null
  const createdAt = str(raw.createdAt, now)
  return {
    id,
    description: str(raw.description).trim().slice(0, MAX_DESCRIPTION),
    amount,
    date,
    categoryId: typeof raw.categoryId === 'string' && raw.categoryId ? raw.categoryId : null,
    notes: str(raw.notes).slice(0, MAX_NOTES),
    createdAt,
    updatedAt: str(raw.updatedAt, createdAt),
  }
}

/**
 * Lê o finance.json de forma tolerante (arquivo editado à mão): registros sem id, sem
 * valor válido ou sem data ficam de fora; ids repetidos (cópia, conflito de
 * sincronização) ficam uma vez só.
 */
export function normalizeFinanceFile(raw: unknown, now = new Date().toISOString()): FinanceData {
  if (!isObject(raw)) throw new Error('O arquivo não tem o formato esperado.')
  const categories: FinanceCategory[] = []
  for (const item of Array.isArray(raw.categories) ? raw.categories : []) {
    const category = normalizeCategory(item, now)
    if (category && !categories.some((other) => other.id === category.id)) categories.push(category)
  }
  const expenses: Expense[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw.expenses) ? raw.expenses : []) {
    const expense = normalizeExpense(item, now)
    if (!expense || seen.has(expense.id)) continue
    seen.add(expense.id)
    expenses.push(expense)
  }
  return { categories, expenses }
}

export function serializeFinance(data: FinanceData): string {
  const file = { app: '4notes', version: 1, currency: CURRENCY, categories: data.categories, expenses: data.expenses }
  return `${JSON.stringify(file, null, 2)}\n`
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
export function recentDescriptions(expenses: readonly Expense[], limit = 30): { description: string; categoryId: string | null }[] {
  const seen = new Set<string>()
  const list: { description: string; categoryId: string | null }[] = []
  for (const expense of sortExpenses(expenses, 'date-desc')) {
    const key = foldText(expense.description.trim())
    if (!key || seen.has(key)) continue
    seen.add(key)
    list.push({ description: expense.description, categoryId: expense.categoryId })
    if (list.length >= limit) break
  }
  return list
}
