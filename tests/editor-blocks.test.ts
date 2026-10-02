import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, Transaction, type Extension, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { codeBlockAt, codeBlocks, removeBlock, replaceBlockCode } from '~/lib/editor/code-blocks'
import { relativeTo, resolveFromNote } from '~/lib/files/workspace-path'
import { lineMarkerAt } from '~/lib/editor/line-markers'
import { indentListItem, listEditing, outdentListItem } from '~/lib/editor/lists'
import { toggleTaskAt } from '~/lib/editor/markdown-preview'

function stateOf(doc: string, extensions: Extension[] = []) {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), ...extensions] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

/** Editor "de mentira": só estado + dispatch (as funções testadas não usam o DOM). */
function editor(doc: string) {
  let state = stateOf(doc, [listEditing])
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
    get text() {
      return state.doc.toString()
    },
    get state() {
      return state
    },
  }
}

const markerOf = (doc: string, lineNumber = 1) => {
  const state = stateOf(doc)
  return lineMarkerAt(state, state.doc.line(lineNumber))
}

describe('marcação no começo da linha', () => {
  it('títulos, citações e listas', () => {
    expect(markerOf('# Título')).toMatchObject({ kind: 'heading', from: 0, markFrom: 0, to: 2 })
    expect(markerOf('### Seção')).toMatchObject({ kind: 'heading', to: 4 })
    expect(markerOf('> citação')).toMatchObject({ kind: 'quote', to: 2 })
    expect(markerOf('- item')).toMatchObject({ kind: 'bullet', level: 0, indent: 0, to: 2 })
    expect(markerOf('1. um')).toMatchObject({ kind: 'ordered', label: '1.', to: 3 })
  })

  it('listas aninhadas sabem o nível e a indentação', () => {
    expect(markerOf('- pai\n  - filho', 2)).toMatchObject({ kind: 'bullet', level: 1, indent: 2, markFrom: 8, to: 10 })
  })

  it('Tab aninha o item no de cima e Shift+Tab volta o nível', () => {
    const tasks = editor('- [ ] pai\n- [ ] filho')
    tasks.view.dispatch({ selection: { anchor: tasks.state.doc.length } })
    expect(indentListItem(tasks.view)).toBe(true)
    expect(tasks.text).toBe('- [ ] pai\n  - [ ] filho')
    expect(lineMarkerAt(tasks.state, tasks.state.doc.line(2))).toMatchObject({ kind: 'task', level: 1 })
    expect(outdentListItem(tasks.view)).toBe(true)
    expect(tasks.text).toBe('- [ ] pai\n- [ ] filho')

    // Lista numerada: a indentação acompanha o "1. " (3 espaços), senão não aninha; a sublista começa em 1
    const ordered = editor('1. um\n2. dois')
    ordered.view.dispatch({ selection: { anchor: ordered.state.doc.length } })
    indentListItem(ordered.view)
    expect(ordered.text).toBe('1. um\n   1. dois')
    expect(lineMarkerAt(ordered.state, ordered.state.doc.line(2))).toMatchObject({ kind: 'ordered', level: 1 })
    outdentListItem(ordered.view)
    expect(ordered.text).toBe('1. um\n2. dois')
  })

  it('o item leva os subitens junto', () => {
    const e = editor('- a\n- b\n  - b1\n  - b2\n- c')
    e.view.dispatch({ selection: { anchor: e.state.doc.line(2).to } })
    indentListItem(e.view)
    expect(e.text).toBe('- a\n  - b\n    - b1\n    - b2\n- c')
    outdentListItem(e.view)
    expect(e.text).toBe('- a\n- b\n  - b1\n  - b2\n- c')
  })

  it('no primeiro item (ou fora de listas) o Tab não aninha', () => {
    const first = editor('- a\n- b')
    expect(indentListItem(first.view)).toBe(true)
    expect(first.text).toBe('- a\n- b')
    const text = editor('Texto comum')
    expect(indentListItem(text.view)).toBe(false)
    expect(outdentListItem(first.view)).toBe(false)
  })

  it('itens de tarefa', () => {
    expect(markerOf('- [ ] comprar pão')).toMatchObject({ kind: 'task', taskFrom: 2, checked: false, to: 6 })
    expect(markerOf('- [x] feito')).toMatchObject({ kind: 'task', checked: true })
    expect(markerOf('- [X] feito')).toMatchObject({ kind: 'task', checked: true })
  })

  it('sem espaço depois da marcação (ou no meio do texto) não conta', () => {
    expect(markerOf('#Título')).toBeNull()
    expect(markerOf('-')).toBeNull()
    expect(markerOf('texto - não é lista')).toBeNull()
    expect(markerOf('Texto comum')).toBeNull()
  })
})

describe('numeração automática das listas', () => {
  /** Simula uma edição sua (com userEvent) que troca [from, to) por `insert`. */
  const edit = (e: ReturnType<typeof editor>, from: number, to: number, insert = '', userEvent = 'delete.selection') =>
    e.view.dispatch({ changes: { from, to, insert }, userEvent })
  const line = (e: ReturnType<typeof editor>, n: number) => e.state.doc.line(n)

  it('apagar o item 1 renumera os outros a partir de 1', () => {
    const e = editor('1. um\n2. dois\n3. três')
    edit(e, 0, line(e, 2).from)
    expect(e.text).toBe('1. dois\n2. três')
  })

  it('apagar um item do meio fecha o buraco', () => {
    const e = editor('1. um\n2. dois\n3. três\n4. quatro')
    edit(e, line(e, 2).from, line(e, 3).from)
    expect(e.text).toBe('1. um\n2. três\n3. quatro')
  })

  it('lista logo abaixo de um parágrafo: apagar o item 1 também renumera', () => {
    // No Markdown, "2." não começa uma lista logo depois de um parágrafo — só "1." começa
    const e = editor('Plano\n1. um\n2. dois\n3. três')
    edit(e, line(e, 2).from, line(e, 3).from)
    expect(e.text).toBe('Plano\n1. dois\n2. três')

    const marker = editor('Plano\n1. um\n2. dois\n3. três')
    edit(marker, line(marker, 2).from, line(marker, 2).from + 3, '', 'delete.backward') // tira o "1. " do primeiro item
    expect(marker.text).toBe('Plano\num\n1. dois\n2. três')
  })

  it('mantém o número inicial da lista', () => {
    const e = editor('5. a\n6. b\n7. c')
    edit(e, 0, line(e, 2).from)
    expect(e.text).toBe('5. b\n6. c')
  })

  it('inserir um item no meio empurra os seguintes', () => {
    const e = editor('1. um\n2. dois\n3. três')
    edit(e, line(e, 2).from, line(e, 2).from, '2. novo\n', 'input.paste')
    expect(e.text).toBe('1. um\n2. novo\n3. dois\n4. três')
  })

  it('trocar o número do primeiro item muda o começo da lista', () => {
    const e = editor('1. um\n2. dois\n3. três')
    edit(e, 0, 1, '4', 'input.type')
    expect(e.text).toBe('4. um\n5. dois\n6. três')
  })

  it('aninhar com Tab começa a sublista em 1 e renumera a lista de fora', () => {
    const e = editor('1. um\n2. dois\n3. três')
    e.view.dispatch({ selection: { anchor: line(e, 2).to } })
    indentListItem(e.view)
    expect(e.text).toBe('1. um\n   1. dois\n2. três')
    outdentListItem(e.view)
    expect(e.text).toBe('1. um\n2. dois\n3. três')
  })

  it('listas separadas por um parágrafo continuam separadas', () => {
    const e = editor('1. a\n2. b\n\nTexto\n\n1. c\n2. d')
    edit(e, 0, line(e, 2).from)
    expect(e.text).toBe('1. b\n\nTexto\n\n1. c\n2. d')
  })

  it('desfazer, mudanças vindas do disco e blocos de código ficam como estão', () => {
    const undo = editor('1. um\n2. dois\n3. três')
    edit(undo, 0, line(undo, 2).from, '', 'undo')
    expect(undo.text).toBe('2. dois\n3. três')

    const external = editor('1. um\n2. dois\n3. três')
    external.view.dispatch({ changes: { from: 0, to: line(external, 2).from } })
    expect(external.text).toBe('2. dois\n3. três')

    const code = editor('```\n1. a\n3. b\n```')
    edit(code, line(code, 3).to, line(code, 3).to, 'c', 'input.type')
    expect(code.text).toBe('```\n1. a\n3. bc\n```')
  })
})

describe('caixas das tarefas', () => {
  it('marca e desmarca gravando [x] / [ ]', () => {
    const e = editor('Compras\n- [ ] pão\n- [x] leite')
    expect(toggleTaskAt(e.view, e.state.doc.line(2).from)).toBe(true)
    expect(e.text).toBe('Compras\n- [x] pão\n- [x] leite')
    expect(toggleTaskAt(e.view, e.state.doc.line(3).to)).toBe(true)
    expect(e.text).toBe('Compras\n- [x] pão\n- [ ] leite')
  })

  it('linhas que não são tarefas ficam como estão', () => {
    const e = editor('Compras\n- pão')
    expect(toggleTaskAt(e.view, 0)).toBe(false)
    expect(toggleTaskAt(e.view, e.state.doc.line(2).from)).toBe(false)
    expect(e.text).toBe('Compras\n- pão')
  })
})

describe('blocos de código', () => {
  it('encontra blocos fechados com a linguagem e o trecho do código', () => {
    const state = stateOf('Antes\n```js\nconst a = 1\nconst b = 2\n```\nDepois')
    const [block] = codeBlocks(state)
    expect(block).toMatchObject({ info: 'js', empty: false, from: 6 })
    expect(state.sliceDoc(block!.codeFrom, block!.codeTo)).toBe('const a = 1\nconst b = 2')
    expect(state.sliceDoc(block!.from, block!.to)).toBe('```js\nconst a = 1\nconst b = 2\n```')
    expect(codeBlockAt(state, 0)).toBeNull()
    expect(codeBlockAt(state, block!.codeFrom)).toEqual(block)
  })

  it('bloco sem a cerca final não conta', () => {
    expect(codeBlocks(stateOf('```js\nconst a = 1'))).toEqual([])
  })

  it('a tela cheia troca só o código (também em bloco vazio)', () => {
    const e = editor('```py\nprint(1)\n```')
    replaceBlockCode(e.view, 0, 'print(2)\nprint(3)')
    expect(e.text).toBe('```py\nprint(2)\nprint(3)\n```')

    const empty = editor('```js\n```')
    expect(codeBlocks(empty.state)[0]).toMatchObject({ empty: true })
    replaceBlockCode(empty.view, 0, 'x()')
    expect(empty.text).toBe('```js\nx()\n```')
  })

  it('remover apaga o bloco inteiro sem deixar linha sobrando', () => {
    const middle = editor('a\n```js\nx\n```\nb')
    removeBlock(middle.view, codeBlocks(middle.state)[0]!)
    expect(middle.text).toBe('a\nb')

    const last = editor('a\n```js\nx\n```')
    removeBlock(last.view, codeBlocks(last.state)[0]!)
    expect(last.text).toBe('a')
  })
})

describe('caminhos das imagens', () => {
  it('caminho relativo da pasta da nota até o anexo', () => {
    expect(relativeTo('notes', 'attachments/print.png')).toBe('../attachments/print.png')
    expect(relativeTo('mindmap/Principal', 'attachments/minha imagem.png')).toBe('../../attachments/minha%20imagem.png')
    expect(relativeTo('notes', 'notes/img.png')).toBe('img.png')
  })

  it('resolve o caminho citado na nota sem sair do workspace', () => {
    expect(resolveFromNote('notes', '../attachments/print.png')).toBe('attachments/print.png')
    expect(resolveFromNote('mindmap/Principal', '../../attachments/minha%20imagem.png')).toBe('attachments/minha imagem.png')
    expect(resolveFromNote('notes', '<../attachments/a b.png>')).toBe('attachments/a b.png')
    expect(resolveFromNote('notes', '../../../segredo.png')).toBeNull()
    expect(resolveFromNote('notes', 'https://exemplo.com/a.png')).toBeNull()
    expect(resolveFromNote('notes', 'C:/imagens/a.png')).toBeNull()
    expect(resolveFromNote('notes', '/etc/a.png')).toBeNull()
  })
})
