import { deleteCharBackward, deleteCharForward, insertNewlineAndIndent } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import {
  activeFormats,
  balancedSlice,
  canClearFormatting,
  breakOutOfTags,
  clearColor,
  clearHighlight,
  clearFormatting,
  cssColor,
  deleteBackwardAcrossTags,
  deleteForwardAcrossTags,
  findElements,
  hiddenTagEditing,
  toggleFormat,
  toggleLineFormat,
} from '~/lib/editor/formatting'

/** Editor "de mentira": só estado + dispatch (os comandos não precisam do DOM). */
function editor(doc: string, from: number, to = from) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: [markdown({ base: markdownLanguage }), hiddenTagEditing],
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
  } as unknown as EditorView
  return {
    view,
    /** Roda os comandos em sequência até um deles tratar a tecla (como o keymap). */
    press(...commands: Command[]) {
      for (const command of commands) if (command(view)) return
    },
    /** Simula digitação do usuário substituindo a seleção. */
    type(text: string) {
      view.dispatch(state.update(state.replaceSelection(text), { userEvent: 'input.type' }))
    },
    get text() {
      return state.doc.toString()
    },
    get selected() {
      const range = state.selection.main
      return state.sliceDoc(range.from, range.to)
    },
    get state() {
      return state
    },
  }
}

/** Seleciona a primeira ocorrência de `word`. */
function select(doc: string, word: string) {
  const index = doc.indexOf(word)
  return editor(doc, index, index + word.length)
}

describe('formatação inline', () => {
  it('aplica e remove negrito mantendo a seleção', () => {
    const e = select('Olá mundo', 'mundo')
    toggleFormat(e.view, 'bold')
    expect(e.text).toBe('Olá **mundo**')
    expect(e.selected).toBe('mundo')
    toggleFormat(e.view, 'bold')
    expect(e.text).toBe('Olá mundo')
  })

  it('remove só do trecho selecionado e junta trechos vizinhos', () => {
    const e = select('**olá mundo**', 'mundo')
    toggleFormat(e.view, 'bold')
    expect(e.text).toBe('**olá** mundo')

    const merge = select('**ab**cd', 'cd')
    toggleFormat(merge.view, 'bold')
    expect(merge.text).toBe('**abcd**')
  })

  it('sublinhado, tachado, marca-texto e código', () => {
    for (const [format, expected] of [
      ['underline', 'a <u>b</u> c'],
      ['strike', 'a ~~b~~ c'],
      ['highlight', 'a ==b== c'],
      ['code', 'a `b` c'],
      ['italic', 'a *b* c'],
    ] as const) {
      const e = select('a b c', 'b')
      toggleFormat(e.view, format)
      expect(e.text).toBe(expected)
      expect(activeFormats(e.state).formats.has(format)).toBe(true)
    }
  })

  it('cor do texto: aplica, troca e remove sem aninhar', () => {
    const e = select('a b c', 'b')
    toggleFormat(e.view, 'color', 'red')
    expect(e.text).toBe('a <span style="color: red">b</span> c')
    expect(activeFormats(e.state).color).toBe('red')
    toggleFormat(e.view, 'color', 'blue')
    expect(e.text).toBe('a <span style="color: blue">b</span> c')
    toggleFormat(e.view, 'color', 'blue')
    expect(e.text).toBe('a b c')

    const doc = '<span style="color: red">abc</span>'
    const c = doc.indexOf('abc') + 2
    const partial = editor(doc, c, c + 1)
    toggleFormat(partial.view, 'color', 'blue')
    expect(partial.text).toBe('<span style="color: red">ab</span><span style="color: blue">c</span>')
  })

  it('"cor padrão" tira a cor só do trecho selecionado', () => {
    const doc = 'a <span style="color: red">bcd</span> e'
    const all = editor(doc, 0, doc.length)
    clearColor(all.view)
    expect(all.text).toBe('a bcd e')

    const middle = doc.indexOf('bcd') + 1
    const part = editor(doc, middle, middle + 1)
    clearColor(part.view)
    expect(part.text).toBe('a <span style="color: red">b</span>c<span style="color: red">d</span> e')
  })

  it('trechos aninhados: tirar ou trocar um formato não deixa tags mal fechadas', () => {
    const nested = '**<span style="color: red"><u>formatar</u></span>**'
    const uncolor = select(nested, 'formatar')
    clearColor(uncolor.view)
    expect(uncolor.text).toBe('**<u>formatar</u>**')

    const recolor = select(nested, 'formatar')
    toggleFormat(recolor.view, 'color', 'blue')
    expect(recolor.text).toBe('**<u><span style="color: blue">formatar</span></u>**')

    const unbold = select('**<u>abc</u>**', 'abc')
    toggleFormat(unbold.view, 'bold')
    expect(unbold.text).toBe('<u>abc</u>')

    const partial = select('<span style="color: red">olá <u>mundo</u></span>', 'mundo')
    clearColor(partial.view)
    expect(partial.text).toBe('<span style="color: red">olá</span> <u>mundo</u>')
  })

  it('seleção de várias linhas formata cada linha', () => {
    const doc = 'linha um\n\nlinha dois'
    const e = editor(doc, 0, doc.length)
    toggleFormat(e.view, 'bold')
    expect(e.text).toBe('**linha um**\n\n**linha dois**')
    toggleFormat(e.view, 'bold')
    expect(e.text).toBe(doc)
  })

  it('sem seleção, o formato fica guardado para o que for digitado (nada de "****" no texto)', () => {
    const e = editor('abc ', 4)
    toggleFormat(e.view, 'bold')
    expect(e.text).toBe('abc ')
    expect(activeFormats(e.state).formats.has('bold')).toBe(true)
    e.type('x')
    expect(e.text).toBe('abc **x**')
    expect(e.state.selection.main.head).toBe(7) // dentro do negrito: o resto continua em negrito
    e.type('y')
    expect(e.text).toBe('abc **xy**')

    // Ctrl+B de novo desliga antes de digitar
    const off = editor('abc ', 4)
    toggleFormat(off.view, 'bold')
    toggleFormat(off.view, 'bold')
    off.type('x')
    expect(off.text).toBe('abc x')

    // Dois formatos guardados
    const two = editor('', 0)
    toggleFormat(two.view, 'bold')
    toggleFormat(two.view, 'underline')
    two.type('o')
    expect(two.text).toBe('**<u>o</u>**')
  })

  it('limpa toda a formatação', () => {
    const doc = '**a** <u>b</u> ==c== <span style="color: teal">d</span>'
    const e = editor(doc, 0, doc.length)
    clearFormatting(e.view)
    expect(e.text).toBe('a b c d')
  })

  it('limpa só o trecho selecionado (1.7.0)', () => {
    // "mundo" selecionado: "olá" continua em negrito
    const doc = '**olá mundo**'
    const e = editor(doc, doc.indexOf('mundo'), doc.indexOf('mundo') + 5)
    clearFormatting(e.view)
    expect(e.text).toBe('**olá** mundo')
    expect(e.selected).toBe('mundo')

    // Formatos aninhados e cor: tudo sai do selecionado, o resto fica
    const nested = '<span style="color: red">ab **cd** ef</span> gh'
    const n = editor(nested, nested.indexOf('cd'), nested.indexOf('ef') + 2)
    clearFormatting(n.view)
    expect(n.text).toBe('<span style="color: red">ab</span> cd ef gh')

    // Seleção que só encosta num formato vizinho não mexe nele
    const near = '**ab** cd'
    const m = editor(near, near.indexOf('cd'), near.length)
    expect(canClearFormatting(m.state)).toBe(false)
    expect(clearFormatting(m.view)).toBe(false)
    expect(m.text).toBe(near)

    // Várias linhas e itálico + sublinhado no mesmo trecho
    const lines = '*a <u>b</u>*\n==c== d'
    const l = editor(lines, 0, lines.length)
    clearFormatting(l.view)
    expect(l.text).toBe('a b\nc d')
  })

  it('"Limpar formatação" só com formatação removível na seleção (1.7.0)', () => {
    expect(canClearFormatting(editor('texto comum', 0, 5).state)).toBe(false)
    expect(canClearFormatting(editor('**negrito**', 4).state)).toBe(false) // sem seleção
    expect(canClearFormatting(editor('**negrito** e mais', 2, 6).state)).toBe(true)
    expect(canClearFormatting(editor('a ==b== c', 0, 9).state)).toBe(true)
    expect(canClearFormatting(editor('`x` y', 0, 5).state)).toBe(true)
    // Link não é formatação para limpar (o "Limpar formatação" deixa os links)
    expect(canClearFormatting(editor('[nuxt](https://nuxt.com) e', 0, 26).state)).toBe(false)
    // Link com negrito dentro: o negrito conta, o link continua
    const doc = '[**nuxt**](https://nuxt.com)'
    const e = editor(doc, 0, doc.length)
    expect(canClearFormatting(e.state)).toBe(true)
    clearFormatting(e.view)
    expect(e.text).toBe('[nuxt](https://nuxt.com)')
  })

  it('ignora marcações dentro de código', () => {
    const e = editor('`<u>a</u>` e <u>b</u>', 0)
    const formats = findElements(e.state, 0, e.state.doc.length).map((el) => el.format)
    expect(formats.sort()).toEqual(['code', 'underline'])
  })

  it('só aceita cores seguras no estilo', () => {
    expect(cssColor('red')).toBe('var(--cat-red)')
    expect(cssColor('#ff0000')).toBe('#ff0000')
    expect(cssColor('url(x)')).toBeNull()
  })
})

describe('formatação de linha', () => {
  it('lista, lista de tarefas e título', () => {
    const e = editor('a\nb', 0, 3)
    toggleLineFormat(e.view, 'bullet')
    expect(e.text).toBe('- a\n- b')
    toggleLineFormat(e.view, 'task')
    expect(e.text).toBe('- [ ] a\n- [ ] b')
    toggleLineFormat(e.view, 'task')
    expect(e.text).toBe('a\nb')

    const heading = editor('- item', 3)
    toggleLineFormat(heading.view, 'heading')
    expect(heading.text).toBe('# item')
    toggleLineFormat(heading.view, 'heading')
    expect(heading.text).toBe('item')
  })
})

describe('tags escondidas (sublinhado e cor)', () => {
  const red = (text: string) => `<span style="color: red">${text}</span>`
  const doc = `a ${red('bcd')} e`
  const at = (text: string) => doc.indexOf(text)
  const openTo = at('bcd')
  const closeFrom = openTo + 3
  const closeTo = closeFrom + '</span>'.length

  it('digitar sobre uma seleção que cruza a tag não quebra a tag', () => {
    const e = editor(doc, 0, openTo + 1)
    e.type('x')
    expect(e.text).toBe(`x${red('cd')} e`)
  })

  it('edição do usuário dentro da tag é ignorada', () => {
    const e = editor(doc, 0)
    e.view.dispatch({ changes: { from: 6, insert: 'x' }, userEvent: 'input.type' })
    expect(e.text).toBe(doc)
  })

  it('apagar todo o texto colorido some com as tags', () => {
    const e = editor(doc, openTo, closeFrom)
    e.press(deleteCharBackward)
    expect(e.text).toBe('a  e')

    const last = editor(`a ${red('b')} e`, openTo + 1)
    last.press(deleteBackwardAcrossTags, deleteCharBackward)
    expect(last.text).toBe('a  e')
  })

  it('Backspace/Delete encostados na tag apagam o caractere visível', () => {
    const start = editor(doc, openTo)
    start.press(deleteBackwardAcrossTags, deleteCharBackward)
    expect(start.text).toBe(`a${red('bcd')} e`)

    const after = editor(doc, closeTo)
    after.press(deleteBackwardAcrossTags, deleteCharBackward)
    expect(after.text).toBe(`a ${red('bc')} e`)

    const end = editor(doc, closeFrom)
    end.press(deleteForwardAcrossTags, deleteCharForward)
    expect(end.text).toBe(`a ${red('bcd')}e`)

    const before = editor(doc, 2)
    before.press(deleteForwardAcrossTags, deleteCharForward)
    expect(before.text).toBe(`a ${red('cd')} e`)
  })

  it('Backspace em "<u>|</u>" (formato ainda sem texto) apaga as tags', () => {
    const e = editor('ab<u></u>cd', 5)
    e.press(deleteBackwardAcrossTags, deleteCharBackward)
    expect(e.text).toBe('abcd')
  })

  it('Enter no meio fecha e reabre o trecho; nas pontas, sai dele', () => {
    const middle = editor(red('abcd'), red('abcd').indexOf('cd'))
    middle.press(breakOutOfTags, insertNewlineAndIndent)
    expect(middle.text).toBe(`${red('ab')}\n${red('cd')}`)

    const nested = `<u>${red('abcd')}</u>`
    const inner = editor(nested, nested.indexOf('cd'))
    inner.press(breakOutOfTags, insertNewlineAndIndent)
    expect(inner.text).toBe(`<u>${red('ab')}</u>\n<u>${red('cd')}</u>`)

    const end = editor('x <u>ab</u>y', 'x <u>ab'.length)
    end.press(breakOutOfTags, insertNewlineAndIndent)
    expect(end.text).toBe('x <u>ab</u>\ny')

    const start = editor('x<u>ab</u>', 'x<u>'.length)
    start.press(breakOutOfTags, insertNewlineAndIndent)
    expect(start.text).toBe('x\n<u>ab</u>')
  })

  it('copiar parte de um trecho leva as tags completas', () => {
    const state = editor(doc, 0).state
    expect(balancedSlice(state, 0, openTo + 1)).toBe(`a ${red('b')}`)
    expect(balancedSlice(state, openTo + 1, openTo + 2)).toBe(red('c'))
    expect(balancedSlice(state, openTo + 2, doc.length)).toBe(`${red('d')} e`)
    expect(balancedSlice(state, closeFrom, doc.length)).toBe(' e')
    expect(balancedSlice(state, 0, openTo)).toBe('a ')
    expect(balancedSlice(state, 0, doc.length)).toBe(doc)
  })

  it('formatação pela barra continua mexendo nas tags', () => {
    const e = editor(doc, openTo, closeFrom)
    toggleFormat(e.view, 'color', 'blue')
    expect(e.text).toBe(`a <span style="color: blue">bcd</span> e`)
    clearColor(e.view)
    expect(e.text).toBe('a bcd e')
  })
})

// ── 1.7.1 ──────────────────────────────────────────────────────────────────

const RED = (text: string) => `<span style="color: red">${text}</span>`
const MARK = (hex: string, text: string) => `<mark style="background-color: ${hex}">${text}</mark>`

describe('formatos dentro de listas (1.7.1)', () => {
  it('cor com o item inteiro selecionado (marcador junto): a lista continua lista', () => {
    const doc = '- item um\n- item dois'
    const whole = editor(doc, 0, doc.length)
    toggleFormat(whole.view, 'color', 'red')
    expect(whole.text).toBe(`- ${RED('item um')}\n- ${RED('item dois')}`)
    // Aplicar de novo a mesma cor tira só a cor (o marcador continua)
    toggleFormat(whole.view, 'color', 'red')
    expect(whole.text).toBe(doc)

    const line = editor(doc, 0, '- item um'.length)
    toggleFormat(line.view, 'color', 'blue')
    expect(line.text).toBe('- <span style="color: blue">item um</span>\n- item dois')
  })

  it('numeradas, tarefas, subitens, títulos e citações: só o conteúdo', () => {
    const ordered = editor('1. primeiro\n2. segundo', 0, 22)
    toggleFormat(ordered.view, 'color', 'red')
    expect(ordered.text).toBe(`1. ${RED('primeiro')}\n2. ${RED('segundo')}`)

    const task = editor('- [ ] tarefa\n- [x] feita', 0, 24)
    toggleFormat(task.view, 'color', 'green')
    expect(task.text).toBe('- [ ] <span style="color: green">tarefa</span>\n- [x] <span style="color: green">feita</span>')

    const nested = editor('- pai\n  - filho', 0, 15)
    toggleFormat(nested.view, 'bold')
    expect(nested.text).toBe('- **pai**\n  - **filho**')

    const heading = editor('# Título', 0, 8)
    toggleFormat(heading.view, 'color', 'purple')
    expect(heading.text).toBe('# <span style="color: purple">Título</span>')

    const quote = editor('> citação', 0, 9)
    toggleFormat(quote.view, 'italic')
    expect(quote.text).toBe('> *citação*')
  })

  it('seleção parcial dentro do item e só o marcador selecionado', () => {
    const doc = '- item um'
    const partial = editor(doc, 4, 6)
    toggleFormat(partial.view, 'color', 'red')
    expect(partial.text).toBe(`- it${RED('em')} um`)
    // Só o "- " selecionado: nada a formatar
    const marker = editor(doc, 0, 2)
    toggleFormat(marker.view, 'color', 'red')
    expect(marker.text).toBe(doc)
  })

  it('a cor do item é reconhecida (botão da barra) e o resto do item continua igual', () => {
    const doc = `- ${RED('item')} e **outro**`
    const e = editor(doc, 0, doc.length)
    expect(activeFormats(e.state).color).toBeNull() // só parte do item é vermelha
    const one = editor(doc, 0, `- ${RED('item')}`.length)
    expect(activeFormats(one.state).color).toBe('red')
  })
})

describe('cor do marca-texto (1.7.1)', () => {
  it('aplica, troca e tira a cor; a mesma cor de novo tira o marca-texto', () => {
    const doc = 'olá mundo'
    const e = editor(doc, 0, doc.length)
    toggleFormat(e.view, 'highlight', 'yellow')
    expect(e.text).toBe(MARK('#fef08a', 'olá mundo'))
    expect(activeFormats(e.state).highlight).toBe('yellow')
    expect(activeFormats(e.state).formats.has('highlight')).toBe(true)
    toggleFormat(e.view, 'highlight', 'blue')
    expect(e.text).toBe(MARK('#bfdbfe', 'olá mundo'))
    toggleFormat(e.view, 'highlight', 'blue')
    expect(e.text).toBe(doc)
  })

  it('o padrão continua "==…==" e a troca vale só no trecho selecionado', () => {
    const doc = '==olá mundo=='
    const e = editor(doc, 6, 11)
    expect(activeFormats(e.state).highlight).toBe('default')
    toggleFormat(e.view, 'highlight', 'pink')
    expect(e.text).toBe(`==olá== ${MARK('#fbcfe8', 'mundo')}`)
    const back = editor(MARK('#fbcfe8', 'mundo'), 0, MARK('#fbcfe8', 'mundo').length)
    toggleFormat(back.view, 'highlight', 'default')
    expect(back.text).toBe('==mundo==')
  })

  it('o atalho (sem cor) tira qualquer marca-texto; "Sem marca-texto" e "Limpar formatação" também', () => {
    const doc = MARK('#fef08a', 'abc')
    const shortcut = editor(doc, 0, doc.length)
    toggleFormat(shortcut.view, 'highlight')
    expect(shortcut.text).toBe('abc')
    const none = editor(`x ${doc} y`, 0, `x ${doc} y`.length)
    clearHighlight(none.view)
    expect(none.text).toBe('x abc y')
    const clear = editor(`**${doc}**`, 0, `**${doc}**`.length)
    expect(canClearFormatting(clear.state)).toBe(true)
    clearFormatting(clear.view)
    expect(clear.text).toBe('abc')
  })

  it('com cor do texto junto, dentro de listas e lido de arquivos escritos à mão', () => {
    const list = editor('- item', 0, 6)
    toggleFormat(list.view, 'highlight', 'green')
    toggleFormat(list.view, 'color', 'red')
    expect(list.text.startsWith('- ')).toBe(true)
    expect(findElements(list.state, 0, list.text.length).map((el) => [el.format, el.color])).toEqual(
      expect.arrayContaining([
        ['highlight', 'green'],
        ['color', 'red'],
      ]),
    )
    // Nome de cor no lugar do tom, hex desconhecido, "background:" sem "-color"
    const hand = editor('<mark style="background-color: yellow">a</mark> <mark style="background: #123456">b</mark>', 0)
    expect(findElements(hand.state, 0, hand.text.length).map((el) => el.color)).toEqual(['yellow', '#123456'])
  })
})
