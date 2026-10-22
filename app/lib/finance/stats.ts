/**
 * Números e gráficos das Finanças (1.7.0): regras puras (sem Vue), sempre calculadas a
 * partir dos gastos registrados (nada de valores de exemplo).
 *
 * Os períodos (dia, semana, mês, ano, intervalo) e a comparação com o período anterior
 * equivalente são os mesmos do Timer (lib/timer/stats.ts): com o período atual ainda em
 * andamento, compara com o MESMO trecho do anterior (1 a 22 deste mês × 1 a 22 do mês
 * passado), nunca com o anterior inteiro. Cada gasto conta no dia dele.
 */
import { addDays, addMonths, type ISODate } from '../dates'
import {
  comparisonRanges,
  dayStart,
  periodDays,
  variation,
  type EvolutionPoint,
  type Period,
  type WeekStart,
} from '../timer/stats'
import { effectiveCategory, type Expense } from './model'

const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

const parts = (iso: ISODate) => iso.split('-').map(Number) as [number, number, number]
function weekdayOf(iso: ISODate): number {
  const [y, m, d] = parts(iso)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** "qua, 21 de out." */
export function dayTitle(day: ISODate): string {
  const [, m, d] = parts(day)
  return `${WEEKDAYS_SHORT[weekdayOf(day)]}, ${d} de ${MONTHS_SHORT[m - 1]}.`
}

/** Gastos dentro do período (datas inclusive). */
export const inPeriod = (expenses: readonly Expense[], period: Period) => expenses.filter((expense) => expense.date >= period.from && expense.date <= period.to)

// ── Resumo ───────────────────────────────────────────────────────────────────

export interface FinanceSummary {
  total: number
  count: number
  /** Valor médio por gasto (null sem gastos). */
  average: number | null
  /** Média por dia do período (até hoje, num período em andamento). null sem gastos. */
  perDay: number | null
  /** Dias do período considerados na média por dia. */
  days: number
}

export function summarize(expenses: readonly Expense[], period: Period | null, today: ISODate): FinanceSummary {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const count = expenses.length
  let days = 0
  if (period) {
    const end = period.to < today ? period.to : today
    days = end >= period.from ? Math.round((dayStart(end) - dayStart(period.from)) / 86_400_000) + 1 : 0
  }
  return {
    total,
    count,
    average: count ? Math.round(total / count) : null,
    perDay: count && days ? Math.round(total / days) : null,
    days,
  }
}

// ── Gastos por categoria ─────────────────────────────────────────────────────

export interface CategorySpending {
  categoryId: string | null
  total: number
  count: number
}

/** Total por categoria (a maior primeiro). Uma categoria que não existe mais conta como "sem categoria". */
export function byCategory(expenses: readonly Expense[], known?: ReadonlySet<string>): CategorySpending[] {
  const map = new Map<string, CategorySpending>()
  for (const expense of expenses) {
    const id = effectiveCategory(expense, known)
    const key = id ?? ''
    const item = map.get(key) ?? { categoryId: id, total: 0, count: 0 }
    item.total += expense.amount
    item.count++
    map.set(key, item)
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.count - a.count)
}

// ── Dias com mais gastos e maiores despesas ──────────────────────────────────

export interface DayTotal {
  date: ISODate
  total: number
  count: number
}

/** Os dias com mais gastos (o maior primeiro). */
export function topDays(expenses: readonly Expense[], limit = 7): DayTotal[] {
  const map = new Map<ISODate, DayTotal>()
  for (const expense of expenses) {
    const item = map.get(expense.date) ?? { date: expense.date, total: 0, count: 0 }
    item.total += expense.amount
    item.count++
    map.set(expense.date, item)
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.date.localeCompare(a.date)).slice(0, limit)
}

/** Os maiores gastos (o maior primeiro; empate: o mais recente). */
export function topExpenses(expenses: readonly Expense[], limit = 8): Expense[] {
  return [...expenses].sort((a, b) => b.amount - a.amount || b.date.localeCompare(a.date)).slice(0, limit)
}

/** Total por dia da semana (0 = domingo … 6 = sábado). */
export function byWeekday(expenses: readonly Expense[]): number[] {
  const totals = [0, 0, 0, 0, 0, 0, 0]
  for (const expense of expenses) totals[weekdayOf(expense.date)]! += expense.amount
  return totals
}

// ── Evolução (as colunas do gráfico) ─────────────────────────────────────────

export type EvolutionStep = 'day' | 'week' | 'month'

export const STEP_LABELS: Record<EvolutionStep, string> = { day: 'Por dia', week: 'Por semana', month: 'Por mês' }

/** Como o período pode ser dividido no gráfico (um dia só não tem evolução). */
export function evolutionSteps(period: Period): EvolutionStep[] {
  const days = periodDays(period)
  if (days < 2) return []
  const steps: EvolutionStep[] = []
  if (days <= 92) steps.push('day')
  if (days >= 14 && days <= 731) steps.push('week')
  if (days >= 45) steps.push('month')
  return steps
}

/** A divisão padrão: por dia até uns dois meses; depois, por mês. */
export function defaultStep(period: Period): EvolutionStep | null {
  const steps = evolutionSteps(period)
  if (!steps.length) return null
  return periodDays(period) <= 62 && steps.includes('day') ? 'day' : steps.includes('month') ? 'month' : steps[0]!
}

/**
 * As colunas do gráfico de evolução: dias, semanas ou meses do período. Os valores (em
 * centavos) vão em `ms` (o campo que os gráficos do Timer leem).
 */
export function evolution(expenses: readonly Expense[], period: Period, step: EvolutionStep, today: ISODate, weekStart: WeekStart = 1): EvolutionPoint[] {
  const totals = new Map<ISODate, number>()
  for (const expense of inPeriod(expenses, period)) totals.set(expense.date, (totals.get(expense.date) ?? 0) + expense.amount)
  const sumRange = (from: ISODate, to: ISODate) => {
    let sum = 0
    for (const [day, value] of totals) if (day >= from && day <= to) sum += value
    return sum
  }
  const points: EvolutionPoint[] = []
  if (step === 'day') {
    const short = periodDays(period) <= 7
    for (let day = period.from, i = 0; day <= period.to && i < 800; day = addDays(day, 1), i++) {
      const [, , d] = parts(day)
      points.push({
        key: day,
        label: short ? WEEKDAYS_SHORT[weekdayOf(day)]! : String(d),
        title: dayTitle(day),
        ms: totals.get(day) ?? 0,
        future: day > today,
        current: day === today,
      })
    }
    return points
  }
  if (step === 'week') {
    // Semanas inteiras do calendário, cortadas nas pontas do período
    let start = addDays(period.from, -((weekdayOf(period.from) - weekStart + 7) % 7))
    for (let i = 0; start <= period.to && i < 120; start = addDays(start, 7), i++) {
      const from = start < period.from ? period.from : start
      const end = addDays(start, 6)
      const to = end > period.to ? period.to : end
      const [, fm, fd] = parts(from)
      const [, tm, td] = parts(to)
      points.push({
        key: from,
        label: `${fd}/${String(fm).padStart(2, '0')}`,
        title: fm === tm ? `${fd} a ${td} de ${MONTHS_SHORT[tm - 1]}.` : `${fd} de ${MONTHS_SHORT[fm - 1]}. a ${td} de ${MONTHS_SHORT[tm - 1]}.`,
        ms: sumRange(from, to),
        future: from > today,
        current: from <= today && today <= to,
      })
    }
    return points
  }
  for (let first = `${period.from.slice(0, 7)}-01`, i = 0; first <= period.to && i < 240; first = addMonths(first, 1), i++) {
    const [y, m] = parts(first)
    const last = addDays(addMonths(first, 1), -1)
    points.push({
      key: first.slice(0, 7),
      label: MONTHS_SHORT[m - 1]!,
      title: `${MONTHS[m - 1]} de ${y}`,
      ms: sumRange(first < period.from ? period.from : first, last > period.to ? period.to : last),
      future: first > today,
      current: first.slice(0, 7) === today.slice(0, 7),
    })
  }
  return points
}

// ── Comparação entre períodos ────────────────────────────────────────────────

export interface CategoryDelta {
  categoryId: string | null
  current: number
  previous: number
  diff: number
  /** Variação (0,25 = +25%); null quando o anterior não tinha gastos. */
  pct: number | null
}

export interface FinanceComparison {
  current: number
  previous: number
  currentCount: number
  previousCount: number
  diff: number
  pct: number | null
  previousPeriod: Period
  /** Período em andamento: os dois só até o mesmo ponto. */
  partial: boolean
  /** Último dia que entrou em cada lado (para dizer "1 a 22"). */
  currentUntil: ISODate
  previousUntil: ISODate
  categories: CategoryDelta[]
}

/** O gasto entra no trecho [início, fim) (o gasto conta à meia-noite do dia dele)? */
const within = (expense: Expense, range: readonly [number, number]) => {
  const at = dayStart(expense.date)
  return at >= range[0] && at < range[1]
}

/** Último dia do calendário que entra no trecho [início, fim). */
function lastDayOf(range: readonly [number, number]): ISODate {
  const date = new Date(Math.max(range[0], range[1] - 1))
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Compara o período com o anterior equivalente (com o atual em andamento, só o mesmo
 * trecho dos dois). `expenses` já vem filtrado (categoria, busca); o período não.
 */
export function compareSpending(expenses: readonly Expense[], period: Period, now: number, weekStart: WeekStart = 1, known?: ReadonlySet<string>): FinanceComparison {
  const ranges = comparisonRanges(period, now, weekStart)
  // Período em andamento: o dia de hoje entra inteiro (os gastos não têm hora)
  const current: [number, number] = ranges.partial ? [ranges.current[0], Math.max(ranges.current[1], dayStart(addDays(lastDayOf([now, now + 1]), 1)))] : ranges.current
  const previous: [number, number] = ranges.partial ? [ranges.previous[0], Math.min(dayStart(addDays(ranges.previousPeriod.to, 1)), ranges.previous[0] + (current[1] - current[0]))] : ranges.previous
  const a = expenses.filter((expense) => within(expense, current))
  const b = expenses.filter((expense) => within(expense, previous))
  const sum = (list: Expense[]) => list.reduce((total, expense) => total + expense.amount, 0)
  const categoryKeys = new Map<string, string | null>()
  const currentBy = byCategory(a, known)
  const previousBy = byCategory(b, known)
  for (const item of [...currentBy, ...previousBy]) categoryKeys.set(item.categoryId ?? '', item.categoryId)
  const categories = [...categoryKeys.values()]
    .map((categoryId) => {
      const x = currentBy.find((item) => item.categoryId === categoryId)?.total ?? 0
      const y = previousBy.find((item) => item.categoryId === categoryId)?.total ?? 0
      return { categoryId, current: x, previous: y, diff: x - y, pct: variation(x, y) }
    })
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || y.current - x.current)
  const totalA = sum(a)
  const totalB = sum(b)
  return {
    current: totalA,
    previous: totalB,
    currentCount: a.length,
    previousCount: b.length,
    diff: totalA - totalB,
    pct: variation(totalA, totalB),
    previousPeriod: ranges.previousPeriod,
    partial: ranges.partial,
    currentUntil: lastDayOf(current),
    previousUntil: lastDayOf(previous),
    categories,
  }
}
