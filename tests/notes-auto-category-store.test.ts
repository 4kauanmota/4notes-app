// Categoria automática pelo título no store das Notas, com um "disco" falso na memória.
import { beforeAll, describe, expect, it } from 'vitest'

const files = new Map<string, string>([
  ['notes/Dev/4notes 1.2.md', '# 4notes 1.2\n'],
  ['notes/categorias.json', JSON.stringify({ categories: [{ name: 'Dev', color: 'blue', image: null }] })],
])
const dirs = new Set<string>(['notes', 'notes/Dev'])
const entry = (path: string, content: string) => ({ path, name: path.split('/').pop()!, size: content.length, mtimeMs: Date.now() })
const api = {
  files: {
    list: async (dir: string) => [...files].filter(([path]) => path.startsWith(`${dir}/`) && path.endsWith('.md')).map(([path, content]) => ({ ...entry(path, content), content })),
    read: async (path: string) => files.get(path) ?? null,
    write: async (path: string, content: string) => {
      files.set(path, content)
      return entry(path, content)
    },
    rename: async (from: string, to: string) => {
      const content = files.get(from)
      if (content === undefined) throw new Error('[ENOENT] não existe')
      files.delete(from)
      files.set(to, content)
    },
    exists: async (path: string) => files.has(path) || dirs.has(path),
    trash: async (path: string) => void files.delete(path),
    mkdir: async (dir: string) => void dirs.add(dir),
    reveal: () => undefined,
  },
}
;(globalThis as unknown as { window: unknown }).window = { fourNotes: api }

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
type Store = ReturnType<(typeof import('~/stores/notes'))['useNotesStore']>
let notes: Store

beforeAll(async () => {
  notes = (await import('~/stores/notes')).useNotesStore()
  await notes.load()
})

describe('categoria automática pelo título (store)', () => {
  it('desligada: a nota nova fica sem categoria', async () => {
    const note = notes.createNote('', null, { autoCategory: true })
    notes.updateContent(note.id, '# 4notes rascunho\ntexto')
    await wait(900)
    await notes.flushAll()
    expect(notes.findNote(note.id)!.path).toBe('notes/4notes rascunho.md')
    // Ligar depois não mexe nas notas que já existiam
    notes.updateSettings({ autoCategory: true })
    notes.updateContent(note.id, '# 4notes rascunho\ntexto 2')
    await wait(900)
    await notes.flushAll()
    expect(notes.findNote(note.id)!.path).toBe('notes/4notes rascunho.md')
  })

  it('ligada: vai para a categoria em comum quando o título fica pronto — com os links acompanhando, mesmo antes de salvar', async () => {
    notes.updateSettings({ autoCategory: true })
    const note = notes.createNote('', null, { autoCategory: true })
    notes.updateContent(note.id, '# 4notes 1.3')
    expect(notes.findNote(note.id)!.dir).toBe('notes') // ainda digitando o título
    notes.updateContent(note.id, '# 4notes 1.3\n![](../attachments/x.png) e [Outra](Outra.md)\n')
    await wait(900)
    await notes.flushAll()
    const saved = notes.findNote(note.id)!
    expect(saved.dir).toBe('notes/Dev')
    expect(saved.path).toBe('notes/Dev/4notes 1.3.md')
    expect(files.get('notes/Dev/4notes 1.3.md')).toBe('# 4notes 1.3\n![](../../attachments/x.png) e [Outra](../Outra.md)\n')
  })

  it('ao sair da nota (outra aba) também decide; sem nada em comum, fica onde está', async () => {
    const first = notes.createNote('', null, { autoCategory: true })
    notes.updateContent(first.id, '# 4notes 1.4')
    await wait(900)
    expect(notes.findNote(first.id)!.path).toBe('notes/4notes 1.4.md')
    const second = notes.createNote('', null, { autoCategory: true }) // a ativa muda: "saiu" da primeira
    await wait(100)
    await notes.flushAll()
    expect(notes.findNote(first.id)!.path).toBe('notes/Dev/4notes 1.4.md')
    notes.updateContent(second.id, '# Receita\nbolo')
    await wait(900)
    await notes.flushAll()
    expect(notes.findNote(second.id)!.path).toBe('notes/Receita.md')
  })
})
