// 1.7.2: conexão com bancos pelo Meu Pluggy. O cliente da API (contra um servidor de teste
// que imita a Pluggy), o plano da importação e o store das Finanças com o disco do Android
// na memória (hoje = 23/10/2026). Nada aqui fala com a Pluggy de verdade.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeTransaction, PluggyClient, pluggyErrorMessage, type BankTransaction, type PluggyTransport } from '#shared/pluggy'
import { fetchFrom, isCardBillPayment, normalizeBankSettings, planBankImport } from '~/lib/finance/bank'
import type { Expense } from '~/lib/finance/model'
import { createMobileApi } from '~/lib/mobile/api'
import { memoryFs } from '~/lib/mobile/fs'
import { fakeNative } from '~/lib/mobile/native'
import { WorkspaceFiles } from '~/lib/mobile/workspace'
import { writeLocalValue } from '~/lib/storage/device-state'
import { startFakePluggy, type FakePluggy } from './helpers/fake-pluggy'

const fetchTransport: PluggyTransport = {
  async request(method, url, headers, body) {
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: await response.json().catch(() => null) }
  },
}

let server: FakePluggy

beforeAll(async () => {
  server = await startFakePluggy()
  server.transactions.push(
    { id: 't1', accountId: 'acc-conta', date: '2026-10-05', description: 'SALARIO EMPRESA X', amount: 5000, type: 'CREDIT', category: 'Salary' },
    { id: 't2', accountId: 'acc-conta', date: '2026-10-20', description: 'IFOOD *IFD', amount: -45.9, type: 'DEBIT', merchant: { name: 'iFood', businessName: 'IFOOD.COM AGENCIA', cnpj: '1' } },
    { id: 't3', accountId: 'acc-conta', date: '2026-10-18', description: 'PAGAMENTO FATURA CARTAO', amount: -1200, type: 'DEBIT' },
    { id: 't4', accountId: 'acc-conta', date: '2026-10-21', description: 'PADARIA PAO BOM', amount: -12.5, type: 'DEBIT' },
    { id: 't5', accountId: 'acc-conta', date: '2026-10-22', description: 'UBER *TRIP', amount: -23.9, type: 'DEBIT', status: 'PENDING' },
    { id: 't6', accountId: 'acc-conta', date: '2026-10-15', description: 'CONTA DE LUZ CEMIG', amount: -189.9, type: 'DEBIT' },
    { id: 't7', accountId: 'acc-cartao', date: '2026-10-10', description: 'NETFLIX.COM', amount: 55.9, type: 'DEBIT' },
    { id: 't8', accountId: 'acc-cartao', date: '2026-10-19', description: 'Pagamento recebido', amount: -1200, type: 'CREDIT', category: 'Credit card payment' },
    { id: 't9', accountId: 'acc-conta', date: '2026-09-01', description: 'ANTIGA', amount: -10, type: 'DEBIT' },
  )
})

afterAll(async () => {
  await server.close()
})

describe('cliente da API (Meu Pluggy)', () => {
  it('Client ID/Secret errados: mensagem clara', async () => {
    const client = new PluggyClient({ clientId: 'x', clientSecret: 'y' }, fetchTransport, server.url)
    await expect(client.authenticate()).rejects.toThrow(/recusou o Client ID/)
  })

  it('item, contas e transações com várias páginas (cursor)', async () => {
    const auths = server.calls.filter((call) => call === 'POST /auth').length
    const client = new PluggyClient({ clientId: 'client-id-teste', clientSecret: 'segredo-teste' }, fetchTransport, server.url)
    const item = await client.item('item-nubank-0001')
    expect(item).toMatchObject({ id: 'item-nubank-0001', name: 'Nubank', status: 'UPDATED', problem: null })
    const accounts = await client.accounts('item-nubank-0001')
    expect(accounts.map((account) => [account.id, account.type])).toEqual([
      ['acc-conta', 'BANK'],
      ['acc-cartao', 'CREDIT'],
    ])
    const before = server.calls.filter((call) => call.startsWith('GET /v2/transactions')).length
    const list = await client.transactions({ accountId: 'acc-conta', from: '2026-10-01', to: '2026-10-23' })
    expect(list.map((tx) => tx.id).sort()).toEqual(['t1', 't2', 't3', 't4', 't5', 't6'])
    expect(server.calls.filter((call) => call.startsWith('GET /v2/transactions')).length - before).toBe(3)
    expect(list.find((tx) => tx.id === 't2')).toMatchObject({ date: '2026-10-20', amount: -45.9, type: 'DEBIT', merchant: 'iFood' })
    // Uma chave da API pedida uma vez só
    expect(server.calls.filter((call) => call === 'POST /auth').length - auths).toBe(1)
  })

  it('chave vencida: pede outra e repete o pedido', async () => {
    const client = new PluggyClient({ clientId: 'client-id-teste', clientSecret: 'segredo-teste' }, fetchTransport, server.url)
    await client.accounts('item-nubank-0001')
    server.expireKey()
    const auths = server.calls.filter((call) => call === 'POST /auth').length
    expect((await client.accounts('item-nubank-0001')).length).toBe(2)
    expect(server.calls.filter((call) => call === 'POST /auth').length).toBe(auths + 1)
  })

  it('Item ID que não existe e sem internet', async () => {
    const client = new PluggyClient({ clientId: 'client-id-teste', clientSecret: 'segredo-teste' }, fetchTransport, server.url)
    await expect(client.item('item-inexistente')).rejects.toThrow(/Confira o Item ID/)
    await expect(client.item('a b')).rejects.toThrow(/Item ID inválido/)
    const offline = new PluggyClient({ clientId: 'a', clientSecret: 'b' }, { request: () => Promise.reject(new Error('ENOTFOUND')) })
    await expect(offline.authenticate()).rejects.toThrow(/Sem conexão/)
    expect(pluggyErrorMessage(429, null)).toMatch(/Muitos pedidos/)
  })

  it('transação: o dia como veio (sem fuso), tipo pelo campo ou pelo sinal', () => {
    expect(normalizeTransaction({ id: 'a', date: '2026-10-31T23:30:00.000Z', amount: -3, description: ' A  b ' })).toMatchObject({ date: '2026-10-31', type: 'DEBIT', description: 'A b' })
    expect(normalizeTransaction({ id: 'a', date: 'ontem', amount: 3 })).toBeNull()
  })
})

describe('plano da importação', () => {
  const tx = (patch: Partial<BankTransaction>): BankTransaction => ({
    id: 'x',
    accountId: 'acc-conta',
    date: '2026-10-20',
    description: 'Algo',
    amount: -10,
    type: 'DEBIT',
    status: 'POSTED',
    category: null,
    merchant: null,
    currency: 'BRL',
    ...patch,
  })
  const accounts = new Map([
    ['acc-conta', { type: 'BANK', itemId: 'i1' }],
    ['acc-cartao', { type: 'CREDIT', itemId: 'i1' }],
  ])
  const entry = (patch: Partial<Expense>): Expense =>
    ({ id: 'e1', kind: 'expense', description: 'Padaria', amount: 1250, date: '2026-10-21', categoryId: null, notes: '', status: 'done', doneOn: null, externalId: null, ...patch }) as Expense

  it('gasto/entrada pelo tipo, centavos sem sinal, id da transação', () => {
    const plan = planBankImport([tx({ id: 'a', amount: -45.9 }), tx({ id: 'b', type: 'CREDIT', amount: 5000 })], accounts, [], new Set())
    expect(plan.rows.map((row) => [row.kind, row.amount, row.externalId])).toEqual([
      ['expense', 4590, 'pluggy:a'],
      ['income', 500000, 'pluggy:b'],
    ])
  })

  it('o que já entrou não entra de novo; pendentes ficam para depois', () => {
    const plan = planBankImport([tx({ id: 'a' }), tx({ id: 'b', status: 'PENDING' })], accounts, [entry({ externalId: 'pluggy:a' })], new Set())
    expect(plan.rows).toEqual([])
    expect(plan.skipped).toMatchObject({ known: 1, pending: 1 })
  })

  it('fatura do cartão paga na conta: fora quando o cartão está conectado', () => {
    const bill = tx({ id: 'f', description: 'PAGAMENTO FATURA CARTAO', amount: -1200 })
    expect(planBankImport([bill], accounts, [], new Set(['i1'])).skipped.billPayments).toBe(1)
    expect(planBankImport([bill], accounts, [], new Set()).rows.length).toBe(1)
    expect(planBankImport([tx({ id: 'p', accountId: 'acc-cartao', type: 'CREDIT', amount: 1200, description: 'Pagamento recebido', category: 'Credit card payment' })], accounts, [], new Set(['i1'])).rows).toEqual([])
    expect(isCardBillPayment({ description: 'Pgto fatura Nubank', category: null })).toBe(true)
    expect(isCardBillPayment({ description: 'Pagamento de aluguel', category: null })).toBe(false)
  })

  it('lançamento seu igual: pendente é confirmado; pago à mão é ligado (sem duplicar)', () => {
    const pending = planBankImport([tx({ id: 'l', amount: -189.9, date: '2026-10-15', description: 'CEMIG' })], accounts, [entry({ id: 'luz', amount: 18990, date: '2026-10-14', status: 'pending', description: 'Luz' })], new Set())
    expect(pending.rows[0]).toMatchObject({ confirms: 'luz', externalId: 'pluggy:l' })
    const manual = planBankImport([tx({ id: 'p', amount: -12.5, date: '2026-10-21', description: 'PADARIA PAO BOM' })], accounts, [entry({})], new Set())
    expect(manual.rows).toEqual([])
    expect(manual.links).toEqual([{ entryId: 'e1', externalId: 'pluggy:p' }])
    // Já ligado a outra transação do banco: é outra compra (dois cafés do mesmo valor)
    const other = planBankImport([tx({ id: 'q', amount: -12.5, date: '2026-10-21' })], accounts, [entry({ externalId: 'pluggy:p' })], new Set())
    expect(other.rows.length).toBe(1)
  })

  it('configurações tolerantes e de onde buscar (volta alguns dias)', () => {
    const settings = normalizeBankSettings({ connections: [{ itemId: 'i', name: 'X', from: '2026-10-01', accounts: [{ id: 'a', syncedUntil: '2026-10-20' }, { id: 'b' }, {}] }, { itemId: 'i' }, 3] })
    expect(settings.connections.length).toBe(1)
    expect(settings.autoSync).toBe(true)
    const [connection] = settings.connections
    expect(connection!.accounts.map((account) => account.enabled)).toEqual([true, true])
    expect(fetchFrom(connection!, connection!.accounts[0]!)).toBe('2026-10-13')
    expect(fetchFrom(connection!, connection!.accounts[1]!)).toBe('2026-10-01')
    expect(fetchFrom({ ...connection!, from: '2026-10-18' }, connection!.accounts[0]!)).toBe('2026-10-18')
  })
})

describe('no store das Finanças (direto, com Desfazer)', () => {
  const ROOT = '/storage/emulated/0'
  const WS = `${ROOT}/Documents/Banco`
  const disk = memoryFs(ROOT)
  const files = new WorkspaceFiles(disk, WS)
  const read = async (path: string) => JSON.parse((await files.read(path)) ?? 'null')
  let finance: ReturnType<(typeof import('~/stores/finance'))['useFinanceStore']>
  let bank: ReturnType<(typeof import('~/stores/bank'))['useBankStore']>
  let shared: ReturnType<(typeof import('~/stores/categories'))['useCategoriesStore']>
  let toasts: ReturnType<(typeof import('~/composables/useToasts'))['useToasts']>['toasts']
  let flushSettings: () => Promise<void>

  beforeAll(async () => {
    writeLocalValue('test-pluggy-url', server.url)
    const api = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.7.2', test: true, fakeToday: '2026-10-23' })
    await api.dataDir.use(WS)
    const noop = () => undefined
    Object.assign(globalThis, {
      window: { fourNotes: api, addEventListener: noop, removeEventListener: noop },
      document: { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', documentElement: { style: {} }, hasFocus: () => true },
    })
    const settings = await import('~/stores/settings')
    await settings.loadSettings()
    flushSettings = settings.flushSettings
    finance = (await import('~/stores/finance')).useFinanceStore()
    bank = (await import('~/stores/bank')).useBankStore()
    shared = (await import('~/stores/categories')).useCategoriesStore()
    toasts = (await import('~/composables/useToasts')).useToasts().toasts
    await finance.load()
    await shared.load()
    // Categorias suas: a do iFood vai para "Comida"
    finance.addCategory('Comida', 'orange')
    finance.addCategory('Moradia', 'blue')
    finance.addExpense({ description: 'Padaria', amount: 1250, date: '2026-10-21', categoryId: null })
  })

  it('sem credenciais: não busca e diz o que falta', async () => {
    expect((await bank.refreshStatus())?.configured).toBe(false)
    expect(await bank.sync({ manual: true })).toBeNull()
    expect(toasts.at(-1)?.message).toMatch(/Configure a conexão com a Pluggy/)
  })

  it('credenciais erradas não são guardadas; certas ficam só no aparelho', async () => {
    expect(await bank.configure('client-id-teste', 'errado')).toMatch(/recusou/)
    expect(bank.state.status?.configured).toBe(false)
    expect(await bank.configure('client-id-teste', 'segredo-teste')).toBeNull()
    expect(bank.state.status).toMatchObject({ configured: true, clientId: 'client-id-teste' })
    await flushSettings()
    expect(JSON.stringify(await read('.4notes/settings.json'))).not.toContain('segredo-teste')
  })

  it('adicionar banco pelo Item ID: contas no workspace, todas marcadas', async () => {
    expect(await bank.addConnection('item-inexistente', '2026-10-01')).toMatch(/Confira o Item ID/)
    expect(await bank.addConnection('item-nubank-0001', '2026-10-01')).toBeNull()
    expect(await bank.addConnection('item-nubank-0001', '2026-10-01')).toMatch(/já está conectado/)
    await flushSettings()
    const saved = (await read('.4notes/settings.json')).finance.bank
    expect(saved.connections[0]).toMatchObject({ itemId: 'item-nubank-0001', name: 'Nubank', from: '2026-10-01' })
    expect(saved.connections[0].accounts.map((account: { id: string; enabled: boolean }) => [account.id, account.enabled])).toEqual([
      ['acc-conta', true],
      ['acc-cartao', true],
    ])
  })

  it('buscar: entra direto, com categoria automática, sem fatura em dobro, sem pendentes, ligando o que você já tinha', async () => {
    const before = finance.state.expenses.length
    const result = await bank.sync({ manual: true })
    expect(result).toMatchObject({ added: 4, linked: 1, pending: 1, errors: [] })
    const imported = finance.state.expenses.filter((entry) => entry.externalId?.startsWith('pluggy:'))
    const byId = (id: string) => imported.find((entry) => entry.externalId === `pluggy:${id}`)
    expect(byId('t1')).toMatchObject({ kind: 'income', amount: 500000, date: '2026-10-05' })
    expect(byId('t2')).toMatchObject({ kind: 'expense', amount: 4590, categoryId: finance.state.categories.find((c) => c.name === 'Comida')!.id })
    expect(byId('t6')?.categoryId).toBe(finance.state.categories.find((c) => c.name === 'Moradia')!.id)
    expect(byId('t7')).toMatchObject({ kind: 'expense', amount: 5590 })
    expect(byId('t3')).toBeUndefined()
    expect(byId('t5')).toBeUndefined()
    expect(byId('t9')).toBeUndefined()
    // A padaria registrada à mão ganhou o id da transação (não duplicou)
    expect(finance.state.expenses.find((entry) => entry.description === 'Padaria')?.externalId).toBe('pluggy:t4')
    expect(finance.state.expenses.length).toBe(before + 4)
    expect(toasts.at(-1)?.message).toMatch(/Do banco \(Nubank\): 4 lançamentos/)
    expect(finance.state.settings.bank.connections[0]!.accounts.every((account) => account.syncedUntil === '2026-10-23')).toBe(true)
    expect(finance.state.imports.at(-1)).toMatchObject({ format: 'bank', file: 'Nubank', count: 4 })
  })

  it('buscar de novo: nada duplica; a pendente que virou lançada entra', async () => {
    let result = await bank.sync({ manual: true })
    expect(result).toMatchObject({ added: 0, pending: 1 })
    expect(toasts.at(-1)?.message).toMatch(/Nada novo no banco/)
    server.transactions.find((tx) => tx.id === 't5')!.status = 'POSTED'
    result = await bank.sync({ manual: true })
    expect(result).toMatchObject({ added: 1, pending: 0 })
    expect(finance.state.expenses.filter((entry) => entry.externalId === 'pluggy:t5').length).toBe(1)
  })

  it('Desfazer tira só o que veio da busca', async () => {
    server.transactions.push({ id: 't10', accountId: 'acc-cartao', date: '2026-10-23', description: 'SPOTIFY', amount: 21.9, type: 'DEBIT' })
    await bank.sync({ manual: true })
    expect(finance.state.expenses.some((entry) => entry.externalId === 'pluggy:t10')).toBe(true)
    await toasts.at(-1)!.action!.run()
    expect(finance.state.expenses.some((entry) => entry.externalId === 'pluggy:t10')).toBe(false)
    expect(finance.state.expenses.some((entry) => entry.externalId === 'pluggy:t2')).toBe(true)
  })

  it('conta desmarcada não é buscada; remover banco mantém os lançamentos', async () => {
    bank.setAccountEnabled('item-nubank-0001', 'acc-cartao', false)
    const calls = server.calls.length
    await bank.sync({ manual: true })
    expect(server.calls.slice(calls).some((call) => call.includes('acc-cartao'))).toBe(false)
    const count = finance.state.expenses.length
    bank.removeConnection('item-nubank-0001')
    expect(finance.state.settings.bank.connections).toEqual([])
    expect(finance.state.expenses.length).toBe(count)
  })

  it('desconectar apaga as credenciais do aparelho', async () => {
    await bank.forget()
    expect(bank.state.status).toMatchObject({ configured: false, clientId: null })
  })
})
