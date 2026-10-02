/**
 * Edição de listas no editor:
 *  - Tab: o item (com os subitens) passa a ser subitem do item de cima; Shift+Tab
 *    volta um nível. A indentação acompanha o marcador de cima ("- " = 2 espaços,
 *    "1. " = 3), senão o Markdown não aninha.
 *  - Listas numeradas ficam sempre em sequência: apagar, inserir, mover ou aninhar
 *    um item renumera os outros (1, 2, 3…), mantendo o número inicial da lista.
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import {
  EditorState,
  MapMode,
  Prec,
  type ChangeSpec,
  type Extension,
  type Line,
  Transaction,
  type SelectionRange,
  type Text,
  type TransactionSpec,
} from '@codemirror/state'
import { keymap, type Command } from '@codemirror/view'
import { lineMarkerAt, type LineMarker } from './line-markers'

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

// ── Nível dos itens (Tab / Shift+Tab) ────────────────────────────────────────

/** Item de lista da linha, fora de citação e indentado só com espaços (null nos outros casos). */
function listMarkerAt(state: EditorState, line: Line): LineMarker | null {
  const marker = lineMarkerAt(state, line)
  if (!marker || marker.kind === 'heading' || marker.kind === 'quote') return null
  if (marker.indentFrom !== line.from || line.text.slice(0, marker.indent).includes('\t')) return null
  return marker
}

/** Onde começa o conteúdo do item: depois de "- " / "1. " (numa tarefa, antes do "[ ]"). */
const contentColumn = (marker: LineMarker) => (marker.taskFrom ?? marker.to) - marker.from

function listItemNode(state: EditorState, marker: LineMarker): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(marker.markFrom, 1); node; node = node.parent) {
    if (node.name === 'ListItem') return node
  }
  return null
}

/** Linhas que mudam de nível: as da seleção e, junto com o último item, os subitens dele. */
function itemLines(state: EditorState, range: SelectionRange): [number, number] {
  const end = state.doc.lineAt(range.to)
  const marker = listMarkerAt(state, end)
  const item = marker && listItemNode(state, marker)
  return [state.doc.lineAt(range.from).number, Math.max(end.number, item ? state.doc.lineAt(item.to).number : 0)]
}

/** Desloca as linhas `delta` espaços (para a esquerda se negativo), ignorando linhas vazias. */
function shiftLines(state: EditorState, [first, last]: [number, number], delta: number): ChangeSpec[] {
  const changes: ChangeSpec[] = []
  for (let number = first; number <= last; number++) {
    const line = state.doc.line(number)
    if (!line.text.trim()) continue
    if (delta > 0) {
      changes.push({ from: line.from, insert: ' '.repeat(delta) })
    } else {
      const remove = Math.min(-delta, /^ */.exec(line.text)![0].length)
      if (remove) changes.push({ from: line.from, to: line.from + remove })
    }
  }
  return changes
}

/** Tab num item. No primeiro item da lista não há onde entrar, então nada muda. */
export const indentListItem: Command = (view) => {
  const { state } = view
  if (state.selection.ranges.length !== 1) return false
  const range = state.selection.main
  const marker = listMarkerAt(state, state.doc.lineAt(range.from))
  const item = marker && listItemNode(state, marker)
  if (!marker || !item) return false
  const previous = item.prevSibling?.name === 'ListItem' ? listMarkerAt(state, state.doc.lineAt(item.prevSibling.from)) : null
  const delta = previous ? contentColumn(previous) - marker.indent : 0
  if (delta > 0) view.dispatch({ changes: shiftLines(state, itemLines(state, range), delta), userEvent: 'input.indent', scrollIntoView: true })
  return true
}

/** Subitem volta um nível (fica no nível do item "pai"), levando os subitens dele. */
export function outdentChanges(state: EditorState, range: SelectionRange): TransactionSpec | null {
  const marker = listMarkerAt(state, state.doc.lineAt(range.from))
  const item = marker && listItemNode(state, marker)
  if (!marker || !item || marker.indent === 0) return null
  const owner = item.parent?.parent
  const parent = owner?.name === 'ListItem' ? listMarkerAt(state, state.doc.lineAt(owner.from)) : null
  const delta = marker.indent - (parent?.indent ?? 0)
  if (delta <= 0) return null
  return { changes: shiftLines(state, itemLines(state, range), -delta), userEvent: 'delete.dedent', scrollIntoView: true }
}

/** Shift+Tab num subitem. */
export const outdentListItem: Command = (view) => {
  if (view.state.selection.ranges.length !== 1) return false
  const spec = outdentChanges(view.state, view.state.selection.main)
  if (spec) view.dispatch(spec)
  return !!spec
}

// ── Numeração automática ─────────────────────────────────────────────────────

const ORDERED_LINE = /^[ \t]*(?:>[ \t]?)*[ \t]*\d{1,9}[.)](?:[ \t]|$)/

/** Número do marcador ("12." → 12). */
const markNumber = (state: EditorState, mark: SyntaxNode) => Number.parseInt(state.sliceDoc(mark.from, mark.to), 10)

const itemMarks = (list: SyntaxNode) =>
  list.getChildren('ListItem').flatMap((item) => {
    const mark = item.getChild('ListMark')
    return mark ? [mark] : []
  })

/** Número inicial que a lista tinha antes da edição (null se ali não havia lista numerada). */
function previousStart(tr: Transaction, pos: number): number | null {
  const state = tr.startState
  const oldPos = tr.changes.invert(state.doc).mapPos(pos, 1)
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(oldPos, 1); node; node = node.parent) {
    if (node.name !== 'ListItem') continue
    const list = node.parent
    const first = list?.name === 'OrderedList' ? itemMarks(list)[0] : undefined
    return first && node.from === oldPos ? markNumber(state, first) : null
  }
  return null
}

type Region = { from: number; to: number }

/** Trechos alterados (com as linhas vizinhas) que têm alguma linha de lista numerada. */
function orderedRegions(doc: Text, ranges: Region[]): Region[] {
  const regions: Region[] = []
  for (const { from, to } of ranges) {
    const first = Math.max(1, doc.lineAt(from).number - 1)
    const last = Math.min(doc.lines, doc.lineAt(to).number + 1)
    for (let number = first; number <= last; number++) {
      if (!ORDERED_LINE.test(doc.line(number).text)) continue
      regions.push({ from: doc.line(first).from, to: doc.line(last).to })
      break
    }
  }
  return regions
}

/** Listas numeradas da árvore de sintaxe que passam pelos trechos. */
function orderedLists(state: EditorState, regions: Region[]): SyntaxNode[] {
  if (!regions.length) return []
  const tree = ensureSyntaxTree(state, Math.max(...regions.map((r) => r.to)), 50) ?? syntaxTree(state)
  const lists = new Map<number, SyntaxNode>()
  for (const { from, to } of regions) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'OrderedList') lists.set(node.from, node.node)
        if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false
      },
    })
  }
  return [...lists.values()]
}

/** A posição é o marcador de um item de lista numerada (no texto novo)? */
function isOrderedMark(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, 1)
  return node.name === 'ListMark' && node.from === pos && node.parent?.parent?.name === 'OrderedList'
}

/** Mudanças para deixar em sequência as listas numeradas que a edição alcançou. */
export function renumberChanges(tr: Transaction): ChangeSpec[] {
  const edited: Region[] = []
  const editedBefore: Region[] = []
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    edited.push({ from: fromB, to: toB })
    editedBefore.push({ from: fromA, to: toA })
  })
  if (!edited.length) return []
  const { state, startState } = tr
  /** Número que cada marcador (posição no texto novo) deve ter. */
  const expected = new Map<number, number>()

  // 1) Listas do texto novo
  for (const list of orderedLists(state, orderedRegions(state.doc, edited))) {
    const marks = itemMarks(list)
    if (!marks.length) continue
    const first = marks[0]!
    // Número inicial: o que você digitou no primeiro item; se você não mexeu nele
    // (ex.: apagou o item 1), o número com que a lista começava antes
    const touched = edited.some(({ from, to }) => from < first.to && to > first.from)
    const start = (touched ? null : previousStart(tr, first.from)) ?? markNumber(state, first)
    if (Number.isFinite(start)) marks.forEach((mark, index) => expected.set(mark.from, start + index))
  }

  // 2) Listas de antes cujos itens restantes deixaram de ser lista. Ex.: uma lista logo
  //    abaixo de um parágrafo perde o item 1 — no Markdown, "2." não começa lista ali.
  for (const list of orderedLists(startState, orderedRegions(startState.doc, editedBefore))) {
    const marks = itemMarks(list)
    if (!marks.length) continue
    const start = markNumber(startState, marks[0]!)
    // Itens que continuam no texto (null = o marcador foi apagado ou alterado)
    const survivors = [
      ...new Set(
        marks
          .map((mark) => tr.changes.mapPos(mark.from, 1, MapMode.TrackAfter))
          .filter((pos): pos is number => pos !== null && /^\d+[.)]/.test(state.sliceDoc(pos, pos + 11))),
      ),
    ]
    if (!survivors.length || !Number.isFinite(start)) continue
    if (survivors.some((pos) => expected.has(pos) || isOrderedMark(state, pos))) continue
    survivors.forEach((pos, index) => expected.set(pos, start + index))
  }

  const changes: ChangeSpec[] = []
  for (const [pos, number] of expected) {
    const digits = /^\d+/.exec(state.sliceDoc(pos, pos + 10))?.[0]
    if (digits && digits !== String(number)) changes.push({ from: pos, to: pos + digits.length, insert: String(number) })
  }
  return changes
}

/** Renumera depois de cada edição feita por você (desfazer/refazer e mudanças vindas do disco ficam como estão). */
const renumberLists = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.annotation(Transaction.userEvent) || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return tr
  const changes = renumberChanges(tr)
  return changes.length ? [tr, { changes, sequential: true }] : tr
})

/** Tab/Shift+Tab nos itens e numeração automática das listas numeradas. */
export const listEditing: Extension = [Prec.highest(keymap.of([{ key: 'Tab', run: indentListItem, shift: outdentListItem }])), renumberLists]
