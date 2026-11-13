/**
 * Tabelas simples nas notas (1.7.3): o formato no arquivo e as contas, sem editor e sem DOM.
 *
 * No arquivo é uma tabela comum do Markdown (abre igual no Obsidian e no VS Code). O que
 * o Markdown não guarda (o tipo de cada coluna e quais somam) vai num comentário logo
 * antes dela, que nenhum leitor de Markdown mostra:
 *
 *   <!-- 4notes-table {"columns":[{"type":"text"},{"type":"number","total":true}]} -->
 *   | Descrição | Valor |
 *   | --- | ---: |
 *   | Mercado | 150 |
 *   | Internet | 100 |
 *   | **Total** | **250** |
 *
 * A linha "Total" é gravada (aparece fora do app também) e refeita pelo app a cada
 * mudança: ela nunca é uma linha que você edita. Uma tabela sem colunas de número nem
 * total não ganha comentário (fica só a tabela).
 */

export type ColumnType = 'text' | 'number'

export interface TableColumn {
  name: string
  type: ColumnType
  /** Soma na linha Total (só colunas de número). */
  total: boolean
}

export interface NoteTable {
  columns: TableColumn[]
  /** As linhas de dados (sem o cabeçalho e sem a linha Total), cada uma com uma célula por coluna. */
  rows: string[][]
}

export const TABLE_COMMENT = /^\s*<!--\s*4notes-table\s+(\{.*\})\s*-->\s*$/
export const MAX_COLUMNS = 20
export const MAX_ROWS = 500
const TOTAL_LABEL = 'Total'

// ── Células ────────────────────────────────────────────────────────────────

/** Divide uma linha "| a | b \| c |" nas células (o "\|" é uma barra dentro da célula). */
export function splitRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (char === '\\' && text[i + 1] === '|') {
      current += '|'
      i++
    } else if (char === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

/** O texto da célula como fica no arquivo (barra escapada, sem quebra de linha). */
export function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

const isDelimiterRow = (cells: string[]) => cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell.replace(/\s/g, '')))

/** **x** → x (a linha Total é gravada em negrito). */
const unbold = (text: string) => /^\*\*(.*)\*\*$/.exec(text.trim())?.[1]?.trim() ?? text.trim()

// ── Números ────────────────────────────────────────────────────────────────

export interface ParsedNumber {
  value: number
  /** Casas decimais escritas. */
  decimals: number
  /** Separador decimal usado (null = sem casas). */
  decimal: ',' | '.' | null
  /** Usou separador de milhar ("1.234"). */
  grouped: boolean
}

/**
 * Lê um número escrito à brasileira ou não: "150", "1.234,56", "1,234.56", "12,5",
 * "R$ 52,30", "-3", "(10)". Célula vazia = null; texto que não é número = NaN.
 */
export function parseCellNumber(raw: string): ParsedNumber | null {
  let text = unbold(raw).replace(/^R\$\s*/i, '').replace(/[\s ]/g, '')
  if (!text) return null
  let sign = 1
  if (/^\(.*\)$/.test(text)) {
    sign = -1
    text = text.slice(1, -1)
  }
  if (/^[-−]/.test(text)) {
    sign = -sign
    text = text.slice(1)
  } else if (text.startsWith('+')) text = text.slice(1)
  if (!/^\d[\d.,]*$/.test(text) && !/^[.,]\d+$/.test(text)) return { value: Number.NaN, decimals: 0, decimal: null, grouped: false }
  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  let decimal: ',' | '.' | null = null
  if (lastComma >= 0 && lastDot >= 0) decimal = lastComma > lastDot ? ',' : '.'
  else if (lastComma >= 0) decimal = /^\d{1,3}(,\d{3})+$/.test(text) && text.split(',').length > 2 ? null : ','
  else if (lastDot >= 0) decimal = /^\d{1,3}(\.\d{3})+$/.test(text) ? null : '.'
  const group = decimal === ',' ? '.' : decimal === '.' ? ',' : lastComma >= 0 ? ',' : '.'
  const [whole, fraction = ''] = decimal ? [text.slice(0, text.lastIndexOf(decimal)), text.slice(text.lastIndexOf(decimal) + 1)] : [text, '']
  if (whole.includes(decimal ?? '\0') || fraction.includes(',') || fraction.includes('.')) return { value: Number.NaN, decimals: 0, decimal: null, grouped: false }
  const grouped = whole.includes(group)
  if (grouped && !new RegExp(`^\\d{1,3}(\\${group}\\d{3})+$`).test(whole)) return { value: Number.NaN, decimals: 0, decimal: null, grouped: false }
  const digits = whole.split(group).join('') || '0'
  const value = sign * Number(`${digits}.${fraction || '0'}`)
  return Number.isFinite(value) ? { value, decimals: fraction.length, decimal: fraction ? decimal : null, grouped } : { value: Number.NaN, decimals: 0, decimal: null, grouped: false }
}

export interface ColumnSum {
  /** Soma dos valores válidos (0 sem valores). */
  value: number
  /** A soma escrita no mesmo jeito dos valores (casas, separadores). */
  text: string
  /** Quantas células com algo que não é número (ficam fora da soma). */
  invalid: number
  /** Quantos valores somados. */
  count: number
}

/** Escreve `value` com `decimals` casas, o separador decimal e o de milhar (se usado). */
export function formatNumber(value: number, decimals: number, decimal: ',' | '.', grouped: boolean): string {
  const negative = value < 0
  const fixed = Math.abs(value).toFixed(Math.min(decimals, 10))
  const [whole, fraction] = fixed.split('.') as [string, string | undefined]
  const group = decimal === ',' ? '.' : ','
  const wholeText = grouped ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, group) : whole
  return `${negative ? '-' : ''}${wholeText}${fraction ? decimal + fraction : ''}`
}

/** Soma de uma coluna: células vazias e textos ficam fora (sem erro). */
export function sumColumn(rows: string[][], index: number): ColumnSum {
  let total = 0
  let decimals = 0
  let decimal: ',' | '.' | null = null
  let grouped = false
  let invalid = 0
  let count = 0
  for (const row of rows) {
    const parsed = parseCellNumber(row[index] ?? '')
    if (!parsed) continue
    if (Number.isNaN(parsed.value)) {
      invalid++
      continue
    }
    count++
    total += parsed.value
    decimals = Math.max(decimals, parsed.decimals)
    decimal ??= parsed.decimal
    grouped ||= parsed.grouped
  }
  // Sem erro de arredondamento do ponto flutuante (0,1 + 0,2)
  const rounded = Math.round(total * 10 ** Math.min(decimals, 10)) / 10 ** Math.min(decimals, 10)
  return { value: rounded, text: formatNumber(rounded, decimals, decimal ?? ',', grouped), invalid, count }
}

// ── Ler e escrever ─────────────────────────────────────────────────────────

const hasTotals = (table: NoteTable) => table.columns.some((column) => column.type === 'number' && column.total)
const needsConfig = (table: NoteTable) => table.columns.some((column) => column.type !== 'text' || column.total)

/** Lê o comentário de configuração (null = não é um). */
export function parseTableConfig(line: string): { columns: { type: ColumnType; total: boolean }[] } | null {
  const match = TABLE_COMMENT.exec(line)
  if (!match) return null
  try {
    const raw = JSON.parse(match[1]!) as { columns?: unknown }
    const columns = Array.isArray(raw.columns)
      ? raw.columns.map((item) => {
          const column = (item && typeof item === 'object' ? item : {}) as { type?: unknown; total?: unknown }
          const type: ColumnType = column.type === 'number' ? 'number' : 'text'
          return { type, total: type === 'number' && column.total === true }
        })
      : []
    return { columns }
  } catch {
    return { columns: [] }
  }
}

/**
 * Lê a tabela a partir das linhas do arquivo (cabeçalho, separador, dados) e da
 * configuração. A linha Total gravada pelo app (a última, toda em negrito) sai dos dados.
 */
export function parseTable(lines: string[], config: { columns: { type: ColumnType; total: boolean }[] } | null): NoteTable | null {
  if (lines.length < 2) return null
  const header = splitRow(lines[0]!)
  const delimiter = splitRow(lines[1]!)
  if (!isDelimiterRow(delimiter)) return null
  const width = Math.min(MAX_COLUMNS, header.length)
  const columns: TableColumn[] = header.slice(0, width).map((name, i) => {
    const conf = config?.columns[i]
    const type: ColumnType = conf?.type ?? 'text'
    return { name, type, total: type === 'number' && !!conf?.total }
  })
  let rows = lines
    .slice(2)
    .map(splitRow)
    .map((cells) => Array.from({ length: width }, (_, i) => cells[i] ?? ''))
  const table: NoteTable = { columns, rows }
  if (hasTotals(table) && rows.length && isTotalRow(rows.at(-1)!, columns)) rows = rows.slice(0, -1)
  table.rows = rows.slice(0, MAX_ROWS)
  return table
}

/** A linha Total que o app grava: o rótulo "Total" e as somas, tudo em negrito. */
function isTotalRow(cells: string[], columns: TableColumn[]): boolean {
  const filled = cells.filter((cell) => cell.trim())
  if (!filled.length || !filled.every((cell) => /^\*\*.*\*\*$/.test(cell.trim()))) return false
  return cells.some((cell, i) => unbold(cell) === TOTAL_LABEL && !columns[i]?.total) || columns.some((column, i) => column.total && filled.includes(cells[i]!))
}

/** A linha Total da tabela (um texto por coluna; vazio onde não soma). */
export function totalRow(table: NoteTable): string[] {
  const cells = table.columns.map((column, i) => (column.type === 'number' && column.total ? sumColumn(table.rows, i).text : ''))
  // O rótulo vai na primeira coluna que não soma
  const label = table.columns.findIndex((column) => !(column.type === 'number' && column.total))
  if (label >= 0) cells[label] = TOTAL_LABEL
  return cells
}

/** A tabela como fica no arquivo (com o comentário quando há tipos ou totais). */
export function serializeTable(table: NoteTable): string {
  const row = (cells: string[]) => `| ${cells.map((cell) => escapeCell(cell)).join(' | ')} |`
  const lines: string[] = []
  if (needsConfig(table)) {
    const config = { columns: table.columns.map((column) => (column.type === 'number' ? { type: 'number', ...(column.total ? { total: true } : {}) } : { type: 'text' })) }
    lines.push(`<!-- 4notes-table ${JSON.stringify(config)} -->`)
  }
  lines.push(row(table.columns.map((column) => column.name)))
  lines.push(`| ${table.columns.map((column) => (column.type === 'number' ? '---:' : '---')).join(' | ')} |`)
  for (const cells of table.rows) lines.push(row(cells))
  if (hasTotals(table)) lines.push(`| ${totalRow(table).map((cell) => (cell ? `**${escapeCell(cell)}**` : '')).join(' | ')} |`)
  return lines.join('\n')
}

/** Uma tabela nova com `rows` linhas de dados e `columns` colunas, só de texto. */
export function newTable(columns: number, rows: number): NoteTable {
  const width = Math.max(1, Math.min(MAX_COLUMNS, Math.round(columns)))
  const height = Math.max(1, Math.min(MAX_ROWS, Math.round(rows)))
  return {
    columns: Array.from({ length: width }, (_, i) => ({ name: `Coluna ${i + 1}`, type: 'text' as const, total: false })),
    rows: Array.from({ length: height }, () => Array.from({ length: width }, () => '')),
  }
}

// ── Mudanças (devolvem uma tabela nova) ────────────────────────────────────

const clone = (table: NoteTable): NoteTable => ({ columns: table.columns.map((column) => ({ ...column })), rows: table.rows.map((cells) => [...cells]) })

export function setCell(table: NoteTable, row: number, column: number, text: string): NoteTable {
  const next = clone(table)
  if (row < 0) next.columns[column]!.name = text
  else next.rows[row]![column] = text
  return next
}

export function insertRow(table: NoteTable, at: number): NoteTable {
  if (table.rows.length >= MAX_ROWS) return table
  const next = clone(table)
  next.rows.splice(Math.max(0, Math.min(at, next.rows.length)), 0, next.columns.map(() => ''))
  return next
}

export function removeRow(table: NoteTable, at: number): NoteTable {
  const next = clone(table)
  next.rows.splice(at, 1)
  // Sempre fica pelo menos uma linha para escrever
  if (!next.rows.length) next.rows.push(next.columns.map(() => ''))
  return next
}

export function moveRow(table: NoteTable, from: number, to: number): NoteTable {
  if (to < 0 || to >= table.rows.length) return table
  const next = clone(table)
  const [moved] = next.rows.splice(from, 1)
  next.rows.splice(to, 0, moved!)
  return next
}

export function insertColumn(table: NoteTable, at: number): NoteTable {
  if (table.columns.length >= MAX_COLUMNS) return table
  const next = clone(table)
  const index = Math.max(0, Math.min(at, next.columns.length))
  next.columns.splice(index, 0, { name: `Coluna ${next.columns.length + 1}`, type: 'text', total: false })
  for (const cells of next.rows) cells.splice(index, 0, '')
  return next
}

export function removeColumn(table: NoteTable, at: number): NoteTable {
  if (table.columns.length <= 1) return table
  const next = clone(table)
  next.columns.splice(at, 1)
  for (const cells of next.rows) cells.splice(at, 1)
  return next
}

export function moveColumn(table: NoteTable, from: number, to: number): NoteTable {
  if (to < 0 || to >= table.columns.length) return table
  const next = clone(table)
  const [column] = next.columns.splice(from, 1)
  next.columns.splice(to, 0, column!)
  for (const cells of next.rows) {
    const [cell] = cells.splice(from, 1)
    cells.splice(to, 0, cell!)
  }
  return next
}

export function setColumnType(table: NoteTable, at: number, type: ColumnType): NoteTable {
  const next = clone(table)
  const column = next.columns[at]!
  column.type = type
  // Uma coluna nova de número já soma (é o mais comum); voltar a texto tira a soma
  column.total = type === 'number'
  return next
}

export function setColumnTotal(table: NoteTable, at: number, total: boolean): NoteTable {
  const next = clone(table)
  const column = next.columns[at]!
  column.total = column.type === 'number' && total
  return next
}

/** O texto da tabela para o Exportar TXT: colunas alinhadas com espaços, e a linha Total. */
export function tableToPlainText(table: NoteTable): string[] {
  const rows = [table.columns.map((column) => column.name), ...table.rows]
  if (hasTotals(table)) rows.push(totalRow(table))
  const widths = table.columns.map((_, i) => Math.max(...rows.map((cells) => (cells[i] ?? '').length)))
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (table.columns[i]?.type === 'number' ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!)))
      .join('   ')
      .replace(/\s+$/, '')
  const out = [line(rows[0]!), widths.map((width) => '-'.repeat(Math.max(width, 1))).join('   ')]
  for (const cells of rows.slice(1)) out.push(line(cells))
  return out
}
