/**
 * Blocos de código (```linguagem … ```) no editor. As cercas ``` nunca aparecem.
 *
 * - Fora da edição, o bloco aparece como um cartão: cabeçalho com a linguagem e os
 *   botões Copiar, Tela cheia e Remover, e o código colorido com altura máxima
 *   (rolagem interna para códigos grandes).
 * - Com o cursor dentro do bloco (clique no código ou setas), o cartão se abre: as
 *   linhas do código ficam editáveis ali mesmo, entre o cabeçalho e o rodapé do
 *   cartão (que tomam o lugar das cercas). O cursor nunca fica numa cerca: as
 *   setas e os cliques passam direto para o código ou para fora do bloco.
 * - Digitar ``` (ou ```linguagem) numa linha e apertar Enter cria um bloco; a
 *   linguagem muda pelo nome dela no cabeçalho. Backspace num bloco vazio o remove.
 * - Blocos de texto (```text, criados pela barra de formatação — text-blocks.ts) usam
 *   o mesmo cartão, mas com a fonte do texto, linhas que quebram e sem linguagem.
 * - O arquivo continua sendo Markdown comum.
 */
import { undo } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { Annotation, EditorSelection, EditorState, Prec, StateField, type Extension, type Range, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, keymap, WidgetType, type Command, type DecorationSet } from '@codemirror/view'
import { highlightTree } from '@lezer/highlight'
import { iconSvg } from '../icons'
import { focusChanged, focusTracking, isFocused } from './focus'
import { editorHost } from './host'
import { findLanguage, isTextBlockInfo, languageLabel } from './languages'
import { codeHighlight } from './theme'

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
  let label: HTMLElement
  if (text) {
    // Bloco de texto: sem linguagem para trocar
    label = el('span', 'cm-codeblock-kind')
    label.innerHTML = iconSvg('text-block', 13)
    label.append('Texto')
  } else {
    const button = el('button', 'cm-codeblock-lang')
    button.type = 'button'
    button.dataset.action = 'language'
    button.dataset.tip = 'Trocar a linguagem'
    button.dataset.tipPos = 'top'
    button.textContent = languageLabel(info)
    button.insertAdjacentHTML('beforeend', iconSvg('chevron-down', 12))
    label = button
  }
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

/** Escreve o código colorido (quando a linguagem já foi carregada) dentro de `target`. */
export function renderHighlighted(target: HTMLElement, code: string, info: string): void {
  const language = findLanguage(info)?.support?.language
  if (!language) {
    target.textContent = code
    return
  }
  const tree = language.parser.parse(code)
  let pos = 0
  highlightTree(tree, codeHighlight, (from, to, classes) => {
    if (from > pos) target.append(code.slice(pos, from))
    const span = el('span', classes)
    span.textContent = code.slice(from, to)
    target.append(span)
    pos = to
  })
  if (pos < code.length) target.append(code.slice(pos))
}

class CodeBlockWidget extends WidgetType {
  constructor(
    readonly info: string,
    readonly code: string,
    readonly loaded: boolean,
  ) {
    super()
  }
  override eq(other: CodeBlockWidget): boolean {
    return other.info === this.info && other.code === this.code && other.loaded === this.loaded
  }
  toDOM(): HTMLElement {
    const text = isTextBlockInfo(this.info)
    // Espaçamento por padding (margens em widgets de bloco atrapalham a medição do editor)
    const wrap = el('div', text ? 'cm-codeblock cm-textblock' : 'cm-codeblock')
    const card = el('div', 'cm-codeblock-card')
    const pre = el('pre', 'cm-codeblock-pre')
    const code = el('code')
    // Bloco de texto: o conteúdo exatamente como está (sem cores de linguagem)
    if (text) code.textContent = this.code
    else renderHighlighted(code, this.code, this.info)
    pre.append(code)
    card.append(header(this.info), pre)
    wrap.append(card)
    return wrap
  }
  override get estimatedHeight(): number {
    return Math.min(this.code.split('\n').length, 18) * 21 + 58
  }
  override ignoreEvent(): boolean {
    return false
  }
}

/** Cabeçalho do cartão aberto (no lugar da cerca de abertura). */
class CodeHeaderWidget extends WidgetType {
  constructor(readonly info: string) {
    super()
  }
  override eq(other: CodeHeaderWidget): boolean {
    return other.info === this.info
  }
  toDOM(): HTMLElement {
    const wrap = el('div', isTextBlockInfo(this.info) ? 'cm-codeblock-head-editing cm-textblock' : 'cm-codeblock-head-editing')
    // O espaço abaixo do cabeçalho é o mesmo do cartão fechado (o código não "pula")
    wrap.append(header(this.info), el('div', 'cm-codeblock-gap'))
    return wrap
  }
  override ignoreEvent(): boolean {
    return false
  }
}

/** Rodapé do cartão aberto (no lugar da cerca de fechamento). */
class CodeFooterWidget extends WidgetType {
  override eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const wrap = el('div', 'cm-codeblock-foot-editing')
    wrap.append(el('div', 'cm-codeblock-foot'))
    return wrap
  }
  override ignoreEvent(): boolean {
    return false
  }
}

const hidden = Decoration.replace({})

function buildDecorations(state: EditorState): { decorations: DecorationSet; atoms: DecorationSet } {
  const focused = isFocused(state)
  const ranges: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  for (const block of codeBlocks(state)) {
    const editing = focused && !block.empty && state.selection.ranges.some((range) => range.from <= block.codeTo && range.to >= block.codeFrom)
    if (editing) {
      ranges.push(Decoration.replace({ widget: new CodeHeaderWidget(block.info), block: true }).range(block.from, block.openTo))
      ranges.push(Decoration.replace({ widget: new CodeFooterWidget(), block: true }).range(block.closeFrom, block.to))
      atoms.push(hidden.range(block.from, block.openTo), hidden.range(block.closeFrom, block.to))
    } else {
      const loaded = !!findLanguage(block.info)?.support
      const code = state.sliceDoc(block.codeFrom, block.codeTo)
      ranges.push(Decoration.replace({ widget: new CodeBlockWidget(block.info, code, loaded), block: true }).range(block.from, block.to))
      atoms.push(hidden.range(block.from, block.to))
    }
  }
  return { decorations: Decoration.set(ranges, true), atoms: Decoration.set(atoms, true) }
}

const codeBlockField = StateField.define<{ decorations: DecorationSet; atoms: DecorationSet }>({
  create: (state) => buildDecorations(state),
  update(value, tr) {
    const changed = tr.docChanged || tr.selection || focusChanged(tr.effects) || syntaxTree(tr.state) !== syntaxTree(tr.startState)
    return changed ? buildDecorations(tr.state) : value
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atoms),
  ],
})

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

/** Posição (no código) do caractere sob o mouse. */
function offsetAtPoint(code: HTMLElement, x: number, y: number): number {
  const caret = document.caretRangeFromPoint?.(x, y)
  if (!caret || !code.contains(caret.startContainer)) return 0
  let offset = 0
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === caret.startContainer) return offset + caret.startOffset
    offset += node.textContent?.length ?? 0
  }
  return offset
}

function flashCopied(button: HTMLElement): void {
  button.classList.add('done')
  button.innerHTML = iconSvg('check', 15)
  setTimeout(() => {
    button.classList.remove('done')
    button.innerHTML = iconSvg('copy', 15)
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

const codeBlockEvents = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement
    const widget = target.closest?.('.cm-codeblock, .cm-codeblock-head-editing, .cm-codeblock-foot-editing') as HTMLElement | null
    if (!widget || event.button !== 0) return false
    const block = codeBlockAt(view.state, view.posAtDOM(widget))
    if (!block) return false
    const button = target.closest('[data-action]') as HTMLElement | null
    if (button) {
      event.preventDefault()
      runAction(view, block, button.dataset.action ?? '', button)
      return true
    }
    if (widget.classList.contains('cm-codeblock-foot-editing')) {
      // Clique no rodapé do cartão aberto: cursor no fim do código
      event.preventDefault()
      view.dispatch({ selection: EditorSelection.cursor(block.codeTo, -1), userEvent: 'select.pointer' })
      view.focus()
      return true
    }
    const pre = target.closest('.cm-codeblock-pre') as HTMLElement | null
    if (!pre) {
      event.preventDefault()
      return true
    }
    // Clique na barra de rolagem: só rola
    if (event.offsetX > pre.clientWidth || event.offsetY > pre.clientHeight) return false
    event.preventDefault()
    if (block.empty) {
      // Bloco sem nenhuma linha: ganha uma linha para o cursor
      view.dispatch({ changes: { from: block.openTo, insert: '\n' }, selection: EditorSelection.cursor(block.openTo + 1), annotations: fenceEdit.of(true), userEvent: 'input' })
    } else {
      const offset = offsetAtPoint(pre.querySelector('code')!, event.clientX, event.clientY)
      view.dispatch({ selection: { anchor: Math.min(block.codeFrom + offset, block.codeTo) }, userEvent: 'select.pointer' })
    }
    view.focus()
    return true
  },
})

export const codeBlockPreview: Extension = [
  focusTracking,
  codeBlockField,
  protectFences,
  keepCursorOutOfFences,
  codeBlockEvents,
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
