/**
 * Conexão com bancos pelo Meu Pluggy (1.7.2) no Android: a mesma API do computador
 * (shared/pluggy.ts), com os pedidos pelo HTTP nativo (CapacitorHttp).
 *
 * O Client ID e o Client Secret ficam no armazenamento do próprio app (o mesmo do estado
 * da tela), que outros apps não leem; não há um cofre do sistema sem um plugin a mais.
 * Por isso `secure` é false e as Configurações explicam.
 *
 * Nos testes no navegador (disco na memória), "4notes:test-pluggy-url" aponta a API para
 * um servidor de teste e os pedidos usam o fetch da página.
 */
import { CapacitorHttp } from '@capacitor/core'
import type { BankStatus, FourNotesApi } from '#shared/ipc'
import { PLUGGY_API, PluggyClient, PluggyError, type PluggyTransport } from '#shared/pluggy'
import { readLocalValue, writeLocalValue } from '~/lib/storage/device-state'

const KEY = 'bank-credentials'

interface Stored {
  clientId: string
  clientSecret: string
}

function readStored(): Stored | null {
  try {
    const data = JSON.parse(readLocalValue(KEY) ?? 'null') as Partial<Stored> | null
    return data && typeof data.clientId === 'string' && typeof data.clientSecret === 'string' ? { clientId: data.clientId, clientSecret: data.clientSecret } : null
  } catch {
    return null
  }
}

const nativeTransport: PluggyTransport = {
  async request(method, url, headers, body) {
    const response = await CapacitorHttp.request({
      url,
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      data: body,
      responseType: 'json',
      connectTimeout: 30_000,
      readTimeout: 30_000,
    })
    return { status: response.status, body: response.data as unknown }
  },
}

const fetchTransport: PluggyTransport = {
  async request(method, url, headers, body) {
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: await response.json().catch(() => null) }
  },
}

export function createMobileBank(options: { test?: boolean }): NonNullable<FourNotesApi['bank']> {
  const base = options.test ? (readLocalValue('test-pluggy-url') ?? PLUGGY_API).replace(/\/$/, '') : PLUGGY_API
  const transport = options.test ? fetchTransport : nativeTransport
  let client: PluggyClient | null = null
  let clientFor = ''

  const status = async (): Promise<BankStatus> => {
    const stored = readStored()
    return { configured: !!stored, clientId: stored?.clientId ?? null, secure: false }
  }

  function current(): PluggyClient {
    const stored = readStored()
    if (!stored) throw new PluggyError('Configure a conexão com a Pluggy em Configurações › Finanças › Conexões bancárias.')
    const key = `${stored.clientId}\n${stored.clientSecret}`
    if (!client || clientFor !== key) {
      client = new PluggyClient(stored, transport, base)
      clientFor = key
    }
    return client
  }

  return {
    status,
    async configure(input) {
      const clientId = String(input?.clientId ?? '').trim()
      const clientSecret = String(input?.clientSecret ?? '').trim()
      if (!clientId || !clientSecret) throw new PluggyError('Preencha o Client ID e o Client Secret.')
      const candidate = new PluggyClient({ clientId, clientSecret }, transport, base)
      await candidate.authenticate(true)
      writeLocalValue(KEY, JSON.stringify({ clientId, clientSecret }))
      client = candidate
      clientFor = `${clientId}\n${clientSecret}`
      return status()
    },
    async forget() {
      writeLocalValue(KEY, 'null')
      client = null
      clientFor = ''
      return status()
    },
    item: (id) => current().item(String(id ?? '').trim()),
    accounts: (itemId) => current().accounts(String(itemId ?? '').trim()),
    transactions: (query) => current().transactions(query),
  }
}
