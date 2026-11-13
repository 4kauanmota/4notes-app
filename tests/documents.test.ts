// 1.7.3: módulo Documentos (índice, arquivos, categorias e anotações), com o disco do
// Android na memória (a mesma API do computador).
import { beforeAll, describe, expect, it } from 'vitest'
import { documentCandidate, documentFileName } from '#shared/files'
import { addPoint, hitTest, newStroke, normalizeAnnotations, serializeAnnotations } from '~/lib/documents/annotations'
import { displayName, kindOf, matchesSearch, normalizeDocumentsFile, sortDocuments, formatSize, type StoredDocument } from '~/lib/documents/model'
import { createMobileApi } from '~/lib/mobile/api'
import { memoryFs } from '~/lib/mobile/fs'
import { fakeNative } from '~/lib/mobile/native'
import { WorkspaceFiles } from '~/lib/mobile/workspace'

const ROOT = '/storage/emulated/0'
const WS = `${ROOT}/Documents/Pessoal`
const disk = memoryFs(ROOT)
const files = new WorkspaceFiles(disk, WS)
const read = async (path: string) => JSON.parse((await files.read(path)) ?? 'null')

const PDF = new TextEncoder().encode('%PDF-1.4\n%fake\n')
const fileOf = (name: string, data: Uint8Array | string, type = '') =>
  new File([typeof data === 'string' ? new TextEncoder().encode(data) : data], name, { type })

let documents: ReturnType<(typeof import('~/stores/documents'))['useDocumentsStore']>
let shared: ReturnType<(typeof import('~/stores/categories'))['useCategoriesStore']>
let api: Awaited<ReturnType<typeof createMobileApi>>

beforeAll(async () => {
  api = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.7.3', test: true })
  await api.dataDir.use(WS)
  const noop = () => undefined
  Object.assign(globalThis, {
    window: { fourNotes: api, addEventListener: noop, removeEventListener: noop },
    document: { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', documentElement: { style: {} } },
  })
  documents = (await import('~/stores/documents')).useDocumentsStore()
  shared = (await import('~/stores/categories')).useCategoriesStore()
  await documents.load()
  await shared.load()
})

describe('nomes e tipos', () => {
  it('o nome do arquivo segue as regras do Windows; repetidos ganham (2)', () => {
    expect(documentFileName('Contrato: 2026.PDF')).toEqual({ base: 'Contrato 2026', extension: 'pdf' })
    expect(documentFileName('CON.txt')).toEqual({ base: 'CON_', extension: 'txt' })
    expect(documentFileName('semextensao')).toEqual({ base: 'semextensao', extension: '' })
    expect(documentCandidate('contrato', 'pdf', 2)).toBe('contrato (2).pdf')
  })

  it('PDF, imagem e texto abrem no app; o resto é "Arquivo"', () => {
    expect(kindOf('a.PDF')).toBe('pdf')
    expect(kindOf('foto.jpeg')).toBe('image')
    expect(kindOf('notas.md')).toBe('text')
    expect(kindOf('planilha.xlsx')).toBe('other')
    expect(displayName('contrato_aluguel.pdf')).toBe('contrato_aluguel')
    expect(formatSize(1536)).toBe('1,5 KB')
  })

  it('o documents.json é lido de forma tolerante', () => {
    const data = normalizeDocumentsFile({
      categories: [{ id: 'c1', name: 'Casa', color: 'green' }, { id: 'c1', name: 'Repetida' }, { id: 'c2', name: '' }],
      documents: [
        { id: 'd1', name: 'Ok', file: 'documents/arquivos/a.pdf', categoryId: 'c1', size: 10 },
        { id: 'd1', name: 'Repetido', file: 'documents/arquivos/b.pdf' },
        { id: 'd2', file: '../fora.pdf' },
        { id: 'd3', file: 'documents/arquivos/c.png', categoryId: 'sumiu' },
      ],
    })
    expect(data.categories.map((c) => c.name)).toEqual(['Casa'])
    expect(data.documents.map((d) => d.id)).toEqual(['d1', 'd3'])
    expect(data.documents[1]).toMatchObject({ name: 'c', kind: 'image', categoryId: null })
  })

  it('busca sem acentos e ordem', () => {
    const doc = { name: 'Certidão de nascimento', file: 'documents/arquivos/certidao.pdf', kind: 'pdf' } as StoredDocument
    expect(matchesSearch(doc, 'certidao pdf')).toBe(true)
    expect(matchesSearch(doc, 'casamento')).toBe(false)
    const list = [
      { id: 'a', name: 'B', kind: 'text', addedAt: '2026-01-02', openedAt: null },
      { id: 'b', name: 'a', kind: 'pdf', addedAt: '2026-01-01', openedAt: '2026-01-05' },
    ] as StoredDocument[]
    expect(sortDocuments(list, 'recent').map((d) => d.id)).toEqual(['b', 'a'])
    expect(sortDocuments(list, 'name').map((d) => d.id)).toEqual(['b', 'a'])
  })
})

describe('no workspace', () => {
  it('sem documentos, o documents.json nem é criado', async () => {
    await documents.flush()
    expect(await files.read('documents/documents.json')).toBeNull()
  })

  it('importar copia o arquivo para documents/arquivos/ (com nome livre) e guarda no índice', async () => {
    const added = await documents.importFiles([fileOf('Contrato.pdf', PDF), fileOf('contrato.pdf', PDF), fileOf('Leia-me.txt', 'olá\nmundo')])
    expect(added.map((doc) => doc.file)).toEqual(['documents/arquivos/Contrato.pdf', 'documents/arquivos/contrato (2).pdf', 'documents/arquivos/Leia-me.txt'])
    expect(added.map((doc) => doc.kind)).toEqual(['pdf', 'pdf', 'text'])
    expect(await files.readBytes('documents/arquivos/Contrato.pdf')).toEqual(PDF)
    const index = await read('documents/documents.json')
    expect(index.documents).toHaveLength(3)
    expect(index.documents[0]).toMatchObject({ name: 'Contrato', file: 'documents/arquivos/Contrato.pdf', kind: 'pdf', size: PDF.byteLength, categoryId: null })
    // A leitura só vale dentro de documents/
    await expect(api.documents.read('notes/x.md')).rejects.toThrow()
    expect(await documents.readText(added[2]!)).toBe('olá\nmundo')
  })

  it('categorias do app: criar, pôr vários documentos nela, filtrar; com Desfazer', async () => {
    const casa = documents.addCategory('Casa', 'green')!
    expect(shared.findCategory(casa.id)?.name).toBe('Casa')
    const ids = documents.state.documents.slice(0, 2).map((doc) => doc.id)
    expect(documents.setCategory(ids, casa.id)).toBe(2)
    documents.select(`category:${casa.id}`)
    expect(documents.visibleDocuments.value.map((doc) => doc.id).sort()).toEqual([...ids].sort())
    expect(documents.countByCategory.value.get(casa.id)).toBe(2)
    expect(documents.countByCategory.value.get('none')).toBe(1)
    documents.select('all')
    await documents.flush()
    expect((await read('documents/documents.json')).documents.filter((doc: { categoryId: string }) => doc.categoryId === casa.id)).toHaveLength(2)
  })

  it('renomear muda só o nome mostrado (o arquivo fica)', async () => {
    const doc = documents.state.documents[0]!
    expect(documents.renameDocument(doc.id, '  Contrato de aluguel  ')).toBe(true)
    expect(documents.renameDocument(doc.id, '   ')).toBe(false)
    await documents.flush()
    expect((await read('documents/documents.json')).documents[0]).toMatchObject({ name: 'Contrato de aluguel', file: 'documents/arquivos/Contrato.pdf' })
  })

  it('anotações: gravadas num arquivo próprio, lidas de volta; o PDF não muda', async () => {
    const doc = documents.state.documents[0]!
    const stroke = newStroke(1, 'pen', '#e5484d', 0.004)
    addPoint(stroke, 0.1, 0.2, 0)
    addPoint(stroke, 0.3, 0.2)
    documents.saveAnnotations(doc.id, [stroke, { id: 'n1', page: 2, tool: 'text', color: '#3b7ef0', x: 0.5, y: 0.5, size: 0.022, text: 'Conferir' }])
    await documents.flush()
    const file = await read(`documents/anotacoes/${doc.id}.json`)
    expect(file).toMatchObject({ app: '4notes', document: doc.id })
    expect(file.items).toHaveLength(2)
    expect(normalizeAnnotations(file)[0]).toMatchObject({ tool: 'pen', points: [[0.1, 0.2], [0.3, 0.2]] })
    expect(await files.readBytes(doc.file)).toEqual(PDF)
    expect(await documents.loadAnnotations(doc.id)).toHaveLength(2)
  })

  it('excluir manda o arquivo e as anotações para a lixeira do workspace e tira do índice', async () => {
    const doc = documents.state.documents[0]!
    const g = globalThis as unknown as { window: { fourNotes: unknown } }
    expect(g.window.fourNotes).toBeTruthy()
    const dialogs = (await import('~/composables/useDialog')).useDialogs().dialogs
    const done = documents.requestDelete([doc.id])
    await new Promise((resolve) => setTimeout(resolve, 0))
    dialogs.at(-1)!.resolve({ button: 'confirm', value: '' })
    expect(await done).toBe(true)
    expect(await files.exists(doc.file)).toBe(false)
    expect(await files.exists(`documents/anotacoes/${doc.id}.json`)).toBe(false)
    expect((await files.list('.4notes/trash', { recursive: true })).some((entry) => entry.name.endsWith(' Contrato.pdf'))).toBe(true)
    expect((await read('documents/documents.json')).documents.map((item: { id: string }) => item.id)).not.toContain(doc.id)
  })

  it('o arquivo mudado em outro aparelho é relido', async () => {
    const raw = await read('documents/documents.json')
    raw.documents[0].name = 'Mudado no celular'
    await files.write('documents/documents.json', JSON.stringify(raw))
    await documents.refreshFromDisk()
    expect(documents.state.documents[0]!.name).toBe('Mudado no celular')
  })

  it('excluir a categoria do app deixa os documentos sem categoria (nenhum é apagado)', async () => {
    const casa = documents.state.categories[0]!
    const count = documents.state.documents.length
    await shared.deleteCategory(casa.id, null)
    expect(documents.state.categories).toHaveLength(0)
    expect(documents.state.documents).toHaveLength(count)
    expect(documents.state.documents.every((doc) => doc.categoryId === null)).toBe(true)
  })
})

describe('anotações (regras)', () => {
  it('o traço guarda só pontos que andaram; a borracha acha o traço e o texto', () => {
    const stroke = newStroke(1, 'pen', '#1f1a2b', 0.004)
    expect(addPoint(stroke, 0.5, 0.5, 0)).toBe(true)
    expect(addPoint(stroke, 0.5001, 0.5)).toBe(false)
    addPoint(stroke, 0.6, 0.5)
    expect(hitTest(stroke, 0.55, 0.5, 0.01, 1.414)).toBe(true)
    expect(hitTest(stroke, 0.55, 0.6, 0.01, 1.414)).toBe(false)
    const note = { id: 'n', page: 1, tool: 'text' as const, color: '#1f1a2b', x: 0.2, y: 0.2, size: 0.02, text: 'Olá' }
    expect(hitTest(note, 0.21, 0.205, 0.005, 1.414)).toBe(true)
    expect(hitTest(note, 0.6, 0.6, 0.005, 1.414)).toBe(false)
  })

  it('arquivo quebrado: o que é válido fica', () => {
    const items = normalizeAnnotations({
      items: [
        { id: 'a', page: 1, tool: 'pen', color: '#e5484d', width: 0.004, points: [[0.1, 0.1], ['x', 2], [2, -1]] },
        { id: 'b', page: 0, tool: 'pen', color: '#e5484d', width: 0.004, points: [[0.1, 0.1]] },
        { id: 'c', page: 1, tool: 'text', color: 'red', x: 0.1, y: 0.1, text: 'cor inválida' },
        { id: 'd', page: 1, tool: 'mark', color: '#ffd43b', rects: [[0.1, 0.2, 0.3, 0.02]] },
      ],
    })
    expect(items.map((item) => item.id)).toEqual(['a', 'd'])
    expect(items[0]).toMatchObject({ points: [[0.1, 0.1], [1, 0]] })
    expect(JSON.parse(serializeAnnotations('d1', items)).items).toHaveLength(2)
  })
})
