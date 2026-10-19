/**
 * Blocos de código (```linguagem … ```) no editor. As cercas ``` nunca aparecem.
 *
 * - O bloco aparece como um cartão: cabeçalho com a linguagem e os botões Copiar,
 *   Tela cheia e Remover, e o código colorido com altura máxima (rolagem interna
 *   para códigos grandes).
 * - O código é editado ali mesmo, no editor do próprio cartão (block-editor.ts): o
 *   cartão continua do mesmo tamanho — só a tela cheia mostra o bloco inteiro. Cada
 *   mudança vai para o texto da nota (e o desfazer é o da nota).
 * - Na nota, o bloco é uma peça só: o cursor da nota pula o bloco; ↑/↓ entram nele.
 *   Uma seleção da nota que cai dentro do código (setas, desfazer, busca, Enter em
 *   ```) aparece no editor do bloco.
 * - Digitar ``` (ou ```linguagem) numa linha e apertar Enter cria um bloco — ou o botão
 *   "Bloco de código" da barra de formatação, com o trecho selecionado (text-blocks.ts).
 *   A linguagem muda pelo nome dela no cabeçalho. Backspace num bloco vazio o remove.
 * - Blocos de texto (```text, criados pela barra de formatação — text-blocks.ts) usam
 *   o mesmo cartão, mas com a fonte do texto, linhas que quebram e sem linguagem.
 * - O nome no cabeçalho também troca o tipo do bloco (1.6.3): texto ↔ código, com a
 *   linguagem escolhida (o cartão é refeito com o editor do tipo novo).
 * - O arquivo continua sendo Markdown comum.
 */
import { redo, undo } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import { Annotation, EditorSelection, EditorState, Prec, StateField, Transaction, type ChangeSpec, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type Command, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { ICONS, iconSvg } from '../icons'
import { BLOCK_EDITOR_CLASS, BlockEditor, type BlockEditorHost } from './block-editor'
import { editorHost } from './host'
import { isTextBlockInfo, languageLabel } from './languages'

export interface CodeBlock {
  /** Começo da linha da cerca de abertura. */
  from: number
  /** Fim da linha da cerca de abertura. */
  openTo: number
  /** Começo da linha da cerca de fechamento. */
  closeFrom: number
  /** Fim da linha da cerca de fechamento. */
  to: number
  /** Texto depois da cerca (```ts → "ts"). */
  info: string
  /** Trecho do código (entre as linhas das cercas). */
  codeFrom: number
  codeTo: number
  /** Bloco sem nenhuma linha de código ("```js" seguido de "```"). */
  empty: boolean
}

/** Mudança feita pelo próprio editor nas cercas (criar, remover, trocar a linguagem). */
const fenceEdit = Annotation.define<boolean>()

/** Mudança (ou seleção) que veio do editor de dentro do bloco: não volta para ele. */
const fromBlockEditor = Annotation.define<boolean>()

/** Nós que nunca contêm blocos de código (não precisa olhar dentro). */
const SKIP = new Set(['Paragraph', 'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6', 'HTMLBlock', 'CodeBlock', 'Table'])

/** Linha que pode ser uma cerca (``` ou ~~~). */
const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/

/** Blocos de código fechados do documento (um bloco sem a cerca final não conta). */
export function codeBlocks(state: EditorState): CodeBlock[] {
  const blocks: CodeBlock[] = []
  const { doc } = state
  syntaxTree(state).iterate({
    enter: (node) => {
      if (SKIP.has(node.name)) return false
      if (node.name !== 'FencedCode') return
      const marks = node.node.getChildren('CodeMark')
      const open = doc.lineAt(node.from)
      const close = doc.lineAt(node.to)
      if (marks.length < 2 || close.number === open.number) return false
      const info = node.node.getChild('CodeInfo')
      const empty = close.number === open.number + 1
      blocks.push({
        from: open.from,
        openTo: open.to,
        closeFrom: close.from,
        to: close.to,
        info: info ? state.sliceDoc(info.from, info.to) : '',
        codeFrom: open.to + 1,
        codeTo: empty ? open.to + 1 : close.from - 1,
        empty,
      })
      return false
    },
  })
  return blocks
}

export function codeBlockAt(state: EditorState, pos: number): CodeBlock | null {
  return codeBlocks(state).find((block) => block.from <= pos && pos <= block.to) ?? null
}

/** Bloco de texto (```text): sem linguagem, conteúdo exatamente como está. */
export const isTextBlock = (block: CodeBlock) => isTextBlockInfo(block.info)

/** Troca o código de um bloco (usado pela tela cheia). */
export function replaceBlockCode(view: EditorView, at: number, code: string): void {
  const block = codeBlockAt(view.state, at)
  if (!block) return
  const insert = block.empty ? (code ? `${code}\n` : '') : code
  if (view.state.sliceDoc(block.codeFrom, block.codeTo) === insert) return
  view.dispatch({ changes: { from: block.codeFrom, to: block.codeTo, insert }, userEvent: 'input.code', annotations: fenceEdit.of(true) })
}

/** Remove o bloco inteiro (com a quebra de linha que sobra). */
export function removeBlock(view: EditorView, block: CodeBlock): void {
  const { doc } = view.state
  let from = block.from
  let to = block.to
  if (to < doc.length) to += 1
  else if (from > 0) from -= 1
  view.dispatch({ changes: { from, to }, userEvent: 'delete.codeblock', scrollIntoView: true, annotations: fenceEdit.of(true) })
}

/** Troca a linguagem do bloco (o texto depois da cerca de abertura). */
export function setBlockLanguage(view: EditorView, at: number, info: string): void {
  const block = codeBlockAt(view.state, at)
  if (!block) return
  const fence = FENCE_LINE.exec(view.state.sliceDoc(block.from, block.openTo))
  if (!fence) return
  const from = block.from + fence[0].length
  const value = info.trim().replace(/\s+/g, '-').replace(/[`~]/g, '')
  if (view.state.sliceDoc(from, block.openTo) === value) return
  view.dispatch({ changes: { from, to: block.openTo, insert: value }, userEvent: 'input.code', annotations: fenceEdit.of(true) })
}

// ── Desenho ──────────────────────────────────────────────────────────────────

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

const ACTIONS = [
  { action: 'copy', icon: 'copy', tip: 'Copiar código' },
  { action: 'expand', icon: 'expand', tip: 'Abrir em tela cheia' },
  { action: 'remove', icon: 'trash', tip: 'Remover bloco de código' },
] as const

const TEXT_ACTIONS = [
  { action: 'copy', icon: 'copy', tip: 'Copiar texto' },
  { action: 'expand', icon: 'expand', tip: 'Abrir em tela cheia' },
  { action: 'remove', icon: 'trash', tip: 'Remover bloco de texto' },
] as const

function header(info: string): HTMLElement {
  const head = el('div', 'cm-codeblock-head')
  const text = isTextBlockInfo(info)
  // O nome do bloco é um botão: troca a linguagem e o tipo (texto ↔ código)
  const label = el('button', text ? 'cm-codeblock-lang cm-codeblock-kind' : 'cm-codeblock-lang')
  label.type = 'button'
  label.dataset.action = 'language'
  label.dataset.tip = text ? 'Trocar para bloco de código' : 'Trocar a linguagem (ou para texto)'
  label.dataset.tipPos = 'top'
  if (text) label.innerHTML = iconSvg('text-block', 13)
  label.append(languageLabel(info))
  label.insertAdjacentHTML('beforeend', iconSvg('chevron-down', 12))
  const actions = el('span', 'cm-codeblock-actions')
  for (const { action, icon, tip } of text ? TEXT_ACTIONS : ACTIONS) {
    const button = el('button', 'cm-codeblock-btn')
    button.type = 'button'
    button.dataset.action = action
    button.dataset.tip = tip
    button.dataset.tipPos = 'top'
    button.setAttribute('aria-label', tip)
    button.innerHTML = iconSvg(icon, 15)
    actions.append(button)
  }
  head.append(label, el('span', 'cm-codeblock-spacer'), actions)
  return head
}

/** Os editores dos cartões na tela (pelo elemento do cartão). */
const blockEditors = new Map<HTMLElement, BlockEditor>()

class CodeBlockWidget extends WidgetType {
  constructor(
    readonly info: string,
    readonly code: string,
  ) {
    super()
  }
  override eq(other: CodeBlockWidget): boolean {
    return other.info === this.info && other.code === this.code
  }
  toDOM(view: EditorView): HTMLElement {
    const text = isTextBlockInfo(this.info)
    // Espaçamento por padding (margens em widgets de bloco atrapalham a medição do editor)
    const wrap = el('div', text ? 'cm-codeblock cm-textblock' : 'cm-codeblock')
    const card = el('div', 'cm-codeblock-card')
    const body = el('div', 'cm-codeblock-body')
    card.append(header(this.info), body)
    wrap.append(card)
    blockEditors.set(wrap, new BlockEditor(body, this.info, this.code, blockHost(view, wrap)))
    return wrap
  }
  /** O código ou a linguagem mudaram: o mesmo cartão (o editor de dentro continua, com o cursor). */
  override updateDOM(dom: HTMLElement): boolean {
    const editor = blockEditors.get(dom)
    if (!editor || isTextBlockInfo(editor.info) !== isTextBlockInfo(this.info)) return false
    if (editor.info !== this.info) {
      const old = dom.querySelector('.cm-codeblock-head')
      if (old) old.replaceWith(header(this.info))
      editor.setInfo(this.info)
    }
    editor.setCode(this.code)
    return true
  }
  override destroy(dom: HTMLElement): void {
    blockEditors.get(dom)?.destroy()
    blockEditors.delete(dom)
  }
  override get estimatedHeight(): number {
    return Math.min(this.code.split('\n').length, 18) * 21 + 58
  }
  /** Os eventos do editor de dentro são dele; os do cabeçalho, da nota (codeBlockEvents). */
  override ignoreEvent(event: Event): boolean {
    const target = event.target instanceof Element ? event.target : (event.target as Node | null)?.parentElement
    return !!target?.closest(`.${BLOCK_EDITOR_CLASS}`)
  }
}

const hidden = Decoration.replace({})

function buildDecorations(state: EditorState): { decorations: DecorationSet; atoms: DecorationSet } {
  const ranges: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  for (const block of codeBlocks(state)) {
    const code = state.sliceDoc(block.codeFrom, block.codeTo)
    ranges.push(Decoration.replace({ widget: new CodeBlockWidget(block.info, code), block: true }).range(block.from, block.to))
    atoms.push(hidden.range(block.from, block.to))
  }
  return { decorations: Decoration.set(ranges, true), atoms: Decoration.set(atoms, true) }
}

const codeBlockField = StateField.define<{ decorations: DecorationSet; atoms: DecorationSet }>({
  create: (state) => buildDecorations(state),
  update(value, tr) {
    const changed = tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)
    return changed ? buildDecorations(tr.state) : value
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atoms),
  ],
})

// ── A ponte entre a nota e o editor de cada bloco ───────────────────────────

/** O bloco do cartão `wrap`, no texto atual da nota. */
function blockOf(view: EditorView, wrap: HTMLElement): CodeBlock | null {
  if (!wrap.isConnected) return null
  try {
    return codeBlockAt(view.state, view.posAtDOM(wrap))
  } catch {
    return null
  }
}

/** Uma cerca maior quando o código passa a ter uma linha que fecharia o bloco antes da hora. */
function longerFences(state: EditorState, block: CodeBlock, code: string): ChangeSpec[] {
  const open = /^(\s{0,3})(`{3,}|~{3,})/.exec(state.sliceDoc(block.from, block.openTo))
  const close = /^(\s{0,3})(`{3,}|~{3,})/.exec(state.sliceDoc(block.closeFrom, block.to))
  if (!open || !close) return []
  const mark = open[2]![0]!
  let longest = 0
  const fence = mark === '`' ? /^ {0,3}(`{3,})/gm : /^ {0,3}(~{3,})/gm
  for (const match of code.matchAll(fence)) longest = Math.max(longest, match[1]!.length)
  if (longest < open[2]!.length) return []
  const next = mark.repeat(longest + 1)
  const openAt = block.from + open[1]!.length
  const closeAt = block.closeFrom + close[1]!.length
  return [
    { from: openAt, to: openAt + open[2]!.length, insert: next },
    { from: closeAt, to: closeAt + close[2]!.length, insert: next },
  ]
}

function blockHost(view: EditorView, wrap: HTMLElement): BlockEditorHost {
  return {
    changed(tr: Transaction) {
      const block = blockOf(view, wrap)
      if (!block) return
      const code = tr.state.doc.toString()
      const changes: ChangeSpec[] = []
      if (block.empty) {
        // Bloco sem nenhuma linha: o código entra com a quebra de linha antes da cerca final
        if (code) changes.push({ from: block.codeFrom, insert: `${code}\n` })
      } else {
        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          changes.push({ from: block.codeFrom + fromA, to: block.codeFrom + toA, insert: inserted.toString() })
        })
      }
      const all = [...changes, ...longerFences(view.state, block, code)]
      // Onde o código começa depois da mudança (a cerca de abertura pode ter crescido)
      const codeFrom = view.state.changes(all).mapPos(block.codeFrom, -1)
      const { main } = tr.state.selection
      view.dispatch({
        changes: all,
        selection: EditorSelection.single(codeFrom + main.anchor, codeFrom + main.head),
        userEvent: tr.annotation(Transaction.userEvent) ?? 'input',
        annotations: [fenceEdit.of(true), fromBlockEditor.of(true)],
      })
    },
    selected(selection) {
      const block = blockOf(view, wrap)
      if (!block || block.empty) return
      const { main } = selection
      const length = block.codeTo - block.codeFrom
      view.dispatch({
        selection: EditorSelection.single(block.codeFrom + Math.min(main.anchor, length), block.codeFrom + Math.min(main.head, length)),
        annotations: fromBlockEditor.of(true),
      })
    },
    undo: () => undo(view),
    redo: () => redo(view),
    exit(side) {
      const block = blockOf(view, wrap)
      if (!block) return
      const { doc } = view.state
      let insert: { at: number; text: string } | null = null
      let target: number
      if (side === 'before') {
        if (block.from > 0) target = block.from - 1
        else {
          // Bloco no começo da nota: uma linha vazia antes dele, para dar onde escrever
          insert = { at: 0, text: '\n' }
          target = 0
        }
      } else if (block.to < doc.length) {
        target = block.to + 1
      } else {
        // Bloco no fim da nota: uma linha vazia depois dele
        insert = { at: doc.length, text: '\n' }
        target = doc.length + 1
      }
      view.dispatch({
        changes: insert ? { from: insert.at, insert: insert.text } : undefined,
        selection: EditorSelection.cursor(target, side === 'before' ? -1 : 1),
        annotations: [fenceEdit.of(true), fromBlockEditor.of(true)],
        userEvent: 'select',
        scrollIntoView: true,
      })
      view.focus()
    },
    removeEmpty() {
      const block = blockOf(view, wrap)
      if (!block) return
      const { doc } = view.state
      const to = block.to < doc.length ? block.to + 1 : block.to
      view.dispatch({
        changes: { from: block.from, to },
        selection: EditorSelection.cursor(block.from),
        userEvent: 'delete.codeblock',
        annotations: [fenceEdit.of(true), fromBlockEditor.of(true)],
      })
      view.focus()
    },
    openSearch: () => openSearchPanel(view),
  }
}

/** O editor do cartão que começa em `from` (só os cartões na tela existem). */
function editorAt(view: EditorView, from: number): BlockEditor | null {
  for (const [wrap, editor] of blockEditors) {
    if (!view.contentDOM.contains(wrap)) continue
    const block = blockOf(view, wrap)
    if (block?.from === from) return editor
  }
  return null
}

/**
 * Seleção da nota que caiu dentro do código de um bloco (↑/↓ entrando, Enter em
 * "```", desfazer, a busca…): aparece no editor do bloco — com o foco, se a nota
 * estava com ele.
 */
const revealInBlocks = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (!update.selectionSet || update.transactions.some((tr) => tr.annotation(fromBlockEditor))) return
      const { selection } = update.state
      const { main } = selection
      const block = codeBlocks(update.state).find((b) => !b.empty && b.codeFrom <= main.from && main.to <= b.codeTo)
      if (!block) return
      const inside = selection.ranges.filter((range) => block.codeFrom <= range.from && range.to <= block.codeTo)
      const ranges = inside.map((range) => ({ anchor: range.anchor - block.codeFrom, head: range.head - block.codeFrom }))
      const mainIndex = inside.indexOf(main)
      const focus = update.view.hasFocus
      if (this.timer) clearTimeout(this.timer)
      // Depois de a nota terminar de desenhar (o cartão pode ter acabado de aparecer)
      const show = (tries: number) => {
        this.timer = null
        const editor = editorAt(this.view, block.from)
        if (editor) {
          editor.select(ranges, mainIndex, focus || editor.view.hasFocus)
          return
        }
        if (tries <= 0 || block.from > this.view.state.doc.length) return
        // Fora da tela: rola até o bloco e tenta de novo
        this.view.dispatch({ effects: EditorView.scrollIntoView(block.from, { y: 'center' }) })
        this.timer = setTimeout(() => show(tries - 1), 60)
      }
      this.timer = setTimeout(() => show(3), 0)
    }
    destroy() {
      if (this.timer) clearTimeout(this.timer)
    }
  },
)

// ── As cercas nunca são editadas pela metade ─────────────────────────────────

const isUserEdit = (tr: Transaction) =>
  (tr.isUserEvent('input') && !tr.isUserEvent('input.format')) || tr.isUserEvent('delete') || tr.isUserEvent('move')

/**
 * Digitar, colar ou apagar não mexe nas cercas (nem nas quebras de linha em volta
 * delas), a não ser que o bloco inteiro seja apagado de uma vez.
 */
const protectFences = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged || !isUserEdit(tr) || tr.annotation(fenceEdit)) return true
  const changed: [number, number][] = []
  tr.changes.iterChangedRanges((fromA, toA) => changed.push([fromA, toA]))
  const { doc } = tr.startState
  const near = (from: number, to: number) => changed.some(([a, b]) => a <= to && b >= from)
  // Só olha os blocos quando alguma mudança alcança uma linha de cerca (ou a vizinha dela)
  const touchesFence = changed.some(([a, b]) => {
    const last = Math.min(doc.lines, doc.lineAt(b).number + 1)
    for (let n = Math.max(1, doc.lineAt(a).number - 1); n <= last; n++) if (FENCE_LINE.test(doc.line(n).text)) return true
    return false
  })
  if (!touchesFence) return true
  const ranges: number[] = []
  for (const block of codeBlocks(tr.startState)) {
    if (!near(block.from - 1, block.to + 1)) continue
    if (changed.some(([a, b]) => a <= block.from && b >= block.to)) continue // o bloco inteiro sai
    ranges.push(Math.max(0, block.from - 1), Math.min(doc.length, block.openTo + 1))
    ranges.push(Math.max(0, block.closeFrom - 1), Math.min(doc.length, block.to + 1))
  }
  return ranges.length ? ranges : true
})

// ── O cursor nunca fica numa cerca ───────────────────────────────────────────

/**
 * Cursor que caiu numa linha de cerca vai para o código (vindo de fora) ou para fora
 * do bloco (saindo dele). Bloco no começo ou no fim do documento: ganha uma linha
 * vazia antes/depois, para dar onde escrever.
 */
const keepCursorOutOfFences = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection && !tr.docChanged) return tr
  if (tr.annotation(fenceEdit) && !tr.selection) return tr
  const state = tr.state
  const { main } = state.selection
  if (state.selection.ranges.length !== 1 || !main.empty) return tr
  const head = main.head
  const line = state.doc.lineAt(head)
  if (!FENCE_LINE.test(line.text)) return tr
  const block = codeBlocks(state).find((b) => (b.from === line.from || b.to === line.to) && b.from <= head && head <= b.to)
  if (!block) return tr
  const previous = tr.changes.mapPos(tr.startState.selection.main.head, 1)
  const forward = head >= previous
  const opening = line.from === block.from
  const { doc } = state
  let target: number
  let insert: { at: number; text: string } | null = null
  if (opening && (forward || block.from > 0)) {
    if (!forward) target = block.from - 1
    else if (block.empty) {
      insert = { at: block.openTo, text: '\n' }
      target = block.openTo + 1
    } else target = block.codeFrom
  } else if (opening) {
    // Bloco no começo do documento, voltando: uma linha vazia antes dele
    insert = { at: 0, text: '\n' }
    target = 0
  } else if (!forward) {
    if (block.empty) {
      insert = { at: block.openTo, text: '\n' }
      target = block.openTo + 1
    } else target = block.codeTo
  } else if (block.to < doc.length) {
    target = block.to + 1
  } else {
    // Bloco no fim do documento, saindo: uma linha vazia depois dele
    insert = { at: doc.length, text: '\n' }
    target = doc.length + 1
  }
  return [
    tr,
    {
      changes: insert ? { from: insert.at, insert: insert.text } : undefined,
      selection: EditorSelection.cursor(target, forward ? -1 : 1),
      annotations: fenceEdit.of(true),
      sequential: true,
    },
  ]
})

// ── Teclas ───────────────────────────────────────────────────────────────────

const FENCE_TYPED = /^(\s{0,3})(`{3,}|~{3,})([^`~\s]*)\s*$/

/** Enter numa linha "```" (ou "```js"): cria o bloco já fechado, com o cursor dentro. */
export const openBlock: Command = (view) => {
  const { state } = view
  const { main } = state.selection
  if (state.selection.ranges.length !== 1 || !main.empty) return false
  const line = state.doc.lineAt(main.head)
  const match = FENCE_TYPED.exec(line.text)
  if (!match || main.head !== line.to) return false
  // Só se a cerca ainda não estiver fechada (senão é a cerca de fechamento de um bloco)
  let unclosed = false
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name === 'FencedCode' && node.from === line.from + match[1]!.length) {
        unclosed = node.node.getChildren('CodeMark').length < 2
        return false
      }
    },
  })
  const plain = !codeBlockAt(state, line.from)
  if (!unclosed && !plain) return false
  const [, indent, fence] = match
  const insert = `\n${indent}\n${indent}${fence}`
  view.dispatch({
    changes: { from: line.to, insert },
    selection: EditorSelection.cursor(line.to + 1 + indent!.length),
    userEvent: 'input.type',
    annotations: fenceEdit.of(true),
    scrollIntoView: true,
  })
  return true
}

/**
 * ↑/↓ na linha logo antes/depois de um bloco fechado (cartão): entra no código
 * (primeira linha descendo, última subindo) em vez de pular o bloco inteiro.
 */
function arrowIntoBlock(forward: boolean): Command {
  return (view) => {
    const { state } = view
    const range = state.selection.main
    if (state.selection.ranges.length !== 1 || !range.empty) return false
    const line = state.doc.lineAt(range.head)
    // Linha quebrada em várias na tela: primeiro anda dentro dela
    if (state.doc.lineAt(view.moveVertically(range, forward).head).number === line.number) return false
    const number = line.number + (forward ? 1 : -1)
    if (number < 1 || number > state.doc.lines) return false
    const next = state.doc.line(number)
    const block = codeBlocks(state).find((b) => !b.empty && (forward ? b.from === next.from : b.to === next.to))
    if (!block) return false
    view.dispatch({ selection: EditorSelection.cursor(forward ? block.codeFrom : block.codeTo, forward ? 1 : -1), scrollIntoView: true, userEvent: 'select' })
    return true
  }
}

/** Backspace no começo do código: num bloco vazio, remove o bloco; senão, não faz nada (não quebra a cerca). */
export const backspaceInBlock: Command = (view) => {
  const { state } = view
  const { main } = state.selection
  if (state.selection.ranges.length !== 1 || !main.empty) return false
  const block = codeBlocks(state).find((b) => !b.empty && b.codeFrom === main.head)
  if (block) {
    if (!state.sliceDoc(block.codeFrom, block.codeTo).trim()) {
      const { doc } = state
      const from = block.from
      const to = block.to < doc.length ? block.to + 1 : block.to
      view.dispatch({ changes: { from, to }, selection: EditorSelection.cursor(from), userEvent: 'delete.codeblock', annotations: fenceEdit.of(true) })
    }
    return true
  }
  // Começo da linha logo depois de um bloco: linha vazia sai; o cursor entra no fim do código
  const line = state.doc.lineAt(main.head)
  if (main.head !== line.from || line.number === 1) return false
  const after = codeBlocks(state).find((b) => b.to === line.from - 1)
  if (!after) return false
  view.dispatch({
    changes: line.length === 0 ? { from: after.to, to: line.from } : undefined,
    selection: EditorSelection.cursor(after.empty ? after.openTo : after.codeTo, -1),
    userEvent: 'delete.backward',
    annotations: fenceEdit.of(true),
  })
  return true
}

/** Delete no fim do código não junta a cerca ao código; numa linha vazia logo antes de um bloco, apaga a linha. */
export const deleteNearBlock: Command = (view) => {
  const { state } = view
  const { main } = state.selection
  if (state.selection.ranges.length !== 1 || !main.empty) return false
  const blocks = codeBlocks(state)
  if (blocks.some((b) => !b.empty && b.codeTo === main.head)) return true
  const line = state.doc.lineAt(main.head)
  if (main.head !== line.to) return false
  const before = blocks.find((b) => b.from === line.to + 1)
  if (!before) return false
  if (line.length === 0) {
    const changes = line.from > 0 ? { from: line.from - 1, to: line.to } : { from: 0, to: 1 }
    view.dispatch({ changes, userEvent: 'delete.forward', annotations: fenceEdit.of(true) })
  }
  return true
}

// ── Cliques ──────────────────────────────────────────────────────────────────

/** Troca o desenho do ícone do botão (o mesmo <svg>: a animação do clique continua nele). */
function setButtonIcon(button: HTMLElement, name: string): void {
  const svg = button.querySelector('svg')
  if (svg) svg.innerHTML = ICONS[name] ?? ''
  else button.innerHTML = iconSvg(name, 15)
}

function flashCopied(button: HTMLElement): void {
  button.classList.add('done')
  setButtonIcon(button, 'check')
  setTimeout(() => {
    button.classList.remove('done')
    setButtonIcon(button, 'copy')
  }, 1400)
}

function runAction(view: EditorView, block: CodeBlock, action: string, button: HTMLElement): void {
  const code = view.state.sliceDoc(block.codeFrom, block.codeTo)
  const host = view.state.facet(editorHost)
  if (action === 'copy') {
    void navigator.clipboard.writeText(code).then(() => flashCopied(button))
  } else if (action === 'expand') {
    host?.openCode({ code, info: block.info, apply: (next) => replaceBlockCode(view, block.from, next) })
  } else if (action === 'remove') {
    removeBlock(view, block)
    host?.notify(isTextBlock(block) ? 'Bloco de texto removido' : 'Bloco de código removido', () => undo(view))
  } else if (action === 'language') {
    const at = block.from
    void host?.chooseLanguage?.(block.info).then((info) => {
      if (info !== null && info !== undefined) setBlockLanguage(view, at, info)
      view.focus()
    })
  }
}

/**
 * Cliques no cartão fora do código (o código é do editor de dentro — ver
 * CodeBlockWidget.ignoreEvent): os botões do cabeçalho; o resto não mexe no cursor.
 */
const codeBlockEvents = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement
    const widget = target.closest?.('.cm-codeblock') as HTMLElement | null
    if (!widget || event.button !== 0) return false
    const block = codeBlockAt(view.state, view.posAtDOM(widget))
    if (!block) return false
    event.preventDefault()
    const button = target.closest('[data-action]') as HTMLElement | null
    if (button) runAction(view, block, button.dataset.action ?? '', button)
    return true
  },
})

export const codeBlockPreview: Extension = [
  codeBlockField,
  protectFences,
  keepCursorOutOfFences,
  codeBlockEvents,
  revealInBlocks,
  Prec.highest(
    keymap.of([
      { key: 'Enter', run: openBlock },
      { key: 'Backspace', run: backspaceInBlock },
      { key: 'Delete', run: deleteNearBlock },
      { key: 'ArrowDown', run: arrowIntoBlock(true) },
      { key: 'ArrowUp', run: arrowIntoBlock(false) },
    ]),
  ),
]
