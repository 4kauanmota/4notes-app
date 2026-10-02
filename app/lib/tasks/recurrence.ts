/**
 * Lógica de recorrência das tarefas (funções puras, fáceis de testar).
 *
 * Uma regra de recorrência descreve uma SÉRIE de datas a partir de uma âncora:
 *   âncora 05/10, a cada 7 dias  →  05/10, 12/10, 19/10, 26/10…
 *
 * A tarefa guarda apenas a data da próxima ocorrência (`task.date`). Por isso o
 * retorno funciona mesmo com o app fechado: ao abrir, o app compara essa data
 * com "hoje" — não existe nenhum processo rodando em segundo plano.
 */
import { addDays, addMonths, diffDays, diffMonths, type ISODate } from '../dates'

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year'

/**
 * - schedule:   segue o calendário (toda segunda continua sendo segunda), pulando
 *               ocorrências perdidas enquanto você não concluiu.
 * - completion: conta a partir do dia em que você concluiu ("7 dias depois de regar").
 */
export type RecurrenceBasis = 'schedule' | 'completion'

export interface Recurrence {
  interval: number
  unit: RecurrenceUnit
  /** Primeira data da série (definida quando você escolhe a data da tarefa). */
  anchor: ISODate
  basis: RecurrenceBasis
}

/** Regra sem a âncora (a âncora vem da data da tarefa). */
export type RecurrenceDraft = Omit<Recurrence, 'anchor'>

export const RECURRENCE_UNITS: { value: RecurrenceUnit; singular: string; plural: string }[] = [
  { value: 'day', singular: 'dia', plural: 'dias' },
  { value: 'week', singular: 'semana', plural: 'semanas' },
  { value: 'month', singular: 'mês', plural: 'meses' },
  { value: 'year', singular: 'ano', plural: 'anos' },
]

export interface RecurrencePreset {
  id: string
  label: string
  interval: number
  unit: RecurrenceUnit
}

export const RECURRENCE_PRESETS: RecurrencePreset[] = [
  { id: 'daily', label: 'Todos os dias', interval: 1, unit: 'day' },
  { id: 'weekly', label: 'Toda semana', interval: 1, unit: 'week' },
  { id: 'biweekly', label: 'A cada 2 semanas', interval: 2, unit: 'week' },
  { id: 'monthly', label: 'Todo mês', interval: 1, unit: 'month' },
  { id: 'yearly', label: 'Todo ano', interval: 1, unit: 'year' },
]

export const MAX_INTERVAL = 999

export function clampInterval(value: unknown): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(MAX_INTERVAL, Math.max(1, n)) : 1
}

/** k-ésima ocorrência da série (k = 0 é a própria âncora). */
export function occurrenceAt(rule: Pick<Recurrence, 'anchor' | 'interval' | 'unit'>, k: number): ISODate {
  const steps = k * rule.interval
  switch (rule.unit) {
    case 'day':
      return addDays(rule.anchor, steps)
    case 'week':
      return addDays(rule.anchor, steps * 7)
    case 'month':
      return addMonths(rule.anchor, steps)
    case 'year':
      return addMonths(rule.anchor, steps * 12)
  }
}

/** Primeira ocorrência ESTRITAMENTE depois de `after`. */
export function nextOccurrenceAfter(rule: Pick<Recurrence, 'anchor' | 'interval' | 'unit'>, after: ISODate): ISODate {
  if (rule.anchor > after) return rule.anchor
  if (rule.unit === 'day' || rule.unit === 'week') {
    const step = rule.interval * (rule.unit === 'week' ? 7 : 1)
    const k = Math.floor(diffDays(rule.anchor, after) / step) + 1
    return occurrenceAt(rule, k)
  }
  const stepMonths = rule.interval * (rule.unit === 'year' ? 12 : 1)
  let k = Math.max(0, Math.floor(diffMonths(rule.anchor, after) / stepMonths) - 1)
  let candidate = occurrenceAt(rule, k)
  while (candidate <= after) candidate = occurrenceAt(rule, ++k)
  return candidate
}

/**
 * Data em que a tarefa deve voltar depois de concluída.
 *
 * @param currentDue  data da ocorrência que foi concluída
 * @param completedOn dia em que você concluiu (hoje)
 */
export function nextDueAfterCompletion(rule: Recurrence, currentDue: ISODate | null, completedOn: ISODate): ISODate {
  if (rule.basis === 'completion') {
    return occurrenceAt({ ...rule, anchor: completedOn }, 1)
  }
  // Concluiu adiantado? A próxima vem depois da data programada.
  // Concluiu atrasado? Pula as ocorrências que já passaram.
  const reference = currentDue && currentDue > completedOn ? currentDue : completedOn
  return nextOccurrenceAfter(rule, reference)
}

/** `from` seguida das próximas datas da série (total de `count` datas). */
export function upcomingOccurrences(rule: Recurrence, from: ISODate, count: number): ISODate[] {
  const result: ISODate[] = [from]
  while (result.length < count) result.push(nextOccurrenceAfter(rule, result[result.length - 1]!))
  return result
}

/** "Todos os dias", "A cada 2 semanas", "Todo mês após concluir"… */
export function describeRecurrence(rule: Pick<Recurrence, 'interval' | 'unit' | 'basis'>): string {
  const unit = RECURRENCE_UNITS.find((u) => u.value === rule.unit)!
  const base =
    rule.interval === 1
      ? { day: 'Todos os dias', week: 'Toda semana', month: 'Todo mês', year: 'Todo ano' }[rule.unit]
      : `A cada ${rule.interval} ${unit.plural}`
  return rule.basis === 'completion' ? `${base} após concluir` : base
}

export function presetFor(rule: Pick<Recurrence, 'interval' | 'unit'>): RecurrencePreset | null {
  return RECURRENCE_PRESETS.find((p) => p.interval === rule.interval && p.unit === rule.unit) ?? null
}
