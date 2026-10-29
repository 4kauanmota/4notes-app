/**
 * Conexão com bancos pelo Meu Pluggy (1.7.2), no computador.
 *
 * - O Client ID e o Client Secret ficam só nesta máquina, em <userData>/bank.json, com o
 *   segredo criptografado pelo sistema (safeStorage: no Windows, a proteção de dados do
 *   usuário). A interface nunca recebe o segredo de volta: só "configurado" e o Client ID.
 * - Os pedidos à API (api.pluggy.ai) saem daqui, do processo principal (a interface não
 *   tem acesso à rede). Só leitura: item, contas e transações.
 * - Nos testes automatizados (FOURNOTES_TEST=1), FOURNOTES_PLUGGY_URL troca o endereço da
 *   API por um servidor de teste.
 */
import { app, net, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BankStatus } from '../shared/ipc'
import { PLUGGY_API, PluggyClient, PluggyError, type PluggyCredentials, type PluggyTransport, type TransactionQuery } from '../shared/pluggy'

interface StoredCredentials {
  clientId: string
  /** Base64 do segredo criptografado (ou do texto, quando `encrypted` é false: só nos testes). */
  secret: string
  encrypted: boolean
}

const isTest = process.env.FOURNOTES_TEST === '1'
const base = isTest && process.env.FOURNOTES_PLUGGY_URL ? process.env.FOURNOTES_PLUGGY_URL.replace(/\/$/, '') : PLUGGY_API

const file = () => path.join(app.getPath('userData'), 'bank.json')

let client: PluggyClient | null = null
let clientFor: string | null = null

const transport: PluggyTransport = {
  async request(method, url, headers, body) {
    const response = await net.fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = { message: text.slice(0, 200) }
    }
    return { status: response.status, body: parsed }
  },
}

async function readStored(): Promise<StoredCredentials | null> {
  try {
    const data = JSON.parse(await fs.readFile(file(), 'utf8')) as Partial<StoredCredentials>
    if (typeof data.clientId !== 'string' || typeof data.secret !== 'string') return null
    return { clientId: data.clientId, secret: data.secret, encrypted: data.encrypted !== false }
  } catch {
    return null
  }
}

function secretOf(stored: StoredCredentials): string {
  const bytes = Buffer.from(stored.secret, 'base64')
  return stored.encrypted ? safeStorage.decryptString(bytes) : bytes.toString('utf8')
}

async function credentials(): Promise<PluggyCredentials> {
  const stored = await readStored()
  if (!stored) throw new PluggyError('Configure a conexão com a Pluggy em Configurações › Finanças › Conexões bancárias.')
  try {
    return { clientId: stored.clientId, clientSecret: secretOf(stored) }
  } catch {
    throw new PluggyError('Não foi possível ler o Client Secret guardado (ele foi criptografado por outro usuário ou computador). Informe de novo.')
  }
}

async function currentClient(): Promise<PluggyClient> {
  const creds = await credentials()
  const key = `${creds.clientId}\n${creds.clientSecret}`
  if (!client || clientFor !== key) {
    client = new PluggyClient(creds, transport, base)
    clientFor = key
  }
  return client
}

export async function bankStatus(): Promise<BankStatus> {
  const stored = await readStored()
  return { configured: !!stored, clientId: stored?.clientId ?? null, secure: stored ? stored.encrypted : safeStorage.isEncryptionAvailable() }
}

/** Testa o Client ID/Secret na Pluggy e, se ela aceitar, guarda (criptografado). */
export async function configureBank(input: PluggyCredentials): Promise<BankStatus> {
  const clientId = String(input?.clientId ?? '').trim()
  const clientSecret = String(input?.clientSecret ?? '').trim()
  if (!clientId || !clientSecret) throw new PluggyError('Preencha o Client ID e o Client Secret.')
  if (clientId.length > 200 || clientSecret.length > 500) throw new PluggyError('Client ID ou Client Secret grande demais.')
  const encrypted = safeStorage.isEncryptionAvailable()
  if (!encrypted && !isTest) throw new PluggyError('Este computador não oferece armazenamento seguro para o Client Secret.')
  const candidate = new PluggyClient({ clientId, clientSecret }, transport, base)
  await candidate.authenticate(true)
  const secret = encrypted ? safeStorage.encryptString(clientSecret).toString('base64') : Buffer.from(clientSecret, 'utf8').toString('base64')
  const stored: StoredCredentials = { clientId, secret, encrypted }
  await fs.mkdir(path.dirname(file()), { recursive: true })
  const temp = `${file()}.tmp`
  await fs.writeFile(temp, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(temp, file())
  client = candidate
  clientFor = `${clientId}\n${clientSecret}`
  return bankStatus()
}

export async function forgetBank(): Promise<BankStatus> {
  client = null
  clientFor = null
  await fs.rm(file(), { force: true })
  return bankStatus()
}

export async function bankItem(id: string) {
  return (await currentClient()).item(String(id ?? '').trim())
}

export async function bankAccounts(itemId: string) {
  return (await currentClient()).accounts(String(itemId ?? '').trim())
}

export async function bankTransactions(query: TransactionQuery) {
  const valid = /^\d{4}-\d{2}-\d{2}$/
  if (!query || typeof query.accountId !== 'string' || !valid.test(query.from) || (query.to !== undefined && !valid.test(query.to))) {
    throw new PluggyError('Pedido de transações inválido.')
  }
  return (await currentClient()).transactions({ accountId: query.accountId, from: query.from, to: query.to })
}
