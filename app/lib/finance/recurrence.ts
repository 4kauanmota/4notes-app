/**
 * Recorrências das Finanças (1.7.1): contas e assinaturas (gastos) e salário (entradas)
 * que se repetem. Regras puras (sem Vue, sem disco).
 *
 * A recorrência é a CONFIGURAÇÃO (valor, frequência, primeira data, fim); cada vez que
 * ela acontece é uma OCORRÊNCIA, que vira um lançamento de verdade (com id, data e
 * situação próprios) no dia dela: pendente até você confirmar o pagamento (ou o
 * recebimento). As ocorrências futuras são só calculadas, para mostrar as próximas.
 *
 * - Cada ocorrência é identificada pela recorrência + a data prevista dela
 *   (`occurrence`): ao abrir o app de novo (ou em outro aparelho) a mesma ocorrência
 *   nunca é criada duas vezes, e o id do lançamento é sempre o mesmo.
 * - As datas vêm sempre da primeira (âncora), como nas tarefas: todo dia 31 cai no
 *   último dia dos meses mais curtos (28 ou 29/02, 30/04) e volta para 31 depois;
 *   29/02 anual cai em 28/02 nos anos que não são bissextos.
 * - Mudar o valor ou a frequência "a partir da próxima" cria uma nova versão da regra,
 *   que vale da próxima ocorrência em diante; as anteriores (e o histórico) não mudam.
 */
import { addDays, addMonths, isISODate, type ISODate } from '../dates'
import { nextOccurrenceAfter, occurrenceAt, type RecurrenceUnit } from '../tasks/recurrence'

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

export const FREQUENCIES: { value: Frequency; label: string; every: string }[] = [
  { value: 'daily', label: 'Diária', every: 'Todo dia' },
  { value: 'weekly', label: 'Semanal', every: 'Toda semana' },
  { value: 'monthly', label: 'Mensal', every: 'Todo mês' },
  { value: 'yearly', label: 'Anual', every: 'Todo ano' },
]

export const isFrequency = (value: unknown): value is Frequency => FREQUENCIES.some((item) => item.value === value)
export const frequencyLabel = (frequency: Frequency) => FREQUENCIES.find((item) => item.value === frequency)!.every

const UNITS: Record<Frequency, RecurrenceUnit> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }

/** Uma versão da regra: vale para as ocorrências a partir de `from` (até a próxima versão). */
export interface RecurrenceVersion {
  from: ISODate
  /** Centavos (inteiro, maior que zero). */
  amount: number
  frequency: Frequency
  /** Data de onde as ocorrências desta versão são contadas (a primeira delas). */
  anchor: ISODate
}

export interface Recurrence {
  id: string
  kind: 'expense' | 'income'
  description: string
  categoryId: string | null
  notes: string
  /** "Me lembre de pagar" (gastos). */
  remind: boolean
  /** Ordenadas por `from`; a primeira começa na primeira ocorrência. */
  versions: RecurrenceVersion[]
  /** Última data possível (inclusive); null = até você encerrar. */
  endDate: ISODate | null
  /** Encerrada por você (quando); as ocorrências que já existiam ficam no histórico. */
  stoppedAt: string | null
  /** As ocorrências até este dia já viraram lançamentos (as seguintes ainda são previsões). */
  generatedUntil: ISODate | null
  createdAt: string
  updatedAt: string
}

/** Uma ocorrência calculada pela regra. */
export interface Occurrence {
  /** Data prevista (a chave da ocorrência). */
  occurrence: ISODate
  amount: number
}

const rule = (version: RecurrenceVersion) => ({ anchor: version.anchor, interval: 1, unit: UNITS[version.frequency] })
const min = (a: ISODate, b: ISODate) => (a < b ? a : b)
const max = (a: ISODate, b: ISODate) => (a > b ? a : b)

/** A data da ocorrência seguinte a `date` na frequência (31/01 + 1 mês = 28 ou 29/02). */
export function stepFrom(date: ISODate, frequency: Frequency): ISODate {
  return occurrenceAt({ anchor: date, interval: 1, unit: UNITS[frequency] }, 1)
}

/** Primeira data da recorrência. */
export const firstDate = (recurrence: Recurrence): ISODate | null => recurrence.versions[0]?.anchor ?? null

/** A versão da regra que vale numa data (null antes da primeira). */
export function versionAt(recurrence: Recurrence, date: ISODate): RecurrenceVersion | null {
  let found: RecurrenceVersion | null = null
  for (const version of recurrence.versions) if (version.from <= date) found = version
  return found
}

/** A versão em vigor hoje (ou a primeira, se ainda não começou). */
export const currentVersion = (recurrence: Recurrence, today: ISODate): RecurrenceVersion => versionAt(recurrence, today) ?? recurrence.versions[0]!

/** As ocorrências previstas entre `from` e `to` (inclusive), na ordem. */
export function occurrencesBetween(recurrence: Recurrence, from: ISODate, to: ISODate, cap = 1000): Occurrence[] {
  const result: Occurrence[] = []
  const last = recurrence.endDate ? min(recurrence.endDate, to) : to
  recurrence.versions.forEach((version, index) => {
    const next = recurrence.versions[index + 1]
    const start = max(max(from, version.from), version.anchor)
    const end = next ? min(last, addDays(next.from, -1)) : last
    if (start > end) return
    const series = rule(version)
    for (let date = nextOccurrenceAfter(series, addDays(start, -1)); date <= end && result.length < cap; date = nextOccurrenceAfter(series, date)) {
      result.push({ occurrence: date, amount: version.amount })
    }
  })
  return result
}

/** A primeira ocorrência prevista a partir de `date` (inclusive); null se a recorrência já terminou. */
export function occurrenceFrom(recurrence: Recurrence, date: ISODate): Occurrence | null {
  return occurrencesBetween(recurrence, date, addMonths(date, 25), 1)[0] ?? null
}

/** A ocorrência prevista logo antes de `date` (null se não houve). */
export function occurrenceBefore(recurrence: Recurrence, date: ISODate): Occurrence | null {
  const start = firstDate(recurrence)
  if (!start || start >= date) return null
  // Procura numa janela que cresce (sem percorrer anos de ocorrências diárias)
  for (const months of [1, 13, 1200]) {
    const from = max(start, addMonths(date, -months))
    const list = occurrencesBetween(recurrence, from, addDays(date, -1), 100_000)
    if (list.length) return list.at(-1)!
    if (from === start) return null
  }
  return null
}

/** Id do lançamento de uma ocorrência: sempre o mesmo (r_abc + 05/11/2026 → "r_abc_20261105"). */
export const occurrenceId = (recurrenceId: string, occurrence: ISODate) => `${recurrenceId}_${occurrence.replace(/-/g, '')}`

/** Chave de uma ocorrência (para não criar duas vezes). */
export const occurrenceKey = (recurrenceId: string, occurrence: ISODate) => `${recurrenceId}|${occurrence}`

/**
 * O que precisa virar lançamento: as ocorrências ainda não geradas até `today`
 * (inclusive) que não existem em `existing` (chaves recorrência|data). `until` = o novo
 * generatedUntil.
 */
export function pendingGeneration(recurrence: Recurrence, today: ISODate, existing: ReadonlySet<string>, cap = 1000): { due: Occurrence[]; until: ISODate | null } {
  const start = firstDate(recurrence)
  if (!start) return { due: [], until: recurrence.generatedUntil }
  const from = recurrence.generatedUntil ? max(addDays(recurrence.generatedUntil, 1), start) : start
  let to = today
  if (recurrence.endDate && recurrence.endDate < to) to = recurrence.endDate
  if (from > to) return { due: [], until: recurrence.generatedUntil }
  const all = occurrencesBetween(recurrence, from, to, 100_000)
  // Muitas de uma vez (uma diária começando há anos): ficam as mais recentes
  const due = all.filter((item) => !existing.has(occurrenceKey(recurrence.id, item.occurrence))).slice(-cap)
  return { due, until: recurrence.generatedUntil && recurrence.generatedUntil > to ? recurrence.generatedUntil : to }
}

/**
 * Nova versão da regra a partir da ocorrência `next` (data prevista dela): o valor, a
 * frequência ou a data mudam dali em diante. Mudando só o valor, as datas continuam
 * contadas da âncora de antes (todo dia 31 continua 31).
 */
export function withFutureChange(
  recurrence: Recurrence,
  next: ISODate,
  change: { amount?: number; frequency?: Frequency; date?: ISODate },
): RecurrenceVersion[] {
  const current = versionAt(recurrence, next) ?? recurrence.versions[0]!
  const frequency = change.frequency ?? current.frequency
  const date = change.date ?? next
  const rescheduled = frequency !== current.frequency || date !== next
  const from = min(next, date)
  const version: RecurrenceVersion = { from, amount: change.amount ?? current.amount, frequency, anchor: rescheduled ? date : current.anchor }
  const kept = recurrence.versions.filter((item) => item.from < from)
  return [...kept, version]
}

/** Lê uma versão (arquivo editado à mão: o que não for válido fica de fora). */
export function normalizeVersion(raw: unknown, maxAmount: number): RecurrenceVersion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  const amount = typeof data.amount === 'number' ? Math.round(data.amount) : NaN
  if (!Number.isFinite(amount) || amount <= 0 || amount > maxAmount) return null
  if (!isISODate(data.anchor)) return null
  const from = isISODate(data.from) ? data.from : data.anchor
  return { from, amount, frequency: isFrequency(data.frequency) ? data.frequency : 'monthly', anchor: data.anchor }
}

/** "Todo mês, dia 5", "Toda semana (quarta)", "Todo ano, 29/02"… */
export function describeSchedule(version: Pick<RecurrenceVersion, 'frequency' | 'anchor'>): string {
  const [, m, d] = version.anchor.split('-').map(Number) as [number, number, number]
  switch (version.frequency) {
    case 'daily':
      return 'Todo dia'
    case 'weekly': {
      const weekday = new Date(`${version.anchor}T12:00:00`).getDay()
      return `Toda semana (${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][weekday]})`
    }
    case 'monthly':
      return d >= 29 ? `Todo mês, dia ${d} (ou o último dia)` : `Todo mês, dia ${d}`
    case 'yearly':
      return `Todo ano, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
  }
}
