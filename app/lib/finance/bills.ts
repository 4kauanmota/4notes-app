/**
 * Contas e saldo das Finanças (1.7.1): regras puras (sem Vue), sempre a partir dos
 * lançamentos registrados e das recorrências (nada de valores de exemplo).
 *
 * Dois saldos, separados de propósito:
 * - REALIZADO: o saldo inicial (se você informou) + as entradas recebidas − os gastos
 *   pagos, cada um no dia em que o dinheiro entrou ou saiu, até hoje. Sem saldo inicial,
 *   é só uma estimativa com o que foi registrado (nunca o saldo do banco).
 * - PROJETADO: o realizado − o que ainda vai sair (pendentes, vencidos e as próximas
 *   ocorrências das recorrências, até a data escolhida) + o que ainda vai entrar.
 * Uma conta pendente nunca é descontada do realizado: só depois de confirmada.
 */
import { addDays, type ISODate } from '../dates'
import { cashDate, type EntryKind, type Expense, type OpeningBalance } from './model'
import { occurrenceId, occurrenceKey, occurrencesBetween, type Recurrence } from './recurrence'

/** Uma conta (ou entrada) que ainda vai acontecer: já lançada (pendente) ou só prevista pela recorrência. */
export interface UpcomingItem {
  /** Id do lançamento (o que ela terá, se ainda é só prevista). */
  id: string
  kind: EntryKind
  description: string
  amount: number
  date: ISODate
  categoryId: string | null
  recurrenceId: string | null
  occurrence: ISODate | null
  /** Já existe como lançamento (pendente); false = só prevista pela recorrência. */
  stored: boolean
  remind: boolean
}

/** Chaves (recorrência|data) das ocorrências que já viraram lançamento. */
export function occurrenceKeys(entries: readonly Expense[]): Set<string> {
  const keys = new Set<string>()
  for (const entry of entries) if (entry.recurrenceId && entry.occurrence) keys.add(occurrenceKey(entry.recurrenceId, entry.occurrence))
  return keys
}

/** As ocorrências previstas (ainda não lançadas) das recorrências entre `from` e `to`. */
export function forecast(recurrences: readonly Recurrence[], entries: readonly Expense[], from: ISODate, to: ISODate, keys = occurrenceKeys(entries)): UpcomingItem[] {
  const items: UpcomingItem[] = []
  if (from > to) return items
  for (const recurrence of recurrences) {
    for (const item of occurrencesBetween(recurrence, from, to, 400)) {
      if (keys.has(occurrenceKey(recurrence.id, item.occurrence))) continue
      items.push({
        id: occurrenceId(recurrence.id, item.occurrence),
        kind: recurrence.kind,
        description: recurrence.description,
        amount: item.amount,
        date: item.occurrence,
        categoryId: recurrence.categoryId,
        recurrenceId: recurrence.id,
        occurrence: item.occurrence,
        stored: false,
        remind: recurrence.remind,
      })
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
}

/** O lançamento pendente no formato da lista de próximas. */
export const pendingItem = (entry: Expense): UpcomingItem => ({
  id: entry.id,
  kind: entry.kind,
  description: entry.description,
  amount: entry.amount,
  date: entry.date,
  categoryId: entry.categoryId,
  recurrenceId: entry.recurrenceId,
  occurrence: entry.occurrence,
  stored: true,
  remind: entry.remind,
})

/**
 * O que ainda vai acontecer até `to`: os pendentes já lançados (os vencidos também) e as
 * ocorrências previstas a partir de amanhã (as de até hoje já foram lançadas).
 */
export function upcoming(entries: readonly Expense[], recurrences: readonly Recurrence[], to: ISODate): UpcomingItem[] {
  const stored = entries.filter((entry) => entry.status === 'pending' && entry.date <= to).map(pendingItem)
  const keys = occurrenceKeys(entries)
  // As ocorrências que ainda não viraram lançamento (de uma recorrência que ainda não foi
  // processada hoje, as que já passaram também: elas vão ficar pendentes)
  const virtual = recurrences.flatMap((recurrence) => {
    const start = recurrence.versions[0]?.anchor
    if (!start) return []
    const from = recurrence.generatedUntil ? addDays(recurrence.generatedUntil, 1) : start
    return forecast([recurrence], entries, from, to, keys)
  })
  return [...stored, ...virtual].sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
}

// ── Saldo ────────────────────────────────────────────────────────────────────

export interface BalanceSummary {
  /** Sem saldo inicial: os saldos são só uma estimativa com o que foi registrado. */
  estimated: boolean
  /** Dia do saldo inicial (os lançamentos depois dele entram na conta). */
  since: ISODate | null
  /** Saldo realizado hoje. */
  realized: number
  /** Gastos pendentes que ainda não venceram (até `until`, incluindo os previstos pelas recorrências). */
  pending: number
  pendingCount: number
  /** Gastos pendentes com a data já passada. */
  overdue: number
  overdueCount: number
  /** Tudo o que ainda vai sair até `until` (vencidos + pendentes + previstos). */
  committed: number
  /** Tudo o que ainda vai entrar até `until` (a receber, atrasadas e previstas). */
  expected: number
  /** Saldo realizado − o que vai sair + o que vai entrar, até `until`. */
  projected: number
  until: ISODate
}

export function balanceSummary(
  entries: readonly Expense[],
  recurrences: readonly Recurrence[],
  opening: OpeningBalance | null,
  today: ISODate,
  until: ISODate,
): BalanceSummary {
  let realized = opening?.amount ?? 0
  let futureDone = 0
  for (const entry of entries) {
    if (entry.status !== 'done') continue
    const day = cashDate(entry)
    if (opening && day <= opening.date) continue
    const signed = entry.kind === 'income' ? entry.amount : -entry.amount
    if (day <= today) realized += signed
    // Lançado como feito, mas com data no futuro: entra só na projeção
    else if (day <= until) futureDone += signed
  }
  let pending = 0
  let pendingCount = 0
  let overdue = 0
  let overdueCount = 0
  let expected = 0
  for (const item of upcoming(entries, recurrences, until)) {
    if (item.kind === 'income') {
      expected += item.amount
    } else if (item.date < today) {
      overdue += item.amount
      overdueCount++
    } else {
      pending += item.amount
      pendingCount++
    }
  }
  const committed = pending + overdue
  return {
    estimated: !opening,
    since: opening?.date ?? null,
    realized,
    pending,
    pendingCount,
    overdue,
    overdueCount,
    committed,
    expected,
    projected: realized + futureDone - committed + expected,
    until,
  }
}

/** Entradas recebidas e gastos pagos no período (no dia em que o dinheiro entrou ou saiu). */
export function cashFlow(entries: readonly Expense[], from: ISODate, to: ISODate): { received: number; paid: number; receivedCount: number; paidCount: number } {
  const result = { received: 0, paid: 0, receivedCount: 0, paidCount: 0 }
  for (const entry of entries) {
    if (entry.status !== 'done') continue
    const day = cashDate(entry)
    if (day < from || day > to) continue
    if (entry.kind === 'income') {
      result.received += entry.amount
      result.receivedCount++
    } else {
      result.paid += entry.amount
      result.paidCount++
    }
  }
  return result
}

// ── Lembretes ────────────────────────────────────────────────────────────────

/** Contas com "Me lembre de pagar" que vencem hoje ou já venceram (pendentes). */
export function dueReminders(entries: readonly Expense[], today: ISODate): Expense[] {
  return entries
    .filter((entry) => entry.kind === 'expense' && entry.status === 'pending' && entry.remind && entry.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date))
}
