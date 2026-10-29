/**
 * Conexão com bancos (1.7.2): o que fica no workspace e como as transações viram
 * lançamentos. Regras puras (sem Vue, sem rede); a API é a do Meu Pluggy (shared/pluggy.ts)
 * e quem busca e grava é o stores/bank.ts.
 *
 * No workspace (.4notes/settings.json, "finance" › "bank"), sem nenhuma credencial:
 *   { "autoSync": true,
 *     "connections": [{ "itemId": "…", "name": "Nubank", "from": "2026-10-01",
 *                       "accounts": [{ "id": "…", "name": "Conta", "type": "BANK", "number": "1234",
 *                                      "enabled": true, "syncedUntil": "2026-10-28" }] }] }
 *
 * Importar (planBankImport):
 * - cada transação vira um lançamento com o id dela ("pluggy:<id>" em externalId): uma
 *   transação que já entrou nunca entra de novo;
 * - DEBIT = gasto, CREDIT = entrada; o valor vai em centavos, sem sinal;
 * - transações ainda pendentes no banco (PENDING) ficam para a próxima busca (podem mudar);
 * - o pagamento da fatura do cartão na conta corrente fica de fora quando o cartão também
 *   está conectado (as compras do cartão já entram uma a uma: seria gasto em dobro);
 * - um lançamento seu parecido (mesmo valor, até 3 dias de diferença): uma conta pendente é
 *   confirmada como paga; um lançamento já pago (registrado à mão ou de um extrato) é ligado
 *   à transação, sem duplicar.
 */
import { addDays, isISODate, type ISODate } from '../dates'
import type { BankAccount, BankTransaction } from '#shared/pluggy'
import type { EntryKind, Expense } from './model'
import { duplicateFinder } from './statement'

export interface BankAccountSetting {
  id: string
  name: string
  /** BANK ou CREDIT (cartão). */
  type: string
  number: string
  enabled: boolean
  /** Até que dia já foi buscado (a próxima busca volta alguns dias, para pegar o que o banco lançou atrasado). */
  syncedUntil: ISODate | null
}

export interface BankConnection {
  itemId: string
  name: string
  /** Buscar a partir deste dia (na primeira vez). */
  from: ISODate
  accounts: BankAccountSetting[]
}

export interface BankSettings {
  /** Buscar sozinho ao abrir o app (uma vez por dia). */
  autoSync: boolean
  connections: BankConnection[]
  /** Última busca (ISO), para "buscado há…" e para a busca automática uma vez por dia. */
  lastSync: string | null
}

export const DEFAULT_BANK_SETTINGS: Readonly<BankSettings> = { autoSync: true, connections: [], lastSync: null }

/** Volta alguns dias em cada busca (o banco às vezes lança com data de dias antes). */
export const OVERLAP_DAYS = 7
/** Primeira busca: quanto tempo para trás, por padrão. */
export const DEFAULT_HISTORY_DAYS = 30

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown) => (typeof value === 'string' ? value : '')

export function normalizeBankSettings(raw: unknown): BankSettings {
  const data = isObject(raw) ? raw : {}
  const connections: BankConnection[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(data.connections) ? data.connections : []) {
    if (!isObject(item)) continue
    const itemId = str(item.itemId).trim()
    if (!itemId || seen.has(itemId)) continue
    seen.add(itemId)
    const accounts: BankAccountSetting[] = []
    for (const account of Array.isArray(item.accounts) ? item.accounts : []) {
      if (!isObject(account) || !str(account.id)) continue
      accounts.push({
        id: str(account.id),
        name: str(account.name) || 'Conta',
        type: str(account.type) || 'BANK',
        number: str(account.number),
        enabled: account.enabled !== false,
        syncedUntil: isISODate(account.syncedUntil) ? (account.syncedUntil as ISODate) : null,
      })
    }
    connections.push({ itemId, name: str(item.name) || 'Banco', from: isISODate(item.from) ? (item.from as ISODate) : '2000-01-01', accounts })
  }
  return { autoSync: data.autoSync !== false, connections, lastSync: str(data.lastSync) || null }
}

/** As contas de um banco recém-adicionado (todas marcadas). */
export function accountSettings(accounts: readonly BankAccount[], previous: readonly BankAccountSetting[] = []): BankAccountSetting[] {
  return accounts.map((account) => {
    const old = previous.find((item) => item.id === account.id)
    return { id: account.id, name: account.name, type: account.type, number: account.number, enabled: old?.enabled ?? true, syncedUntil: old?.syncedUntil ?? null }
  })
}

/** De que dia buscar as transações de uma conta. */
export function fetchFrom(connection: BankConnection, account: BankAccountSetting): ISODate {
  if (!account.syncedUntil) return connection.from
  const back = addDays(account.syncedUntil, -OVERLAP_DAYS)
  return back < connection.from ? connection.from : back
}

export const BANK_ID_PREFIX = 'pluggy:'
export const bankExternalId = (transaction: Pick<BankTransaction, 'id'>) => `${BANK_ID_PREFIX}${transaction.id}`

/** Pagamento da fatura do cartão (na conta corrente). */
export function isCardBillPayment(transaction: Pick<BankTransaction, 'description' | 'category'>): boolean {
  if (/credit card payment/i.test(transaction.category ?? '')) return true
  const text = transaction.description
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  return /\b(pagamento|pagto|pgto|pag)\b.*\bfatura\b/.test(text) || /\bfatura\b.*\bcart(ao|oes)\b/.test(text) || /\bpag(amento)?\s+(de\s+)?cartao\b/.test(text)
}

export interface PlannedRow {
  kind: EntryKind
  date: ISODate
  description: string
  /** Centavos. */
  amount: number
  externalId: string
  /** Confirmar esta conta pendente em vez de criar outro lançamento. */
  confirms: string | null
  /** Pistas para a categoria automática (estabelecimento, categoria do banco). */
  hints: string[]
  accountId: string
}

export interface BankPlan {
  rows: PlannedRow[]
  /** Lançamentos seus que são esta transação: ganham o id dela (não entram de novo). */
  links: { entryId: string; externalId: string }[]
  skipped: { known: number; pending: number; billPayments: number; invalid: number }
}

/**
 * O que fazer com as transações buscadas. `cardItems` = os bancos com um cartão de crédito
 * conectado (o pagamento da fatura na conta corrente deles fica de fora).
 */
export function planBankImport(
  transactions: readonly BankTransaction[],
  accounts: ReadonlyMap<string, { type: string; itemId: string }>,
  existing: readonly Expense[],
  cardItems: ReadonlySet<string>,
): BankPlan {
  const plan: BankPlan = { rows: [], links: [], skipped: { known: 0, pending: 0, billPayments: 0, invalid: 0 } }
  const known = new Set(existing.map((entry) => entry.externalId).filter(Boolean))
  const findDuplicate = duplicateFinder(existing)
  const seen = new Set<string>()
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  for (const transaction of sorted) {
    const externalId = bankExternalId(transaction)
    if (seen.has(externalId) || known.has(externalId)) {
      plan.skipped.known++
      continue
    }
    seen.add(externalId)
    if (transaction.status === 'PENDING') {
      plan.skipped.pending++
      continue
    }
    const amount = Math.round(Math.abs(transaction.amount) * 100)
    if (!isISODate(transaction.date) || !amount) {
      plan.skipped.invalid++
      continue
    }
    const account = accounts.get(transaction.accountId)
    if (account && account.type !== 'CREDIT' && cardItems.has(account.itemId) && isCardBillPayment(transaction)) {
      plan.skipped.billPayments++
      continue
    }
    // No cartão, o pagamento da fatura (entrando no cartão) também não é uma entrada
    if (account?.type === 'CREDIT' && transaction.type === 'CREDIT' && isCardBillPayment(transaction)) {
      plan.skipped.billPayments++
      continue
    }
    const kind: EntryKind = transaction.type === 'CREDIT' ? 'income' : 'expense'
    const description = (transaction.description || transaction.merchant || (kind === 'income' ? 'Entrada' : 'Gasto')).slice(0, 120)
    const match = findDuplicate({ date: transaction.date, amount, kind, externalId, description })
    if (match && !match.certain) {
      const entry = match.entry
      if (entry.status === 'pending') {
        plan.rows.push({ kind, date: transaction.date, description, amount, externalId, confirms: entry.id, hints: [], accountId: transaction.accountId })
        continue
      }
      // Já pago e sem id de banco (à mão ou de um extrato): é a mesma transação
      if (!entry.externalId?.startsWith(BANK_ID_PREFIX)) {
        plan.links.push({ entryId: entry.id, externalId })
        plan.skipped.known++
        continue
      }
    }
    plan.rows.push({
      kind,
      date: transaction.date,
      description,
      amount,
      externalId,
      confirms: null,
      hints: [transaction.merchant, transaction.category].filter((hint): hint is string => !!hint),
      accountId: transaction.accountId,
    })
  }
  return plan
}
