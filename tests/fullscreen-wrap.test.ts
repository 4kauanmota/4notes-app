// 4notes 1.6.4 — "Quebrar linhas" na tela cheia dos blocos e a configuração guardada no workspace.
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { leadingColumns, lineWrap } from '~/lib/editor/line-wrap'
import { DEFAULT_NOTES_SETTINGS, normalizeNotesSettings } from '~/lib/notes/repository'

describe('quebrar linhas (tela cheia)', () => {
  it('desligada não acrescenta nada (as linhas passam da borda, como antes)', () => {
    expect(lineWrap(false, true)).toEqual([])
    expect(lineWrap(false, false)).toEqual([])
  })

  it('texto: só a quebra do editor; código: a quebra e o recuo de continuação', () => {
    expect(lineWrap(true, false)).toBe(EditorView.lineWrapping)
    const code = lineWrap(true, true)
    expect(Array.isArray(code) && code[0]).toBe(EditorView.lineWrapping)
    expect(Array.isArray(code) && code.length).toBe(2)
  })

  it('só muda a exibição: o conteúdo do bloco continua o mesmo, sem quebras novas', () => {
    const long = `const lista = [${Array.from({ length: 60 }, (_, i) => `'item${i}'`).join(', ')}]\n  return lista`
    for (const ext of [lineWrap(true, true), lineWrap(true, false), lineWrap(false, true)]) {
      const state = EditorState.create({ doc: long, extensions: ext })
      expect(state.doc.toString()).toBe(long)
      expect(state.doc.lines).toBe(2)
    }
  })

  it('recuo de continuação: espaços e tabs viram colunas; linha em branco não tem recuo', () => {
    expect(leadingColumns('if (x) {', 4)).toBe(0)
    expect(leadingColumns('    return x', 4)).toBe(4)
    expect(leadingColumns('\treturn x', 4)).toBe(4)
    expect(leadingColumns('\t  return x', 4)).toBe(6)
    expect(leadingColumns('  \t x', 4)).toBe(5)
    expect(leadingColumns('      ', 4)).toBe(0)
    expect(leadingColumns('', 4)).toBe(0)
  })
})

describe('configurações das Notas (1.6.4)', () => {
  it('padrões: pastas misturadas pela data, código sem quebra, texto com quebra (como até a 1.6.3)', () => {
    expect(DEFAULT_NOTES_SETTINGS).toMatchObject({ foldersFirst: false, wrapCode: false, wrapText: true })
    expect(normalizeNotesSettings(undefined)).toEqual(DEFAULT_NOTES_SETTINGS)
    // settings.json de uma versão anterior (sem as chaves novas)
    expect(normalizeNotesSettings({ autoCategory: true, folderCase: 'upper', titleFirstLine: false })).toEqual({
      autoCategory: true,
      folderCase: 'upper',
      titleFirstLine: false,
      foldersFirst: false,
      wrapCode: false,
      wrapText: true,
    })
  })

  it('lê as escolhas gravadas (e ignora valores estranhos)', () => {
    expect(normalizeNotesSettings({ foldersFirst: true, wrapCode: true, wrapText: false })).toMatchObject({ foldersFirst: true, wrapCode: true, wrapText: false })
    expect(normalizeNotesSettings({ foldersFirst: 'sim', wrapCode: 1, wrapText: 0 })).toMatchObject({ foldersFirst: false, wrapCode: false, wrapText: true })
  })
})
