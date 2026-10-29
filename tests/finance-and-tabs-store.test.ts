// 1.7.0 nos stores, com o disco do Android na memória (a mesma API do desktop):
// gastos (registrar, editar, excluir com Desfazer, mencionar) e as abas temporárias das Notas.
import { beforeAll, describe, expect, it } from 'vitest'
import { createMobileApi } from '~/lib/mobile/api'
import { memoryFs } from '~/lib/mobile/fs'
import { fakeNative } from '~/lib/mobile/native'
import { WorkspaceFiles } from '~/lib/mobile/workspace'

const ROOT = '/storage/emulated/0'
const WS = `${ROOT}/Documents/Pessoal`
const disk = memoryFs(ROOT)
const files = new WorkspaceFiles(disk, WS)
const read = async (path: string) => JSON.parse((await files.read(path)) ?? 'null')
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let finance: ReturnType<(typeof import('~/stores/finance'))['useFinanceStore']>
let notes: ReturnType<(typeof import('~/stores/notes'))['useNotesStore']>
let tasks: ReturnType<(typeof import('~/stores/tasks'))['useTasksStore']>
let shared: ReturnType<(typeof import('~/stores/categories'))['useCategoriesStore']>
let mentions: typeof import('~/stores/mentions')
let toasts: ReturnType<(typeof import('~/composables/useToasts'))['useToasts']>['toasts']

beforeAll(async () => {
  await files.write('notes/A.md', '# A\nprimeira')
  await files.write('notes/B.md', '# B\nsegunda')
  await files.write('notes/C.md', '# C\nterceira')
  await files.write('notes/D.md', '# D\nquarta')
  const api = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.7.0', test: true })
  await api.dataDir.use(WS)
  const noop = () => undefined
  Object.assign(globalThis, {
    window: { fourNotes: api, addEventListener: noop, removeEventListener: noop },
    // (o editor, importado pelas menções, olha o documentElement ao carregar)
    document: { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', documentElement: { style: {} } },
  })
  finance = (await import('~/stores/finance')).useFinanceStore()
  notes = (await import('~/stores/notes')).useNotesStore()
  tasks = (await import('~/stores/tasks')).useTasksStore()
  shared = (await import('~/stores/categories')).useCategoriesStore()
  mentions = await import('~/stores/mentions')
  toasts = (await import('~/composables/useToasts')).useToasts().toasts
  await Promise.all([finance.load(), notes.load(), tasks.load()])
  await shared.load()
})

const flush = () => Promise.all([finance.flush(), shared.flush(), notes.flushAll(), tasks.flush()])

describe('gastos', () => {
  it('sem gastos, o finance.json nem é criado', async () => {
    await flush()
    expect(await files.read('finance/finance.json')).toBeNull()
    expect(finance.state.expenses).toEqual([])
  })

  it('registrar: valor em centavos, categoria compartilhada; valor ou data inválidos não registram', async () => {
    expect(finance.addExpense({ description: 'Nada', amount: 0, date: '2026-10-21', categoryId: null })).toBeNull()
    expect(finance.addExpense({ description: 'Data ruim', amount: 100, date: '21/10/2026', categoryId: null })).toBeNull()
    const mercado = finance.addCategory('Mercado', 'green')!
    expect(shared.findCategory(mercado.id)).toMatchObject({ name: 'Mercado' })
    const feira = finance.addExpense({ description: '  Feira  ', amount: 5230, date: '2026-10-21', categoryId: mercado.id, notes: 'barraca do Zé' })!
    // Categoria que não está nas Finanças não entra no gasto
    const cafe = finance.addExpense({ description: 'Café', amount: 890, date: '2026-10-20', categoryId: 'nao-existe' })!
    expect(cafe.categoryId).toBeNull()
    await flush()
    const file = await read('finance/finance.json')
    expect(file.currency).toBe('BRL')
    expect(file.expenses.map((item: { description: string; amount: number }) => `${item.description}:${item.amount}`)).toEqual(['Feira:5230', 'Café:890'])
    expect(file.expenses[0]).toMatchObject({ id: feira.id, categoryId: 'mercado', notes: 'barraca do Zé' })
    expect(file.categories.map((item: { id: string }) => item.id)).toEqual(['mercado'])
  })

  it('editar: muda os campos e a data de alteração; valor inválido não muda nada', async () => {
    const feira = finance.state.expenses[0]!
    const before = feira.updatedAt
    await wait(5)
    expect(finance.updateExpense(feira.id, { amount: -1 })).toBe(false)
    expect(finance.updateExpense(feira.id, { amount: 6000, description: 'Feira grande' })).toBe(true)
    const updated = finance.findExpense(feira.id)!
    expect(updated).toMatchObject({ amount: 6000, description: 'Feira grande', createdAt: feira.createdAt })
    expect(updated.updatedAt > before).toBe(true)
    await flush()
    expect((await read('finance/finance.json')).expenses[0].amount).toBe(6000)
  })

  it('excluir tem Desfazer (volta no mesmo lugar)', async () => {
    const [first, second] = finance.state.expenses
    finance.deleteExpense(first!.id)
    expect(finance.state.expenses.map((item) => item.id)).toEqual([second!.id])
    await flush()
    expect((await read('finance/finance.json')).expenses.length).toBe(1)
    const toast = toasts.at(-1)!
    expect(toast.message).toBe('Gasto excluído: Feira grande · R$ 60,00')
    await toast.action!.run()
    expect(finance.state.expenses.map((item) => item.id)).toEqual([first!.id, second!.id])
    await flush()
    expect((await read('finance/finance.json')).expenses.length).toBe(2)
  })

  it('abrir a menção de um gasto: vai para o mês dele e tira os filtros que o escondem', () => {
    finance.state.search = 'outra coisa'
    finance.state.categoryFilter = ['mercado']
    const cafe = finance.state.expenses.find((item) => item.description === 'Café')!
    finance.updateExpense(cafe.id, { date: '2026-08-15' })
    expect(finance.revealExpense(cafe.id)).toBe(true)
    expect(finance.state.search).toBe('')
    expect(finance.state.categoryFilter).toEqual([])
    expect(finance.state.period).toMatchObject({ kind: 'month', from: '2026-08-01', to: '2026-08-31' })
    expect(finance.state.reveal?.id).toBe(cafe.id)
  })

  it('um gasto gravado por outro aparelho aparece ao reler o arquivo', async () => {
    await flush()
    const file = await read('finance/finance.json')
    file.expenses.push({ id: 'e_celular', description: 'Uber', amount: 2350, date: '2026-10-22', categoryId: null, notes: '', createdAt: '2026-10-22T10:00:00.000Z', updatedAt: '2026-10-22T10:00:00.000Z' })
    await files.write('finance/finance.json', `${JSON.stringify(file, null, 2)}\n`)
    await finance.refreshFromDisk()
    expect(finance.findExpense('e_celular')).toMatchObject({ description: 'Uber', amount: 2350 })
  })

  it('mencionado numa nota e numa tarefa: aparece no "@", e o "Ver menções" encontra os dois', async () => {
    const feira = finance.state.expenses.find((item) => item.description === 'Feira grande')!
    const found = await mentions.searchMentions('feira')
    expect(found.find((item) => item.path === `finance/finance.json#${feira.id}`)).toMatchObject({ title: 'Feira grande' })
    expect(mentions.describeMention(`finance/finance.json#${feira.id}`)).toMatchObject({ title: 'Feira grande', detail: expect.stringContaining('R$ 60,00') })
    expect(mentions.describeMention('finance/finance.json#e_apagado')).toBeNull()

    const note = notes.createNote(`# Compras\nHoje: [Feira grande](../finance/finance.json#${feira.id})`)
    await notes.flushAll()
    expect(note.path).toBe('notes/Compras.md')
    const task = tasks.addTask({ title: 'Conferir a feira', mentions: [{ kind: 'expense', id: feira.id, title: 'Feira grande' }] })!
    expect(task.mentions).toEqual([{ kind: 'expense', id: feira.id, title: 'Feira grande' }])
    const places = await mentions.findMentionPlaces(mentions.expenseSubject(feira))
    expect(places.map((place) => `${place.kind}:${place.title}`).sort()).toEqual(['note:Compras', 'task:Conferir a feira'])
    await notes.closeTab(note.id)
  })
})

describe('abas temporárias e fixas (Notas)', () => {
  const id = (name: string) => notes.findByPath(`notes/${name}.md`)!.id
  const tabs = () => notes.state.openIds.map((open) => notes.findNote(open)!.path!.replace(/^notes\/|\.md$/g, ''))

  it('clique simples abre na aba temporária, e o próximo clique troca a nota dela', () => {
    for (const open of [...notes.state.openIds]) void notes.closeTab(open)
    notes.openNote(id('A'), { preview: true })
    expect(tabs()).toEqual(['A'])
    expect(notes.state.previewId).toBe(id('A'))
    notes.openNote(id('B'), { preview: true })
    expect(tabs()).toEqual(['B'])
    expect(notes.state.previewId).toBe(id('B'))
    expect(notes.state.activeId).toBe(id('B'))
  })

  it('clique duplo fixa: a próxima nota abre ao lado, sem trocar a fixa', () => {
    notes.openNote(id('B')) // clique duplo na lista (ou na aba)
    expect(notes.state.previewId).toBeNull()
    notes.openNote(id('C'), { preview: true })
    expect(tabs()).toEqual(['B', 'C'])
    notes.openNote(id('D'), { preview: true })
    expect(tabs()).toEqual(['B', 'D'])
    // Uma nota já aberta só é selecionada (sem aba repetida)
    notes.openNote(id('B'), { preview: true })
    expect(tabs()).toEqual(['B', 'D'])
    expect(notes.state.activeId).toBe(id('B'))
    expect(notes.state.previewId).toBe(id('D'))
  })

  it('editar fixa a aba (pinTab); mesmo sem fixar, a troca grava o que estava pendente', async () => {
    notes.pinTab(id('D'))
    expect(notes.state.previewId).toBeNull()
    notes.openNote(id('A'), { preview: true })
    expect(tabs()).toEqual(['B', 'D', 'A'])
    // Alteração na aba temporária, trocada logo em seguida (antes do salvamento automático)
    notes.updateContent(id('A'), '# A\nprimeira, editada')
    notes.openNote(id('C'), { preview: true })
    expect(tabs()).toEqual(['B', 'D', 'C'])
    await wait(20)
    await notes.flushAll()
    expect(await files.read('notes/A.md')).toBe('# A\nprimeira, editada')
    // A nota que saiu da aba pode ser reaberta (Ctrl+Shift+T)
    expect(notes.reopenClosedTab()).toBe(true)
    expect(tabs()).toEqual(['B', 'D', 'C', 'A'])
  })

  it('"Abrir em aba fixa" numa nota que está na aba temporária só a fixa; fechar a temporária libera o lugar', async () => {
    notes.openNote(id('B'), { preview: true })
    notes.openNote(id('D'), { preview: true })
    notes.openNote(id('C'), { preview: true }) // C está na aba temporária desde o teste anterior
    expect(notes.state.previewId).toBe(id('C'))
    notes.openNote(id('C'))
    expect(notes.state.previewId).toBeNull()
    expect(tabs()).toEqual(['B', 'D', 'C', 'A'])
    await notes.closeTab(id('A'))
    notes.openNote(id('A'), { preview: true })
    expect(notes.state.previewId).toBe(id('A'))
    await notes.closeTab(id('A'))
    expect(notes.state.previewId).toBeNull()
    notes.openNote(id('A'), { preview: true })
    expect(tabs()).toEqual(['B', 'D', 'C', 'A'])
  })

  it('a aba temporária é lembrada ao abrir o app de novo', async () => {
    await wait(250)
    const { readDeviceState } = await import('~/lib/storage/device-state')
    expect(readDeviceState('notes')).toMatchObject({ openTabs: ['notes/B.md', 'notes/D.md', 'notes/C.md', 'notes/A.md'], previewTab: 'notes/A.md' })
  })
})
