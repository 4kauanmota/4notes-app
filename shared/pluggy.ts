/**
 * Conexão com bancos pelo Meu Pluggy (1.7.2): o cliente da API da Pluggy, usado pelo
 * processo principal do Electron (electron/bank.ts) e pelo Android (app/lib/mobile/bank.ts).
 *
 * Como funciona (sem servidor do 4notes e sem senha de banco):
 *  1. Você conecta os seus bancos em meu.pluggy.ai, pelo Open Finance (a autorização é
 *     feita no app ou no site do próprio banco).
 *  2. No painel da Pluggy (dashboard.pluggy.ai) você cria uma aplicação: ela tem um
 *     Client ID e um Client Secret, que ficam só neste aparelho.
 *  3. Cada banco conectado no Meu Pluggy tem um "Item ID" (no painel: aplicação › Demo ›
 *     "Copiar Item ID"). O 4notes guarda esses ids no workspace.
 *  4. O 4notes pede à API (api.pluggy.ai) as contas e as transações desses itens, só para
 *     ler. Nada é enviado à Pluggy além do Client ID/Secret e dos ids.
 *
 * Esta parte não conhece o Electron nem o Android: quem a usa passa como fazer os pedidos
 * HTTP (`PluggyTransport`).
 */

export const PLUGGY_API = 'https://api.pluggy.ai'
/** Onde criar a aplicação e conectar os bancos (mostrado nas Configurações). */
export const PLUGGY_DASHBOARD = 'https://dashboard.pluggy.ai'
export const MEU_PLUGGY = 'https://meu.pluggy.ai'

export interface PluggyCredentials {
  clientId: string
  clientSecret: string
}

export interface PluggyResponse {
  status: number
  body: unknown
}

/** Como fazer um pedido HTTP (JSON) nesta plataforma. */
export interface PluggyTransport {
  request(method: 'GET' | 'POST', url: string, headers: Record<string, string>, body?: unknown): Promise<PluggyResponse>
}

/** Um banco conectado (o "item" da Pluggy). */
export interface BankItem {
  id: string
  /** Nome da instituição ("Nubank", "Itaú"…). */
  name: string
  /** Situação da conexão na Pluggy (UPDATED, UPDATING, LOGIN_ERROR, OUTDATED…). */
  status: string
  /** Última vez que a Pluggy atualizou os dados (ISO), ou null. */
  updatedAt: string | null
  /** Problema da conexão (em português), ou null. */
  problem: string | null
}

export interface BankAccount {
  id: string
  itemId: string
  /** BANK (conta corrente/poupança) ou CREDIT (cartão de crédito). */
  type: 'BANK' | 'CREDIT' | string
  subtype: string
  name: string
  number: string
  currency: string
}

export interface BankTransaction {
  id: string
  accountId: string
  /** Dia (AAAA-MM-DD), como o banco informou. */
  date: string
  description: string
  /** Valor em reais, como veio (o sinal depende do tipo da conta: use `type`). */
  amount: number
  /** DEBIT = dinheiro saindo, CREDIT = entrando. */
  type: 'DEBIT' | 'CREDIT'
  /** PENDING (ainda pode mudar) ou POSTED. */
  status: 'PENDING' | 'POSTED'
  /** Categoria dada pela Pluggy (em inglês: "Food and drinks"…), ou null. */
  category: string | null
  /** Nome do estabelecimento, se a Pluggy souber. */
  merchant: string | null
  currency: string
}

export interface TransactionQuery {
  accountId: string
  /** AAAA-MM-DD (inclusive). */
  from: string
  /** AAAA-MM-DD (inclusive); ausente = até hoje. */
  to?: string
}

/** Erro com uma mensagem para mostrar (em português). */
export class PluggyError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'PluggyError'
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A mensagem de um erro da API, em português. */
export function pluggyErrorMessage(status: number, body: unknown): string {
  const detail = isObject(body) ? str(body.message) || str(body.error) : ''
  if (status === 401 || status === 403) return 'A Pluggy recusou o Client ID/Client Secret. Confira os dois no painel da Pluggy.'
  if (status === 404) return 'Não encontrado na Pluggy. Confira o Item ID (ele muda se a conexão for refeita no Meu Pluggy).'
  if (status === 429) return 'Muitos pedidos à Pluggy em pouco tempo. Tente de novo em alguns minutos.'
  if (status >= 500) return 'A Pluggy está com problemas agora. Tente de novo mais tarde.'
  if (status === 0) return 'Sem conexão com a Pluggy. Confira a internet.'
  return detail ? `A Pluggy respondeu: ${detail}` : `A Pluggy respondeu com o erro ${status}.`
}

/** O que dizer de um item com problema (null = tudo certo). */
export function itemProblem(status: string, errorCode: string | null): string | null {
  if (status === 'LOGIN_ERROR' || status === 'WAITING_USER_INPUT' || status === 'WAITING_USER_ACTION') {
    return 'O banco pede uma nova autorização: refaça a conexão no Meu Pluggy.'
  }
  if (status === 'OUTDATED') return errorCode ? `A última atualização falhou (${errorCode}). A Pluggy tenta de novo sozinha.` : 'A última atualização falhou. A Pluggy tenta de novo sozinha.'
  return null
}

/** AAAA-MM-DD de uma data da API (sem mexer no fuso: o dia que o banco informou). */
export function apiDay(value: unknown): string | null {
  const text = str(value)
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

export function normalizeItem(raw: unknown): BankItem {
  const data = isObject(raw) ? raw : {}
  const connector = isObject(data.connector) ? data.connector : {}
  const error = isObject(data.error) ? str(data.error.code) || null : null
  const status = str(data.status) || 'UNKNOWN'
  return {
    id: str(data.id),
    name: str(connector.name) || 'Banco',
    status,
    updatedAt: str(data.lastUpdatedAt) || str(data.updatedAt) || null,
    problem: itemProblem(status, error),
  }
}

export function normalizeAccount(raw: unknown): BankAccount | null {
  if (!isObject(raw) || !str(raw.id)) return null
  return {
    id: str(raw.id),
    itemId: str(raw.itemId),
    type: str(raw.type) || 'BANK',
    subtype: str(raw.subtype),
    name: str(raw.marketingName) || str(raw.name) || 'Conta',
    number: str(raw.number),
    currency: str(raw.currencyCode) || 'BRL',
  }
}

export function normalizeTransaction(raw: unknown): BankTransaction | null {
  if (!isObject(raw) || !str(raw.id)) return null
  const date = apiDay(raw.date)
  const amount = typeof raw.amount === 'number' && Number.isFinite(raw.amount) ? raw.amount : null
  if (!date || amount === null) return null
  const merchant = isObject(raw.merchant) ? str(raw.merchant.name) || str(raw.merchant.businessName) || null : null
  const type = raw.type === 'CREDIT' || raw.type === 'DEBIT' ? raw.type : amount < 0 ? 'DEBIT' : 'CREDIT'
  return {
    id: str(raw.id),
    accountId: str(raw.accountId),
    date,
    description: (str(raw.description) || str(raw.descriptionRaw) || merchant || '').trim().replace(/\s+/g, ' '),
    amount,
    type,
    status: raw.status === 'PENDING' ? 'PENDING' : 'POSTED',
    category: str(raw.category) || null,
    merchant,
    currency: str(raw.currencyCode) || 'BRL',
  }
}

/** Página da API com cursor ({ results, next }) ou com número ({ results, page, totalPages }). */
function resultsOf(body: unknown): unknown[] {
  return isObject(body) && Array.isArray(body.results) ? body.results : []
}

/** Até quantas páginas de transações por conta num pedido. */
const MAX_PAGES = 40
/** A chave da API vale 2 horas; renovada um pouco antes. */
const KEY_LIFETIME_MS = 110 * 60 * 1000

export class PluggyClient {
  private apiKey: string | null = null
  private keyExpires = 0

  constructor(
    private readonly credentials: PluggyCredentials,
    private readonly transport: PluggyTransport,
    private readonly base = PLUGGY_API,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async send(method: 'GET' | 'POST', path: string, headers: Record<string, string>, body?: unknown): Promise<PluggyResponse> {
    try {
      return await this.transport.request(method, `${this.base}${path}`, { Accept: 'application/json', ...headers }, body)
    } catch {
      throw new PluggyError(pluggyErrorMessage(0, null), 0)
    }
  }

  /** Pede (ou reaproveita) a chave da API. Também serve para testar o Client ID/Secret. */
  async authenticate(force = false): Promise<string> {
    if (!force && this.apiKey && this.now() < this.keyExpires) return this.apiKey
    const response = await this.send('POST', '/auth', { 'Content-Type': 'application/json' }, { clientId: this.credentials.clientId, clientSecret: this.credentials.clientSecret })
    const key = isObject(response.body) ? str(response.body.apiKey) : ''
    if (response.status < 200 || response.status >= 300 || !key) throw new PluggyError(pluggyErrorMessage(response.status || 401, response.body), response.status)
    this.apiKey = key
    this.keyExpires = this.now() + KEY_LIFETIME_MS
    return key
  }

  private async get(path: string, params: Record<string, string | undefined> = {}): Promise<unknown> {
    const query = Object.entries(params)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&')
    const url = query ? `${path}?${query}` : path
    let response = await this.send('GET', url, { 'X-API-KEY': await this.authenticate() })
    // Chave vencida antes da hora: pede outra uma vez
    if (response.status === 401 || response.status === 403) response = await this.send('GET', url, { 'X-API-KEY': await this.authenticate(true) })
    if (response.status < 200 || response.status >= 300) throw new PluggyError(pluggyErrorMessage(response.status, response.body), response.status)
    return response.body
  }

  async item(id: string): Promise<BankItem> {
    if (!/^[\w-]{6,80}$/.test(id)) throw new PluggyError('Item ID inválido. Copie o id do item no painel da Pluggy (Demo › "Copiar Item ID").')
    const item = normalizeItem(await this.get(`/items/${encodeURIComponent(id)}`))
    return { ...item, id: item.id || id }
  }

  async accounts(itemId: string): Promise<BankAccount[]> {
    const body = await this.get('/accounts', { itemId })
    return resultsOf(body)
      .map(normalizeAccount)
      .filter((account): account is BankAccount => !!account)
      .map((account) => ({ ...account, itemId: account.itemId || itemId }))
  }

  /** As transações de uma conta no período (todas as páginas, até um limite). */
  async transactions(query: TransactionQuery): Promise<BankTransaction[]> {
    const out: BankTransaction[] = []
    let after: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.get('/v2/transactions', { accountId: query.accountId, dateFrom: query.from, dateTo: query.to, after })
      for (const raw of resultsOf(body)) {
        const transaction = normalizeTransaction(raw)
        if (transaction) out.push({ ...transaction, accountId: transaction.accountId || query.accountId })
      }
      const next = isObject(body) ? str(body.next) : ''
      if (!next) break
      const cursor = /[?&]after=([^&]+)/.exec(next)?.[1]
      if (!cursor) break
      after = decodeURIComponent(cursor)
    }
    return out
  }
}
