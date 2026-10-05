/**
 * Formatação de texto no editor: negrito, itálico, sublinhado, cor, links, listas…
 *
 * O arquivo continua sendo Markdown comum:
 *   **negrito**   *itálico*   ~~tachado~~   ==marca-texto==   `código`   [texto](endereço)
 * Sublinhado e cor não existem no Markdown, então usam HTML simples (que o
 * Obsidian e outros visualizadores também entendem):
 *   <u>sublinhado</u>   <span style="color: red">colorido</span>
 *
 * As marcações NUNCA aparecem no editor: o texto simplesmente fica em negrito,
 * colorido… Para tirar um formato, selecione o texto e desligue-o na barra (ou no
 * atalho). A leitura dos trechos fica em elements.ts e a edição com as marcações
 * escondidas, em hidden-markup.ts.
 */
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type ChangeSpec, type Range, type SelectionRange, type StateEffect } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type Command, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import {
  cssColor,
  findElements,
  hasContent,
  hasHiddenMarkup,
  linkDestination,
  linkLabel,
  markersFor,
  sameColor,
  type FormatElement,
  type InlineFormat,
} from './elements'
import {
  balancedSlice,
  breakOutOfMarkup,
  deleteBackwardAcrossMarkup,
  deleteForwardAcrossMarkup,
  hiddenMarkupEditing,
  storedFormats,
  toggleStoredFormat,
} from './hidden-markup'

export { cssColor, findElements, linkAt, type ElementKind, type FormatElement, type InlineFormat } from './elements'
export { balancedSlice, storedFormats } from './hidden-markup'
/** Nomes antigos (1.2.0), usados pelos testes. */
export const hiddenTagEditing = hiddenMarkupEditing
export const breakOutOfTags = breakOutOfMarkup
export const deleteBackwardAcrossTags = deleteBackwardAcrossMarkup
export const deleteForwardAcrossTags = deleteForwardAcrossMarkup

export type LineFormat = 'heading' | 'bullet' | 'task'

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
function containerOf(elements: FormatElement[], seg: { from: number; to: number }, format: FormatElement['format']): FormatElement | undefined {
  return elements.find((el) => el.format === format && el.openTo <= seg.from && seg.to <= el.closeFrom)
}

export interface ActiveFormats {
  formats: Set<InlineFormat>
  color: string | null
  /** Endereço do link em que a seleção está (null = fora de link). */
  link: string | null
}

/** Formatos ativos na seleção principal (para destacar os botões da barra). */
export function activeFormats(state: EditorState): ActiveFormats {
  const range = state.selection.main
  const formats = new Set<InlineFormat>()
  if (range.empty) {
    for (const stored of storedFormats(state)) formats.add(stored.format)
    return { formats, color: null, link: null }
  }
  treeFor(state, range.to)
  const { segments, perLine } = preparedSegments(state, range)
  if (!segments.length) return { formats, color: null, link: null }
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
  const links = segments.map((seg, i) => containerOf(perLine[i]!, seg, 'link'))
  const link = links.every(Boolean) && links.every((el) => el!.url === links[0]!.url) ? (links[0]!.url ?? null) : null
  return { formats, color, link }
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
 *  - fora → o formato fica guardado para o que você digitar em seguida (nada é escrito
 *    no arquivo até lá; Ctrl+B de novo desliga).
 */
function toggleAtCursor(
  state: EditorState,
  range: SelectionRange,
  format: InlineFormat,
): { changes?: ChangeSpec; range: SelectionRange; effects?: StateEffect<unknown> } {
  if (format === 'color') return { range } // cor só se aplica a texto selecionado
  const line = state.doc.lineAt(range.head)
  const el = findElements(state, line.from, line.to).find((e) => e.format === format && e.openTo <= range.head && range.head <= e.closeFrom)
  if (el && hasContent(el)) {
    // Sai do trecho: o cursor fica "colado" no texto de fora
    if (range.head === el.closeFrom) return { range: EditorSelection.cursor(el.to, 1) }
    if (range.head === el.openTo) return { range: EditorSelection.cursor(el.from, -1) }
  }
  if (el) {
    const changes = state.changes([
      { from: el.from, to: el.openTo },
      { from: el.closeFrom, to: el.to },
    ])
    return { changes, range: EditorSelection.cursor(changes.mapPos(range.head, 1)) }
  }
  return { range, effects: toggleStoredFormat(state, format) }
}

/**
 * Liga/desliga um formato na seleção. Se toda a seleção já tem o formato, ele é
 * removido (só do trecho selecionado); senão, é aplicado a tudo.
 * Para 'color': aplicar a mesma cor de novo remove a cor.
 */
export function toggleFormat(view: EditorView, format: InlineFormat, color?: string): boolean {
  const { state } = view
  treeFor(state, state.selection.ranges.at(-1)!.to)
  const single = state.selection.ranges.length === 1
  const transaction = state.changeByRange((range) => {
    if (range.empty) {
      const result = toggleAtCursor(state, range, format)
      // Formato guardado só com um cursor (vários cursores: nada a fazer)
      return single || !result.effects ? result : { range }
    }
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

/** Remove toda a formatação inline que encosta na seleção (os links ficam). */
export function clearFormatting(view: EditorView): boolean {
  const { state } = view
  treeFor(state, state.selection.main.to)
  const transaction = state.changeByRange((range) => {
    const specs: ChangeSpec[] = []
    const seen = new Set<string>()
    for (const seg of segmentsOf(state, range)) {
      for (const el of findElements(state, seg.lineFrom, seg.lineTo)) {
        const key = `${el.format}:${el.from}:${el.to}`
        if (el.format === 'link' || seen.has(key) || el.to < seg.from || el.from > seg.to) continue
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

// ── Links ────────────────────────────────────────────────────────────────────

/** Endereço digitado/colado pronto para virar link: "nuxt.com" → "https://nuxt.com". */
export function normalizeLinkUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text || /\s/.test(text)) return null
  if (/^(https?:|mailto:)/i.test(text)) return text
  if (/^[\w-]+(\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/.test(text)) return `https://${text}`
  return null
}

/**
 * Transforma a seleção em link (ou troca o endereço do link em que ela está).
 * Cada linha da seleção vira um link próprio.
 */
export function setLink(view: EditorView, url: string): boolean {
  const { state } = view
  const destination = linkDestination(url)
  if (!destination) return false
  treeFor(state, state.selection.ranges.at(-1)!.to)
  const transaction = state.changeByRange((range) => {
    const { segments, perLine } = preparedSegments(state, range)
    const specs: ChangeSpec[] = []
    segments.forEach((seg, i) => {
      const links = perLine[i]!.filter((el) => el.format === 'link' && el.from < seg.to && seg.from < el.to)
      const container = links.find((el) => el.openTo <= seg.from && seg.to <= el.closeFrom)
      if (container) {
        specs.push({ from: container.closeFrom, to: container.to, insert: `](${destination})` })
        return
      }
      // Links que encostam na seleção se juntam ao novo (sem link dentro de link)
      const from = Math.min(seg.from, ...links.map((el) => el.from))
      const to = Math.max(seg.to, ...links.map((el) => el.to))
      const cuts = links.flatMap((el): [number, number][] => [[el.from, el.openTo], [el.closeFrom, el.to]]).sort((a, b) => a[0] - b[0])
      let text = ''
      let pos = from
      for (const [a, b] of cuts) {
        text += state.sliceDoc(pos, a)
        pos = b
      }
      text += state.sliceDoc(pos, to)
      specs.push({ from, to, insert: `[${linkLabel(text)}](${destination})` })
    })
    if (!specs.length) return { range }
    const changes = state.changes(specs)
    return { changes, range: EditorSelection.range(changes.mapPos(range.from, 1), changes.mapPos(range.to, -1)) }
  })
  view.dispatch(state.update(transaction, { userEvent: 'input.format', scrollIntoView: true }))
  return true
}

/** Tira os links que encostam na seleção (o texto fica). */
export function removeLink(view: EditorView): boolean {
  const { state } = view
  treeFor(state, state.selection.main.to)
  const specs: ChangeSpec[] = []
  const seen = new Set<number>()
  for (const range of state.selection.ranges) {
    for (let line = state.doc.lineAt(range.from); ; line = state.doc.line(line.number + 1)) {
      for (const el of findElements(state, line.from, line.to)) {
        if (el.format !== 'link' || seen.has(el.from) || el.to < range.from || el.from > range.to) continue
        seen.add(el.from)
        specs.push({ from: el.from, to: el.openTo }, { from: el.closeFrom, to: el.to })
      }
      if (line.to >= range.to || line.number >= state.doc.lines) break
    }
  }
  if (!specs.length) return false
  view.dispatch(state.update({ changes: specs, userEvent: 'input.format' }))
  return true
}

let lastContextMenu: { view: EditorView; pos: number; at: number } | null = null

/** Guarda onde foi o clique direito (o menu oferece abrir, editar ou remover o link dali). */
export const contextMenuTracking = EditorView.domEventHandlers({
  contextmenu(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    lastContextMenu = pos === null ? null : { view, pos, at: Date.now() }
    return false
  },
})

/** Link sob o clique direito que acabou de acontecer num editor (null se não foi num link). */
export function linkAtContextMenu(): { view: EditorView; link: FormatElement } | null {
  const context = lastContextMenu
  if (!context || Date.now() - context.at > 3000 || !context.view.dom.isConnected) return null
  const { view, pos } = context
  if (pos > view.state.doc.length) return null
  const line = view.state.doc.lineAt(pos)
  const link = findElements(view.state, line.from, line.to).find((el) => el.format === 'link' && el.from <= pos && pos <= el.to)
  return link ? { view, link } : null
}

/** Seleciona o texto do link em `pos` (para editar ou remover pelo menu). */
export function selectLinkAt(view: EditorView, pos: number): FormatElement | null {
  const line = view.state.doc.lineAt(pos)
  const link = findElements(view.state, line.from, line.to).find((el) => el.format === 'link' && el.from <= pos && pos <= el.to)
  if (!link) return null
  view.dispatch({ selection: EditorSelection.range(link.openTo, link.closeFrom) })
  return link
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

// ── Prévia: as marcações nunca aparecem ──────────────────────────────────────

const hiddenMarkup = Decoration.replace({})
const underlineMark = Decoration.mark({ class: 'cm-fmt-underline' })
const highlightMark = Decoration.mark({ class: 'cm-fmt-highlight' })
const colorMarks = new Map<string, Decoration>()
const linkMarks = new Map<string, Decoration>()

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

/** Texto do link: sublinhado discreto e a dica com o endereço. */
function linkMark(url: string): Decoration {
  let mark = linkMarks.get(url)
  if (!mark) {
    mark = Decoration.mark({ class: 'cm-md-link', attributes: { 'data-tip': `Ctrl+clique para abrir · ${url}`, 'data-url': url } })
    if (linkMarks.size > 500) linkMarks.clear()
    linkMarks.set(url, mark)
  }
  return mark
}

function buildPreview(view: EditorView): { decorations: DecorationSet; atoms: DecorationSet } {
  const { state } = view
  const visible = view.visibleRanges
  if (!visible.length) return { decorations: Decoration.none, atoms: Decoration.none }
  const ranges: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  const from = state.doc.lineAt(visible[0]!.from).from
  const to = state.doc.lineAt(visible.at(-1)!.to).to
  for (const el of findElements(state, from, to)) {
    const content = hasContent(el)
    if (content && el.format === 'underline') ranges.push(underlineMark.range(el.openTo, el.closeFrom))
    if (content && el.format === 'highlight') ranges.push(highlightMark.range(el.openTo, el.closeFrom))
    if (content && el.format === 'color') {
      const mark = colorMark(el.color ?? '')
      if (mark) ranges.push(mark.range(el.openTo, el.closeFrom))
    }
    if (content && el.format === 'link' && el.url) ranges.push(linkMark(el.url).range(el.openTo, el.closeFrom))
    if (!hasHiddenMarkup(el)) continue
    for (const [a, b] of [[el.from, el.openTo], [el.closeFrom, el.to]] as const) {
      if (b <= a) continue
      ranges.push(hiddenMarkup.range(a, b))
      atoms.push(hiddenMarkup.range(a, b))
    }
  }
  return { decorations: Decoration.set(ranges, true), atoms: Decoration.set(atoms, true) }
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    /** Marcações escondidas: o cursor pula por cima delas (atomicRanges). */
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

/** Texto copiado (usado pelos testes e pela área de transferência). */
export const copiedText = balancedSlice
