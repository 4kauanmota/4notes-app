/**
 * Blocos de código (```linguagem … ```) no editor.
 *
 * - Fora da edição, o bloco aparece como um cartão: cabeçalho com a linguagem e os
 *   botões Copiar, Tela cheia e Remover, e o código colorido com altura máxima
 *   (rolagem interna para códigos grandes).
 * - Com o cursor dentro do bloco (clique no código ou setas), aparecem as linhas
 *   de verdade — com as cercas ``` — para editar normalmente.
 * - O arquivo continua sendo Markdown comum.
 */
import { undo } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { highlightTree } from '@lezer/highlight'
import { iconSvg } from '../icons'
import { focusChanged, focusTracking, isFocused } from './focus'
import { editorHost } from './host'
import { findLanguage, languageLabel } from './languages'
import { codeHighlight } from './theme'

export interface CodeBlock {
  /** Começo da linha da cerca de abertura. */
  from: number
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

/** Nós que nunca contêm blocos de código (não precisa olhar dentro). */
const SKIP = new Set(['Paragraph', 'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6', 'HTMLBlock', 'CodeBlock', 'Table'])

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

/** Troca o código de um bloco (usado pela tela cheia). */
export function replaceBlockCode(view: EditorView, at: number, code: string): void {
  const block = codeBlockAt(view.state, at)
  if (!block) return
  const insert = block.empty ? (code ? `${code}\n` : '') : code
  if (view.state.sliceDoc(block.codeFrom, block.codeTo) === insert) return
  view.dispatch({ changes: { from: block.codeFrom, to: block.codeTo, insert }, userEvent: 'input.code' })
}

/** Remove o bloco inteiro (com a quebra de linha que sobra). */
export function removeBlock(view: EditorView, block: CodeBlock): void {
  const { doc } = view.state
  let from = block.from
  let to = block.to
  if (to < doc.length) to += 1
  else if (from > 0) from -= 1
  view.dispatch({ changes: { from, to }, userEvent: 'delete.codeblock', scrollIntoView: true })
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

function header(info: string): HTMLElement {
  const head = el('div', 'cm-codeblock-head')
  const label = el('span', 'cm-codeblock-lang')
  label.textContent = languageLabel(info)
  const actions = el('span', 'cm-codeblock-actions')
  for (const { action, icon, tip } of ACTIONS) {
    const button = el('button', 'cm-codeblock-btn')
    button.type = 'button'
    button.dataset.action = action
    button.dataset.tip = tip
    button.dataset.tipPos = 'top'
    button.setAttribute('aria-label', tip)
    button.innerHTML = iconSvg(icon, 15)
    actions.append(button)
  }
  head.append(label, actions)
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
    // Espaçamento por padding (margens em widgets de bloco atrapalham a medição do editor)
    const wrap = el('div', 'cm-codeblock')
    const card = el('div', 'cm-codeblock-card')
    const pre = el('pre', 'cm-codeblock-pre')
    const code = el('code')
    renderHighlighted(code, this.code, this.info)
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

class CodeHeaderWidget extends WidgetType {
  constructor(readonly info: string) {
    super()
  }
  override eq(other: CodeHeaderWidget): boolean {
    return other.info === this.info
  }
  toDOM(): HTMLElement {
    const wrap = el('div', 'cm-codeblock-head-editing')
    wrap.append(header(this.info))
    return wrap
  }
  override ignoreEvent(): boolean {
    return false
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const focused = isFocused(state)
  const ranges: Range<Decoration>[] = []
  for (const block of codeBlocks(state)) {
    const editing = focused && state.selection.ranges.some((range) => range.from <= block.to && range.to >= block.from)
    if (editing) {
      ranges.push(Decoration.widget({ widget: new CodeHeaderWidget(block.info), block: true, side: -1 }).range(block.from))
    } else {
      const loaded = !!findLanguage(block.info)?.support
      const code = state.sliceDoc(block.codeFrom, block.codeTo)
      ranges.push(Decoration.replace({ widget: new CodeBlockWidget(block.info, code, loaded), block: true }).range(block.from, block.to))
    }
  }
  return Decoration.set(ranges, true)
}

const codeBlockField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update(decorations, tr) {
    const changed = tr.docChanged || tr.selection || focusChanged(tr.effects) || syntaxTree(tr.state) !== syntaxTree(tr.startState)
    return changed ? buildDecorations(tr.state) : decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

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
    host?.notify('Bloco de código removido', () => undo(view))
  }
}

const codeBlockEvents = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement
    const widget = target.closest?.('.cm-codeblock, .cm-codeblock-head-editing') as HTMLElement | null
    if (!widget || event.button !== 0) return false
    const block = codeBlockAt(view.state, view.posAtDOM(widget))
    if (!block) return false
    const button = target.closest('[data-action]') as HTMLElement | null
    if (button) {
      event.preventDefault()
      runAction(view, block, button.dataset.action ?? '', button)
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
    const offset = offsetAtPoint(pre.querySelector('code')!, event.clientX, event.clientY)
    view.dispatch({ selection: { anchor: Math.min(block.codeFrom + offset, block.codeTo) }, userEvent: 'select.pointer' })
    view.focus()
    return true
  },
})

export const codeBlockPreview: Extension = [focusTracking, codeBlockField, codeBlockEvents]
