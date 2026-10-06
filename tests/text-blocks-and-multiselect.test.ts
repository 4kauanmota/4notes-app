import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, RangeSet, Transaction, type Extension, type TransactionSpec } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { codeBlocks, isTextBlock } from '~/lib/editor/code-blocks'
import { fenceFromVsCodeMode, findLanguage, isTextBlockInfo, languageLabel } from '~/lib/editor/languages'
import { multipleSelections, selectNextOccurrence } from '~/lib/editor/multi-select'
import { canWrapInTextBlock, textBlockChange } from '~/lib/editor/text-blocks'
import { noteToPlainText } from '~/lib/notes/export'

function stateOf(doc: string, selection: EditorSelection | { anchor: number; head?: number }, extensions: Extension[] = []) {
  const state = EditorState.create({ doc, selection, extensions: [markdown({ base: markdownLanguage }), ...extensions] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

/** Transforma o trecho [from, to) de `doc` num bloco de texto: devolve o texto novo e o cursor. */
function wrap(doc: string, from: number, to: number) {
  const state = stateOf(doc, { anchor: from, head: to })
  const spec = textBlockChange(state, 'notes')
  if (!spec) return null
  const next = state.update(spec).state
  return { text: next.doc.toString(), cursor: next.selection.main.head }
}

/** Posições de um trecho (a primeira vez que ele aparece). */
const range = (doc: string, text: string, occurrence = 0) => {
  let from = -1
  for (let i = 0; i <= occurrence; i++) from = doc.indexOf(text, from + 1)
  return [from, from + text.length] as const
}

describe('bloco de texto (```text)', () => {
  it('é reconhecido e fica sem linguagem (e "text" não vira LaTeX)', () => {
    expect(isTextBlockInfo('text')).toBe(true)
    expect(isTextBlockInfo(' TEXT ')).toBe(true)
    expect(isTextBlockInfo('ts')).toBe(false)
    expect(findLanguage('text')).toBeNull()
    expect(languageLabel('text')).toBe('Texto')
    expect(languageLabel('ts')).toBe('TypeScript')
    const state = stateOf('```text\nolá\n```', { anchor: 0 })
    expect(codeBlocks(state).map(isTextBlock)).toEqual([true])
  })

  it('colar nunca cria bloco de texto (o VS Code também não)', () => {
    expect(fenceFromVsCodeMode('text')).toBeNull()
    expect(fenceFromVsCodeMode('plaintext')).toBeNull()
    expect(fenceFromVsCodeMode('typescript')).toBe('typescript')
  })

  it('parte de uma linha: o texto de antes e de depois fica em linhas próprias', () => {
    const doc = 'Olá mundo bonito'
    const result = wrap(doc, ...range(doc, 'mundo'))!
    expect(result.text).toBe('Olá\n```text\nmundo\n```\nbonito')
    // Cursor no texto que sobrou, logo depois do bloco
    expect(result.text.slice(result.cursor)).toBe('bonito')
  })

  it('linha inteira e várias linhas', () => {
    expect(wrap('a\nbeta\nc', 2, 6)!.text).toBe('a\n```text\nbeta\n```\nc')
    // Seleção que termina no começo da linha seguinte (linha inteira selecionada)
    expect(wrap('a\nbeta\nc', 2, 7)!.text).toBe('a\n```text\nbeta\n```\nc')
    // No fim da nota, sobra uma linha depois do bloco para continuar escrevendo
    const result = wrap('a\nbeta', 2, 6)!
    expect(result.text).toBe('a\n```text\nbeta\n```\n')
    expect(result.cursor).toBe(result.text.length)
  })

  it('o conteúdo fica como aparece na tela (sem marcações escondidas)', () => {
    const doc = 'Texto **forte** e [link](https://nuxt.com) e <u>sub</u>'
    expect(wrap(doc, 0, doc.length)!.text).toBe('```text\nTexto forte e link e sub\n```\n')
    // Indentação e espaços do meio continuam
    const spaced = 'a\n\nfunção  com   espaços\n\tcom tab\nb'
    expect(wrap(spaced, 3, spaced.indexOf('\nb'))!.text).toBe('a\n\n```text\nfunção  com   espaços\n\tcom tab\n```\nb')
  })

  it('formatos cortados fecham antes do bloco e reabrem depois', () => {
    const doc = '**abcd**'
    expect(wrap(doc, ...range(doc, 'bc'))!.text).toBe('**a**\n```text\nbc\n```\n**d**')
    const link = 'ver [abcd](https://x.dev) já'
    expect(wrap(link, ...range(link, 'bc'))!.text).toBe('ver [a](https://x.dev)\n```text\nbc\n```\n[d](https://x.dev) já')
    // Espaço encostado no corte sai (o negrito continua válido)
    const spaced = '**ab cd ef**'
    expect(wrap(spaced, ...range(spaced, 'cd'))!.text).toBe('**ab**\n```text\ncd\n```\n**ef**')
  })

  it('listas: várias linhas desde o começo levam os marcadores; parte de um item mantém o item', () => {
    const list = '- um\n- dois\n- três'
    const [from] = range(list, 'um')
    const [, to] = range(list, 'dois')
    expect(wrap(list, from, to)!.text).toBe('```text\n• um\n• dois\n```\n- três')
    const item = '- Comprar pão'
    expect(wrap(item, ...range(item, 'Comprar'))!.text).toBe('```text\nComprar\n```\n- pão')
    expect(wrap(item, ...range(item, 'pão'))!.text).toBe('- Comprar\n```text\npão\n```\n')
    const tasks = '- [ ] fazer\n- [x] feito'
    expect(wrap(tasks, tasks.indexOf('fazer'), tasks.length)!.text).toBe('```text\n☐ fazer\n☑ feito\n```\n')
  })

  it('código dentro da seleção entra como texto; texto com ``` ganha uma cerca maior', () => {
    const doc = 'antes\n```js\nx()\n```\ndepois'
    expect(wrap(doc, 0, doc.length)!.text).toBe('```text\nantes\nx()\ndepois\n```\n')
    // "\`\`\`" aparece na tela como ``` no começo da linha
    const fences = 'a\n\\`\\`\\` b'
    const result = wrap(fences, 0, fences.length)!.text
    expect(result).toBe('````text\na\n``` b\n````\n')
    expect(codeBlocks(stateOf(result, { anchor: 0 })).length).toBe(1)
  })

  it('dentro de um bloco de código ou de texto não dá; o bloco inteiro dá', () => {
    const doc = 'a\n```js\nconst x = 1\n```\nb'
    const [from, to] = range(doc, 'const')
    expect(canWrapInTextBlock(stateOf(doc, { anchor: from, head: to }))).toBe(false)
    expect(wrap(doc, from, to)).toBeNull()
    const block = codeBlocks(stateOf(doc, { anchor: 0 }))[0]!
    expect(wrap(doc, block.from, block.to)!.text).toBe('a\n```text\nconst x = 1\n```\nb')
    // Seleção que corta um bloco leva o bloco inteiro
    expect(wrap(doc, 0, from + 3)!.text).toBe('```text\na\nconst x = 1\n```\nb')
  })

  it('sem seleção ou só com espaços: nada acontece', () => {
    expect(wrap('abc', 1, 1)).toBeNull()
    expect(wrap('a   b', 1, 4)).toBeNull()
  })

  it('o TXT exportado e o bloco usam o mesmo texto', () => {
    expect(noteToPlainText('```text\n**não é negrito**\n```\n', 'notes')).toBe('**não é negrito**\n')
  })
})

// ── Ctrl+D ──────────────────────────────────────────────────────────────────

/** Editor "de mentira" com o Ctrl+D (só estado + dispatch). */
function editor(doc: string, selection: EditorSelection | { anchor: number; head?: number }, extra: Extension[] = []) {
  let state = stateOf(doc, selection, [multipleSelections, ...extra])
  const view = {
    get state() {
      return state
    },
    dispatch(...specs: (Transaction | TransactionSpec)[]) {
      state = (specs[0] instanceof Transaction ? specs[0] : state.update(...(specs as TransactionSpec[]))).state
    },
  } as unknown as EditorView
  const ctrlD = () => selectNextOccurrence(view)
  return {
    view,
    ctrlD,
    get state() {
      return state
    },
    get selected() {
      return state.selection.ranges.map((r) => [r.from, r.to])
    },
    type(text: string) {
      view.dispatch(state.update(state.replaceSelection(text), { userEvent: 'input.type' }))
    },
  }
}

describe('Ctrl+D: próxima ocorrência', () => {
  it('acrescenta as próximas ocorrências e para quando acabam', () => {
    const doc = 'foo bar foo baz foo'
    const ed = editor(doc, { anchor: 0, head: 3 })
    expect(ed.ctrlD()).toBe(true)
    expect(ed.selected).toEqual([[0, 3], [8, 11]])
    ed.ctrlD()
    expect(ed.selected).toEqual([[0, 3], [8, 11], [16, 19]])
    ed.ctrlD()
    expect(ed.selected.length).toBe(3)
    // A última encontrada é a principal
    expect(ed.state.selection.main.from).toBe(16)
  })

  it('digitar muda todas as ocorrências juntas', () => {
    const ed = editor('foo bar foo baz foo', { anchor: 0, head: 3 })
    ed.ctrlD()
    ed.ctrlD()
    ed.type('X')
    expect(ed.state.doc.toString()).toBe('X bar X baz X')
    expect(ed.selected).toEqual([[1, 1], [7, 7], [13, 13]])
  })

  it('com texto selecionado, não diferencia maiúsculas (como o VS Code)', () => {
    const ed = editor('Nota nota NOTA', { anchor: 0, head: 4 })
    ed.ctrlD()
    ed.ctrlD()
    expect(ed.selected).toEqual([[0, 4], [5, 9], [10, 14]])
  })

  it('sem seleção: seleciona a palavra e depois só a mesma palavra inteira', () => {
    const ed = editor('foo food Foo foo', { anchor: 1 })
    ed.ctrlD()
    expect(ed.selected).toEqual([[0, 3]])
    ed.ctrlD()
    expect(ed.selected).toEqual([[0, 3], [13, 16]])
  })

  it('volta ao começo da nota depois da última', () => {
    const ed = editor('ab x ab x ab', { anchor: 5, head: 7 })
    ed.ctrlD()
    expect(ed.selected).toEqual([[5, 7], [10, 12]])
    ed.ctrlD()
    expect(ed.selected).toEqual([[0, 2], [5, 7], [10, 12]])
  })

  it('pula ocorrências escondidas (ex.: o endereço de um link), mesmo fora da tela', () => {
    // Lido do texto: o endereço do link é marcação escondida
    const link = editor('foo [x](https://foo.dev) foo', { anchor: 0, head: 3 })
    link.ctrlD()
    expect(link.selected).toEqual([[0, 3], [25, 28]])
    // E o que o editor marca como atômico na tela também fica de fora
    const doc = 'foo [x](foo.md) foo'
    const hidden = EditorView.atomicRanges.of(() => RangeSet.of([Decoration.replace({}).range(doc.indexOf('[x]'), doc.indexOf(') ') + 1)]))
    const ed = editor(doc, { anchor: 0, head: 3 }, [hidden])
    ed.ctrlD()
    expect(ed.selected).toEqual([[0, 3], [16, 19]])
  })

  it('só o Ctrl+D cria seleções extras (outros comandos continuam com uma só)', () => {
    const ed = editor('foo foo', { anchor: 0, head: 3 })
    ed.view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)], 1) })
    expect(ed.selected).toEqual([[4, 7]])
  })
})
