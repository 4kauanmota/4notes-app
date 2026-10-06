// Versões de uma nota ("4notes 1.4.1" → "4notes 1.4.0" → …): a regra pura e o store
// das Notas (só a mesma categoria), com um "disco" falso na memória.
import { beforeAll, describe, expect, it } from 'vitest'
import { compareVersions, previousVersion, versionOf } from '~/lib/notes/versions'

describe('versão no título', () => {
  it('acha a última palavra que é um número de versão', () => {
    expect(versionOf('4notes 1.4.1')).toMatchObject({ parts: [1, 4, 1], label: '1.4.1' })
    expect(versionOf('Aula 3')).toMatchObject({ parts: [3], label: '3' })
    expect(versionOf('App v2.1')).toMatchObject({ parts: [2, 1], label: 'v2.1' })
    // O texto depois da versão também faz parte do nome
    expect(versionOf('4notes 1.2.0 bugs')!.key).toBe(versionOf('4notes 1.1.1 Bugs')!.key)
    expect(versionOf('4notes 1.2.0 bugs')!.key).not.toBe(versionOf('4notes 1.2.0')!.key)
  })

  it('sem nome antes ou sem número: não é versão', () => {
    expect(versionOf('1.4.1')).toBeNull()
    expect(versionOf('Ideias')).toBeNull()
    expect(versionOf('4notes beta')).toBeNull()
    expect(versionOf('')).toBeNull()
  })

  it('compara parte por parte', () => {
    expect(compareVersions([1, 10], [1, 9])).toBeGreaterThan(0)
    expect(compareVersions([1, 4], [1, 4, 0])).toBe(0)
    expect(compareVersions([1, 3, 9], [1, 4])).toBeLessThan(0)
  })

  it('a anterior é a maior versão menor que a atual, com o mesmo nome', () => {
    const titles = ['4notes 1.3.2', '4notes 1.4.0', '4notes 1.3.10', 'Outro 1.4.0', '4notes 1.5', '4notes 1.4']
    const previous = (title: string) => previousVersion(title, titles, (item) => item)?.item ?? null
    expect(previous('4notes 1.4.1')).toBe('4notes 1.4.0')
    expect(previous('4notes 1.4.0')).toBe('4notes 1.3.10')
    expect(previous('4notes 1.3.10')).toBe('4notes 1.3.2')
    expect(previous('4notes 1.3.2')).toBeNull()
    // Maiúsculas não importam
    expect(previous('4NOTES 1.6')).toBe('4notes 1.5')
    expect(previous('Ideias')).toBeNull()
  })
})

// ── No store das Notas ──────────────────────────────────────────────────────

const files = new Map<string, string>([
  ['notes/Dev/4notes 1.4.1.md', '# 4notes 1.4.1\n'],
  ['notes/Dev/4notes 1.4.0.md', '# 4notes 1.4.0\n'],
  ['notes/Dev/4notes 1.3.2.md', '# 4notes 1.3.2\n'],
  ['notes/Outra/4notes 1.3.9.md', '# 4notes 1.3.9\n'],
  ['notes/4notes 1.0.md', '# 4notes 1.0\n'],
  ['notes/Aula 3.md', '# Aula 3\n'],
  ['notes/Aula 2.md', '# Aula 2\n'],
  ['notes/Dev/Aula 4.md', '# Aula 4\n'],
])
const dirs = new Set<string>(['notes', 'notes/Dev', 'notes/Outra'])
const entry = (path: string, content: string) => ({ path, name: path.split('/').pop()!, size: content.length, mtimeMs: 1 })
const api = {
  files: {
    list: async (dir: string) => [...files].filter(([path]) => path.startsWith(`${dir}/`) && path.endsWith('.md')).map(([path, content]) => ({ ...entry(path, content), content })),
    read: async (path: string) => files.get(path) ?? null,
    write: async (path: string, content: string) => {
      files.set(path, content)
      return entry(path, content)
    },
    exists: async (path: string) => files.has(path) || dirs.has(path),
    mkdir: async (dir: string) => void dirs.add(dir),
  },
}
;(globalThis as unknown as { window: unknown }).window = { fourNotes: api }

type Store = ReturnType<(typeof import('~/stores/notes'))['useNotesStore']>
let notes: Store

beforeAll(async () => {
  notes = (await import('~/stores/notes')).useNotesStore()
  await notes.load()
})

const previousOf = (path: string) => {
  const found = notes.previousVersionOf(notes.findByPath(path)!)
  return found ? `${found.note.path} (${found.label})` : null
}

describe('versão anterior no store (mesma categoria)', () => {
  it('segue a sequência dentro da categoria', () => {
    expect(previousOf('notes/Dev/4notes 1.4.1.md')).toBe('notes/Dev/4notes 1.4.0.md (1.4.0)')
    // A 1.3.9 está em outra categoria: não conta
    expect(previousOf('notes/Dev/4notes 1.4.0.md')).toBe('notes/Dev/4notes 1.3.2.md (1.3.2)')
    // A 1.0 está sem categoria: não conta
    expect(previousOf('notes/Dev/4notes 1.3.2.md')).toBeNull()
  })

  it('sem categoria: só entre as notas sem categoria', () => {
    expect(previousOf('notes/Aula 3.md')).toBe('notes/Aula 2.md (2)')
    expect(previousOf('notes/Dev/Aula 4.md')).toBeNull()
    expect(previousOf('notes/Outra/4notes 1.3.9.md')).toBeNull()
  })

  it('nota nova (ainda sem arquivo) também acha a anterior', () => {
    const note = notes.createNote('', 'Dev')
    notes.updateContent(note.id, '# 4notes 1.5.0\n')
    expect(notes.previousVersionOf(notes.findNote(note.id)!)?.note.path).toBe('notes/Dev/4notes 1.4.1.md')
  })
})
