/**
 * Servidor de teste que imita a API da Pluggy (só o que o 4notes usa: /auth, /items/:id,
 * /accounts e /v2/transactions com cursor). Usado pelos testes do store dos bancos; os
 * testes de ponta a ponta usam uma cópia em .mjs. NÃO faz parte do app.
 */
import http from 'node:http'

export interface FakeTransaction {
  id: string
  accountId: string
  date: string
  description: string
  amount: number
  type: 'DEBIT' | 'CREDIT'
  status?: 'PENDING' | 'POSTED'
  category?: string | null
  merchant?: { name: string; businessName: string; cnpj: string } | null
}

export interface FakePluggy {
  url: string
  calls: string[]
  transactions: FakeTransaction[]
  /** Faz a próxima chave da API "vencer" (o 4notes precisa pedir outra). */
  expireKey(): void
  close(): Promise<void>
}

export async function startFakePluggy(options: { pageSize?: number } = {}): Promise<FakePluggy> {
  const pageSize = options.pageSize ?? 2
  let key = 'key-1'
  let keys = 1
  const calls: string[] = []
  const transactions: FakeTransaction[] = []
  const items: Record<string, { name: string; accounts: { id: string; type: string; subtype: string; name: string; number: string }[] }> = {
    'item-nubank-0001': {
      name: 'Nubank',
      accounts: [
        { id: 'acc-conta', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta', number: '1234-5' },
        { id: 'acc-cartao', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Cartão Ultravioleta', number: '9876' },
      ],
    },
  }
  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' })
    res.end(JSON.stringify(body))
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    calls.push(`${req.method} ${url.pathname}${url.search}`)
    if (req.method === 'OPTIONS') return send(res, 204, {})
    if (req.method === 'POST' && url.pathname === '/auth') {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
        const body = JSON.parse(raw || '{}') as { clientId?: string; clientSecret?: string }
        if (body.clientId === 'client-id-teste' && body.clientSecret === 'segredo-teste') send(res, 200, { apiKey: key })
        else send(res, 401, { code: 401, message: 'Invalid credentials' })
      })
      return
    }
    if (req.headers['x-api-key'] !== key) return send(res, 403, { message: 'Forbidden' })
    const item = url.pathname.match(/^\/items\/([\w-]+)$/)
    if (req.method === 'GET' && item) {
      const found = items[item[1]!]
      if (!found) return send(res, 404, { message: 'Item not found' })
      return send(res, 200, { id: item[1], connector: { id: 212, name: found.name }, status: 'UPDATED', lastUpdatedAt: '2026-10-23T06:00:00.000Z', error: null })
    }
    if (req.method === 'GET' && url.pathname === '/accounts') {
      const found = items[url.searchParams.get('itemId') ?? '']
      if (!found) return send(res, 404, { message: 'Item not found' })
      return send(res, 200, {
        total: found.accounts.length,
        results: found.accounts.map((account) => ({ ...account, itemId: url.searchParams.get('itemId'), balance: 100, currencyCode: 'BRL', marketingName: null })),
      })
    }
    if (req.method === 'GET' && url.pathname === '/v2/transactions') {
      const accountId = url.searchParams.get('accountId')
      const from = url.searchParams.get('dateFrom') ?? '0000-00-00'
      const to = url.searchParams.get('dateTo') ?? '9999-99-99'
      const list = transactions.filter((tx) => tx.accountId === accountId && tx.date >= from && tx.date <= to)
      const start = Number(url.searchParams.get('after') ? Buffer.from(url.searchParams.get('after')!, 'base64').toString() : '0')
      const page = list.slice(start, start + pageSize)
      const nextStart = start + pageSize
      const next = nextStart < list.length ? `/v2/transactions?accountId=${accountId}&after=${encodeURIComponent(Buffer.from(String(nextStart)).toString('base64'))}` : null
      return send(res, 200, {
        results: page.map((tx) => ({
          ...tx,
          date: `${tx.date}T00:00:00.000Z`,
          descriptionRaw: null,
          currencyCode: 'BRL',
          status: tx.status ?? 'POSTED',
          category: tx.category ?? null,
          merchant: tx.merchant ?? null,
          balance: 0,
        })),
        next,
      })
    }
    send(res, 404, { message: 'Not found' })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    transactions,
    expireKey() {
      key = `key-${++keys}`
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
