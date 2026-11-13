/**
 * Tabelas simples nas notas (1.7.3): o cartão no editor. O formato no arquivo e as
 * contas ficam em table-model.ts.
 *
 * - Toda tabela do Markdown (as que o app cria e as escritas à mão) aparece como um
 *   cartão com uma célula editável por campo. O comentário de configuração, quando
 *   existe, faz parte do cartão (nunca aparece).
 * - Cada mudança numa célula reescreve a tabela inteira no texto da nota (uma só fonte de
 *   verdade, o arquivo), com a linha Total refeita. Ctrl+Z dentro da tabela usa o
 *   histórico da nota.
 * - Tab / Shift+Tab andam pelas células (Tab na última cria uma linha), Enter desce (na
 *   última linha, cria outra), ↑ ↓ trocam de linha, Esc volta para o texto depois da tabela.
 * - Tipo e total de cada coluna, inserir, mover e remover linhas e colunas: o botão da
 *   coluna (▾), o botão ⋯ da tabela (para a célula em que você está) ou o clique direito.
 */
import { syntaxTree } from '@codemirror/language'
import { isolateHistory, redo, undo } from '@codemirror/commands'
import { EditorSelection, StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { iconSvg } from '../icons'
import { editorHost, type HostMenuItem } from './host'
import {
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  newTable,
  parseCellNumber,
  parseTable,
  parseTableConfig,
  removeColumn,
  removeRow,
  serializeTable,
  setCell,
  setColumnTotal,
  setColumnType,
  sumColumn,
  type NoteTable,
} from './table-model'

export interface TableBlock {
  /** Começo (o comentário de configuração, se houver) e fim da tabela no texto. */
  from: number
  to: number
  table: NoteTable
}

/** As tabelas da nota (fora dos blocos de código, pela árvore do Markdown). */
export function noteTables(state: EditorState): TableBlock[] {
  const blocks: TableBlock[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Table') return
      const first = state.doc.lineAt(node.from)
      const last = state.doc.lineAt(Math.max(node.from, node.to - (state.sliceDoc(node.to - 1, node.to) === '\n' ? 1 : 0)))
      const lines: string[] = []
      for (let n = first.number; n <= last.number; n++) lines.push(state.doc.line(n).text)
      let from = first.from
      let config = null
      if (first.number > 1) {
        const previous = state.doc.line(first.number - 1)
        config = parseTableConfig(previous.text)
        if (config) from = previous.from
      }
      const table = parseTable(lines, config)
      if (table) blocks.push({ from, to: last.to, table })
      return false
    },
  })
  return blocks
}

export function tableAt(state: EditorState, pos: number): TableBlock | null {
  return noteTables(state).find((block) => block.from <= pos && pos <= block.to) ?? null
}

/**
 * "Inserir tabela…" (clique direito no texto, ou o botão da barra no celular): pergunta o
 * tamanho e insere onde foi o clique. false = este editor não tem como perguntar.
 */
export function insertTableFromMenu(view: EditorView, at?: number): boolean {
  const host = view.state.facet(editorHost)
  if (!host?.chooseTableSize) return false
  const key = host.docKey()
  const pos = at ?? view.state.selection.main.head
  void host.chooseTableSize().then((size) => {
    if (!size || host.docKey() !== key) return
    insertTable(view, Math.min(pos, view.state.doc.length), size.columns, size.rows)
  })
  return true
}

/** Insere uma tabela nova em `pos` (numa linha própria), com o foco na primeira célula. */
export function insertTable(view: EditorView, pos: number, columns: number, rows: number): void {
  const { state } = view
  const { doc } = state
  const line = doc.lineAt(Math.min(pos, doc.length))
  const text = serializeTable(newTable(columns, rows))
  // No Markdown, a tabela precisa de linhas vazias em volta (senão o texto vizinho entra
  // nela): numa linha vazia, entra ali; senão, depois da linha
  const blank = !line.text.trim()
  const from = blank ? line.from : line.to
  const to = blank ? line.to : line.to
  const before = blank ? (line.number > 1 && doc.line(line.number - 1).text.trim() ? '\n' : '') : '\n\n'
  const nextLine = line.number < doc.lines ? doc.line(line.number + 1) : null
  const after = nextLine ? (nextLine.text.trim() ? '\n' : '') : '\n'
  const insert = `${before}${text}${after}`
  const tableAt = from + before.length
  // O cursor fica depois da tabela (na linha vazia que vem depois)
  const cursor = tableAt + text.length + (after ? 1 : nextLine ? 1 : 0)
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(Math.min(cursor, doc.length - (to - from) + insert.length)),
    userEvent: 'input',
    scrollIntoView: true,
  })
  pendingFocus = { at: tableAt, row: -1, column: 0 }
  requestAnimationFrame(() => focusPending(view))
}

// ── O cartão ───────────────────────────────────────────────────────────────

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

interface CardState {
  table: NoteTable
  /** Célula com o foco (row -1 = cabeçalho). */
  focus: { row: number; column: number }
}

const cards = new WeakMap<HTMLElement, CardState>()
/** Célula para focar quando o cartão for redesenhado (depois de inserir linha, coluna, tabela). */
let pendingFocus: { at: number; row: number; column: number } | null = null

class TableWidget extends WidgetType {
  constructor(readonly text: string, readonly table: NoteTable) {
    super()
  }
  override eq(other: TableWidget): boolean {
    return other.text === this.text
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = el('div', 'cm-table')
    wrap.contentEditable = 'false'
    cards.set(wrap, { table: this.table, focus: { row: 0, column: 0 } })
    render(view, wrap)
    return wrap
  }
  /** A tabela mudou (digitação, desfazer): o mesmo cartão, sem perder o foco da célula. */
  override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const card = cards.get(dom)
    if (!card) return false
    const before = card.table
    card.table = this.table
    const sameShape = before.columns.length === this.table.columns.length && before.rows.length === this.table.rows.length && before.columns.every((column, i) => column.type === this.table.columns[i]!.type && column.total === this.table.columns[i]!.total)
    if (sameShape) syncValues(dom, card)
    else render(view, dom)
    return true
  }
  override get estimatedHeight(): number {
    return (this.table.rows.length + 2) * 34 + 40
  }
  /** Os eventos do cartão são dele (cliques, teclas e digitação nas células). */
  override ignoreEvent(): boolean {
    return true
  }
}

const cellSelector = (row: number, column: number) => `[data-row="${row}"][data-col="${column}"]`

function render(view: EditorView, wrap: HTMLElement): void {
  const card = cards.get(wrap)!
  const { table } = card
  const focused = wrap.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset : null
  wrap.replaceChildren()
  const scroller = el('div', 'cm-table-scroll')
  const grid = el('table', 'cm-table-grid')
  const head = el('thead')
  const headRow = el('tr')
  table.columns.forEach((column, c) => {
    const th = el('th')
    if (column.type === 'number') th.classList.add('num')
    const box = el('div', 'cm-table-th')
    const input = cellInput(-1, c, column.name, 'Nome da coluna')
    const menu = el('button', 'cm-table-colbtn')
    menu.type = 'button'
    menu.dataset.action = 'column'
    menu.dataset.col = String(c)
    menu.dataset.tip = column.type === 'number' ? (column.total ? 'Número, soma no total' : 'Número') : 'Texto'
    menu.dataset.tipPos = 'top'
    menu.setAttribute('aria-label', `Opções da coluna ${column.name || c + 1}`)
    menu.innerHTML = column.type === 'number' ? `<span class="cm-table-type">${column.total ? 'Σ' : '#'}</span>${iconSvg('chevron-down', 11)}` : iconSvg('chevron-down', 11)
    box.append(input, menu)
    th.append(box)
    headRow.append(th)
  })
  head.append(headRow)
  const body = el('tbody')
  table.rows.forEach((cells, r) => {
    const tr = el('tr')
    cells.forEach((value, c) => {
      const td = el('td')
      if (table.columns[c]!.type === 'number') td.classList.add('num')
      td.append(cellInput(r, c, value, table.columns[c]!.name))
      tr.append(td)
    })
    body.append(tr)
  })
  grid.append(head, body)
  if (table.columns.some((column) => column.total)) {
    const foot = el('tfoot')
    const tr = el('tr', 'cm-table-total')
    const label = table.columns.findIndex((column) => !column.total)
    table.columns.forEach((column, c) => {
      const td = el('td')
      td.dataset.total = String(c)
      if (column.type === 'number') td.classList.add('num')
      if (c === label) td.textContent = 'Total'
      tr.append(td)
    })
    foot.append(tr)
    grid.append(foot)
  }
  scroller.append(grid)
  const actions = el('div', 'cm-table-actions')
  for (const [action, icon, label] of [
    ['add-row', 'plus', 'Linha'],
    ['add-column', 'plus', 'Coluna'],
  ] as const) {
    const button = el('button', 'cm-table-btn')
    button.type = 'button'
    button.dataset.action = action
    button.innerHTML = `${iconSvg(icon, 13)}<span>${label}</span>`
    actions.append(button)
  }
  const spacer = el('span', 'cm-table-spacer')
  const more = el('button', 'cm-table-btn icon')
  more.type = 'button'
  more.dataset.action = 'menu'
  more.dataset.tip = 'Linha, coluna e tabela'
  more.dataset.tipPos = 'top'
  more.setAttribute('aria-label', 'Opções da tabela')
  more.innerHTML = iconSvg('more', 15)
  actions.append(spacer, more)
  wrap.append(scroller, actions)
  syncValues(wrap, card)
  bind(view, wrap)
  // Mantém o foco onde estava (a tabela foi redesenhada por outra mudança)
  if (focused?.row !== undefined) wrap.querySelector<HTMLInputElement>(cellSelector(Number(focused.row), Number(focused.col)))?.focus()
}

function cellInput(row: number, column: number, value: string, label: string): HTMLInputElement {
  const input = el('input', 'cm-table-cell')
  input.type = 'text'
  input.value = value
  input.dataset.row = String(row)
  input.dataset.col = String(column)
  input.spellcheck = row >= 0
  input.setAttribute('aria-label', row < 0 ? label : `${label || 'Célula'}, linha ${row + 1}`)
  return input
}

/** Valores das células (as que não estão sendo digitadas) e a linha Total. */
function syncValues(wrap: HTMLElement, card: CardState): void {
  const { table } = card
  for (const input of wrap.querySelectorAll<HTMLInputElement>('input.cm-table-cell')) {
    const row = Number(input.dataset.row)
    const column = Number(input.dataset.col)
    const value = row < 0 ? table.columns[column]?.name : table.rows[row]?.[column]
    // A célula em que você digita já tem o valor (nada muda nela); desfazer muda
    if (value !== undefined && input.value !== value) input.value = value
    if (row >= 0) {
      const parsed = table.columns[column]?.type === 'number' ? parseCellNumber(input.value) : null
      input.classList.toggle('invalid', !!parsed && Number.isNaN(parsed.value))
      input.title = parsed && Number.isNaN(parsed.value) ? 'Não é um número: fica fora da soma' : ''
      input.inputMode = table.columns[column]?.type === 'number' ? 'decimal' : 'text'
    }
  }
  for (const cell of wrap.querySelectorAll<HTMLElement>('[data-total]')) {
    const column = Number(cell.dataset.total)
    if (!table.columns[column]?.total) continue
    const sum = sumColumn(table.rows, column)
    cell.textContent = sum.text
    cell.title = sum.invalid ? `${sum.invalid} ${sum.invalid === 1 ? 'célula não é número' : 'células não são números'} (fora da soma)` : ''
  }
}

/** Onde o cartão está no texto agora (null = saiu da nota). */
function blockOf(view: EditorView, wrap: HTMLElement): TableBlock | null {
  if (!wrap.isConnected) return null
  try {
    return tableAt(view.state, view.posAtDOM(wrap))
  } catch {
    return null
  }
}

/** A última célula digitada (digitar em outra célula começa um novo passo do desfazer). */
let lastTyped: { wrap: HTMLElement; cell: string } | null = null

/** Grava a tabela nova no texto da nota (a linha Total é refeita). */
function commit(view: EditorView, wrap: HTMLElement, table: NoteTable, focus?: { row: number; column: number }, userEvent = 'input', cell?: string): void {
  const block = blockOf(view, wrap)
  if (!block) return
  const card = cards.get(wrap)
  const text = serializeTable(table)
  if (focus) pendingFocus = { at: block.from, row: focus.row, column: focus.column }
  const newStep = !cell || lastTyped?.wrap !== wrap || lastTyped.cell !== cell
  lastTyped = cell ? { wrap, cell } : null
  view.dispatch({ changes: { from: block.from, to: block.to, insert: text }, userEvent, annotations: newStep ? isolateHistory.of('before') : undefined })
  if (card) syncValues(wrap, card)
  if (focus) requestAnimationFrame(() => focusPending(view))
}

function focusPending(view: EditorView): void {
  const target = pendingFocus
  pendingFocus = null
  if (!target) return
  for (const wrap of view.dom.querySelectorAll<HTMLElement>('.cm-table')) {
    const block = blockOf(view, wrap)
    if (!block || block.from !== target.at) continue
    const input = wrap.querySelector<HTMLInputElement>(cellSelector(target.row, target.column))
    input?.focus()
    input?.select()
    return
  }
}

/** Sai da tabela: o cursor vai para a linha depois dela (criada se a nota acaba ali). */
function leave(view: EditorView, wrap: HTMLElement): void {
  const block = blockOf(view, wrap)
  if (!block) return
  const { doc } = view.state
  if (block.to >= doc.length) view.dispatch({ changes: { from: doc.length, insert: '\n' }, selection: EditorSelection.cursor(doc.length + 1) })
  else view.dispatch({ selection: EditorSelection.cursor(doc.lineAt(block.to + 1).from) })
  view.focus()
}

function bind(view: EditorView, wrap: HTMLElement): void {
  if (wrap.dataset.bound) return
  wrap.dataset.bound = '1'
  const card = () => cards.get(wrap)!

  wrap.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement
    if (target.dataset.row !== undefined) card().focus = { row: Number(target.dataset.row), column: Number(target.dataset.col) }
  })

  wrap.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement
    if (!input.classList.contains('cm-table-cell')) return
    const row = Number(input.dataset.row)
    const column = Number(input.dataset.col)
    commit(view, wrap, setCell(card().table, row, column, input.value), undefined, 'input.type', `${row}:${column}`)
  })

  wrap.addEventListener('keydown', (event) => {
    const input = event.target as HTMLInputElement
    if (!input.classList?.contains('cm-table-cell')) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (mod && key === 'z' && !event.shiftKey) {
      event.preventDefault()
      undo(view)
      return
    }
    if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault()
      redo(view)
      return
    }
    const { table } = card()
    const row = Number(input.dataset.row)
    const column = Number(input.dataset.col)
    const width = table.columns.length
    const go = (r: number, c: number) => {
      const next = wrap.querySelector<HTMLInputElement>(cellSelector(r, c))
      if (next) {
        next.focus()
        next.select()
      }
      return !!next
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const index = (row + 1) * width + column + (event.shiftKey ? -1 : 1)
      const r = Math.floor(index / width) - 1
      const c = ((index % width) + width) % width
      if (event.shiftKey) {
        if (index >= 0) go(r, c)
      } else if (r >= table.rows.length) {
        commit(view, wrap, insertRow(table, table.rows.length), { row: table.rows.length, column: 0 })
      } else go(r, c)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (row + 1 >= table.rows.length && row >= 0) commit(view, wrap, insertRow(table, table.rows.length), { row: table.rows.length, column })
      else go(row + 1, column)
    } else if (event.key === 'ArrowDown' && !event.altKey) {
      event.preventDefault()
      if (!go(row + 1, column)) leave(view, wrap)
    } else if (event.key === 'ArrowUp' && !event.altKey) {
      event.preventDefault()
      go(row - 1, column)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      leave(view, wrap)
    }
  })

  // Os cliques nos botões não tiram o foco da célula
  wrap.addEventListener('mousedown', (event) => {
    if ((event.target as HTMLElement).closest('button')) event.preventDefault()
  })

  wrap.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button[data-action]')
    if (!button) return
    const { table, focus } = card()
    const action = button.dataset.action
    if (action === 'add-row') commit(view, wrap, insertRow(table, table.rows.length), { row: table.rows.length, column: 0 })
    else if (action === 'add-column') commit(view, wrap, insertColumn(table, table.columns.length), { row: -1, column: table.columns.length })
    else if (action === 'column') void columnMenu(view, wrap, Number(button.dataset.col), button)
    else if (action === 'menu') void cellMenu(view, wrap, focus, button)
  })

  wrap.addEventListener('contextmenu', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLElement>('[data-row]')
    if (!input) return
    event.preventDefault()
    event.stopPropagation()
    const position = { row: Number(input.dataset.row), column: Number(input.dataset.col) }
    card().focus = position
    void cellMenu(view, wrap, position, null)
  })
}

function columnItems(table: NoteTable, column: number): HostMenuItem[] {
  const current = table.columns[column]!
  return [
    { id: 'type:text', label: 'Texto', type: 'radio', checked: current.type === 'text' },
    { id: 'type:number', label: 'Número', type: 'radio', checked: current.type === 'number' },
    { id: 'total', label: 'Somar na linha Total', type: 'checkbox', checked: current.total, enabled: current.type === 'number' },
    { type: 'separator' },
    { id: 'col-left', label: 'Inserir coluna à esquerda', enabled: table.columns.length < 20 },
    { id: 'col-right', label: 'Inserir coluna à direita', enabled: table.columns.length < 20 },
    { id: 'col-move-left', label: 'Mover para a esquerda', enabled: column > 0 },
    { id: 'col-move-right', label: 'Mover para a direita', enabled: column < table.columns.length - 1 },
    { id: 'col-remove', label: 'Remover coluna', danger: true, enabled: table.columns.length > 1 },
  ]
}

function applyColumn(view: EditorView, wrap: HTMLElement, column: number, choice: string, row: number): void {
  const { table } = cards.get(wrap)!
  if (choice === 'type:text') commit(view, wrap, setColumnType(table, column, 'text'))
  else if (choice === 'type:number') commit(view, wrap, setColumnType(table, column, 'number'))
  else if (choice === 'total') commit(view, wrap, setColumnTotal(table, column, !table.columns[column]!.total))
  else if (choice === 'col-left') commit(view, wrap, insertColumn(table, column), { row: -1, column })
  else if (choice === 'col-right') commit(view, wrap, insertColumn(table, column + 1), { row: -1, column: column + 1 })
  else if (choice === 'col-move-left') commit(view, wrap, moveColumn(table, column, column - 1), { row, column: column - 1 })
  else if (choice === 'col-move-right') commit(view, wrap, moveColumn(table, column, column + 1), { row, column: column + 1 })
  else if (choice === 'col-remove') commit(view, wrap, removeColumn(table, column), { row, column: Math.max(0, column - 1) })
}

async function columnMenu(view: EditorView, wrap: HTMLElement, column: number, anchor: Element): Promise<void> {
  const host = view.state.facet(editorHost)
  if (!host?.menu) return
  const choice = await host.menu(columnItems(cards.get(wrap)!.table, column), anchor)
  if (choice) applyColumn(view, wrap, column, choice, -1)
}

/** O menu da célula: a linha, a coluna e a tabela. */
async function cellMenu(view: EditorView, wrap: HTMLElement, at: { row: number; column: number }, anchor: Element | null): Promise<void> {
  const host = view.state.facet(editorHost)
  if (!host?.menu) return
  const { table } = cards.get(wrap)!
  const row = Math.min(at.row, table.rows.length - 1)
  const column = Math.min(at.column, table.columns.length - 1)
  const dataRow = row >= 0
  const items: HostMenuItem[] = [
    { id: 'row-above', label: 'Inserir linha acima', enabled: dataRow },
    { id: 'row-below', label: dataRow ? 'Inserir linha abaixo' : 'Inserir linha', enabled: table.rows.length < 500 },
    { id: 'row-up', label: 'Mover linha para cima', enabled: row > 0 },
    { id: 'row-down', label: 'Mover linha para baixo', enabled: dataRow && row < table.rows.length - 1 },
    { id: 'row-remove', label: 'Remover linha', danger: true, enabled: dataRow },
    { type: 'separator' },
    { label: `Coluna “${table.columns[column]!.name || column + 1}”`, submenu: columnItems(table, column) },
    { type: 'separator' },
    { id: 'table-remove', label: 'Remover tabela', danger: true },
  ]
  const choice = await host.menu(items, anchor)
  if (!choice) return
  if (choice === 'row-above') commit(view, wrap, insertRow(table, row), { row, column })
  else if (choice === 'row-below') commit(view, wrap, insertRow(table, row + 1), { row: row + 1, column })
  else if (choice === 'row-up') commit(view, wrap, moveRow(table, row, row - 1), { row: row - 1, column })
  else if (choice === 'row-down') commit(view, wrap, moveRow(table, row, row + 1), { row: row + 1, column })
  else if (choice === 'row-remove') commit(view, wrap, removeRow(table, row), { row: Math.max(0, Math.min(row, table.rows.length - 2)), column })
  else if (choice === 'table-remove') {
    const block = blockOf(view, wrap)
    if (!block) return
    const { doc } = view.state
    // A linha da tabela sai junto (sem deixar uma linha vazia no lugar)
    const to = block.to < doc.length ? block.to + 1 : block.to
    const from = to === block.to && block.from > 0 ? block.from - 1 : block.from
    view.dispatch({ changes: { from, to }, selection: EditorSelection.cursor(from), userEvent: 'delete' })
    view.focus()
    host.notify('Tabela removida', () => undo(view))
  } else applyColumn(view, wrap, column, choice, row)
}

// ── Decorações ─────────────────────────────────────────────────────────────

const hidden = Decoration.replace({})

function buildDecorations(state: EditorState): { decorations: DecorationSet; atoms: DecorationSet } {
  const ranges: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  for (const block of noteTables(state)) {
    const text = state.sliceDoc(block.from, block.to)
    ranges.push(Decoration.replace({ widget: new TableWidget(text, block.table), block: true }).range(block.from, block.to))
    atoms.push(hidden.range(block.from, block.to))
  }
  return { decorations: Decoration.set(ranges, true), atoms: Decoration.set(atoms, true) }
}

const tableField = StateField.define<{ decorations: DecorationSet; atoms: DecorationSet }>({
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

/** Depois de desfazer/refazer, a célula com o foco é a mesma (o cartão foi redesenhado). */
const keepFocus = EditorView.updateListener.of((update) => {
  if (pendingFocus && update.docChanged) requestAnimationFrame(() => focusPending(update.view))
})

export const tablePreview = [tableField, keepFocus]
