// Categorias compartilhadas (1.7.0) de ponta a ponta nos stores: um workspace da 1.6.4
// (Notas, Tarefas, Links e Timer, cada um com as próprias categorias) aberto na 1.7.0,
// com o disco do Android na memória (a mesma API do desktop: lib/mobile).
import { beforeAll, describe, expect, it } from 'vitest'
import { createMobileApi } from '~/lib/mobile/api'
import { memoryFs } from '~/lib/mobile/fs'
import { fakeNative } from '~/lib/mobile/native'
import { WorkspaceFiles } from '~/lib/mobile/workspace'

const ROOT = '/storage/emulated/0'
const WS = `${ROOT}/Documents/Pessoal`
const disk = memoryFs(ROOT)
const files = new WorkspaceFiles(disk, WS)
const PNG = new Uint8Array(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex'))
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const read = async (path: string) => JSON.parse((await files.read(path)) ?? 'null')
const exists = async (path: string) => !!(await disk.stat(`${WS}/${path}`))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Stores = {
  notes: ReturnType<(typeof import('~/stores/notes'))['useNotesStore']>
  tasks: ReturnType<(typeof import('~/stores/tasks'))['useTasksStore']>
  links: ReturnType<(typeof import('~/stores/links'))['useLinksStore']>
  timer: ReturnType<(typeof import('~/stores/timer'))['useTimerStore']>
  finance: ReturnType<(typeof import('~/stores/finance'))['useFinanceStore']>
  shared: ReturnType<(typeof import('~/stores/categories'))['useCategoriesStore']>
}
let s: Stores

async function flushAll() {
  await Promise.all([s.notes.flushAll(), s.tasks.flush(), s.links.flush(), s.timer.flush(), s.finance.flush(), s.shared.flush()])
}

const session = (id: string, categoryId: string | null) => ({
  id,
  mode: 'stopwatch',
  activity: `Atividade ${id}`,
  categoryId,
  start: '2026-10-20T13:00:00.000Z',
  end: '2026-10-20T14:00:00.000Z',
  duration: 3600,
  measured: 3600,
  status: 'completed',
  spans: [['2026-10-20T13:00:00.000Z', '2026-10-20T14:00:00.000Z']],
})

beforeAll(async () => {
  // Um workspace da 1.6.4
  await files.write('notes/Solta.md', '# Solta')
  await files.write('notes/Estudo/Aula 1.md', '# Aula 1\n![](../../attachments/x.png)')
  await files.writeBytes('notes/Estudo/Estudo.png', PNG)
  await files.write('notes/Trabalho/Reunião.md', '# Reunião')
  await files.write(
    'notes/categorias.json',
    json({ app: '4notes', version: 1, categories: [{ name: 'Estudo', color: 'blue', icon: null, image: 'Estudo.png' }, { name: 'Trabalho', color: 'red', icon: 'briefcase', image: null }] }),
  )
  await files.write(
    'tasks/tasks.json',
    json({
      app: '4notes',
      version: 1,
      categories: [
        { id: 'estudo', name: 'Estudo', color: 'purple', createdAt: '2026-10-01T00:00:00.000Z' },
        { id: 'casa', name: 'Casa', color: 'green', createdAt: '2026-10-01T00:00:00.000Z' },
      ],
      tasks: [
        { id: 't1', title: 'Ler capítulo', categoryId: 'estudo', date: null },
        { id: 't2', title: 'Lavar louça', categoryId: 'casa', date: null },
        { id: 't3', title: 'Sem categoria', categoryId: null, date: null },
      ],
    }),
  )
  await files.write(
    'links/links.json',
    json({
      app: '4notes',
      version: 1,
      folders: [
        { id: 'estudo-1', name: 'estudo', color: 'teal', icon: null, image: null, createdAt: '2026-10-01T00:00:00.000Z' },
        { id: 'dev', name: 'Dev', color: 'purple', icon: 'code', image: null, createdAt: '2026-10-01T00:00:00.000Z' },
      ],
      links: [
        { id: 'l1', url: 'https://godotengine.org/', title: 'Godot', folderId: 'estudo-1', icon: null },
        { id: 'l2', url: 'https://nuxt.com/', title: 'Nuxt', folderId: 'dev', icon: null },
      ],
    }),
  )
  await files.write(
    'timer/timer.json',
    json({
      app: '4notes',
      version: 1,
      categories: [
        { id: 'estudo', name: 'ESTUDO', color: 'green', createdAt: '2026-10-01T00:00:00.000Z' },
        { id: 'trabalho', name: 'Trabalho', color: 'orange', createdAt: '2026-10-01T00:00:00.000Z' },
      ],
      sessions: [session('s1', 'estudo'), session('s2', 'trabalho')],
      active: null,
    }),
  )

  const api = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.7.0', test: true })
  await api.dataDir.use(WS)
  const noop = () => undefined
  Object.assign(globalThis, {
    window: { fourNotes: api, addEventListener: noop, removeEventListener: noop },
    document: { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible' },
  })
  s = {
    notes: (await import('~/stores/notes')).useNotesStore(),
    tasks: (await import('~/stores/tasks')).useTasksStore(),
    links: (await import('~/stores/links')).useLinksStore(),
    timer: (await import('~/stores/timer')).useTimerStore(),
    finance: (await import('~/stores/finance')).useFinanceStore(),
    shared: (await import('~/stores/categories')).useCategoriesStore(),
  }
  await Promise.all([s.notes.load(), s.tasks.load(), s.links.load(), s.timer.load(), s.finance.load()])
  await s.shared.load()
  await flushAll()
})

const byName = (name: string) => s.shared.findByName(name)!

describe('passagem da 1.6 para as categorias compartilhadas', () => {
  it('uma lista só, com as categorias de mesmo nome juntas (cor, ícone e foto do primeiro: Notas)', async () => {
    const names = s.shared.state.categories.map((category) => category.name).sort()
    expect(names).toEqual(['Casa', 'Dev', 'Estudo', 'Trabalho'])
    expect(byName('Estudo')).toMatchObject({ id: 'estudo', color: 'blue' })
    expect(byName('Trabalho')).toMatchObject({ id: 'trabalho', color: 'red', icon: 'briefcase' })
    // A foto da categoria das Notas foi para a biblioteca
    expect(byName('Estudo').image).toMatch(/^attachments\//)
    const file = await read('categories/categories.json')
    expect(file.categories.map((category: { id: string }) => category.id).sort()).toEqual(['casa', 'dev', 'estudo', 'trabalho'])
  })

  it('os registros de cada módulo apontam para a categoria certa (nenhum fica sem)', async () => {
    const links = await read('links/links.json')
    expect(links.folders.map((folder: { id: string; name: string }) => `${folder.id}:${folder.name}`)).toEqual(['estudo:Estudo', 'dev:Dev'])
    expect(links.links.find((link: { id: string }) => link.id === 'l1').folderId).toBe('estudo')
    const timer = await read('timer/timer.json')
    // A cópia do nome e da cor fica igual à da lista central
    expect(timer.categories.map((category: { name: string; color: string }) => `${category.name}:${category.color}`)).toEqual(['Estudo:blue', 'Trabalho:red'])
    expect(timer.sessions.map((item: { categoryId: string }) => item.categoryId)).toEqual(['estudo', 'trabalho'])
    const tasks = await read('tasks/tasks.json')
    expect(tasks.tasks.map((task: { categoryId: string | null }) => task.categoryId)).toEqual(['estudo', 'casa', null])
    const notes = await read('notes/categorias.json')
    expect(notes.categories.map((category: { id: string; name: string }) => `${category.id}:${category.name}`)).toEqual(['estudo:Estudo', 'trabalho:Trabalho'])
  })

  it('antes de mexer, uma cópia de cada arquivo em .4notes/backups/1.7.0', async () => {
    const backups = (await files.list('.4notes/backups/1.7.0')).map((file) => file.name).sort()
    expect(backups).toEqual(['links-links.json', 'notes-categorias.json', 'tasks-tasks.json', 'timer-timer.json'])
    expect((await read('.4notes/backups/1.7.0/links-links.json')).folders[0].id).toBe('estudo-1')
  })

  it('"Ver categorias": onde cada uma é usada, por módulo', () => {
    const usage = Object.fromEntries(s.shared.usage('estudo').map((item) => [item.module, item.records.map((record) => record.title)]))
    expect(usage).toEqual({ notes: ['Aula 1'], links: ['Godot'], tasks: ['Ler capítulo'], timer: ['Atividade s1'], finance: [] })
    expect(s.shared.usage('estudo').find((item) => item.module === 'links')!.records[0]!.path).toBe('links/links.json#l1')
    expect(s.shared.availableFor('finance').length).toBe(4)
    expect(s.shared.availableFor('notes').map((category) => category.name).sort()).toEqual(['Casa', 'Dev'])
  })
})

describe('uma categoria criada num módulo vale nos outros', () => {
  it('categoria das Notas usada nas Finanças (e num gasto)', async () => {
    const category = s.finance.attachCategory('trabalho')!
    expect(category).toMatchObject({ id: 'trabalho', name: 'Trabalho', color: 'red' })
    const expense = s.finance.addExpense({ description: 'Almoço com cliente', amount: 4590, date: '2026-10-21', categoryId: 'trabalho' })!
    await flushAll()
    const finance = await read('finance/finance.json')
    expect(finance.categories.map((item: { id: string }) => item.id)).toEqual(['trabalho'])
    expect(finance.expenses[0]).toMatchObject({ id: expense.id, amount: 4590, categoryId: 'trabalho' })
    expect(s.shared.usage('trabalho').find((item) => item.module === 'finance')!.records.map((record) => record.detail)).toEqual([expect.stringContaining('R$ 45,90')])
  })

  it('criar com um nome que já existe no app usa aquela categoria (sem duplicar)', () => {
    const before = s.shared.state.categories.length
    const dev = s.timer.addCategory('dev', 'yellow')!
    expect(dev.id).toBe('dev')
    expect(s.shared.state.categories.length).toBe(before)
  })

  it('a categoria das Tarefas vira uma pasta nas Notas ao ser usada lá', async () => {
    const casa = await s.notes.attachCategory('casa')
    expect(casa).toMatchObject({ id: 'casa', name: 'Casa' })
    await flushAll()
    expect(await exists('notes/Casa')).toBe(true)
  })
})

describe('editar vale em todos os módulos', () => {
  it('renomear: a pasta das Notas (e a foto dela) acompanham, e as cópias dos outros módulos', async () => {
    expect(await s.shared.updateCategory('estudo', { name: 'Estudos', color: 'green' })).toBe(true)
    await flushAll()
    expect(await exists('notes/Estudos/Aula 1.md')).toBe(true)
    expect(await exists('notes/Estudo')).toBe(false)
    expect(s.notes.findCategory('Estudos')).toMatchObject({ id: 'estudo', color: 'green', image: 'Estudos.png' })
    expect(s.tasks.categoryById.value.get('estudo')).toMatchObject({ name: 'Estudos', color: 'green' })
    expect((await read('links/links.json')).folders[0]).toMatchObject({ id: 'estudo', name: 'Estudos', color: 'green' })
    expect((await read('timer/timer.json')).categories[0]).toMatchObject({ id: 'estudo', name: 'Estudos' })
    // Os links relativos da nota continuam certos (mesma profundidade de pasta)
    expect(await files.read('notes/Estudos/Aula 1.md')).toBe('# Aula 1\n![](../../attachments/x.png)')
  })

  it('nome que já existe ou que não serve para pasta: nada muda', async () => {
    expect(await s.shared.updateCategory('estudo', { name: 'casa' })).toBe(false)
    expect(await s.shared.updateCategory('estudo', { name: 'A/B' })).toBe(false)
    expect(s.shared.findCategory('estudo')!.name).toBe('Estudos')
  })
})

describe('juntar e excluir sem perder registros', () => {
  it('juntar "Casa" com "Trabalho": tarefas, notas e o lugar na lista passam para "Trabalho"', async () => {
    await files.write('notes/Casa/Lista.md', '# Lista')
    await s.notes.refreshFromDisk()
    expect(await s.shared.mergeCategories('casa', 'trabalho')).toBe(true)
    await flushAll()
    expect(s.shared.findCategory('casa')).toBeUndefined()
    expect(s.shared.state.replaced.casa).toBe('trabalho')
    const tasks = await read('tasks/tasks.json')
    expect(tasks.tasks.find((task: { id: string }) => task.id === 't2').categoryId).toBe('trabalho')
    // "Trabalho" não estava nas Tarefas: entra no lugar de "Casa"
    expect(tasks.categories.map((category: { id: string }) => category.id)).toEqual(['estudo', 'trabalho'])
    // Notas: a nota foi para a pasta de Trabalho e a pasta de Casa saiu
    expect(await exists('notes/Trabalho/Lista.md')).toBe(true)
    expect(await exists('notes/Casa')).toBe(false)
    expect(s.notes.state.categories.map((category) => category.name)).toEqual(['Estudos', 'Trabalho'])
  })

  it('excluir transferindo: os links de "Dev" vão para "Estudos"', async () => {
    expect(await s.shared.deleteCategory('dev', 'estudo')).toBe(true)
    await flushAll()
    const links = await read('links/links.json')
    expect(links.links.map((link: { folderId: string }) => link.folderId)).toEqual(['estudo', 'estudo'])
    expect(links.folders.map((folder: { id: string }) => folder.id)).toEqual(['estudo'])
    expect(s.timer.state.categories.map((category) => category.id)).toEqual(['estudo', 'trabalho'])
  })

  it('tirar só de um módulo: as sessões do Timer ficam sem categoria, as tarefas continuam', async () => {
    expect(await s.shared.removeFromModule('timer', 'estudo', null)).toBe(true)
    await flushAll()
    expect(s.shared.findCategory('estudo')).toBeDefined()
    expect(s.timer.state.sessions.map((item) => item.categoryId)).toEqual([null, 'trabalho'])
    expect(s.timer.state.categories.map((category) => category.id)).toEqual(['trabalho'])
    expect(s.tasks.findTask('t1')!.categoryId).toBe('estudo')
  })

  it('excluir deixando sem categoria: notas voltam para Notas, nada é apagado', async () => {
    expect(await s.shared.deleteCategory('trabalho', null)).toBe(true)
    await flushAll()
    expect(await exists('notes/Reunião.md')).toBe(true)
    expect(await exists('notes/Lista.md')).toBe(true)
    expect(s.tasks.findTask('t2')!.categoryId).toBeNull()
    expect(s.timer.state.sessions.map((item) => item.categoryId)).toEqual([null, null])
    expect(s.finance.state.expenses[0]!.categoryId).toBeNull()
    expect(s.shared.state.replaced).toMatchObject({ casa: null, trabalho: null, dev: 'estudo' })
  })
})

describe('arquivos vindos de outro aparelho (versão antiga)', () => {
  it('categoria juntada/excluída não volta; categoria nova entra; categorias.json sem ids é reconhecido', async () => {
    // O celular, ainda na 1.6.4, gravou o tasks.json com "Casa" (que foi juntada e depois excluída)
    // e uma categoria nova, "Viagem"; e regravou o categorias.json sem os ids
    const tasks = await read('tasks/tasks.json')
    tasks.categories.push({ id: 'casa', name: 'Casa', color: 'green' }, { id: 'viagem', name: 'Viagem', color: 'teal' })
    tasks.tasks.push({ id: 't4', title: 'Comprar passagem', categoryId: 'viagem', date: null }, { id: 't5', title: 'Velha', categoryId: 'casa', date: null })
    await files.write('tasks/tasks.json', json(tasks))
    await files.write('notes/categorias.json', json({ app: '4notes', version: 1, categories: [{ name: 'Estudos', color: 'green', icon: null, image: 'Estudos.png' }] }))
    await s.tasks.refreshFromDisk()
    await s.notes.refreshFromDisk()
    await s.shared.refreshFromDisk()
    await flushAll()
    expect(s.shared.findCategory('casa')).toBeUndefined()
    expect(s.shared.findCategory('viagem')).toMatchObject({ name: 'Viagem' })
    expect(s.tasks.findTask('t5')!.categoryId).toBeNull()
    expect(s.tasks.state.categories.map((category) => category.id)).toEqual(['estudo', 'viagem'])
    expect((await read('notes/categorias.json')).categories[0].id).toBe('estudo')
    expect(s.shared.state.categories.filter((category) => category.name === 'Estudos').length).toBe(1)
  })

  it('depois de conciliado, reler não grava nada de novo', async () => {
    const before = await files.read('categories/categories.json')
    const tasksBefore = await files.read('tasks/tasks.json')
    await s.shared.refreshFromDisk()
    await flushAll()
    await wait(300)
    expect(await files.read('categories/categories.json')).toBe(before)
    expect(await files.read('tasks/tasks.json')).toBe(tasksBefore)
  })
})
