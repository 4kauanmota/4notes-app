/**
 * Prévia do Markdown "de linha": títulos (#), citações (>), listas (-, 1.),
 * listas de tarefas (- [ ]) e linhas horizontais (---).
 *
 * - A marcação do começo da linha NUNCA aparece: títulos e citações só mudam o
 *   desenho da linha, listas mostram um marcador (•, 1.) e listas de tarefas uma
 *   caixa clicável que grava [ ] / [x] no arquivo. O cursor nunca fica antes da
 *   marcação (Home vai para o começo do texto; ← no começo do texto vai para a
 *   linha de cima).
 * - Para criar, é só digitar o atalho do Markdown no começo da linha ("# ", "- ",
 *   "1. ", "- [ ] ", "> ") ou usar a barra de formatação. Para tirar, Backspace no
 *   começo do texto (um item aninhado primeiro sobe um nível).
 * - Enter continua a lista; Tab/Shift+Tab e a numeração automática ficam em lists.ts.
 * - Os links ficam em formatting.ts (são trechos com marcação escondida, como o negrito).
 */
import { indentUnit, syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Prec, type Extension, type Line, type Range, type Text } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type Command, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { gravityCursor } from './hidden-markup'
import { lineMarkerAt, type LineMarker, type LineMarkerKind } from './line-markers'
import { outdentChanges } from './lists'

export { lineMarkerAt, type LineMarker, type LineMarkerKind } from './line-markers'

// ── O cursor nunca fica antes da marcação escondida ─────────────────────────

/** Onde o cursor pode ficar: dentro da marcação do começo da linha, vai para o começo do texto. */
function clampToText(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos)
  const marker = pos < line.from + 80 ? lineMarkerAt(state, line) : null
  return marker && pos < marker.to ? marker.to : pos
}

/** Toda seleção (clique, setas, mudanças externas…) respeita o começo do texto da linha. */
const keepCursorAfterMarkers = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection && !tr.docChanged) return tr
  const state = tr.state
  const { selection } = state
  let changed = false
  const ranges = selection.ranges.map((range) => {
    // Selecionar tudo (Ctrl+A) continua pegando tudo
    if (!range.empty && range.from === 0 && range.to === state.doc.length) return range
    const anchor = clampToText(state, range.anchor)
    const head = clampToText(state, range.head)
    if (anchor === range.anchor && head === range.head) return range
    changed = true
    return anchor === head ? EditorSelection.cursor(head, 1) : EditorSelection.range(anchor, head)
  })
  return changed ? [tr, { selection: EditorSelection.create(ranges, selection.mainIndex), sequential: true }] : tr
})

// ── Widgets ──────────────────────────────────────────────────────────────────

class MarkerWidget extends WidgetType {
  constructor(
    readonly kind: LineMarkerKind,
    readonly checked: boolean,
    readonly label: string,
  ) {
    super()
  }
  override eq(other: MarkerWidget): boolean {
    return other.kind === this.kind && other.checked === this.checked && other.label === this.label
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = `cm-md-marker cm-md-marker-${this.kind}`
    if (this.kind === 'task') {
      const box = document.createElement('span')
      box.className = 'cm-md-checkbox'
      box.setAttribute('role', 'checkbox')
      box.setAttribute('aria-checked', String(this.checked))
      box.setAttribute('aria-label', this.checked ? 'Desmarcar item' : 'Marcar item')
      if (this.checked) box.classList.add('checked')
      span.append(box)
    } else if (this.kind === 'ordered') {
      span.textContent = this.label
    } else {
      span.textContent = '•'
    }
    span.setAttribute('aria-hidden', this.kind === 'task' ? 'false' : 'true')
    return span
  }
  override ignoreEvent(): boolean {
    return false
  }
}

class RuleWidget extends WidgetType {
  override eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-md-rule'
    return span
  }
}

const hidden = Decoration.replace({})
const listLine = (level: number) => Decoration.line({ class: 'cm-md-li', attributes: { style: `--li-level: ${level}` } })
const taskDone = Decoration.mark({ class: 'cm-md-task-done' })
const ruleWidget = Decoration.replace({ widget: new RuleWidget() })

/** A linha é uma linha horizontal (---, ***, ___)? */
function isRuleLine(state: EditorState, line: Line): boolean {
  if (!/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line.text)) return false
  const node = syntaxTree(state).resolveInner(line.from + line.text.search(/\S/), 1)
  for (let n: typeof node | null = node; n; n = n.parent) if (n.name === 'HorizontalRule') return true
  return false
}

// ── Decorações ───────────────────────────────────────────────────────────────

function buildPreview(view: EditorView): { decorations: DecorationSet; atoms: DecorationSet } {
  const { state } = view
  const ranges: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []

  for (const { from, to } of view.visibleRanges) {
    // Marcações de começo de linha (sempre escondidas)
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      const marker = lineMarkerAt(state, line)
      if (marker) {
        const isList = marker.kind === 'bullet' || marker.kind === 'ordered' || marker.kind === 'task'
        if (isList) ranges.push(listLine(marker.level).range(line.from))
        if (marker.kind === 'task' && marker.checked && marker.to < line.to) ranges.push(taskDone.range(marker.to, line.to))
        const deco = isList ? Decoration.replace({ widget: new MarkerWidget(marker.kind, !!marker.checked, marker.label ?? '') }) : hidden
        ranges.push(deco.range(marker.from, marker.to))
        atoms.push(hidden.range(marker.from, marker.to))
      }
      pos = line.to + 1
    }

    // Linhas horizontais
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'HorizontalRule') {
          const line = state.doc.lineAt(node.from)
          if (line.to > line.from) {
            ranges.push(ruleWidget.range(line.from, line.to))
            atoms.push(hidden.range(line.from, line.to))
          }
          return false
        }
        if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'Paragraph') return false
      },
    })
  }
  return { decorations: Decoration.set(ranges, true), atoms: Decoration.set(atoms, true) }
}

const previewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    atoms: DecorationSet
    constructor(view: EditorView) {
      ;({ decorations: this.decorations, atoms: this.atoms } = buildPreview(view))
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        ;({ decorations: this.decorations, atoms: this.atoms } = buildPreview(update.view))
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atoms ?? Decoration.none),
  },
)

// ── Texto digitado encostado numa linha horizontal vai para uma linha própria ─

const isComposing = (tr: { isUserEvent(event: string): boolean }) => tr.isUserEvent('input.type.compose')

/** Uma inserção simples (sem quebra de linha) do usuário: onde e o quê. */
export function singleInsertion(tr: { changes: { iterChanges(f: (fromA: number, toA: number, fromB: number, toB: number, inserted: Text) => void): void } }): { pos: number; text: string } | null {
  let result: { pos: number; text: string } | null = null
  let count = 0
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count++
    result = fromA === toA ? { pos: fromA, text: inserted.toString() } : null
  })
  const found = result as { pos: number; text: string } | null
  return count === 1 && found && found.text && !found.text.includes('\n') ? found : null
}

const textBesideRule = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || isComposing(tr) || !(tr.isUserEvent('input.type') || tr.isUserEvent('input.paste'))) return tr
  const insertion = singleInsertion(tr)
  if (!insertion) return tr
  const line = tr.startState.doc.lineAt(insertion.pos)
  if (!isRuleLine(tr.startState, line) || (insertion.pos !== line.from && insertion.pos !== line.to)) return tr
  const atEnd = insertion.pos === line.to
  const insert = atEnd ? `\n${insertion.text}` : `${insertion.text}\n`
  return {
    changes: { from: insertion.pos, insert },
    selection: EditorSelection.cursor(insertion.pos + (atEnd ? insert.length : insertion.text.length)),
    userEvent: 'input.type',
    scrollIntoView: true,
  }
})

// ── Interação ────────────────────────────────────────────────────────────────

/** Marca/desmarca o item de tarefa da linha em `pos`. */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const marker = lineMarkerAt(view.state, view.state.doc.lineAt(pos))
  if (!marker || marker.kind !== 'task' || marker.taskFrom === undefined) return false
  view.dispatch({
    changes: { from: marker.taskFrom + 1, to: marker.taskFrom + 2, insert: marker.checked ? ' ' : 'x' },
    userEvent: 'input.toggle',
  })
  return true
}

const markerClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement
    const widget = target.closest?.('.cm-md-marker')
    if (!widget || event.button !== 0) return false
    const pos = view.posAtDOM(widget)
    event.preventDefault()
    if (target.closest('.cm-md-checkbox')) return toggleTaskAt(view, pos)
    // Clique no marcador (•, 1.): cursor no começo do texto do item
    const marker = lineMarkerAt(view.state, view.state.doc.lineAt(pos))
    if (marker) view.dispatch({ selection: EditorSelection.cursor(marker.to, 1), userEvent: 'select.pointer' })
    view.focus()
    return true
  },
})

/**
 * Backspace logo no começo do texto de uma linha com marcação escondida:
 * item aninhado sobe um nível; item, título ou citação viram texto comum.
 */
export const deleteLineMarker: Command = (view) => {
  const { state } = view
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const marker = lineMarkerAt(state, line)
  if (!marker || head !== marker.to) return false
  if (marker.indent > 0) {
    const outdent = outdentChanges(state, state.selection.main)
    if (outdent) {
      view.dispatch(outdent)
      return true
    }
    // Indentação com tab ou item dentro de citação: tira uma unidade de indentação
    const unit = Math.min(marker.indent, state.facet(indentUnit).length || 2)
    view.dispatch({ changes: { from: marker.indentFrom, to: marker.indentFrom + unit }, userEvent: 'delete.dedent' })
    return true
  }
  view.dispatch({ changes: { from: marker.markFrom, to: marker.to }, userEvent: 'delete.backward' })
  return true
}

/** Delete no fim de uma linha: a linha de baixo sobe sem a marcação dela (como juntar parágrafos no Word). */
export const deleteIntoMarkedLine: Command = (view) => {
  const { state } = view
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  if (head !== line.to || line.number >= state.doc.lines) return false
  const marker = lineMarkerAt(state, state.doc.line(line.number + 1))
  if (!marker) return false
  view.dispatch({ changes: { from: line.to, to: marker.to }, userEvent: 'delete.forward', scrollIntoView: true })
  return true
}

/** Home: vai para o começo do texto (nunca para antes da marcação escondida). */
function smartHome(extend: boolean): Command {
  return (view) => {
    const { state } = view
    if (state.selection.ranges.length !== 1) return false
    const range = state.selection.main
    const marker = lineMarkerAt(state, state.doc.lineAt(range.head))
    const boundary = view.moveToLineBoundary(EditorSelection.cursor(range.head), false).head
    const target = marker && boundary <= marker.to ? marker.to : boundary
    if (extend) {
      view.dispatch({ selection: EditorSelection.range(range.anchor, target), scrollIntoView: true, userEvent: 'select' })
      return true
    }
    const cursor = gravityCursor(state, target) ?? EditorSelection.cursor(target, 1)
    view.dispatch({ selection: EditorSelection.create([cursor]), scrollIntoView: true, userEvent: 'select' })
    return true
  }
}

/** ← no começo do texto de uma linha com marcação: vai para o fim da linha de cima. */
export function leftOverMarker(extend: boolean): Command {
  return (view) => {
    const { state } = view
    if (state.selection.ranges.length !== 1) return false
    const range = state.selection.main
    if (!extend && !range.empty) return false
    const line = state.doc.lineAt(range.head)
    const marker = lineMarkerAt(state, line)
    if (!marker || range.head !== marker.to) return false
    if (line.from === 0) return true
    const target = line.from - 1
    view.dispatch({
      selection: extend ? EditorSelection.range(range.anchor, target) : EditorSelection.cursor(target, -1),
      scrollIntoView: true,
      userEvent: 'select',
    })
    return true
  }
}

/** Prévia das marcações de linha (títulos, citações, listas, tarefas e linhas horizontais). */
export const markdownPreview: Extension = [
  keepCursorAfterMarkers,
  textBesideRule,
  previewPlugin,
  markerClicks,
  Prec.highest(
    keymap.of([
      { key: 'Backspace', run: deleteLineMarker },
      { key: 'Delete', run: deleteIntoMarkedLine },
      { key: 'Home', run: smartHome(false), shift: smartHome(true) },
      { key: 'ArrowLeft', run: leftOverMarker(false), shift: leftOverMarker(true) },
    ]),
  ),
]
