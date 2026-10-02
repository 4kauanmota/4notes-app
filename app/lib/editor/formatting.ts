/**
 * Formatação de texto no editor: negrito, itálico, sublinhado, cor, listas…
 *
 * O arquivo continua sendo Markdown comum:
 *   **negrito**   *itálico*   ~~tachado~~   ==marca-texto==   `código`
 * Sublinhado e cor não existem no Markdown, então usam HTML simples (que o
 * Obsidian e outros visualizadores também entendem):
 *   <u>sublinhado</u>   <span style="color: red">colorido</span>
 *
 * "Prévia ao vivo": as marcações ficam escondidas. As do Markdown aparecem quando o
 * cursor encosta no trecho (como no Obsidian); as tags HTML nunca aparecem e são
 * protegidas na edição (ver "Edição com as tags escondidas", no fim do arquivo).
 */
import { cursorCharLeft, cursorCharRight, selectCharLeft, selectCharRight } from '@codemirror/commands'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Prec, type ChangeSpec, type Extension, type Range, type SelectionRange, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin, type Command, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { isPaletteColor, paletteVar } from '../colors'

export type InlineFormat = 'bold' | 'italic' | 'underline' | 'strike' | 'highlight' | 'code' | 'color'
export type LineFormat = 'heading' | 'bullet' | 'task'

/** Um trecho formatado: [from, openTo) = marcação de abertura, [closeFrom, to) = de fechamento. */
export interface FormatElement {
  format: InlineFormat
  from: number
  openTo: number
  closeFrom: number
  to: number
  /** Só para format = 'color'. */
  color?: string
}

const MARKERS: Record<Exclude<InlineFormat, 'color'>, readonly [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['<u>', '</u>'],
  strike: ['~~', '~~'],
  highlight: ['==', '=='],
  code: ['`', '`'],
}

const colorMarkers = (color: string) => [`<span style="color: ${color}">`, '</span>'] as const

function markersFor(format: InlineFormat, color?: string): readonly [string, string] {
  return format === 'color' ? colorMarkers(color ?? 'purple') : MARKERS[format]
}

// ── Leitura: encontrar trechos formatados ────────────────────────────────────

/** Nós do Markdown (árvore do CodeMirror) que viram formatação. */
const TREE_FORMATS: Record<string, { format: InlineFormat; mark: string }> = {
  StrongEmphasis: { format: 'bold', mark: 'EmphasisMark' },
  Emphasis: { format: 'italic', mark: 'EmphasisMark' },
  Strikethrough: { format: 'strike', mark: 'StrikethroughMark' },
  InlineCode: { format: 'code', mark: 'CodeMark' },
}
const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'CodeInfo'])

const UNDERLINE_RE = /<u>(.*?)<\/u>/g
const COLOR_RE = /<span\s+style\s*=\s*(["'])\s*color\s*:\s*([#\w(),.%\s-]+?)\s*;?\s*\1\s*>(.*?)<\/span>/gi
const HIGHLIGHT_RE = /==([^\s=](?:[^=\n]*?[^\s=])?)==/g

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

function isInCode(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (CODE_NODES.has(node.name)) return true
  }
  return false
}

/** Trechos formatados inteiramente dentro de [from, to] (use limites de linha). */
export function findElements(state: EditorState, from: number, to: number): FormatElement[] {
  const elements: FormatElement[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      const spec = TREE_FORMATS[ref.name]
      if (!spec || ref.from < from || ref.to > to) return
      const first = ref.node.firstChild
      const last = ref.node.lastChild
      if (!first || !last || first.from === last.from || first.name !== spec.mark || last.name !== spec.mark) return
      elements.push({ format: spec.format, from: ref.from, openTo: first.to, closeFrom: last.from, to: ref.to })
    },
  })

  const scan = (re: RegExp, build: (match: RegExpExecArray, start: number) => FormatElement) => {
    for (let line = state.doc.lineAt(from); ; line = state.doc.line(line.number + 1)) {
      re.lastIndex = 0
      for (let match = re.exec(line.text); match; match = re.exec(line.text)) {
        const start = line.from + match.index
        if (!isInCode(state, start)) elements.push(build(match, start))
      }
      if (line.to >= to || line.number >= state.doc.lines) break
    }
  }
  scan(UNDERLINE_RE, (m, start) => ({ format: 'underline', from: start, openTo: start + 3, closeFrom: start + m[0].length - 4, to: start + m[0].length }))
  scan(HIGHLIGHT_RE, (m, start) => ({ format: 'highlight', from: start, openTo: start + 2, closeFrom: start + m[0].length - 2, to: start + m[0].length }))
  scan(COLOR_RE, (m, start) => {
    const closeFrom = start + m[0].length - '</span>'.length
    return { format: 'color', from: start, openTo: closeFrom - m[3]!.length, closeFrom, to: start + m[0].length, color: m[2]!.trim().toLowerCase() }
  })
  return elements.sort((a, b) => a.from - b.from || b.to - a.to)
}

/** Valor CSS seguro para uma cor lida do arquivo (cores da paleta seguem o tema). */
export function cssColor(color: string | undefined): string | null {
  if (!color) return null
  if (isPaletteColor(color)) return paletteVar(color)
  if (/^#[0-9a-f]{3,8}$/i.test(color) || /^[a-z]{3,20}$/i.test(color) || /^(rgb|hsl)a?\([\d\s.,%-]+\)$/i.test(color)) return color
  return null
}

// ── Trechos da seleção (uma parte por linha, sem espaços nas pontas) ─────────

interface Segment {
  from: number
  to: number
  lineFrom: number
  lineTo: number
}

function segmentsOf(state: EditorState, range: SelectionRange): Segment[] {
  const segments: Segment[] = []
  for (let line = state.doc.lineAt(range.from); ; line = state.doc.line(line.number + 1)) {
    let from = Math.max(range.from, line.from)
    let to = Math.min(range.to, line.to)
    const text = state.doc.sliceString(from, to)
    from += text.length - text.trimStart().length
    to -= text.length - text.trimEnd().length
    if (to > from) segments.push({ from, to, lineFrom: line.from, lineTo: line.to })
    if (line.to >= range.to || line.number >= state.doc.lines) break
  }
  return segments
}

function treeFor(state: EditorState, upto: number): void {
  ensureSyntaxTree(state, upto, 200)
}

const sameColor = (a?: string, b?: string) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

/**
 * Tira das pontas do trecho as marcações que ele pegou por inteiro
 * (ex.: a seleção "**mundo**" vale como "mundo"; numa seleção de várias linhas,
 * o "**" do fim de uma linha não conta como texto selecionado).
 */
function trimMarkers(seg: Segment, elements: FormatElement[]): Segment {
  let { from, to } = seg
  for (let changed = true, guard = 0; changed && guard < 6; guard++) {
    changed = false
    for (const el of elements) {
      if (from === el.from && el.openTo <= to) {
        from = el.openTo
        changed = true
      }
      if (to === el.to && el.closeFrom >= from) {
        to = el.closeFrom
        changed = true
      }
    }
  }
  return { ...seg, from, to }
}

/** Trechos da seleção já sem as marcações nas pontas, com os elementos de cada linha. */
function preparedSegments(state: EditorState, range: SelectionRange): { segments: Segment[]; perLine: FormatElement[][] } {
  const perLine: FormatElement[][] = []
  const segments: Segment[] = []
  for (const raw of segmentsOf(state, range)) {
    const elements = findElements(state, raw.lineFrom, raw.lineTo)
    const seg = trimMarkers(raw, elements)
    if (seg.to <= seg.from) continue
    segments.push(seg)
    perLine.push(elements)
  }
  return { segments, perLine }
}

/** O trecho [from, to] está todo dentro de um elemento desse formato? */
function containerOf(elements: FormatElement[], seg: { from: number; to: number }, format: InlineFormat): FormatElement | undefined {
  return elements.find((el) => el.format === format && el.openTo <= seg.from && seg.to <= el.closeFrom)
}

/** Formatos ativos na seleção principal (para destacar os botões da barra). */
export function activeFormats(state: EditorState): { formats: Set<InlineFormat>; color: string | null } {
  const range = state.selection.main
  const formats = new Set<InlineFormat>()
  if (range.empty) return { formats, color: null }
  treeFor(state, range.to)
  const { segments, perLine } = preparedSegments(state, range)
  if (!segments.length) return { formats, color: null }
  let color: string | null = null
  for (const format of ['bold', 'italic', 'underline', 'strike', 'highlight', 'code', 'color'] as InlineFormat[]) {
    const containers = segments.map((seg, i) => containerOf(perLine[i]!, seg, format))
    if (containers.every(Boolean)) {
      formats.add(format)
      if (format === 'color') {
        const first = containers[0]!.color ?? null
        color = containers.every((el) => sameColor(el!.color, first ?? undefined)) ? first : null
      }
    }
  }
  return { formats, color }
}

// ── Comandos de formatação inline ────────────────────────────────────────────

/**
 * Aplica o formato a um trecho, juntando-o a trechos vizinhos com o mesmo formato
 * ("**ab**cd" + negrito em "cd" → "**abcd**"). Cor diferente não é aninhada: o
 * pedaço selecionado troca de cor e o resto mantém a cor antiga.
 */
function applyToSegment(state: EditorState, seg: Segment, elements: FormatElement[], format: InlineFormat, color?: string): ChangeSpec[] {
  const [open, close] = markersFor(format, color)
  const touching = elements.filter((el) => el.format === format && el.from <= seg.to && seg.from <= el.to)
  const merge = touching.filter((el) => format !== 'color' || sameColor(el.color, color))
  const recolor = touching.filter((el) => !merge.includes(el) && el.openTo < seg.to && seg.from < el.closeFrom)
  const from = Math.min(seg.from, ...merge.map((el) => el.from))
  const to = Math.max(seg.to, ...merge.map((el) => el.to))

  const before: ChangeSpec[] = []
  const inner: ChangeSpec[] = []
  const after: ChangeSpec[] = []
  for (const el of merge) inner.push({ from: el.from, to: el.openTo }, { from: el.closeFrom, to: el.to })
  for (const el of recolor) {
    const { left, right } = splitAround(state, elements, el, seg)
    if (left !== null) before.push({ from: left, insert: state.sliceDoc(el.closeFrom, el.to) })
    else inner.push({ from: el.from, to: el.openTo })
    if (right !== null) after.push({ from: right, insert: state.sliceDoc(el.from, el.openTo) })
    else inner.push({ from: el.closeFrom, to: el.to })
  }
  return [...before, { from, insert: open }, ...inner, { from: to, insert: close }, ...after]
}

/**
 * Onde partir o elemento `el` em volta do trecho `seg` (para tirar ou trocar o formato só ali):
 *  - left: onde fechar `el` antes do trecho — logo depois do último texto visível —, ou null se antes só há espaços;
 *  - right: onde reabrir `el` depois do trecho — logo antes do próximo texto visível —, ou null se depois só há espaços.
 * As marcações de outros trechos encostadas no trecho ficam do lado de dentro, para nada ficar mal aninhado
 * ("<span…>olá <u>|mundo</u></span>" → "<span…>olá</span> <u>mundo</u>").
 */
function splitAround(state: EditorState, elements: FormatElement[], el: FormatElement, seg: { from: number; to: number }): { left: number | null; right: number | null } {
  const others = elements.filter((other) => other !== el)
  let left = seg.from
  for (let moved = true; moved && left > el.openTo; ) {
    const opening = others.find((other) => other.openTo === left && other.from >= el.openTo)
    moved = !!opening || /\s/.test(state.sliceDoc(left - 1, left))
    if (moved) left = opening ? opening.from : left - 1
  }
  let right = seg.to
  for (let moved = true; moved && right < el.closeFrom; ) {
    const closing = others.find((other) => other.closeFrom === right && other.to <= el.closeFrom)
    moved = !!closing || /\s/.test(state.sliceDoc(right, right + 1))
    if (moved) right = closing ? closing.to : right + 1
  }
  return { left: left > el.openTo ? left : null, right: right < el.closeFrom ? right : null }
}

/** Remove o formato só do trecho selecionado, mantendo o resto do elemento formatado. */
function removeFromSegment(state: EditorState, seg: Segment, el: FormatElement, elements: FormatElement[]): ChangeSpec[] {
  const { left, right } = splitAround(state, elements, el, seg)
  return [
    // "**olá |mundo**" → "**olá** mundo": o fechamento vai antes do espaço
    left !== null ? { from: left, insert: state.sliceDoc(el.closeFrom, el.to) } : { from: el.from, to: el.openTo },
    right !== null ? { from: right, insert: state.sliceDoc(el.from, el.openTo) } : { from: el.closeFrom, to: el.to },
  ]
}

/**
 * Cursor sem seleção (atalhos de teclado):
 *  - no fim/início de um trecho formatado → sai dele (o que você digitar fica sem o formato);
 *  - no meio → remove o formato do trecho inteiro;
 *  - fora → insere as marcações com o cursor no meio (ex.: "**|**").
 */
function toggleAtCursor(state: EditorState, range: SelectionRange, format: InlineFormat): { changes?: ChangeSpec; range: SelectionRange } {
  if (format === 'color') return { range } // cor só se aplica a texto selecionado
  const line = state.doc.lineAt(range.head)
  const el = findElements(state, line.from, line.to).find((e) => e.format === format && e.openTo <= range.head && range.head <= e.closeFrom)
  if (el && el.closeFrom > el.openTo) {
    if (range.head === el.closeFrom) return { range: EditorSelection.cursor(el.to) }
    if (range.head === el.openTo) return { range: EditorSelection.cursor(el.from) }
  }
  if (el) {
    const changes = state.changes([
      { from: el.from, to: el.openTo },
      { from: el.closeFrom, to: el.to },
    ])
    return { changes, range: EditorSelection.cursor(changes.mapPos(range.head, 1)) }
  }
  const [open, close] = markersFor(format)
  return { changes: { from: range.head, insert: open + close }, range: EditorSelection.cursor(range.head + open.length) }
}

/**
 * Liga/desliga um formato na seleção. Se toda a seleção já tem o formato, ele é
 * removido (só do trecho selecionado); senão, é aplicado a tudo.
 * Para 'color': aplicar a mesma cor de novo remove a cor.
 */
export function toggleFormat(view: EditorView, format: InlineFormat, color?: string): boolean {
  const { state } = view
  treeFor(state, state.selection.ranges.at(-1)!.to)
  const transaction = state.changeByRange((range) => {
    if (range.empty) return toggleAtCursor(state, range, format)
    const { segments, perLine } = preparedSegments(state, range)
    if (!segments.length) return { range }
    const containers = segments.map((seg, i) => containerOf(perLine[i]!, seg, format))
    const remove = containers.every((el) => el && (format !== 'color' || !color || sameColor(el.color, color)))
    const specs: ChangeSpec[] = []
    segments.forEach((seg, i) => {
      if (remove) specs.push(...removeFromSegment(state, seg, containers[i]!, perLine[i]!))
      else specs.push(...applyToSegment(state, seg, perLine[i]!, format, color))
    })
    const changes = state.changes(specs)
    const first = segments[0]!
    const last = segments.at(-1)!
    return { changes, range: EditorSelection.range(changes.mapPos(first.from, 1), changes.mapPos(last.to, -1)) }
  })
  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input.format' }))
  return true
}

/** "Cor padrão": tira a cor do trecho selecionado (o que estiver fora da seleção continua colorido). */
export function clearColor(view: EditorView): boolean {
  const { state } = view
  treeFor(state, state.selection.ranges.at(-1)!.to)
  const transaction = state.changeByRange((range) => {
    const { segments, perLine } = preparedSegments(state, range)
    const specs: ChangeSpec[] = []
    segments.forEach((seg, i) => {
      for (const el of perLine[i]!) {
        if (el.format !== 'color' || !(el.openTo < seg.to && seg.from < el.closeFrom)) continue
        specs.push(...removeFromSegment(state, { ...seg, from: Math.max(seg.from, el.openTo), to: Math.min(seg.to, el.closeFrom) }, el, perLine[i]!))
      }
    })
    if (!specs.length) return { range }
    const changes = state.changes(specs)
    return { changes, range: EditorSelection.range(changes.mapPos(range.from, 1), changes.mapPos(range.to, -1)) }
  })
  view.dispatch(state.update(transaction, { userEvent: 'input.format' }))
  return true
}

/** Remove toda a formatação inline que encosta na seleção. */
export function clearFormatting(view: EditorView): boolean {
  const { state } = view
  treeFor(state, state.selection.main.to)
  const transaction = state.changeByRange((range) => {
    const specs: ChangeSpec[] = []
    const seen = new Set<string>()
    for (const seg of segmentsOf(state, range)) {
      for (const el of findElements(state, seg.lineFrom, seg.lineTo)) {
        const key = `${el.format}:${el.from}:${el.to}`
        if (seen.has(key) || el.to < seg.from || el.from > seg.to) continue
        seen.add(key)
        specs.push({ from: el.from, to: el.openTo }, { from: el.closeFrom, to: el.to })
      }
    }
    const changes = state.changes(specs)
    return { changes, range: EditorSelection.range(changes.mapPos(range.from, 1), changes.mapPos(range.to, -1)) }
  })
  view.dispatch(state.update(transaction, { userEvent: 'input.format' }))
  return true
}

/** [texto](https://) com o endereço selecionado, pronto para colar o link. */
export function insertLink(view: EditorView): boolean {
  const { state } = view
  const transaction = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const insert = `[${text}](https://)`
    const urlFrom = range.from + text.length + 3
    return {
      changes: { from: range.from, to: range.to, insert },
      range: text ? EditorSelection.range(urlFrom, urlFrom + 'https://'.length) : EditorSelection.cursor(range.from + 1),
    }
  })
  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input.format' }))
  return true
}

// ── Formatos de linha (título, lista, lista de tarefas) ──────────────────────

const HEADING_RE = /^(\s{0,3})#{1,6}\s+/
const TASK_RE = /^(\s*)[-*+]\s+\[[ xX]\]\s+/
const BULLET_RE = /^(\s*)[-*+]\s+/
const ORDERED_RE = /^(\s*)\d+[.)]\s+/

function lineKind(text: string): LineFormat | 'ordered' | null {
  if (HEADING_RE.test(text)) return 'heading'
  if (TASK_RE.test(text)) return 'task'
  if (BULLET_RE.test(text)) return 'bullet'
  if (ORDERED_RE.test(text)) return 'ordered'
  return null
}

/** Remove o prefixo de título/lista e devolve [indentação, texto]. */
function stripPrefix(text: string): [string, string] {
  for (const re of [HEADING_RE, TASK_RE, BULLET_RE, ORDERED_RE]) {
    const match = re.exec(text)
    if (match) return [match[1] ?? '', text.slice(match[0].length)]
  }
  const indent = /^\s*/.exec(text)![0]
  return [indent, text.slice(indent.length)]
}

const LINE_PREFIX: Record<LineFormat, string> = { heading: '# ', bullet: '- ', task: '- [ ] ' }

/** Liga/desliga título, lista ou lista de tarefas nas linhas da seleção. */
export function toggleLineFormat(view: EditorView, format: LineFormat): boolean {
  const { state } = view
  const lines = new Map<number, { from: number; to: number; text: string }>()
  for (const range of state.selection.ranges) {
    for (let line = state.doc.lineAt(range.from); ; line = state.doc.line(line.number + 1)) {
      if (line.text.trim() || range.empty) lines.set(line.number, line)
      if (line.to >= range.to || line.number >= state.doc.lines) break
    }
  }
  const targets = [...lines.values()]
  if (!targets.length) return false
  const removing = targets.every((line) => lineKind(line.text) === format)
  const changes = targets.map((line) => {
    const [indent, body] = stripPrefix(line.text)
    let next: string
    if (removing) next = indent + body
    else if (format === 'heading') next = LINE_PREFIX.heading + body // títulos ficam no início da linha
    else next = indent + LINE_PREFIX[format] + body
    return { from: line.from, to: line.to, insert: next }
  })
  view.dispatch(state.update({ changes, userEvent: 'input.format', scrollIntoView: true }))
  return true
}

// ── Atalhos ──────────────────────────────────────────────────────────────────

export const formatCommand = (format: InlineFormat): Command => (view) => toggleFormat(view, format)

export const formattingKeymap = [
  { key: 'Mod-b', run: formatCommand('bold') },
  { key: 'Mod-i', run: formatCommand('italic') },
  { key: 'Mod-u', run: formatCommand('underline') },
  { key: 'Mod-Shift-x', run: formatCommand('strike') },
  { key: 'Mod-Shift-h', run: formatCommand('highlight') },
  { key: 'Mod-e', run: formatCommand('code') },
]

// ── Prévia ao vivo ───────────────────────────────────────────────────────────

/**
 * Sublinhado e cor usam tags HTML, longas demais para aparecer quando o cursor
 * encosta (o texto "pularia" sob o mouse). Por isso elas ficam sempre escondidas.
 */
const HTML_FORMATS: ReadonlySet<InlineFormat> = new Set<InlineFormat>(['underline', 'color'])

/** Trecho de sublinhado/cor com texto: as tags dele ficam sempre escondidas. */
const hasHiddenTags = (el: FormatElement) => HTML_FORMATS.has(el.format) && el.closeFrom > el.openTo

const hiddenMarkup = Decoration.replace({})
const visibleHtmlMarkup = Decoration.mark({ class: 'cm-fmt-markup' })
const underlineMark = Decoration.mark({ class: 'cm-fmt-underline' })
const highlightMark = Decoration.mark({ class: 'cm-fmt-highlight' })
const colorMarks = new Map<string, Decoration>()

function colorMark(color: string): Decoration | null {
  const css = cssColor(color)
  if (!css) return null
  let mark = colorMarks.get(css)
  if (!mark) {
    mark = Decoration.mark({ class: 'cm-fmt-color', attributes: { style: `color: ${css}` } })
    colorMarks.set(css, mark)
  }
  return mark
}

function buildPreview(view: EditorView): { decorations: DecorationSet; tags: DecorationSet } {
  const { state } = view
  const visible = view.visibleRanges
  if (!visible.length) return { decorations: Decoration.none, tags: Decoration.none }
  const ranges: Range<Decoration>[] = []
  const tags: Range<Decoration>[] = []
  // Sem foco, tudo fica limpo; com foco, as marcações Markdown do trecho onde está o cursor aparecem.
  const selection = view.hasFocus ? state.selection.ranges : []
  const from = state.doc.lineAt(visible[0]!.from).from
  const to = state.doc.lineAt(visible.at(-1)!.to).to
  for (const el of findElements(state, from, to)) {
    const hasContent = el.closeFrom > el.openTo
    if (hasContent && el.format === 'underline') ranges.push(underlineMark.range(el.openTo, el.closeFrom))
    if (hasContent && el.format === 'highlight') ranges.push(highlightMark.range(el.openTo, el.closeFrom))
    if (hasContent && el.format === 'color') {
      const mark = colorMark(el.color ?? '')
      if (mark) ranges.push(mark.range(el.openTo, el.closeFrom))
    }
    if (hasHiddenTags(el)) {
      const open = hiddenMarkup.range(el.from, el.openTo)
      const close = hiddenMarkup.range(el.closeFrom, el.to)
      ranges.push(open, close)
      tags.push(open, close)
    } else if (HTML_FORMATS.has(el.format)) {
      // Ainda sem texto (ex.: Ctrl+U sem seleção): as tags aparecem até você digitar.
      ranges.push(visibleHtmlMarkup.range(el.from, el.openTo), visibleHtmlMarkup.range(el.closeFrom, el.to))
    } else if (hasContent && !selection.some((range) => range.from <= el.to && range.to >= el.from)) {
      ranges.push(hiddenMarkup.range(el.from, el.openTo), hiddenMarkup.range(el.closeFrom, el.to))
    }
  }
  return { decorations: Decoration.set(ranges, true), tags: Decoration.set(tags, true) }
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    /** Tags HTML escondidas: o cursor pula por cima delas (atomicRanges). */
    tags: DecorationSet
    constructor(view: EditorView) {
      ;({ decorations: this.decorations, tags: this.tags } = buildPreview(view))
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        ;({ decorations: this.decorations, tags: this.tags } = buildPreview(update.view))
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.tags ?? Decoration.none),
  },
)

// ── Edição com as tags escondidas ────────────────────────────────────────────
//
// Como as tags de sublinhado/cor nunca aparecem, digitar ou apagar não pode
// quebrá-las pela metade (senão "<span style=…" surgiria no meio do texto):
//  - edições do usuário não alteram as tags (o texto em volta, sim);
//  - ←/→ e Backspace/Delete encostados numa tag agem no caractere visível do outro lado;
//  - Enter no meio de um trecho fecha o trecho nesta linha e o reabre na de baixo;
//  - um trecho que fica sem texto some junto com as tags;
//  - copiar parte de um trecho leva as tags completas.

/** Trechos de sublinhado/cor (com texto) nas linhas de `from` até `to`. */
function htmlElements(state: EditorState, from: number, to: number): FormatElement[] {
  return findElements(state, state.doc.lineAt(from).from, state.doc.lineAt(to).to).filter(hasHiddenTags)
}

/** Digitação, colagem, apagar, arrastar… (não os comandos de formatação, desfazer ou recarregar). */
const isUserEdit = (tr: Transaction) =>
  (tr.isUserEvent('input') && !tr.isUserEvent('input.format')) || tr.isUserEvent('delete') || tr.isUserEvent('move')

const protectTags = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged || !isUserEdit(tr)) return true
  let from = Infinity
  let to = -Infinity
  tr.changes.iterChangedRanges((fromA, toA) => {
    from = Math.min(from, fromA)
    to = Math.max(to, toA)
  })
  const tags = htmlElements(tr.startState, from, to)
    .flatMap((el) => [[el.from, el.openTo], [el.closeFrom, el.to]])
    .sort((a, b) => a[0]! - b[0]!)
  return tags.length ? tags.flat() : true
})

/** Tag de abertura (sublinhado ou cor) no fim do texto. */
const OPEN_TAG_AT_END = /(?:<u>|<span\s+style\s*=\s*(["'])\s*color\s*:\s*[#\w(),.%\s-]+?\s*;?\s*\1\s*>)$/i

/** Tags vazias em volta da posição `at` da linha (ex.: "<u>|</u>"): [início, fim] ou null. */
function emptyTagsAround(text: string, at: number): [number, number] | null {
  let start = at
  let end = at
  for (let open = OPEN_TAG_AT_END.exec(text.slice(0, start)); open; open = OPEN_TAG_AT_END.exec(text.slice(0, start))) {
    const close = open[0].toLowerCase() === '<u>' ? '</u>' : '</span>'
    if (text.slice(end, end + close.length).toLowerCase() !== close) break
    start -= open[0].length
    end += close.length
  }
  return start < at ? [start, end] : null
}

/** Depois de apagar, o trecho que ficou sem texto some com as tags. */
const removeEmptiedTags = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent('delete') || tr.isUserEvent('move'))) return tr
  const removals: { from: number; to: number }[] = []
  tr.changes.iterChanges((fromA, toA, fromB) => {
    if (toA === fromA || isInCode(tr.startState, fromA)) return
    const line = tr.newDoc.lineAt(fromB)
    const run = emptyTagsAround(line.text, fromB - line.from)
    if (run && !removals.some((r) => r.from < line.from + run[1] && line.from + run[0] < r.to)) {
      removals.push({ from: line.from + run[0], to: line.from + run[1] })
    }
  })
  return removals.length ? [tr, { changes: removals, sequential: true }] : tr
})

/** Posição depois de pular as tags escondidas encostadas em `pos`. */
function skipTags(state: EditorState, pos: number, forward: boolean): number {
  const elements = htmlElements(state, pos, pos)
  for (let moved = true; moved; ) {
    moved = false
    for (const el of elements) {
      for (const [from, to] of [[el.from, el.openTo], [el.closeFrom, el.to]] as const) {
        if (forward ? from === pos : to === pos) {
          pos = forward ? to : from
          moved = true
        }
      }
    }
  }
  return pos
}

/**
 * Backspace/Delete: "<u>|</u>" (formato ainda sem texto) apaga as tags; encostado
 * numa tag escondida, o cursor passa por ela e o comando normal apaga o caractere
 * visível do outro lado.
 */
function deleteAcrossTags(forward: boolean): Command {
  return (view) => {
    const { state } = view
    if (!state.selection.ranges.every((range) => range.empty)) return false
    const { head } = state.selection.main
    const line = state.doc.lineAt(head)
    const pending = state.selection.ranges.length === 1 && !isInCode(state, head) ? emptyTagsAround(line.text, head - line.from) : null
    if (pending) {
      view.dispatch(state.update({ changes: { from: line.from + pending[0], to: line.from + pending[1] }, userEvent: 'delete' }))
      return true
    }
    let moved = false
    const ranges = state.selection.ranges.map((range) => {
      const pos = skipTags(state, range.head, forward)
      if (pos !== range.head) moved = true
      return EditorSelection.cursor(pos)
    })
    if (moved) view.dispatch({ selection: EditorSelection.create(ranges, state.selection.mainIndex) })
    return false // segue para o Backspace/Delete normal
  }
}

/**
 * Enter dentro de um trecho com sublinhado/cor: no começo ou no fim, sai do trecho
 * antes de quebrar a linha; no meio, fecha o trecho aqui e o reabre depois da quebra.
 * O Enter normal (que também continua listas) roda em seguida.
 */
export function breakOutOfTags(view: EditorView): boolean {
  if (view.state.selection.ranges.length !== 1) return false
  const selected = view.state.selection.main
  if (!htmlElements(view.state, selected.from, selected.to).length) return false
  if (!selected.empty) view.dispatch(view.state.update(view.state.replaceSelection(''), { userEvent: 'delete.selection' }))

  const { state } = view
  const head = state.selection.main.head
  const elements = htmlElements(state, head, head)
  let pos = head
  for (let moved = true; moved; ) {
    moved = false
    for (const el of elements) {
      if (el.closeFrom === pos) {
        pos = el.to
        moved = true
      }
    }
  }
  for (let moved = pos === head; moved; ) {
    moved = false
    for (const el of elements) {
      if (el.openTo === pos) {
        pos = el.from
        moved = true
      }
    }
  }
  const inside = elements.filter((el) => el.openTo < pos && pos < el.closeFrom) // de fora para dentro
  if (pos === head && !inside.length) return false
  const closing = inside.map((el) => state.sliceDoc(el.closeFrom, el.to)).reverse().join('')
  const opening = inside.map((el) => state.sliceDoc(el.from, el.openTo)).join('')
  view.dispatch(
    state.update({
      changes: inside.length ? { from: pos, insert: closing + opening } : [],
      selection: EditorSelection.cursor(pos + closing.length),
      userEvent: 'input.format',
    }),
  )
  return false
}

/** ←/→ (com ou sem Shift): atravessar uma tag escondida não "gasta" a tecla — o cursor sempre anda na tela. */
function stepOverTags(move: Command): Command {
  return (view) => {
    if (view.state.selection.ranges.length !== 1) return false
    const before = view.state.selection.main.head
    if (!move(view)) return false
    const { anchor, head } = view.state.selection.main
    if (head === before) return true
    const forward = head > before
    const edge = skipTags(view.state, before, forward)
    if (forward ? head <= edge : head >= edge) {
      view.dispatch({ selection: anchor === head ? EditorSelection.cursor(edge) : EditorSelection.range(anchor, edge) })
      move(view)
    }
    return true
  }
}

/** Texto copiado com as tags completas: parte de um trecho colorido continua colorida ao colar. */
export function balancedSlice(state: EditorState, from: number, to: number): string {
  let prefix = ''
  let suffix = ''
  let start = from
  let end = to
  for (const el of htmlElements(state, from, to)) {
    const opensBefore = el.from < from
    const closesAfter = el.to > to
    if (el.to <= from || el.from >= to || (!opensBefore && !closesAfter)) continue
    const hasText = Math.max(from, el.openTo) < Math.min(to, el.closeFrom)
    if (hasText) {
      if (opensBefore) prefix += state.sliceDoc(el.from, el.openTo)
      if (closesAfter) suffix = state.sliceDoc(el.closeFrom, el.to) + suffix
    } else if (closesAfter) {
      end = Math.min(end, el.from) // só a tag de abertura entrou na seleção: fica de fora
    } else {
      start = Math.max(start, el.to) // só a de fechamento
    }
  }
  return prefix + state.sliceDoc(start, Math.max(start, end)) + suffix
}

const balancedClipboard = EditorView.clipboardOutputFilter.of((text, state) => {
  const ranges = state.selection.ranges.filter((range) => !range.empty)
  if (ranges.map((range) => state.sliceDoc(range.from, range.to)).join(state.lineBreak) === text) {
    return ranges.map((range) => balancedSlice(state, range.from, range.to)).join(state.lineBreak)
  }
  const { main } = state.selection
  return !main.empty && state.sliceDoc(main.from, main.to) === text ? balancedSlice(state, main.from, main.to) : text
})

export const deleteBackwardAcrossTags = deleteAcrossTags(false)
export const deleteForwardAcrossTags = deleteAcrossTags(true)

/** Comportamentos de edição que mantêm as tags escondidas inteiras (ver acima). */
export const hiddenTagEditing: Extension = [
  protectTags,
  removeEmptiedTags,
  balancedClipboard,
  Prec.highest(
    keymap.of([
      { key: 'Backspace', run: deleteBackwardAcrossTags, shift: deleteBackwardAcrossTags },
      { key: 'Delete', run: deleteForwardAcrossTags },
      { key: 'Mod-Backspace', mac: 'Alt-Backspace', run: deleteBackwardAcrossTags },
      { key: 'Mod-Delete', mac: 'Alt-Delete', run: deleteForwardAcrossTags },
      { key: 'Enter', run: breakOutOfTags, shift: breakOutOfTags },
      { key: 'ArrowLeft', run: stepOverTags(cursorCharLeft), shift: stepOverTags(selectCharLeft) },
      { key: 'ArrowRight', run: stepOverTags(cursorCharRight), shift: stepOverTags(selectCharRight) },
    ]),
  ),
]
