/**
 * Conexão com bancos (1.7.2): os bancos conectados pelo Meu Pluggy e a busca das
 * transações, que entram direto nos lançamentos das Finanças (com Desfazer).
 *
 * - As credenciais (Client ID/Secret) ficam só no aparelho (window.fourNotes.bank); este
 *   store só sabe se estão configuradas.
 * - Os bancos e as contas escolhidas ficam no workspace (settings.json › finance › bank),
 *   para valer nos dois aparelhos; a busca usa o id de cada transação, então buscar nos
 *   dois não duplica nada.
 * - "Buscar agora" (Finanças e Configurações) e, ligado por padrão, uma busca automática
 *   por dia ao abrir o app (só com as Finanças ativas e a conexão configurada).
 * - Nada é simulado: sem credenciais, sem banco ou sem internet, a tela diz o que falta.
 */
import { reactive } from 'vue'
import { errorMessage, type BankStatus } from '#shared/ipc'
import type { BankAccount, BankItem, BankTransaction } from '#shared/pluggy'
import { notifyError, showToast } from '~/composables/useToasts'
import { useToday } from '~/composables/useToday'
import { toISODate, type ISODate } from '~/lib/dates'
import { accountSettings, fetchFrom, planBankImport, type BankConnection, type BankSettings } from '~/lib/finance/bank'
import { desktop, hasDesktopApi } from '~/lib/platform'
import { useFinanceStore, type ImportRow } from './finance'
import { useModulesStore } from './modules'

const { today } = useToday()

const state = reactive({
  /** O que este aparelho tem (null = ainda não perguntou). */
  status: null as BankStatus | null,
  /** A plataforma tem a conexão (o navegador comum não tem). */
  available: false,
  /** Buscando agora. */
  syncing: false,
  /** Situação de cada banco na Pluggy (itemId → item), da última consulta. */
  items: {} as Record<string, BankItem>,
  /** Último erro de cada banco (itemId → mensagem). */
  errors: {} as Record<string, string>,
})

function api() {
  return hasDesktopApi() ? (desktop().bank ?? null) : null
}

function settings(): BankSettings {
  return useFinanceStore().state.settings.bank
}

function saveSettings(next: BankSettings): void {
  useFinanceStore().updateSettings({ bank: next })
}

async function refreshStatus(): Promise<BankStatus | null> {
  const bank = api()
  state.available = !!bank
  if (!bank) return (state.status = null)
  try {
    state.status = await bank.status()
  } catch (error) {
    console.warn('[4notes] Conexão com bancos:', error)
    state.status = { configured: false, clientId: null, secure: false }
  }
  return state.status
}

/** Testa e guarda o Client ID/Secret (só neste aparelho). Devolve o erro, ou null. */
async function configure(clientId: string, clientSecret: string): Promise<string | null> {
  const bank = api()
  if (!bank) return 'A conexão com bancos não está disponível aqui.'
  try {
    state.status = await bank.configure({ clientId, clientSecret })
    return null
  } catch (error) {
    return errorMessage(error)
  }
}

async function forget(): Promise<void> {
  const bank = api()
  if (!bank) return
  try {
    state.status = await bank.forget()
  } catch (error) {
    notifyError(`Não foi possível apagar as credenciais: ${errorMessage(error)}`, error)
  }
}

/**
 * Adiciona um banco pelo Item ID (do Meu Pluggy): confere na Pluggy, lê as contas e guarda
 * no workspace. Devolve o erro, ou null.
 */
async function addConnection(itemId: string, from: ISODate): Promise<string | null> {
  const bank = api()
  const id = itemId.trim()
  if (!bank) return 'A conexão com bancos não está disponível aqui.'
  if (!id) return 'Cole o Item ID do banco.'
  if (settings().connections.some((connection) => connection.itemId === id)) return 'Este banco já está conectado.'
  try {
    const item = await bank.item(id)
    const accounts = await bank.accounts(id)
    if (!accounts.length) return `A Pluggy não tem contas para ${item.name}. Confira a conexão no Meu Pluggy.`
    state.items = { ...state.items, [id]: item }
    const connection: BankConnection = { itemId: id, name: item.name, from, accounts: accountSettings(accounts) }
    saveSettings({ ...settings(), connections: [...settings().connections, connection] })
    return null
  } catch (error) {
    return errorMessage(error)
  }
}

function removeConnection(itemId: string): void {
  saveSettings({ ...settings(), connections: settings().connections.filter((connection) => connection.itemId !== itemId) })
  const { [itemId]: _item, ...items } = state.items
  state.items = items
}

function setAccountEnabled(itemId: string, accountId: string, enabled: boolean): void {
  saveSettings({
    ...settings(),
    connections: settings().connections.map((connection) =>
      connection.itemId !== itemId ? connection : { ...connection, accounts: connection.accounts.map((account) => (account.id === accountId ? { ...account, enabled } : account)) },
    ),
  })
}

function setAutoSync(autoSync: boolean): void {
  saveSettings({ ...settings(), autoSync })
}

/** Atualiza a lista de contas e a situação de um banco (contas novas entram marcadas). */
async function refreshConnection(itemId: string): Promise<void> {
  const bank = api()
  const connection = settings().connections.find((item) => item.itemId === itemId)
  if (!bank || !connection) return
  try {
    const [item, accounts] = await Promise.all([bank.item(itemId), bank.accounts(itemId)])
    state.items = { ...state.items, [itemId]: item }
    const { [itemId]: _error, ...errors } = state.errors
    state.errors = errors
    saveSettings({
      ...settings(),
      connections: settings().connections.map((current) => (current.itemId === itemId ? { ...current, name: item.name, accounts: accountSettings(accounts, current.accounts) } : current)),
    })
  } catch (error) {
    state.errors = { ...state.errors, [itemId]: errorMessage(error) }
  }
}

export interface SyncResult {
  added: number
  confirmed: number
  linked: number
  pending: number
  errors: string[]
}

/**
 * Busca as transações das contas marcadas e põe nas Finanças: categoria automática,
 * sem duplicar, com Desfazer no aviso. `manual` = você pediu (avisa também quando não
 * há nada novo).
 */
async function sync(options: { manual?: boolean } = {}): Promise<SyncResult | null> {
  const bank = api()
  const finance = useFinanceStore()
  if (!bank || state.syncing) return null
  if (!state.status) await refreshStatus()
  if (!state.status?.configured) {
    if (options.manual) notifyError('Configure a conexão com a Pluggy em Configurações › Finanças › Conexões bancárias.')
    return null
  }
  const connections = settings().connections.filter((connection) => connection.accounts.some((account) => account.enabled))
  if (!connections.length) {
    if (options.manual) notifyError('Nenhuma conta marcada para buscar. Escolha as contas em Configurações › Finanças › Conexões bancárias.')
    return null
  }
  state.syncing = true
  const result: SyncResult = { added: 0, confirmed: 0, linked: 0, pending: 0, errors: [] }
  try {
    const day = today.value
    const transactions: BankTransaction[] = []
    const accounts = new Map<string, { type: string; itemId: string }>()
    const cardItems = new Set<string>()
    /** Contas buscadas sem erro (o "até quando" delas avança). */
    const done = new Set<string>()
    const names: string[] = []
    const errors: Record<string, string> = {}
    for (const connection of connections) {
      let ok = false
      for (const account of connection.accounts) {
        if (!account.enabled) continue
        accounts.set(account.id, { type: account.type, itemId: connection.itemId })
        if (account.type === 'CREDIT') cardItems.add(connection.itemId)
        try {
          transactions.push(...(await bank.transactions({ accountId: account.id, from: fetchFrom(connection, account), to: day })))
          done.add(account.id)
          ok = true
        } catch (error) {
          result.errors.push(`${connection.name} (${account.name}): ${errorMessage(error)}`)
          errors[connection.itemId] = errorMessage(error)
        }
      }
      if (ok) names.push(connection.name)
    }
    state.errors = errors

    const plan = planBankImport(transactions, accounts, finance.state.expenses, cardItems)
    result.pending = plan.skipped.pending
    result.linked = finance.linkExternalIds(plan.links)
    const rows: ImportRow[] = plan.rows.map((row) => {
      const suggestion = row.confirms ? null : finance.suggestCategory({ description: row.description, kind: row.kind, hints: row.hints })
      return {
        kind: row.kind,
        date: row.date,
        description: row.description,
        amount: row.amount,
        categoryId: finance.ensureCategory(suggestion?.id ?? null),
        externalId: row.externalId,
        confirms: row.confirms,
      }
    })
    if (rows.length) {
      const imported = finance.importEntries(rows, { file: names.join(', ') || 'banco', format: 'bank' })
      result.added = imported?.added ?? 0
      result.confirmed = imported?.confirmed ?? 0
    }

    // O "até quando" de cada conta buscada avança (a próxima busca volta alguns dias)
    saveSettings({
      ...settings(),
      lastSync: new Date().toISOString(),
      connections: settings().connections.map((connection) => ({
        ...connection,
        accounts: connection.accounts.map((account) => (done.has(account.id) ? { ...account, syncedUntil: day } : account)),
      })),
    })

    if (result.errors.length) notifyError(`Não deu para buscar em todas as contas: ${result.errors.join(' · ')}`)
    else if (!result.added && !result.confirmed && options.manual) {
      const pending = result.pending ? ` ${result.pending} ${result.pending === 1 ? 'transação ainda pendente' : 'transações ainda pendentes'} no banco ${result.pending === 1 ? 'entra' : 'entram'} na próxima busca.` : ''
      showToast({ message: `Nada novo no banco.${pending}`, icon: 'check' })
    }
    return result
  } finally {
    state.syncing = false
  }
}

let autoTimer: ReturnType<typeof setTimeout> | null = null

/** Ao abrir o app: busca uma vez por dia, se ligado (e com as Finanças ativas). */
function scheduleAutoSync(delay = 3000): void {
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = setTimeout(() => {
    autoTimer = null
    void (async () => {
      const current = settings()
      if (!current.autoSync || !current.connections.length || !useModulesStore().isEnabled('finance')) return
      // Já buscou hoje (neste ou em outro aparelho)
      if (current.lastSync && toISODate(new Date(current.lastSync)) >= today.value) return
      if (!(await refreshStatus())?.configured) return
      await sync()
    })()
  }, delay)
}

export function useBankStore() {
  return {
    state,
    settings,
    refreshStatus,
    configure,
    forget,
    addConnection,
    removeConnection,
    setAccountEnabled,
    setAutoSync,
    refreshConnection,
    sync,
    scheduleAutoSync,
  }
}

export type { BankAccount }
