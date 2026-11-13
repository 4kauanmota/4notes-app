// 1.7.3: a conexão com bancos (Meu Pluggy, 1.7.2) saiu. Um workspace e um aparelho que
// usaram a 1.7.2 perdem os bancos e as credenciais; os lançamentos que vieram do banco ficam.
import { beforeAll, describe, expect, it } from 'vitest'
import { createMobileApi } from '~/lib/mobile/api'
import { memoryFs } from '~/lib/mobile/fs'
import { fakeNative } from '~/lib/mobile/native'
import { WorkspaceFiles } from '~/lib/mobile/workspace'
import { normalizeFinanceSettings } from '~/lib/finance/settings'
import { readLocalValue, writeLocalValue } from '~/lib/storage/device-state'

const ROOT = '/storage/emulated/0'
const WS = `${ROOT}/Documents/Pessoal`
const disk = memoryFs(ROOT)
const files = new WorkspaceFiles(disk, WS)
const read = async (path: string) => JSON.parse((await files.read(path)) ?? 'null')

const FINANCE_172 = {
  app: '4notes',
  version: 2,
  currency: 'BRL',
  categories: [{ id: 'comida', name: 'Comida', color: 'orange', createdAt: '2026-10-01T00:00:00.000Z' }],
  expenses: [
    {
      id: 'e_banco1', description: 'IFOOD', amount: 4590, date: '2026-10-20', categoryId: 'comida', notes: '',
      importId: 'x_banco', externalId: 'pluggy:abc123', createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
    },
  ],
  imports: [{ id: 'x_banco', file: 'Nubank', format: 'bank', importedAt: '2026-10-21T00:00:00.000Z', count: 1 }],
}

let finance: ReturnType<(typeof import('~/stores/finance'))['useFinanceStore']>
let settings: typeof import('~/stores/settings')

beforeAll(async () => {
  writeLocalValue('bank-credentials', JSON.stringify({ clientId: 'id', clientSecret: 'segredo' }))
  await files.write('finance/finance.json', JSON.stringify(FINANCE_172))
  await files.write(
    '.4notes/settings.json',
    JSON.stringify({
      version: 1,
      theme: 'dark',
      finance: { weekStart: 0, notify: false, defaultCategory: 'comida', bank: { connections: [{ itemId: 'item-1', name: 'Nubank' }], autoSync: true } },
    }),
  )
  const api = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.7.3', test: true })
  await api.dataDir.use(WS)
  const noop = () => undefined
  Object.assign(globalThis, {
    window: { fourNotes: api, addEventListener: noop, removeEventListener: noop },
    document: { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', documentElement: { style: {} } },
  })
  settings = await import('~/stores/settings')
  await settings.loadSettings()
  finance = (await import('~/stores/finance')).useFinanceStore()
  await finance.load()
})

describe('sem a conexão com bancos', () => {
  it('as credenciais guardadas no aparelho saem', () => {
    expect(readLocalValue('bank-credentials')).toBeNull()
  })

  it('a seção "bank" sai do settings.json; o resto das Finanças fica', async () => {
    await settings.flushSettings()
    const file = await read('.4notes/settings.json')
    expect(file.finance).toEqual({ weekStart: 0, notify: false, defaultCategory: 'comida' })
    expect(file.theme).toBe('dark')
    expect(normalizeFinanceSettings(file.finance)).not.toHaveProperty('bank')
  })

  it('os lançamentos que vieram do banco continuam, com o id e a importação', async () => {
    const entry = finance.state.expenses.find((item) => item.id === 'e_banco1')
    expect(entry).toMatchObject({ amount: 4590, externalId: 'pluggy:abc123', importId: 'x_banco' })
    expect(finance.state.imports[0]).toMatchObject({ id: 'x_banco', format: 'bank' })
    // Gravar de novo não muda esses campos
    finance.updateExpense('e_banco1', { description: 'iFood' })
    await finance.flush()
    const file = await read('finance/finance.json')
    expect(file.expenses[0]).toMatchObject({ description: 'iFood', externalId: 'pluggy:abc123', importId: 'x_banco' })
    expect(file.imports[0].format).toBe('bank')
  })
})
