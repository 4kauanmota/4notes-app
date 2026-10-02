/**
 * Prévia ao vivo do Markdown "de linha": títulos (#), citações (>), listas (-, 1.),
 * listas de tarefas (- [ ]), linhas horizontais (---) e links ([texto](endereço)).
 *
 * - A marcação do começo da linha fica escondida e só aparece quando você entra
 *   nela pelo teclado (Home duas vezes, ← no começo do texto…) ou a seleciona pelo
 *   teclado. Clicar no texto nunca faz a linha "pular".
 * - Listas mostram um marcador (•) e listas de tarefas uma caixa clicável que grava
 *   [ ] / [x] no arquivo. Enter continua a lista; Backspace no começo do item tira
 *   um nível (ou transforma o item em texto comum). Tab/Shift+Tab e a numeração
 *   automática ficam em lists.ts.
 * - Links mostram só o texto; o endereço aparece quando o cursor encosta no link.
 */
import { indentUnit, syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Prec, StateField, type Extension, type Range } from '@codemirror/state'
import { cursorLineBoundaryBackward, selectLineBoundaryBackward } from '@codemirror/commands'
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type Command, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { lineMarkerAt, type LineMarker, type LineMarkerKind } from './line-markers'
import { outdentChanges } from './lists'
import { isMentionUrl } from './mentions'

export { lineMarkerAt, type LineMarker, type LineMarkerKind } from './line-markers'

/** A marcação da linha fica escondida? (não está sendo editada nem selecionada pelo teclado) */
function isHidden(marker: LineMarker, state: EditorState, focused: boolean): boolean {
  if (!focused || state.field(pointerSelection, false)) return true
  return !state.selection.ranges.some((range) => range.from < marker.to && range.to >= marker.from)
}

// ── Seleção feita com o mouse ────────────────────────────────────────────────

/** true quando a última seleção veio do mouse (aí a marcação da linha não aparece). */
const pointerSelection = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => (tr.selection ? tr.isUserEvent('select.pointer') : value),
})

/** Clique antes de uma marcação escondida (ex.: na margem de um item) vai para o começo do texto. */
const pointerToText = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || !tr.isUserEvent('select.pointer')) return tr
  const state = tr.startState
  let changed = false
  const ranges = tr.selection.ranges.map((range) => {
    if (!range.empty || range.head > state.doc.length) return range
    const line = state.doc.lineAt(range.head)
    if (range.head !== line.from) return range
    const marker = lineMarkerAt(state, line)
    if (!marker || marker.to === range.head) return range
    changed = true
    return EditorSelection.cursor(marker.to)
  })
  return changed ? [tr, { selection: EditorSelection.create(ranges, tr.selection.mainIndex), sequential: true }] : tr
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
const linkText = Decoration.mark({ class: 'cm-md-link' })
const ruleWidget = Decoration.replace({ widget: new RuleWidget() })

// ── Decorações ───────────────────────────────────────────────────────────────

function buildPreview(view: EditorView): { decorations: DecorationSet; atoms: DecorationSet } {
  const { state } = view
  const focused = view.hasFocus
  const ranges: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  const touched = (from: number, to: number) => focused && state.selection.ranges.some((r) => r.from <= to && r.to >= from)

  for (const { from, to } of view.visibleRanges) {
    // Marcações de começo de linha
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      const marker = lineMarkerAt(state, line)
      if (marker) {
        const isList = marker.kind === 'bullet' || marker.kind === 'ordered' || marker.kind === 'task'
        if (isList) ranges.push(listLine(marker.level).range(line.from))
        if (marker.kind === 'task' && marker.checked && marker.to < line.to) ranges.push(taskDone.range(marker.to, line.to))
        if (isHidden(marker, state, focused)) {
          const deco = isList
            ? Decoration.replace({ widget: new MarkerWidget(marker.kind, !!marker.checked, marker.label ?? '') })
            : hidden
          ranges.push(deco.range(marker.from, marker.to))
          atoms.push(hidden.range(marker.from, marker.to))
        }
      }
      pos = line.to + 1
    }

    // Linhas horizontais e links
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'HorizontalRule') {
          const line = state.doc.lineAt(node.from)
          if (!touched(line.from, line.to)) {
            ranges.push(ruleWidget.range(line.from, line.to))
            atoms.push(hidden.range(line.from, line.to))
          }
          return false
        }
        if (node.name === 'Image' || node.name === 'FencedCode' || node.name === 'CodeBlock') return false
        if (node.name !== 'Link') return
        const marks = node.node.getChildren('LinkMark')
        const url = node.node.getChild('URL')
        if (marks.length < 3 || !url || marks[0]!.to >= marks[1]!.from) return false
        // Menções a notas viram chips (mentions.ts)
        if (isMentionUrl(state, state.sliceDoc(url.from, url.to))) return false
        if (!touched(node.from, node.to)) {
          ranges.push(
            hidden.range(marks[0]!.from, marks[0]!.to),
            linkText.range(marks[0]!.to, marks[1]!.from),
            hidden.range(marks[1]!.from, node.to),
          )
        }
        return false
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
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        ;({ decorations: this.decorations, atoms: this.atoms } = buildPreview(update.view))
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atoms ?? Decoration.none),
  },
)

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
    if (marker) view.dispatch({ selection: EditorSelection.cursor(marker.to), userEvent: 'select.pointer' })
    view.focus()
    return true
  },
})

/**
 * Backspace logo no começo do texto de uma linha com marcação escondida:
 * item aninhado sobe um nível; item, título ou citação viram texto comum.
 */
const deleteLineMarker: Command = (view) => {
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

/** Home: primeiro vai para o começo do texto (depois do marcador); de novo, para o começo da linha. */
function smartHome(extend: boolean): Command {
  return (view) => {
    const { state } = view
    if (state.selection.ranges.length !== 1) return false
    const range = state.selection.main
    const marker = lineMarkerAt(state, state.doc.lineAt(range.head))
    if (!marker || range.head <= marker.to) return extend ? selectLineBoundaryBackward(view) : cursorLineBoundaryBackward(view)
    const target = view.moveToLineBoundary(EditorSelection.cursor(range.head), false).head
    const head = target <= marker.to ? marker.to : target
    view.dispatch({
      selection: extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head),
      scrollIntoView: true,
      userEvent: 'select',
    })
    return true
  }
}

/** Prévia das marcações de linha (títulos, citações, listas, tarefas, linhas e links). */
export const markdownPreview: Extension = [
  pointerSelection,
  pointerToText,
  previewPlugin,
  markerClicks,
  Prec.highest(
    keymap.of([
      { key: 'Backspace', run: deleteLineMarker },
      { key: 'Home', run: smartHome(false), shift: smartHome(true) },
    ]),
  ),
]
