/**
 * Estatísticas do Timer — regras puras (sem Vue).
 *
 * - Períodos: dia, semana, mês, ano ou um intervalo escolhido (datas do calendário,
 *   no fuso local); navegar para o anterior e o próximo.
 * - O tempo de cada sessão é dividido pelos trechos em que ele realmente aconteceu
 *   (spans): uma sessão que passa da meia-noite conta um pouco em cada dia.
 * - Só conta o tempo válido (`duration`): sessões canceladas ficam de fora, a não ser
 *   pelo tempo válido que tiverem.
 * - Comparação com o período anterior equivalente: com o período atual ainda em
 *   andamento, compara com o MESMO trecho do anterior (segunda a quarta 14:30 com
 *   segunda a quarta 14:30 da semana passada), nunca com o anterior inteiro.
 */
import { addDays, addMonths, daysInMonth, diffDays, toISODate, type ISODate } from '../dates'
import { activityKey, spansTotal, type TimerSession } from './model'

export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'custom'
/** Primeiro dia da semana: 0 = domingo, 1 = segunda. */
export type WeekStart = 0 | 1

/** Um período do calendário: de `from` até `to` (inclusive). */
export interface Period {
  kind: PeriodKind
  from: ISODate
  to: ISODate
}

export const PERIOD_LABELS: Record<Exclude<PeriodKind, 'custom'>, string> = { day: 'Dia', week: 'Semana', month: 'Mês', year: 'Ano' }

const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

const parts = (iso: ISODate) => iso.split('-').map(Number) as [number, number, number]

/** Meia-noite (local) do dia, em ms. */
export function dayStart(iso: ISODate): number {
  const [y, m, d] = parts(iso)
  return new Date(y, m - 1, d).getTime()
}

/** Dia da semana (0 = domingo) de uma data do calendário. */
function weekdayOf(iso: ISODate): number {
  const [y, m, d] = parts(iso)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** O período (dia, semana, mês ou ano) que contém `date`. */
export function periodOf(kind: Exclude<PeriodKind, 'custom'>, date: ISODate, weekStart: WeekStart = 1): Period {
  const [y, m] = parts(date)
  switch (kind) {
    case 'day':
      return { kind, from: date, to: date }
    case 'week': {
      const from = addDays(date, -((weekdayOf(date) - weekStart + 7) % 7))
      return { kind, from, to: addDays(from, 6) }
    }
    case 'month': {
      const from = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`
      return { kind, from, to: addDays(from, daysInMonth(y, m) - 1) }
    }
    case 'year':
      return { kind, from: `${String(y).padStart(4, '0')}-01-01`, to: `${String(y).padStart(4, '0')}-12-31` }
  }
}

/** Um intervalo escolhido (as datas podem vir trocadas). */
export function customPeriod(a: ISODate, b: ISODate): Period {
  return a <= b ? { kind: 'custom', from: a, to: b } : { kind: 'custom', from: b, to: a }
}

/** Quantos dias o período tem. */
export const periodDays = (period: Period) => diffDays(period.from, period.to) + 1

/** O período anterior (delta = −1) ou o próximo (+1), do mesmo tipo e tamanho. */
export function shiftPeriod(period: Period, delta: number, weekStart: WeekStart = 1): Period {
  switch (period.kind) {
    case 'day':
    case 'week':
      return periodOf(period.kind, addDays(period.from, delta * periodDays(period)), weekStart)
    case 'month':
      return periodOf('month', addMonths(period.from, delta), weekStart)
    case 'year':
      return periodOf('year', addMonths(period.from, delta * 12), weekStart)
    case 'custom': {
      const days = periodDays(period)
      return { kind: 'custom', from: addDays(period.from, delta * days), to: addDays(period.to, delta * days) }
    }
  }
}

/** [início, fim) do período em ms (fuso local). */
export function periodBounds(period: Period): [number, number] {
  return [dayStart(period.from), dayStart(addDays(period.to, 1))]
}

export function containsDay(period: Period, day: ISODate): boolean {
  return day >= period.from && day <= period.to
}

/** "Hoje", "Ontem", "qua, 7 de outubro de 2026", "5 – 11 de out. de 2026", "Outubro de 2026", "2026"… */
export function periodLabel(period: Period, today: ISODate): string {
  const [fy, fm, fd] = parts(period.from)
  const [ty, tm, td] = parts(period.to)
  const year = (y: number) => (y === parts(today)[0] ? '' : ` de ${y}`)
  switch (period.kind) {
    case 'day': {
      if (period.from === today) return 'Hoje'
      if (period.from === addDays(today, -1)) return 'Ontem'
      if (period.from === addDays(today, 1)) return 'Amanhã'
      return `${WEEKDAYS_SHORT[weekdayOf(period.from)]}, ${fd} de ${MONTHS[fm - 1]}${year(fy)}`
    }
    case 'month':
      return `${MONTHS[fm - 1]!.charAt(0).toUpperCase()}${MONTHS[fm - 1]!.slice(1)}${year(fy)}`
    case 'year':
      return String(fy)
    default: {
      if (period.from === period.to) return `${fd} de ${MONTHS_SHORT[fm - 1]}.${year(fy)}`
      const sameMonth = fy === ty && fm === tm
      const left = sameMonth ? `${fd}` : `${fd} de ${MONTHS_SHORT[fm - 1]}.${fy === ty ? '' : ` de ${fy}`}`
      return `${left} – ${td} de ${MONTHS_SHORT[tm - 1]}.${year(ty)}`
    }
  }
}

// ── Tempo de cada sessão, pedaço por pedaço ─────────────────────────────────

/**
 * Pedaços de tempo VÁLIDO da sessão: os trechos dela, com o tempo que conta
 * espalhado em proporção (uma sessão cancelada sem tempo válido não tem pedaços;
 * uma com o tempo editado para menos conta menos em cada trecho).
 */
export function countedPieces(session: TimerSession): [number, number, number][] {
  if (session.duration <= 0) return []
  const spans = session.spans.length ? session.spans : [[session.start, session.end] as [number, number]]
  const total = spansTotal(spans)
  if (total <= 0) return []
  const factor = (session.duration * 1000) / total
  return spans.map(([start, end]) => [start, end, (end - start) * factor])
}

/** Divide [start, end) nas horas do relógio (local) e chama `visit` com o início de cada hora e a fração do pedaço. */
function eachHour(start: number, end: number, visit: (hourStart: Date, fraction: number) => void): void {
  const length = end - start
  if (length <= 0) return
  let cursor = start
  while (cursor < end) {
    const date = new Date(cursor)
    const hour = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours())
    const next = Math.min(end, new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() + 1).getTime())
    visit(hour, (next - cursor) / length)
    cursor = next
  }
}

export interface Bucket {
  ms: number
  sessions: number
}

export interface CategoryTotal extends Bucket {
  categoryId: string | null
}

export interface ActivityTotal extends Bucket {
  key: string
  /** Nome como foi escrito da última vez ("" = sem nome). */
  activity: string
  categoryId: string | null
}

export interface Aggregate {
  /** Tempo válido no período (ms). */
  total: number
  /** Sessões com tempo válido no período. */
  sessions: number
  /** Duração média das sessões (ms). */
  average: number
  /** Por categoria (null = sem categoria), do maior para o menor. */
  categories: CategoryTotal[]
  /** Por atividade (+ categoria), do maior para o menor. */
  activities: ActivityTotal[]
  /** Por dia (AAAA-MM-DD → ms). */
  days: Map<ISODate, number>
  /** Por hora do dia (0–23). */
  hours: number[]
  /** Por dia da semana (0 = domingo). */
  weekdays: number[]
  /** Dia da semana × hora (0 = domingo; 0–23). */
  heat: number[][]
}

/** Filtro de categoria: undefined = todas; null = sem categoria. */
/** undefined (ou lista vazia) = todas; null = sem categoria; lista = qualquer uma delas (1.7.2, filtro de várias). */
export type CategoryFilter = string | null | undefined | readonly (string | null)[]

export function matchesCategory(session: TimerSession, filter: CategoryFilter, known?: ReadonlySet<string>): boolean {
  if (filter === undefined) return true
  // Categoria que não existe mais conta como "sem categoria"
  const category = session.categoryId && (!known || known.has(session.categoryId)) ? session.categoryId : null
  if (Array.isArray(filter)) return !filter.length || filter.includes(category)
  return category === filter
}

/** Junta o tempo válido de [from, to) — por categoria, atividade, dia, hora… */
export function aggregate(
  sessions: readonly TimerSession[],
  range: readonly [number, number],
  options: { category?: CategoryFilter; knownCategories?: ReadonlySet<string> } = {},
): Aggregate {
  const [from, to] = range
  const known = options.knownCategories
  const categories = new Map<string | null, CategoryTotal>()
  const activities = new Map<string, ActivityTotal>()
  const days = new Map<ISODate, number>()
  const hours = Array.from({ length: 24 }, () => 0)
  const weekdays = Array.from({ length: 7 }, () => 0)
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  let total = 0
  let count = 0

  for (const session of sessions) {
    if (session.end <= from || session.start >= to || session.duration <= 0) continue
    if (!matchesCategory(session, options.category, known)) continue
    let inside = 0
    for (const [start, end, ms] of countedPieces(session)) {
      const a = Math.max(start, from)
      const b = Math.min(end, to)
      if (b <= a) continue
      const piece = (ms * (b - a)) / (end - start)
      inside += piece
      eachHour(a, b, (hour, fraction) => {
        const value = piece * fraction
        const day = toISODate(hour)
        days.set(day, (days.get(day) ?? 0) + value)
        hours[hour.getHours()]! += value
        weekdays[hour.getDay()]! += value
        heat[hour.getDay()]![hour.getHours()]! += value
      })
    }
    if (inside <= 0) continue
    total += inside
    count += 1
    const categoryId = session.categoryId && (!known || known.has(session.categoryId)) ? session.categoryId : null
    const category = categories.get(categoryId) ?? { categoryId, ms: 0, sessions: 0 }
    category.ms += inside
    category.sessions += 1
    categories.set(categoryId, category)
    const key = `${activityKey(session.activity)}|${categoryId ?? ''}`
    const activity = activities.get(key) ?? { key, activity: session.activity.trim(), categoryId, ms: 0, sessions: 0 }
    activity.ms += inside
    activity.sessions += 1
    // O nome mais recente (as sessões vêm em ordem)
    if (session.activity.trim()) activity.activity = session.activity.trim()
    activities.set(key, activity)
  }

  const byTime = <T extends Bucket>(list: T[]) => list.sort((a, b) => b.ms - a.ms)
  return {
    total,
    sessions: count,
    average: count ? total / count : 0,
    categories: byTime([...categories.values()]),
    activities: byTime([...activities.values()]),
    days,
    hours,
    weekdays,
    heat,
  }
}

// ── Evolução (as colunas do gráfico) ─────────────────────────────────────────

export interface EvolutionPoint {
  key: string
  /** Rótulo do eixo ("seg", "7", "14h", "out"). */
  label: string
  /** Rótulo completo (balão e tabela). */
  title: string
  ms: number
  /** Ainda não chegou (fica apagado). */
  future: boolean
  /** É agora (hoje, esta hora, este mês). */
  current: boolean
}

/** Como o período é dividido no gráfico de evolução. */
export function evolutionUnit(period: Period): 'hour' | 'day' | 'month' {
  if (period.kind === 'day') return 'hour'
  if (period.kind === 'year') return 'month'
  if (period.kind === 'custom' && periodDays(period) > 62) return 'month'
  return 'day'
}

/** As colunas do gráfico de evolução: horas do dia, dias da semana/mês ou meses do ano. */
export function evolution(
  sessions: readonly TimerSession[],
  period: Period,
  now: number,
  options: { category?: CategoryFilter; knownCategories?: ReadonlySet<string> } = {},
): EvolutionPoint[] {
  const unit = evolutionUnit(period)
  const today = toISODate(new Date(now))
  const data = aggregate(sessions, periodBounds(period), options)
  if (unit === 'hour') {
    const [y, m, d] = parts(period.from)
    const nowDate = new Date(now)
    return data.hours.map((ms, hour) => {
      const start = new Date(y, m - 1, d, hour).getTime()
      return {
        key: String(hour),
        label: `${hour}h`,
        title: `${String(hour).padStart(2, '0')}:00 – ${String(hour + 1).padStart(2, '0')}:00`,
        ms,
        future: start > now,
        current: period.from === today && nowDate.getHours() === hour,
      }
    })
  }
  if (unit === 'day') {
    const points: EvolutionPoint[] = []
    for (let day = period.from, i = 0; day <= period.to && i < 400; day = addDays(day, 1), i++) {
      const [, m, d] = parts(day)
      const weekday = weekdayOf(day)
      points.push({
        key: day,
        label: period.kind === 'week' || periodDays(period) <= 7 ? WEEKDAYS_SHORT[weekday]! : String(d),
        title: `${WEEKDAYS_SHORT[weekday]}, ${d} de ${MONTHS_SHORT[m - 1]}.`,
        ms: data.days.get(day) ?? 0,
        future: day > today,
        current: day === today,
      })
    }
    return points
  }
  // Meses
  const months = new Map<string, number>()
  for (const [day, ms] of data.days) months.set(day.slice(0, 7), (months.get(day.slice(0, 7)) ?? 0) + ms)
  const points: EvolutionPoint[] = []
  for (let first = `${period.from.slice(0, 7)}-01`, i = 0; first <= period.to && i < 240; first = addMonths(first, 1), i++) {
    const [y, m] = parts(first)
    const key = first.slice(0, 7)
    points.push({
      key,
      label: MONTHS_SHORT[m - 1]!,
      title: `${MONTHS[m - 1]} de ${y}`,
      ms: months.get(key) ?? 0,
      future: first > today,
      current: key === today.slice(0, 7),
    })
  }
  return points
}

// ── Quando você mais registra tempo ──────────────────────────────────────────

export const PARTS_OF_DAY = [
  { id: 'dawn', label: 'Madrugada', from: 0, to: 6 },
  { id: 'morning', label: 'Manhã', from: 6, to: 12 },
  { id: 'afternoon', label: 'Tarde', from: 12, to: 18 },
  { id: 'night', label: 'Noite', from: 18, to: 24 },
] as const

/** Tempo por parte do dia (madrugada, manhã, tarde, noite). */
export function partsOfDay(hours: readonly number[]): { id: string; label: string; ms: number }[] {
  return PARTS_OF_DAY.map((part) => ({ id: part.id, label: part.label, ms: hours.slice(part.from, part.to).reduce((a, b) => a + b, 0) }))
}

/** O dia (do calendário) com mais tempo no período; null se não houve tempo. */
export function busiestDay(days: ReadonlyMap<ISODate, number>): { day: ISODate; ms: number } | null {
  let best: { day: ISODate; ms: number } | null = null
  for (const [day, ms] of days) if (ms > 0 && (!best || ms > best.ms)) best = { day, ms }
  return best
}

/** Os dias da semana na ordem escolhida (a semana começa no domingo ou na segunda). */
export function weekdayOrder(weekStart: WeekStart): number[] {
  return Array.from({ length: 7 }, (_, i) => (i + weekStart) % 7)
}

export const weekdayName = (day: number, short = false) => (short ? WEEKDAYS_SHORT[day]! : WEEKDAYS[day]!)

// ── Comparação entre períodos ────────────────────────────────────────────────

export interface ComparisonRanges {
  current: [number, number]
  previous: [number, number]
  previousPeriod: Period
  /** O período atual ainda não acabou: o anterior entra só até o mesmo ponto. */
  partial: boolean
}

/**
 * O período e o anterior equivalente. Com o período em andamento, os dois vão só até
 * o mesmo ponto (de segunda até agora × de segunda até a mesma hora da semana passada);
 * um mês mais curto que o outro fica inteiro, sem passar para o mês seguinte.
 */
export function comparisonRanges(period: Period, now: number, weekStart: WeekStart = 1): ComparisonRanges {
  const [start, end] = periodBounds(period)
  const previousPeriod = shiftPeriod(period, -1, weekStart)
  const [prevStart, prevEnd] = periodBounds(previousPeriod)
  if (now >= end) return { current: [start, end], previous: [prevStart, prevEnd], previousPeriod, partial: false }
  // Em andamento (ou no futuro): o mesmo pedaço dos dois
  const offset = Math.max(0, now - start)
  return {
    current: [start, start + offset],
    previous: [prevStart, Math.min(prevEnd, prevStart + offset)],
    previousPeriod,
    partial: true,
  }
}

export interface Delta {
  key: string
  label: string
  categoryId: string | null
  current: number
  previous: number
  diff: number
  /** Variação (0,25 = +25%); null quando não dá para calcular (antes era zero). */
  pct: number | null
}

/** Variação percentual: null quando o anterior é zero (não existe "+∞%"). */
export function variation(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return (current - previous) / previous
}

export interface Comparison {
  current: Aggregate
  previous: Aggregate
  diff: number
  pct: number | null
  categories: Delta[]
  activities: Delta[]
}

/** Compara dois trechos de tempo: totais, diferença, variação e o que subiu ou caiu. */
export function compare(
  sessions: readonly TimerSession[],
  ranges: Pick<ComparisonRanges, 'current' | 'previous'>,
  options: { category?: CategoryFilter; knownCategories?: ReadonlySet<string>; categoryName?: (id: string | null) => string } = {},
): Comparison {
  const current = aggregate(sessions, ranges.current, options)
  const previous = aggregate(sessions, ranges.previous, options)
  const name = options.categoryName ?? ((id: string | null) => id ?? 'Sem categoria')

  const categoryKeys = new Map<string, string | null>()
  for (const item of [...current.categories, ...previous.categories]) categoryKeys.set(item.categoryId ?? '', item.categoryId)
  const categories = [...categoryKeys.values()].map((categoryId) => {
    const a = current.categories.find((item) => item.categoryId === categoryId)?.ms ?? 0
    const b = previous.categories.find((item) => item.categoryId === categoryId)?.ms ?? 0
    return { key: categoryId ?? '', label: name(categoryId), categoryId, current: a, previous: b, diff: a - b, pct: variation(a, b) }
  })

  const activityKeys = new Map<string, ActivityTotal>()
  for (const item of [...previous.activities, ...current.activities]) activityKeys.set(item.key, item)
  const activities = [...activityKeys.values()].map((item) => {
    const a = current.activities.find((other) => other.key === item.key)?.ms ?? 0
    const b = previous.activities.find((other) => other.key === item.key)?.ms ?? 0
    return { key: item.key, label: item.activity, categoryId: item.categoryId, current: a, previous: b, diff: a - b, pct: variation(a, b) }
  })

  const byChange = (list: Delta[]) => list.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.current - a.current)
  return {
    current,
    previous,
    diff: current.total - previous.total,
    pct: variation(current.total, previous.total),
    categories: byChange(categories),
    activities: byChange(activities),
  }
}

// ── Histórico ────────────────────────────────────────────────────────────────

/** A sessão aparece no período? (começou, terminou ou passou por ele) */
export function sessionInRange(session: TimerSession, range: readonly [number, number]): boolean {
  return session.start < range[1] && session.end >= range[0]
}

/** Dia (local) em que a sessão começou. */
export const sessionDay = (session: TimerSession) => toISODate(new Date(session.start))
