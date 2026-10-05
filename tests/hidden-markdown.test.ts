// Editor com o Markdown sempre escondido (1.3.0): marcações protegidas e válidas,
// formatos guardados, links, marcações de linha e blocos de código.
import { deleteCharBackward, deleteCharForward, insertNewlineAndIndent } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Transaction, type Extension, type TransactionSpec } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { backspaceInBlock, codeBlockPreview, codeBlocks, deleteNearBlock, openBlock } from '~/lib/editor/code-blocks'
import { findElements, linkDestination, linkLabel } from '~/lib/editor/elements'
import { activeFormats, normalizeLinkUrl, removeLink, setLink, toggleFormat } from '~/lib/editor/formatting'
import {
  balancedSlice,
  breakOutOfMarkup,
  deleteBackwardAcrossMarkup,
  gravityPos,
  hiddenMarkupEditing,
} from '~/lib/editor/hidden-markup'
import { deleteIntoMarkedLine, deleteLineMarker, leftOverMarker, markdownPreview } from '~/lib/editor/markdown-preview'

const md = markdown({ base: markdownLanguage, extensions: [{ remove: ['SetextHeading'] }] })

/** Editor "de mentira": estado + dispatch, com as mesmas extensões de edição do app. */
function editor(doc: string, from: number, to = from, extra: Extension[] = []) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: [md, markdownPreview, hiddenMarkupEditing, codeBlockPreview, ...extra],
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const view = {
    get state() {
      return state
    },
    dispatch(...specs: (Transaction | TransactionSpec)[]) {
      state = (specs[0] instanceof Transaction ? specs[0] : state.update(...(specs as TransactionSpec[]))).state
      ensureSyntaxTree(state, state.doc.length, 5000)
    },
    focus() {},
  } as unknown as EditorView
  return {
    view,
    press(...commands: Command[]) {
      for (const command of commands) if (command(view)) return
    },
    type(text: string) {
      view.dispatch(state.update(state.replaceSelection(text), { userEvent: 'input.type' }))
    },
    select(anchor: number, head = anchor, userEvent = 'select') {
      view.dispatch({ selection: EditorSelection.single(anchor, head), userEvent })
    },
    get text() {
      return state.doc.toString()
    },
    get head() {
      return state.selection.main.head
    },
    get state() {
      return state
    },
  }
}

/** Cursor logo depois de `text` (primeira ocorrência). */
const after = (doc: string, text: string) => doc.indexOf(text) + text.length

describe('marcações sempre escondidas: trechos e proteção', () => {
  it('links são trechos com marcação ([ e ](endereço)), menções e imagens não', () => {
    const state = editor('Veja [o site](https://nuxt.com) e ![x](a.png) e <https://vuejs.org>', 0).state
    const links = findElements(state, 0, state.doc.length).filter((el) => el.format === 'link')
    expect(links.map((el) => [state.sliceDoc(el.openTo, el.closeFrom), el.url])).toEqual([
      ['o site', 'https://nuxt.com'],
      ['https://vuejs.org', 'https://vuejs.org'],
    ])
  })

  it('digitar dentro da marcação do link é ignorado; no texto do link, funciona', () => {
    const doc = 'a [bc](https://x.com) d'
    const inside = editor(doc, doc.indexOf('https') + 2)
    inside.type('Z')
    expect(inside.text).toBe(doc)
    const text = editor(doc, after(doc, '[bc'))
    text.type('Z')
    expect(text.text).toBe('a [bcZ](https://x.com) d')
  })

  it('apagar uma seleção que cruza o link não deixa marcação pela metade', () => {
    const doc = 'abc [link](https://x.com) fim'
    const e = editor(doc, 1, doc.indexOf('nk'))
    e.press(deleteCharBackward)
    expect(e.text).toBe('a[nk](https://x.com) fim')
  })

  it('um trecho que fica sem texto some com as marcações', () => {
    const doc = 'a **b** [c](u) d'
    const bold = editor(doc, doc.indexOf('b'), doc.indexOf('b') + 1)
    bold.press(deleteCharBackward)
    expect(bold.text).toBe('a  [c](u) d')
    const link = editor(doc, doc.indexOf('[c') + 1, doc.indexOf('[c') + 2)
    link.press(deleteCharBackward)
    expect(link.text).toBe('a **b**  d')
  })
})

describe('marcações continuam valendo no Markdown', () => {
  it('espaço no fim de um negrito vai para fora, e o texto seguinte continua em negrito', () => {
    const e = editor('**olá**', 5)
    e.type(' ')
    expect(e.text).toBe('**olá** ')
    expect(e.head).toBe(8)
    e.type('m')
    expect(e.text).toBe('**olá m**')
    e.type('undo')
    expect(e.text).toBe('**olá mundo**')
  })

  it('o mesmo vale para itálico, tachado e marca-texto', () => {
    for (const [doc, end, typed] of [
      ['*ab*', 3, '*ab c*'],
      ['~~ab~~', 4, '~~ab c~~'],
      ['==ab==', 4, '==ab c=='],
    ] as const) {
      const e = editor(doc, end)
      e.type(' ')
      e.type('c')
      expect(e.text, doc).toBe(typed)
    }
  })

  it('apagar a última palavra não deixa "**olá **" (o espaço sai e o negrito continua)', () => {
    const doc = '**olá mundo**'
    const e = editor(doc, after(doc, 'mundo'))
    for (let i = 0; i < 5; i++) e.press(deleteBackwardAcrossMarkup, deleteCharBackward)
    expect(e.text).toBe('**olá** ')
    e.type('m')
    expect(e.text).toBe('**olá m**')
  })

  it('espaço no começo de um trecho vai para antes da marcação', () => {
    const e = editor('**olá**', 2)
    e.type(' ')
    expect(e.text).toBe(' **olá**')
    expect(e.head).toBe(3) // continua dentro, antes do "olá"
    e.type('x')
    expect(e.text).toBe(' **xolá**')
  })

  it('Ctrl+B no fim do negrito sai dele (o resto fica sem negrito)', () => {
    const e = editor('**ab**', 4)
    toggleFormat(e.view, 'bold')
    expect(e.head).toBe(6)
    e.type('c')
    expect(e.text).toBe('**ab**c')
  })

  it('Enter no meio de um negrito fecha e reabre o negrito', () => {
    const doc = '- **abcd**'
    const e = editor(doc, doc.indexOf('cd'))
    e.press(breakOutOfMarkup, insertNewlineAndIndent)
    expect(e.text).toBe('- **ab**\n**cd**')
  })

  it('copiar parte de um negrito ou de um link leva as marcações', () => {
    const doc = 'x **negrito** [site](https://a.b) y'
    const { state } = editor(doc, 0)
    expect(balancedSlice(state, doc.indexOf('egr'), doc.indexOf('egr') + 3)).toBe('**egr**')
    const site = doc.indexOf('site') + 1
    expect(balancedSlice(state, site, site + 2)).toBe('[it](https://a.b)')
  })
})

describe('clique e End no fim de um texto formatado', () => {
  it('logo depois de um negrito o cursor vai para dentro; depois de um link, não', () => {
    const doc = '**ab** [cd](u) <u>ef</u>'
    const { state } = editor(doc, 0)
    expect(gravityPos(state, after(doc, '**ab**'))).toBe(after(doc, '**ab'))
    expect(gravityPos(state, after(doc, '(u)'))).toBe(after(doc, '(u)'))
    expect(gravityPos(state, doc.length)).toBe(after(doc, '<u>ef'))
  })

  it('no começo da linha, antes de um trecho, entra nele', () => {
    const doc = '# **ab** c'
    expect(gravityPos(editor(doc, 0).state, 2)).toBe(4)
  })

  it('o clique (select.pointer) usa essa posição', () => {
    const e = editor('**ab** c', 0)
    e.select(6, 6, 'select.pointer')
    expect(e.head).toBe(4)
    e.type('x')
    expect(e.text).toBe('**abx** c')
  })
})

describe('links', () => {
  it('cria, troca o endereço e remove', () => {
    const doc = 'veja o site'
    const e = editor(doc, doc.indexOf('site'), doc.length)
    setLink(e.view, 'https://nuxt.com')
    expect(e.text).toBe('veja o [site](https://nuxt.com)')
    expect(activeFormats(e.state).link).toBe('https://nuxt.com')
    setLink(e.view, 'https://vuejs.org/guide')
    expect(e.text).toBe('veja o [site](https://vuejs.org/guide)')
    removeLink(e.view)
    expect(e.text).toBe('veja o site')
  })

  it('endereços e textos ficam seguros no Markdown', () => {
    expect(normalizeLinkUrl('nuxt.com/docs')).toBe('https://nuxt.com/docs')
    expect(normalizeLinkUrl('https://a.b')).toBe('https://a.b')
    expect(normalizeLinkUrl('texto qualquer')).toBeNull()
    expect(linkDestination('https://a.b/x (1).png')).toBe('https://a.b/x%20%281%29.png')
    expect(linkLabel('a [b] c')).toBe('a [b] c')
    expect(linkLabel('a ] c')).toBe('a \\] c')
  })
})

describe('marcações de linha nunca aparecem', () => {
  it('o cursor nunca fica antes da marcação (clique, setas, mudanças)', () => {
    const e = editor('# Título\n- item', 3)
    e.select(0)
    expect(e.head).toBe(2)
    e.select(9)
    expect(e.head).toBe(11)
    // Selecionar tudo continua pegando tudo
    e.select(0, e.state.doc.length)
    expect(e.state.selection.main.from).toBe(0)
  })

  it('← no começo do texto vai para a linha de cima', () => {
    const doc = 'abc\n## Seção'
    const e = editor(doc, doc.indexOf('Seção'))
    e.press(leftOverMarker(false))
    expect(e.head).toBe(3)
  })

  it('Backspace no começo do texto tira a marcação; Delete no fim da linha de cima junta sem ela', () => {
    const doc = 'abc\n# Título'
    const backspace = editor(doc, doc.indexOf('Título'))
    backspace.press(deleteLineMarker)
    expect(backspace.text).toBe('abc\nTítulo')
    const del = editor(doc, 3)
    del.press(deleteIntoMarkedLine)
    expect(del.text).toBe('abcTítulo')
  })

  it('"---" debaixo de um texto é uma linha horizontal (não um título)', () => {
    const { state } = editor('Texto\n---\n', 0)
    const names: string[] = []
    syntaxTree(state).iterate({ enter: (node) => void names.push(node.name) })
    expect(names).toContain('HorizontalRule')
    expect(names).not.toContain('SetextHeading2')
  })

  it('texto digitado encostado numa linha horizontal vai para uma linha própria', () => {
    const e = editor('---', 3)
    e.type('x')
    expect(e.text).toBe('---\nx')
  })
})

describe('blocos de código sem as cercas ```', () => {
  const doc = 'antes\n```js\nconst a = 1\n```\ndepois'

  it('as cercas não são editadas pela metade (o bloco inteiro pode sair)', () => {
    const typing = editor(doc, doc.indexOf('```js'))
    typing.view.dispatch({ changes: { from: doc.indexOf('```js'), insert: 'x' }, userEvent: 'input.type' })
    expect(typing.text).toBe(doc)
    // Seleção do meio do código até o fim: a cerca de fechamento fica
    const partial = editor(doc, doc.indexOf('= 1'), doc.length)
    partial.press(deleteCharBackward)
    expect(partial.text).toBe('antes\n```js\nconst a \n```\n')
    // Tudo selecionado: sai tudo
    const all = editor(doc, 0, doc.length)
    all.press(deleteCharBackward)
    expect(all.text).toBe('')
  })

  it('o cursor nunca fica numa cerca: entra no código ou sai do bloco', () => {
    const e = editor(doc, 3)
    e.select(doc.indexOf('```js') + 2) // descendo para a cerca de abertura
    expect(e.head).toBe(doc.indexOf('const'))
    e.select(doc.lastIndexOf('```') + 1) // descendo para a de fechamento
    expect(e.head).toBe(doc.indexOf('depois'))
    e.select(doc.lastIndexOf('```') + 1) // subindo (vindo de baixo)
    expect(e.head).toBe(after(doc, 'const a = 1'))
  })

  it('bloco no fim do documento: sair dele cria uma linha depois', () => {
    const end = '```\nx\n```'
    const e = editor(end, 4)
    e.select(end.length)
    expect(e.text).toBe(`${end}\n`)
    expect(e.head).toBe(end.length + 1)
  })

  it('Enter em "```js" cria o bloco fechado com o cursor dentro', () => {
    const e = editor('```js', 5)
    e.press(openBlock)
    expect(e.text).toBe('```js\n\n```')
    expect(e.head).toBe(6)
    expect(codeBlocks(e.state)).toHaveLength(1)
  })

  it('Backspace num bloco vazio remove o bloco; com código, não quebra a cerca', () => {
    const empty = editor('a\n```\n\n```\nb', 6)
    empty.press(backspaceInBlock)
    expect(empty.text).toBe('a\nb')
    const full = editor(doc, doc.indexOf('const'))
    full.press(backspaceInBlock, deleteCharBackward)
    expect(full.text).toBe(doc)
    const end = editor(doc, after(doc, '= 1'))
    end.press(deleteNearBlock, deleteCharForward)
    expect(end.text).toBe(doc)
  })
})
