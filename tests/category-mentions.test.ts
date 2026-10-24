// 1.7.1: "#" menciona uma categoria do app (ligada pelo id, não pelo nome): o texto que
// abre a lista, o link que fica na nota, o nome e a cor atuais, renomear, juntar com
// outra (o vínculo continua), "Ver menções" (notas e observações das Finanças) e a
// contagem de registros de cada categoria (Configurações › Categorias).
import { beforeAll, describe, expect, it } from 'vitest'
import { categoryQueryAt } from '~/lib/editor/mentions'
import { createMobileApi } from '~/lib/mobile/api'
import { memoryFs } from '~/lib/mobile/fs'
import { fakeNative } from '~/lib/mobile/native'
import { WorkspaceFiles } from '~/lib/mobile/workspace'
import { idMentionPath, idOf, mentionKind, mentionMarkdown, mentionTarget, relinkCategory } from '~/lib/notes/mention-links'

describe('o texto que abre a lista do "#"', () => {
  it('abre depois de espaço, no começo da linha ou de "("; não em "C#", "# título", "#12" nem com dois espaços', () => {
    expect(categoryQueryAt('Comprei #merc')).toEqual({ at: 8, query: 'merc' })
    expect(categoryQueryAt('#')).toEqual({ at: 0, query: '' })
    expect(categoryQueryAt('(ver #Casa e')).toEqual({ at: 5, query: 'Casa e' })
    expect(categoryQueryAt('Linguagem C#')).toBeNull()
    expect(categoryQueryAt('# Título')).toBeNull()
    expect(categoryQueryAt('Issue #12')).toBeNull()
    expect(categoryQueryAt('#Casa  depois')).toBeNull()
    expect(categoryQueryAt('## sub')).toBeNull()
  })
})

describe('o link da menção', () => {
  it('pelo id, no categories.json; juntar troca o destino e o texto', () => {
    const path = idMentionPath('category', 'c_mercado')
    expect(path).toBe('categories/categories.json#c_mercado')
    expect(idOf(path)).toEqual({ kind: 'category', id: 'c_mercado' })
    expect(mentionKind(path)).toBe('category')
    expect(mentionTarget('notes/Casa', '../../categories/categories.json#c_mercado')).toBe(path)
    const content = `Feira ${mentionMarkdown('notes', path, 'Mercado')} e ${mentionMarkdown('notes', idMentionPath('category', 'c_outra'), 'Outra')}`
    expect(content).toBe('Feira [Mercado](../categories/categories.json#c_mercado) e [Outra](../categories/categories.json#c_outra)')
    expect(relinkCategory(content, 'notes', 'c_mercado', 'c_compras', 'Compras')).toBe(
      'Feira [Compras](../categories/categories.json#c_compras) e [Outra](../categories/categories.json#c_outra)',
    )
    expect(relinkCategory(content, 'notes', 'c_nada', 'c_compras', 'Compras')).toBeNull()
  })
})

const ROOT = '/storage/emulated/0'
const WS = `${ROOT}/Documents/Categorias`
const disk = memoryFs(ROOT)
const files = new WorkspaceFiles(disk, WS)

let notes: ReturnType<(typeof import('~/stores/notes'))['useNotesStore']>
let finance: ReturnType<(typeof import('~/stores/finance'))['useFinanceStore']>
let tasks: ReturnType<(typeof import('~/stores/tasks'))['useTasksStore']>
let shared: ReturnType<(typeof import('~/stores/categories'))['useCategoriesStore']>
let mentions: typeof import('~/stores/mentions')

beforeAll(async () => {
  await files.write('notes/Compras.md', '# Compras\nlista')
  const api = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.7.1', test: true, fakeToday: '2026-10-23' })
  await api.dataDir.use(WS)
  const noop = () => undefined
  Object.assign(globalThis, {
    window: { fourNotes: api, addEventListener: noop, removeEventListener: noop },
    document: { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', documentElement: { style: {} }, hasFocus: () => true },
  })
  notes = (await import('~/stores/notes')).useNotesStore()
  finance = (await import('~/stores/finance')).useFinanceStore()
  tasks = (await import('~/stores/tasks')).useTasksStore()
  shared = (await import('~/stores/categories')).useCategoriesStore()
  mentions = await import('~/stores/mentions')
  await Promise.all([notes.load(), finance.load(), tasks.load()])
  await shared.load()
  mentions.installMentionTracking()
})

describe('menções "#" no app', () => {
  it('buscar e criar pela lista do "#" (a categoria nova vale no app inteiro)', () => {
    const created = mentions.categoryMentions.create('Mercado')!
    expect(created.path).toMatch(/^categories\/categories\.json#/)
    expect(created.title).toBe('Mercado')
    const id = idOf(created.path)!.id
    expect(shared.findCategory(id)).toMatchObject({ name: 'Mercado' })
    // Criar de novo com o mesmo nome (sem diferenciar maiúsculas) usa a que existe
    expect(mentions.categoryMentions.create('mercado')!.path).toBe(created.path)
    expect(mentions.categoryMentions.search('merc').map((item) => item.title)).toEqual(['Mercado'])
    expect(mentions.categoryMentions.search('xyz')).toEqual([])
  })

  it('o chip mostra o nome e a cor atuais; renomear acompanha; excluída aparece como excluída', () => {
    const category = shared.findByName('Mercado')!
    const path = idMentionPath('category', category.id)
    expect(mentions.describeMention(path)).toMatchObject({ title: 'Mercado' })
    expect(mentions.describeMention(path)?.color).toContain('--cat-')
    return shared.updateCategory(category.id, { name: 'Supermercado' }).then(() => {
      expect(mentions.describeMention(path)?.title).toBe('Supermercado')
      expect(mentions.describeMention(idMentionPath('category', 'c_nao_existe'))).toBeNull()
    })
  })

  it('juntar com outra: a menção antiga continua resolvendo (para a que ficou) e as notas passam a apontar para ela', async () => {
    const from = shared.findByName('Supermercado')!
    const to = shared.createCategory({ name: 'Compras da casa', color: 'green' })!
    const note = notes.createNote(`# Lista\nIr ao ${mentionMarkdown('notes', idMentionPath('category', from.id), 'Supermercado')} amanhã`, null)
    await notes.saveNow(note.id)
    expect(await shared.mergeCategories(from.id, to.id)).toBe(true)
    expect(shared.findCategory(from.id)).toBeUndefined()
    // O link antigo ainda abre a categoria certa
    expect(mentions.describeMention(idMentionPath('category', from.id))?.title).toBe('Compras da casa')
    // E o texto da nota passa a apontar para a que ficou
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(notes.findNote(note.id)!.content).toContain(`[Compras da casa](../categories/categories.json#${to.id})`)
  })

  it('"Ver menções" da categoria acha as notas e as observações das Finanças', async () => {
    const category = shared.findByName('Compras da casa')!
    const entry = finance.addExpense({
      description: 'Feira',
      amount: 5230,
      date: '2026-10-21',
      categoryId: null,
      notes: `Ver ${mentionMarkdown('finance', idMentionPath('category', category.id), 'Compras da casa')}`,
    })!
    const places = await mentions.findMentionPlaces(mentions.categorySubject(category))
    expect(places.map((place) => place.kind).sort()).toEqual(['expense', 'note'])
    expect(places.find((place) => place.kind === 'expense')).toMatchObject({ path: `finance/finance.json#${entry.id}`, title: 'Feira' })
  })

  it('quantos registros cada categoria tem, por módulo (Configurações › Categorias)', () => {
    const category = shared.findByName('Compras da casa')!
    finance.attachCategory(category.id)
    finance.addExpense({ description: 'Pão', amount: 900, date: '2026-10-22', categoryId: category.id })
    finance.addExpense({ kind: 'income', description: 'Reembolso', amount: 900, date: '2026-10-22', categoryId: category.id })
    tasks.attachCategory(category.id)
    tasks.addTask({ title: 'Lista do mercado', categoryId: category.id })
    const summary = shared.summaries.value.get(category.id)!
    expect(summary.modules).toEqual(expect.arrayContaining(['finance', 'tasks']))
    expect(summary.total).toBe(3)
  })
})
