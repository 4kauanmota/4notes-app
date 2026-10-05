/**
 * Edição com as marcações SEMPRE escondidas (negrito, itálico, sublinhado,
 * tachado, marca-texto, código, cor e links — ver elements.ts).
 *
 * Como as marcações nunca aparecem, quem edita não pode quebrá-las sem perceber:
 *  - digitar, colar ou apagar mexe só no texto em volta, nunca em parte de uma
 *    marcação (protectMarkup);
 *  - um trecho que fica sem texto some junto com as marcações;
 *  - no Markdown, "**olá **" não é negrito (espaço encostado por dentro): o espaço
 *    vai para fora da marcação e o que você digitar depois continua formatado
 *    (keepMarkupValid + formatos guardados);
 *  - Ctrl+B sem seleção não escreve "****" no texto: o negrito fica guardado para
 *    o que você digitar em seguida (também com acentos digitados por composição);
 *  - ←/→ e Backspace/Delete encostados numa marcação agem no caractere visível do
 *    outro lado; Enter no meio de um trecho fecha o trecho nesta linha e o reabre
 *    na de baixo;
 *  - clicar logo depois de um texto em negrito (ou End) e digitar continua em
 *    negrito, como no Word (links e código não continuam);
 *  - copiar parte de um trecho leva as marcações completas.
 */
import { cursorCharLeft, cursorCharRight, cursorLineBoundaryForward, selectCharLeft, selectCharRight } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import {
  Annotation,
  ChangeSet,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type ChangeSpec,
  type Extension,
  type SelectionRange,
  type Transaction,
} from '@codemirror/state'
import { EditorView, keymap, type Command } from '@codemirror/view'
import {
  FLANKING,
  findElements,
  hasContent,
  hiddenElements,
  INCLUSIVE,
  isInCode,
  markersFor,
  markupRanges,
  sameColor,
  type FormatElement,
  type InlineFormat,
} from './elements'
import { lineMarkerAt } from './line-markers'

/** Mudança feita pelo próprio editor nas marcações (ex.: dar os formatos guardados a um texto composto). */
const markupEdit = Annotation.define<boolean>()

/** Digitação, colagem, apagar, arrastar… (não os comandos de formatação, desfazer ou recarregar). */
export const isUserEdit = (tr: Transaction) =>
  ((tr.isUserEvent('input') && !tr.isUserEvent('input.format')) || tr.isUserEvent('delete') || tr.isUserEvent('move')) && !tr.annotation(markupEdit)

const isComposing = (tr: Transaction) => tr.isUserEvent('input.type.compose')

/** Trechos (com texto) que alcançam as linhas de [from, to]. */
const contentElements = (state: EditorState, from: number, to: number) => hiddenElements(state, from, to).filter(hasContent)

// ── 1. As marcações não são editadas pela metade ─────────────────────────────

const protectMarkup = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged || !isUserEdit(tr)) return true
  let from = Infinity
  let to = -Infinity
  tr.changes.iterChangedRanges((fromA, toA) => {
    from = Math.min(from, fromA)
    to = Math.max(to, toA)
  })
  const ranges = markupRanges(hiddenElements(tr.startState, from, to))
  return ranges.length ? ranges.flat() : true
})

// ── 2. Formatos guardados (para o próximo texto digitado) ───────────────────

export interface StoredFormat {
  format: InlineFormat
  color?: string
}

interface Stored {
  /** Onde o cursor está (o próximo texto digitado ali recebe os formatos). */
  pos: number
  formats: StoredFormat[]
  /** Começo do texto sendo digitado por composição (acentos, IME), ainda sem os formatos. */
  composeFrom: number | null
}

const setStored = StateEffect.define<Stored | null>()

const storedField = StateField.define<Stored | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setStored)) return effect.value
    if (!value) return null
    const pos = tr.changes.mapPos(value.pos, -1)
    const composeFrom = value.composeFrom === null ? null : tr.changes.mapPos(value.composeFrom, -1)
    if (isComposing(tr)) return { ...value, pos, composeFrom: composeFrom ?? pos }
    if (composeFrom !== null) return { ...value, pos, composeFrom } // a composição terminou: compositionend aplica
    const { main } = tr.newSelection
    if (tr.newSelection.ranges.length !== 1 || !main.empty || main.head !== pos) return null
    return pos === value.pos ? value : { ...value, pos }
  },
})

/** Formatos guardados no cursor (Ctrl+B sem seleção…). */
export function storedFormats(state: EditorState): StoredFormat[] {
  const stored = state.field(storedField, false)
  const { main } = state.selection
  return stored && main.empty && main.head === stored.pos ? stored.formats : []
}

/** Liga/desliga um formato guardado no cursor (efeito para a transação). */
export function toggleStoredFormat(state: EditorState, format: InlineFormat): StateEffect<Stored | null> {
  const pos = state.selection.main.head
  const current = storedFormats(state)
  const formats = current.some((item) => item.format === format) ? current.filter((item) => item.format !== format) : [...current, { format }]
  return setStored.of(formats.length ? { pos, formats, composeFrom: null } : null)
}

/**
 * Mudanças para dar os `formats` ao texto em [from, to) (que já está no documento)
 * ou ao `insert` digitado em `from`. Um trecho do mesmo formato que termina logo
 * antes (só com espaços no meio) é estendido em vez de abrir outro:
 * "**olá** |" + "m" → "**olá m**".
 */
function applyFormats(
  state: EditorState,
  from: number,
  to: number,
  insert: string | null,
  formats: StoredFormat[],
): { changes: ChangeSet; cursor: number } | null {
  const text = insert ?? state.sliceDoc(from, to)
  const core = text.trimEnd()
  if (!core.trim()) return null
  const trailingSpace = text.slice(core.length)
  const elements = contentElements(state, from, from)
  const removals: ChangeSpec[] = []
  const extended: FormatElement[] = []
  const opens: string[] = []
  const closes: string[] = []
  for (const stored of formats) {
    const previous = elements
      .filter((el) => el.format === stored.format && (stored.format !== 'color' || sameColor(el.color, stored.color)) && el.to <= from)
      .filter((el) => !state.sliceDoc(el.to, from).trim() && !extended.includes(el))
      .sort((a, b) => b.to - a.to)[0]
    if (previous) {
      extended.push(previous)
      removals.push({ from: previous.closeFrom, to: previous.to })
    } else {
      const [open, close] = markersFor(stored.format, stored.color)
      opens.push(open)
      closes.unshift(close)
    }
  }
  // Fechamentos dos trechos estendidos, de dentro para fora (quem fecha antes está por dentro)
  const moved = extended.sort((a, b) => a.to - b.to).map((el) => state.sliceDoc(el.closeFrom, el.to))
  const before = opens.join('')
  const after = closes.join('') + moved.join('')
  const changes =
    insert === null
      ? state.changes([...removals, { from, insert: before }, { from: from + core.length, insert: after }])
      : state.changes([...removals, { from, insert: before + core + after + trailingSpace }])
  const start = changes.mapPos(from, -1)
  return { changes, cursor: start + before.length + core.length }
}

/** Texto digitado no lugar dos formatos guardados recebe os formatos. */
const applyStoredFormats = EditorState.transactionFilter.of((tr) => {
  const stored = tr.startState.field(storedField, false)
  if (!stored || stored.composeFrom !== null || !tr.docChanged || isComposing(tr)) return tr
  if (!tr.isUserEvent('input.type') && !tr.isUserEvent('input.paste')) return tr
  let single: { fromA: number; toA: number; text: string } | null = null
  let count = 0
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count++
    single = { fromA, toA, text: inserted.toString() }
  })
  const change = single as { fromA: number; toA: number; text: string } | null
  if (count !== 1 || !change || change.fromA !== stored.pos || change.toA !== stored.pos || change.text.includes('\n')) return tr
  if (!change.text.trim()) return [tr, { effects: setStored.of({ ...stored, pos: stored.pos + change.text.length }) }]
  const result = applyFormats(tr.startState, stored.pos, stored.pos, change.text, stored.formats)
  if (!result) return tr
  // Espaço no fim do texto colado: os formatos continuam guardados depois dele
  const trailing = change.text.length - change.text.trimEnd().length
  const end = result.changes.newLength - (tr.startState.doc.length - stored.pos) // fim do que foi inserido
  return {
    changes: result.changes,
    // assoc -1: o cursor fica "colado" no texto formatado (o que vier depois entra nele)
    selection: EditorSelection.cursor(trailing ? end : result.cursor, -1),
    effects: setStored.of(trailing ? { ...stored, pos: end } : null),
    userEvent: 'input.type',
    scrollIntoView: true,
  }
})

/** Fim de uma composição (acentos, IME): o texto composto recebe os formatos guardados. */
function applyComposed(view: EditorView, attempt = 0): void {
  if (view.composing && attempt < 20) {
    setTimeout(() => applyComposed(view, attempt + 1), 30)
    return
  }
  const stored = view.state.field(storedField, false)
  if (!stored || stored.composeFrom === null) return
  const { main } = view.state.selection
  const from = stored.composeFrom
  const text = view.state.sliceDoc(from, main.head)
  const result = view.state.selection.ranges.length === 1 && main.empty && main.head > from && !text.includes('\n')
    ? applyFormats(view.state, from, main.head, null, stored.formats)
    : null
  if (!result) {
    view.dispatch({ effects: setStored.of(text.trim() ? null : { ...stored, pos: main.head, composeFrom: null }) })
    return
  }
  view.dispatch({
    changes: result.changes,
    selection: EditorSelection.cursor(result.cursor, -1),
    effects: setStored.of(null),
    userEvent: 'input.type',
    annotations: markupEdit.of(true),
  })
}

const compositionHandling = EditorView.domEventHandlers({
  compositionend(_event, view) {
    // Espera o CodeMirror ler a última mudança da composição
    setTimeout(() => applyComposed(view), 60)
    return false
  },
})

// ── 3. Marcações continuam válidas depois de cada edição ─────────────────────

interface Placed {
  format: FormatElement['format']
  color?: string
  from: number
  openTo: number
  closeFrom: number
  to: number
  open: string
  close: string
}

/** Onde o trecho `el` (do texto de antes) ficou depois das mudanças (null se as marcações não sobreviveram). */
function place(el: FormatElement, open: string, close: string, changes: ChangeSet, doc: EditorState['doc']): Placed | null {
  const from = changes.mapPos(el.from, 1)
  const openTo = changes.mapPos(el.openTo, -1)
  const closeFrom = changes.mapPos(el.closeFrom, 1)
  const to = changes.mapPos(el.to, -1)
  if (closeFrom < openTo || doc.sliceString(from, openTo) !== open || doc.sliceString(closeFrom, to) !== close) return null
  return { format: el.format, color: el.color, from, openTo, closeFrom, to, open, close }
}

/** O trecho continua sendo lido como um trecho formatado, nas mesmas posições? */
function isValid(state: EditorState, el: Placed): boolean {
  const lineFrom = state.doc.lineAt(el.from).from
  const lineTo = state.doc.lineAt(el.to).to
  ensureSyntaxTree(state, lineTo, 200)
  return findElements(state, lineFrom, lineTo).some(
    (other) => other.format === el.format && other.from === el.from && other.openTo === el.openTo && other.closeFrom === el.closeFrom && other.to === el.to,
  )
}

const PUNCTUATION = /[\p{P}\p{S}]/u

interface Repair {
  changes: ChangeSpec[]
  /** O trecho depois do conserto (null = as marcações saíram). */
  result: Placed | null
  /** Quantos caracteres saíram pela frente / pelo fim. */
  leading: number
  trailing: number
}

/**
 * Conserta um trecho que deixou de valer no Markdown: espaços encostados por
 * dentro (e, se ainda precisar, uma pontuação na ponta) vão para fora das marcações.
 */
function repair(state: EditorState, el: Placed): Repair | null {
  const content = state.sliceDoc(el.openTo, el.closeFrom)
  const lead = /^\s*/.exec(content)![0].length
  if (lead === content.length) {
    // Só espaços: o trecho deixa de existir (os espaços ficam)
    return { changes: [{ from: el.from, to: el.openTo }, { from: el.closeFrom, to: el.to }], result: null, leading: 0, trailing: 0 }
  }
  const trail = /\s*$/.exec(content)![0].length
  const others = markupRanges(contentElements(state, el.from, el.to))
  const isMarkup = (pos: number) => others.some(([a, b]) => a <= pos && pos < b)
  const punctuationAt = (pos: number) => PUNCTUATION.test(state.sliceDoc(pos, pos + 1)) && !isMarkup(pos)
  const candidates: [number, number][] = []
  if (lead || trail) candidates.push([lead, trail])
  const extraLead = punctuationAt(el.openTo + lead) ? 1 : 0
  const extraTrail = punctuationAt(el.closeFrom - trail - 1) ? 1 : 0
  if (extraTrail) candidates.push([lead, trail + extraTrail])
  if (extraLead) candidates.push([lead + extraLead, trail])
  if (extraLead && extraTrail) candidates.push([lead + extraLead, trail + extraTrail])
  for (const [l, t] of candidates) {
    if (l + t >= content.length) continue
    const changes: ChangeSpec[] = []
    if (l) changes.push({ from: el.openTo, to: el.openTo + l }, { from: el.from, insert: content.slice(0, l) })
    if (t) changes.push({ from: el.closeFrom - t, to: el.closeFrom }, { from: el.to, insert: content.slice(content.length - t) })
    const result: Placed = { ...el, from: el.from + l, openTo: el.openTo + l, closeFrom: el.closeFrom - t, to: el.to - t }
    if (isValid(state.update({ changes, filter: false }).state, result)) return { changes, result, leading: l, trailing: t }
  }
  return null
}

const keepMarkupValid = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !isUserEdit(tr) || isComposing(tr)) return tr
  let from = Infinity
  let to = -Infinity
  tr.changes.iterChangedRanges((fromA, toA) => {
    from = Math.min(from, fromA)
    to = Math.max(to, toA)
  })
  const start = tr.startState
  const old = contentElements(start, from, to)
  if (!old.length) return tr

  let state = tr.state
  let total = ChangeSet.empty(state.doc.length)
  const main = state.selection.main
  let cursor: number | null = main.empty && state.selection.ranges.length === 1 ? main.head : null
  /** Lado a que o cursor fica "colado" (-1: texto de antes; 1: texto de depois). */
  let assoc: -1 | 1 = -1
  const stored: StoredFormat[] = []
  // De dentro para fora: consertar o de dentro pode resolver (ou mudar) o de fora
  const placed = old
    .map((el) => place(el, start.sliceDoc(el.from, el.openTo), start.sliceDoc(el.closeFrom, el.to), tr.changes, state.doc))
    .filter((el): el is Placed => !!el)
    .sort((a, b) => a.to - a.from - (b.to - b.from))

  for (const original of placed) {
    // Posição atual (depois dos consertos anteriores)
    const el: Placed = {
      ...original,
      from: total.mapPos(original.from, 1),
      openTo: total.mapPos(original.openTo, -1),
      closeFrom: total.mapPos(original.closeFrom, 1),
      to: total.mapPos(original.to, -1),
    }
    if (state.sliceDoc(el.from, el.openTo) !== el.open || state.sliceDoc(el.closeFrom, el.to) !== el.close) continue
    let fix: Repair | null = null
    if (el.closeFrom === el.openTo) {
      // Ficou sem texto: some junto com as marcações
      fix = { changes: [{ from: el.from, to: el.openTo }, { from: el.closeFrom, to: el.to }], result: null, leading: 0, trailing: 0 }
    } else if (FLANKING.has(el.format) && !isValid(state, el)) {
      fix = repair(state, el)
    }
    if (!fix) continue
    const changes = state.changes(fix.changes)
    // Cursor no fim do trecho (por dentro) e o espaço saiu: ele fica depois do espaço,
    // e o que for digitado ali continua com o formato
    if (cursor !== null && fix.result && fix.trailing && cursor === el.closeFrom) {
      cursor = fix.result.to + fix.trailing
      assoc = -1
      if (el.format !== 'link') stored.push({ format: el.format, color: el.color })
    } else if (cursor !== null && fix.result && fix.leading && cursor >= el.openTo && cursor <= el.openTo + fix.leading) {
      cursor = fix.result.openTo
      assoc = 1
    } else if (cursor !== null) {
      cursor = changes.mapPos(cursor, cursor === el.from ? -1 : 1)
    }
    state = state.update({ changes, filter: false }).state
    total = total.compose(changes)
  }
  if (total.empty) return tr
  return [
    tr,
    {
      changes: total,
      sequential: true,
      ...(cursor !== null ? { selection: EditorSelection.cursor(cursor, assoc) } : {}),
      ...(stored.length && cursor !== null ? { effects: setStored.of({ pos: cursor, formats: stored, composeFrom: null }) } : {}),
    },
  ]
})

// ── 4. O texto digitado entra onde o cursor está ─────────────────────────────

/**
 * Do lado de dentro ou de fora de uma marcação escondida, o cursor fica no mesmo
 * lugar da tela — e o navegador às vezes põe a letra digitada do outro lado (ex.:
 * no fim da linha, depois de um link, ela entraria no texto do link). Aqui a letra
 * volta para onde o cursor realmente está.
 */
const keepTypingAtCursor = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input.type') || isComposing(tr)) return tr
  const start = tr.startState
  const { main } = start.selection
  if (start.selection.ranges.length !== 1 || !main.empty) return tr
  let insertion: { pos: number; text: string } | null = null
  let count = 0
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count++
    insertion = fromA === toA ? { pos: fromA, text: inserted.toString() } : null
  })
  const typed = insertion as { pos: number; text: string } | null
  if (count !== 1 || !typed || !typed.text || typed.pos === main.head) return tr
  const from = Math.min(typed.pos, main.head)
  const to = Math.max(typed.pos, main.head)
  if (to - from > 400) return tr
  // Entre a letra e o cursor só pode haver marcação escondida
  let covered = from
  for (const [a, b] of markupRanges(hiddenElements(start, from, to))) if (a <= covered && b > covered) covered = b
  if (covered < to) return tr
  return {
    changes: { from: main.head, insert: typed.text },
    selection: EditorSelection.cursor(main.head + typed.text.length, -1),
    userEvent: 'input.type',
    scrollIntoView: true,
  }
})

// ── 5. Clique e End no fim de um texto formatado continuam o formato ─────────

/**
 * Posição "de digitação" para um cursor em `pos`: logo depois de um trecho que
 * continua (negrito, cor…) o cursor vai para dentro dele; no fim de um link ou de
 * um código, vai para fora (digitar ali não aumenta o link); no começo da linha,
 * antes de um trecho que continua, vai para dentro dele.
 */
export function gravityPos(state: EditorState, pos: number): number {
  const elements = contentElements(state, pos, pos)
  for (let moved = true; moved; ) {
    moved = false
    for (const el of elements) {
      if (el.closeFrom === pos && !INCLUSIVE.has(el.format)) {
        pos = el.to
        moved = true
      }
    }
  }
  for (let moved = true; moved; ) {
    moved = false
    for (const el of elements) {
      if (el.to === pos && INCLUSIVE.has(el.format)) {
        pos = el.closeFrom
        moved = true
      }
    }
  }
  const line = state.doc.lineAt(pos)
  if (pos === line.from || pos === lineMarkerAt(state, line)?.to) {
    for (let moved = true; moved; ) {
      moved = false
      for (const el of elements) {
        if (el.from === pos && INCLUSIVE.has(el.format)) {
          pos = el.openTo
          moved = true
        }
      }
    }
  }
  return pos
}

/** Cursor numa posição "de digitação", colado no lado certo da marcação escondida. */
export function gravityCursor(state: EditorState, pos: number): SelectionRange | null {
  const target = gravityPos(state, pos)
  if (target === pos) return null
  // Dentro, no fim do trecho: colado no texto de antes; dentro, no começo: no de depois
  return EditorSelection.cursor(target, target < pos ? -1 : 1)
}

const pointerGravity = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || !tr.isUserEvent('select.pointer')) return tr
  const { main } = tr.selection
  if (tr.selection.ranges.length !== 1 || !main.empty) return tr
  const cursor = gravityCursor(tr.startState, main.head)
  return cursor ? [tr, { selection: EditorSelection.create([cursor]) }] : tr
})

const endWithGravity: Command = (view) => {
  if (!cursorLineBoundaryForward(view)) return false
  const { main } = view.state.selection
  if (view.state.selection.ranges.length === 1 && main.empty) {
    const cursor = gravityCursor(view.state, main.head)
    if (cursor) view.dispatch({ selection: EditorSelection.create([cursor]), userEvent: 'select' })
  }
  return true
}

// ── 6. Teclas encostadas nas marcações ───────────────────────────────────────

/** Tag de abertura (sublinhado ou cor) no fim do texto. */
const OPEN_TAG_AT_END = /(?:<u>|<span\s+style\s*=\s*(["'])\s*color\s*:\s*[#\w(),.%\s-]+?\s*;?\s*\1\s*>)$/i

/** Tags vazias em volta da posição `at` da linha (ex.: "<u>|</u>", de versões antigas): [início, fim] ou null. */
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

/** Posição depois de pular as marcações escondidas encostadas em `pos`. */
function skipMarkup(state: EditorState, pos: number, forward: boolean): number {
  const ranges = markupRanges(hiddenElements(state, pos, pos))
  for (let moved = true; moved; ) {
    moved = false
    for (const [from, to] of ranges) {
      if (forward ? from === pos : to === pos) {
        pos = forward ? to : from
        moved = true
      }
    }
  }
  return pos
}

/**
 * Backspace/Delete: "<u>|</u>" (tags vazias) apaga as tags; encostado numa marcação
 * escondida, o cursor passa por ela e o comando normal apaga o caractere visível
 * do outro lado.
 */
function deleteAcrossMarkup(forward: boolean): Command {
  return (view) => {
    const { state } = view
    if (!state.selection.ranges.every((range) => range.empty)) return false
    const { head } = state.selection.main
    const line = state.doc.lineAt(head)
    const pending = state.selection.ranges.length === 1 && !isInCode(state, head) ? emptyTagsAround(line.text, head - line.from) : null
    if (pending) {
      // 'input.format': é o próprio editor tirando as tags (a proteção das marcações não se aplica)
      view.dispatch(state.update({ changes: { from: line.from + pending[0], to: line.from + pending[1] }, userEvent: 'input.format' }))
      return true
    }
    let moved = false
    const ranges = state.selection.ranges.map((range) => {
      const pos = skipMarkup(state, range.head, forward)
      if (pos !== range.head) moved = true
      return EditorSelection.cursor(pos)
    })
    if (moved) view.dispatch({ selection: EditorSelection.create(ranges, state.selection.mainIndex) })
    return false // segue para o Backspace/Delete normal
  }
}

/**
 * Enter dentro de um trecho formatado (ou de um link): no começo ou no fim, sai do
 * trecho antes de quebrar a linha; no meio, fecha o trecho aqui e o reabre depois
 * da quebra. O Enter normal (que também continua listas) roda em seguida.
 */
export function breakOutOfMarkup(view: EditorView): boolean {
  if (view.state.selection.ranges.length !== 1) return false
  const selected = view.state.selection.main
  if (!contentElements(view.state, selected.from, selected.to).length) return false
  if (!selected.empty) view.dispatch(view.state.update(view.state.replaceSelection(''), { userEvent: 'delete.selection' }))

  const { state } = view
  const head = state.selection.main.head
  const elements = contentElements(state, head, head)
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

/**
 * ←/→ (com ou sem Shift): atravessar uma marcação escondida não "gasta" a tecla — o
 * cursor sempre anda na tela. Só no começo/fim da linha a tecla para logo depois da
 * marcação (sai do negrito ou do link sem pular para a outra linha).
 */
function stepOverMarkup(move: Command): Command {
  return (view) => {
    if (view.state.selection.ranges.length !== 1) return false
    const before = view.state.selection.main.head
    if (!move(view)) return false
    const { anchor, head } = view.state.selection.main
    if (head === before) return true
    const forward = head > before
    const edge = skipMarkup(view.state, before, forward)
    if (forward ? head <= edge : head >= edge) {
      const line = view.state.doc.lineAt(edge)
      const atLineEdge = edge !== before && (forward ? edge === line.to : edge === line.from)
      // Colado no texto de fora da marcação que acabou de atravessar
      const cursor = EditorSelection.cursor(edge, forward ? 1 : -1)
      view.dispatch({ selection: anchor === head ? cursor : EditorSelection.range(anchor, edge), userEvent: 'select' })
      if (!atLineEdge) move(view)
    }
    return true
  }
}

// ── 7. Copiar leva as marcações completas ────────────────────────────────────

/** Texto copiado com as marcações completas: parte de um trecho em negrito (ou de um link) continua assim ao colar. */
export function balancedSlice(state: EditorState, from: number, to: number): string {
  let prefix = ''
  let suffix = ''
  let start = from
  let end = to
  for (const el of hiddenElements(state, from, to)) {
    const opensBefore = el.from < from
    const closesAfter = el.to > to
    if (el.to <= from || el.from >= to || (!opensBefore && !closesAfter)) continue
    const hasText = Math.max(from, el.openTo) < Math.min(to, el.closeFrom)
    if (hasText) {
      if (opensBefore) prefix += state.sliceDoc(el.from, el.openTo)
      if (closesAfter) suffix = state.sliceDoc(el.closeFrom, el.to) + suffix
    } else if (closesAfter) {
      end = Math.min(end, el.from) // só a marcação de abertura entrou na seleção: fica de fora
    } else {
      start = Math.max(start, el.to) // só a de fechamento
    }
  }
  return prefix + state.sliceDoc(start, Math.max(start, end)) + suffix
}

const balancedClipboard = EditorView.clipboardOutputFilter.of((text, state) => {
  const ranges = state.selection.ranges.filter((range) => !range.empty)
  if (ranges.map((range) => state.sliceDoc(range.from, range.to)).join(state.lineBreak) === text) {
    return ranges.map((range: SelectionRange) => balancedSlice(state, range.from, range.to)).join(state.lineBreak)
  }
  const { main } = state.selection
  return !main.empty && state.sliceDoc(main.from, main.to) === text ? balancedSlice(state, main.from, main.to) : text
})

export const deleteBackwardAcrossMarkup = deleteAcrossMarkup(false)
export const deleteForwardAcrossMarkup = deleteAcrossMarkup(true)

/** Comportamentos de edição que mantêm as marcações escondidas inteiras e válidas. */
export const hiddenMarkupEditing: Extension = [
  storedField,
  protectMarkup,
  // Filtros rodam do último para o primeiro: os formatos guardados entram antes do conserto
  keepMarkupValid,
  applyStoredFormats,
  pointerGravity,
  keepTypingAtCursor,
  compositionHandling,
  balancedClipboard,
  Prec.highest(
    keymap.of([
      { key: 'Backspace', run: deleteBackwardAcrossMarkup, shift: deleteBackwardAcrossMarkup },
      { key: 'Delete', run: deleteForwardAcrossMarkup },
      { key: 'Mod-Backspace', mac: 'Alt-Backspace', run: deleteBackwardAcrossMarkup },
      { key: 'Mod-Delete', mac: 'Alt-Delete', run: deleteForwardAcrossMarkup },
      { key: 'Enter', run: breakOutOfMarkup, shift: breakOutOfMarkup },
      { key: 'ArrowLeft', run: stepOverMarkup(cursorCharLeft), shift: stepOverMarkup(selectCharLeft) },
      { key: 'ArrowRight', run: stepOverMarkup(cursorCharRight), shift: stepOverMarkup(selectCharRight) },
      { key: 'End', run: endWithGravity },
    ]),
  ),
]
