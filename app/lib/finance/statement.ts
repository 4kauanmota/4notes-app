/**
 * Importar um extrato bancário (1.7.1): leitura de CSV e OFX, regras puras (sem Vue,
 * sem disco, sem internet: o arquivo é lido só aqui, no aparelho).
 *
 * - OFX (1.x SGML ou 2.x XML): as transações (<STMTTRN>) com data, valor com sinal,
 *   descrição (NAME/MEMO) e o id do banco (FITID), que evita importar duas vezes.
 * - CSV: o separador (; , tab |), a linha de cabeçalho (os bancos põem linhas antes
 *   dela), as colunas (data, descrição, valor, ou crédito e débito separados, ou uma
 *   coluna D/C), o formato das datas e o separador dos centavos são descobertos pelo
 *   conteúdo; você pode corrigir tudo na prévia (ColumnMapping).
 * - O sinal decide gasto × entrada, conforme o tipo do extrato: na conta, negativo é
 *   gasto; na fatura do cartão, positivo é gasto (compra) e negativo, pagamento ou
 *   estorno. Nada é decidido sem mostrar na prévia.
 */
import { addDays, isISODate, type ISODate } from '../dates'
import { MAX_AMOUNT } from './format'
import { foldText, type EntryKind, type Expense } from './model'

export type StatementFormat = 'csv' | 'ofx'

/** Uma transação lida do arquivo (valor em centavos, com o sinal do arquivo). */
export interface StatementRow {
  /** Linha (CSV) ou posição (OFX) no arquivo, para mostrar e para chave. */
  line: number
  date: ISODate | null
  description: string
  /** Centavos com sinal; null = valor ilegível. */
  amount: number | null
  /** Id da transação no banco (OFX FITID). */
  externalId: string | null
}

// ── Texto do arquivo ─────────────────────────────────────────────────────────

/** Bytes → texto: UTF-8 se for válido; senão Windows-1252 (o padrão dos bancos brasileiros). */
export function decodeStatement(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  return text.replace(/^﻿/, '')
}

export function detectFormat(text: string, fileName = ''): StatementFormat {
  if (/\.(ofx|qfx)$/i.test(fileName)) return 'ofx'
  return /<OFX>|OFXHEADER\s*:|<STMTTRN>/i.test(text.slice(0, 4000)) ? 'ofx' : 'csv'
}

// ── Valores e datas ──────────────────────────────────────────────────────────

export type DecimalSeparator = ',' | '.'

/**
 * "−1.234,56", "R$ 52,30", "(12,00)", "12,00-", "12.5 D", "-1234.56" → centavos com sinal.
 * `decimal` diz qual é o separador dos centavos.
 */
export function parseSignedAmount(input: string, decimal: DecimalSeparator): number | null {
  let text = input.trim().replace(/ | /g, ' ')
  if (!text) return null
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  const suffix = text.match(/\s*([DC])$/i)
  if (suffix) {
    negative = suffix[1]!.toUpperCase() === 'D'
    text = text.slice(0, -suffix[0].length)
  }
  text = text.replace(/R\$|BRL|\s/gi, '')
  if (/^[-−–]/.test(text)) {
    negative = !negative
    text = text.slice(1)
  } else if (/^\+/.test(text)) {
    text = text.slice(1)
  }
  if (/[-−–]$/.test(text)) {
    negative = !negative
    text = text.slice(0, -1)
  }
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null
  const thousands = decimal === ',' ? '.' : ','
  const parts = text.split(thousands).join('').split(decimal)
  if (parts.length > 2) return null
  const whole = parts[0] || '0'
  const decimals = parts[1] ?? ''
  // Mais de 2 casas só se forem zeros ("12.3400"); senão o separador está errado
  if (decimals.length > 2 && /[1-9]/.test(decimals.slice(2))) return null
  const fraction = decimals.slice(0, 2).padEnd(2, '0')
  if (!/^\d+$/.test(whole) || !/^\d{2}$/.test(fraction)) return null
  const cents = Number(whole) * 100 + Number(fraction)
  if (!Number.isFinite(cents) || cents > MAX_AMOUNT) return null
  return negative ? -cents : cents
}

/** Qual separador de centavos a coluna usa (pela maioria dos valores). */
export function detectDecimal(values: readonly string[]): DecimalSeparator {
  let comma = 0
  let dot = 0
  for (const value of values) {
    const text = value.replace(/[^\d.,]/g, '')
    const lastComma = text.lastIndexOf(',')
    const lastDot = text.lastIndexOf('.')
    if (lastComma > lastDot && /,\d{1,2}$/.test(text)) comma++
    else if (lastDot > lastComma && /\.\d{1,2}$/.test(text)) dot++
    else if (lastComma > lastDot && /,\d{3}$/.test(text)) dot++ // "1,234" = mil (inglês)
    else if (lastDot > lastComma && /\.\d{3}$/.test(text)) comma++ // "1.234" = mil (brasileiro)
  }
  return dot > comma ? '.' : ','
}

export type DateOrder = 'dmy' | 'mdy' | 'ymd'

export const DATE_ORDERS: { value: DateOrder; label: string }[] = [
  { value: 'dmy', label: 'Dia/mês/ano' },
  { value: 'mdy', label: 'Mês/dia/ano' },
  { value: 'ymd', label: 'Ano-mês-dia' },
]

const pad = (value: number) => String(value).padStart(2, '0')

/** "21/10/2026", "21-10-26", "2026-10-21", "2026-10-21T13:00", "21.10.2026", "20261021" → ISO. */
export function parseStatementDate(input: string, order: DateOrder): ISODate | null {
  const text = input.trim()
  let y: number
  let m: number
  let d: number
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})/)
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  const other = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/)
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (other) {
    const year = Number(other[3])
    y = other[3]!.length === 2 ? 2000 + year : year
    ;[d, m] = order === 'mdy' ? [Number(other[2]), Number(other[1])] : [Number(other[1]), Number(other[2])]
  } else if (compact) [y, m, d] = [Number(compact[1]), Number(compact[2]), Number(compact[3])]
  else return null
  const date = `${y}-${pad(m)}-${pad(d)}`
  return isISODate(date) ? date : null
}

/** A ordem das datas da coluna: dia antes do mês, a não ser que algum "dia" passe de 12 na segunda posição. */
export function detectDateOrder(values: readonly string[]): DateOrder {
  let dmy = 0
  let mdy = 0
  let ymd = 0
  for (const value of values) {
    const text = value.trim()
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text) || /^\d{8}$/.test(text)) ymd++
    const match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/)
    if (!match) continue
    if (Number(match[1]) > 12) dmy++
    if (Number(match[2]) > 12) mdy++
  }
  if (ymd > dmy + mdy) return 'ymd'
  return mdy > dmy ? 'mdy' : 'dmy'
}

// ── OFX ──────────────────────────────────────────────────────────────────────

/** Valor de uma tag folha do OFX (SGML sem fechamento ou XML). */
function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}>\\s*([^<\\r\\n]*)`, 'i'))
  return match ? decodeEntities(match[1]!.trim()) : null
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

export interface OfxStatement {
  rows: StatementRow[]
  /** Fatura de cartão (CCSTMTRS) × conta (STMTRS). */
  creditCard: boolean
}

export function parseOfx(text: string): OfxStatement {
  const rows: StatementRow[] = []
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  blocks.forEach((chunk, index) => {
    const block = chunk.split(/<\/STMTTRN>/i)[0]!
    const posted = tag(block, 'DTPOSTED') ?? tag(block, 'DTUSER') ?? ''
    const raw = (tag(block, 'TRNAMT') ?? '').replace(/\s/g, '')
    // O OFX usa ponto; alguns bancos mandam vírgula
    const amount = parseSignedAmount(raw, /,\d{1,2}$/.test(raw) && !/\.\d{1,2}$/.test(raw) ? ',' : '.')
    const name = tag(block, 'NAME') ?? ''
    const memo = tag(block, 'MEMO') ?? ''
    const description = (memo && name && !foldText(memo).includes(foldText(name)) && !foldText(name).includes(foldText(memo)) ? `${name} · ${memo}` : memo.length > name.length ? memo : name || memo).replace(/\s+/g, ' ').trim()
    rows.push({
      line: index + 1,
      date: parseStatementDate(posted.slice(0, 8), 'ymd'),
      description,
      amount,
      externalId: tag(block, 'FITID') || null,
    })
  })
  return { rows, creditCard: /<CCSTMTRS>/i.test(text) }
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const DELIMITERS = [';', ',', '\t', '|'] as const

/** Linhas e colunas de um CSV (aspas, aspas dobradas e quebras de linha dentro de aspas). */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"' && !cell.trim()) {
      quoted = true
      cell = ''
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.map((cells) => cells.map((value) => value.trim())).filter((cells) => cells.some((value) => value))
}

/** O separador que dá o mesmo número (≥ 2) de colunas no maior número de linhas. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 40).join('\n')
  let best: { delimiter: string; score: number } = { delimiter: ';', score: -1 }
  for (const delimiter of DELIMITERS) {
    const rows = splitCsv(sample, delimiter)
    const counts = new Map<number, number>()
    for (const row of rows) if (row.length >= 2) counts.set(row.length, (counts.get(row.length) ?? 0) + 1)
    const score = Math.max(0, ...counts.values())
    if (score > best.score) best = { delimiter, score }
  }
  return best.delimiter
}

export type ColumnRole = 'date' | 'description' | 'amount' | 'credit' | 'debit' | 'type'

export interface CsvMapping {
  delimiter: string
  /** Índice da linha de cabeçalho, contando só as linhas com conteúdo (-1 = sem cabeçalho). */
  header: number
  date: number
  description: number[]
  /** Uma coluna com o valor (com sinal) … */
  amount: number
  /** … ou crédito e débito separados (-1 = não tem). */
  credit: number
  debit: number
  /** Coluna "D/C" ou "Débito/Crédito" (-1 = não tem). */
  type: number
  decimal: DecimalSeparator
  dateOrder: DateOrder
}

const HEADERS: Record<ColumnRole, RegExp> = {
  date: /^(data|date|dt|dia)\b|data (da )?(transa|lan|mov|compra)|^vencimento/,
  description: /descri|hist[oó]rico|lan[cç]amento|memo|title|t[ií]tulo|estabelecimento|detalhe|benefici|favorecido|identifica|^nome/,
  amount: /^valor|amount|quantia|montante|^value|valor \(r\$\)|^r\$/,
  credit: /cr[eé]dito|entrada|^credit/,
  debit: /d[eé]bito|sa[ií]da|^debit/,
  type: /^(tipo|natureza|d\/c|c\/d|dc|cd|opera[cç][aã]o)$/,
}

const looksLikeDate = (value: string) => /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(value.trim()) || /^\d{8}$/.test(value.trim())
const looksLikeAmount = (value: string) => /^[(+\-−]?\s*(R\$\s*)?[\d.,]*\d[\d.,]*\)?\s*[-DC]?$/i.test(value.trim()) && /[.,]\d{2}\b|^\d+$/.test(value.replace(/[^\d.,]/g, ''))

/** Descobre o cabeçalho e as colunas (o usuário pode trocar na prévia). */
export function detectCsvMapping(text: string): CsvMapping {
  const delimiter = detectDelimiter(text)
  const rows = splitCsv(text, delimiter)
  const width = Math.max(0, ...rows.map((row) => row.length))
  // Cabeçalho: a primeira linha (das 15 primeiras) com nomes de coluna conhecidos
  let header = -1
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i]!.map((cell) => foldText(cell))
    const known = cells.filter((cell) => Object.values(HEADERS).some((re) => re.test(cell))).length
    if (known >= 2 && rows[i]!.length >= 2 && !rows[i]!.some(looksLikeDate)) {
      header = i
      break
    }
  }
  const names = header >= 0 ? rows[header]!.map((cell) => foldText(cell)) : []
  const body = rows.slice(header + 1).filter((row) => row.length >= 2)
  const column = (index: number) => body.map((row) => row[index] ?? '').filter(Boolean)
  const byHeader = (role: ColumnRole, exclude: number[] = []) => names.findIndex((name, index) => !exclude.includes(index) && HEADERS[role].test(name))
  const share = (index: number, test: (value: string) => boolean) => {
    const values = column(index)
    return values.length ? values.filter(test).length / values.length : 0
  }

  let date = byHeader('date')
  if (date < 0 || share(date, looksLikeDate) < 0.6) date = [...Array(width).keys()].find((index) => share(index, looksLikeDate) >= 0.8) ?? -1
  let amount = byHeader('amount', [date])
  const credit = byHeader('credit', [date, amount])
  const debit = byHeader('debit', [date, amount, credit])
  if (amount >= 0 && share(amount, looksLikeAmount) < 0.5) amount = -1
  if (amount < 0 && (credit < 0 || debit < 0)) {
    // Sem nome conhecido: a última coluna que parece valor
    const candidates = [...Array(width).keys()].filter((index) => index !== date && share(index, looksLikeAmount) >= 0.8)
    amount = candidates.at(-1) ?? -1
  }
  const type = byHeader('type', [date, amount, credit, debit])
  let description = names.map((name, index) => (HEADERS.description.test(name) && ![date, amount, credit, debit, type].includes(index) ? index : -1)).filter((index) => index >= 0)
  if (!description.length) {
    // O texto mais longo (que não é data nem valor)
    let bestIndex = -1
    let bestLength = 0
    for (let index = 0; index < width; index++) {
      if ([date, amount, credit, debit, type].includes(index)) continue
      const values = column(index).filter((value) => !looksLikeAmount(value) && !looksLikeDate(value))
      const average = values.reduce((sum, value) => sum + value.length, 0) / Math.max(1, column(index).length)
      if (average > bestLength) {
        bestLength = average
        bestIndex = index
      }
    }
    description = bestIndex >= 0 ? [bestIndex] : []
  }
  const amountValues = [amount, credit, debit].filter((index) => index >= 0).flatMap(column)
  return {
    delimiter,
    header,
    date,
    description: description.slice(0, 2),
    amount: credit >= 0 && debit >= 0 && amount < 0 ? -1 : amount,
    credit: credit >= 0 && debit >= 0 && amount < 0 ? credit : -1,
    debit: credit >= 0 && debit >= 0 && amount < 0 ? debit : -1,
    type,
    decimal: detectDecimal(amountValues),
    dateOrder: detectDateOrder(date >= 0 ? column(date) : []),
  }
}

export interface CsvTable {
  /** Nomes das colunas (do cabeçalho ou "Coluna 1"…). */
  columns: string[]
  /** Linhas de dados (depois do cabeçalho), com o número da linha no arquivo. */
  rows: { line: number; cells: string[] }[]
}

export function csvTable(text: string, mapping: Pick<CsvMapping, 'delimiter' | 'header'>): CsvTable {
  const all = splitCsv(text, mapping.delimiter)
  const width = Math.max(0, ...all.map((row) => row.length))
  const head = mapping.header >= 0 ? (all[mapping.header] ?? []) : []
  const columns = [...Array(width).keys()].map((index) => head[index] || `Coluna ${index + 1}`)
  const rows = all.slice(mapping.header + 1).map((cells, index) => ({ line: mapping.header + 2 + index, cells }))
  return { columns, rows }
}

/** As transações do CSV com as colunas escolhidas. Linhas sem data nem valor (totais, saldos) ficam de fora. */
export function parseCsv(text: string, mapping: CsvMapping): StatementRow[] {
  const { rows } = csvTable(text, mapping)
  const result: StatementRow[] = []
  for (const { line, cells } of rows) {
    const date = mapping.date >= 0 ? parseStatementDate(cells[mapping.date] ?? '', mapping.dateOrder) : null
    let amount: number | null = null
    if (mapping.amount >= 0) {
      amount = parseSignedAmount(cells[mapping.amount] ?? '', mapping.decimal)
    } else if (mapping.credit >= 0 || mapping.debit >= 0) {
      const credit = mapping.credit >= 0 && cells[mapping.credit] ? parseSignedAmount(cells[mapping.credit]!, mapping.decimal) : null
      const debit = mapping.debit >= 0 && cells[mapping.debit] ? parseSignedAmount(cells[mapping.debit]!, mapping.decimal) : null
      if (credit !== null || debit !== null) amount = Math.abs(credit ?? 0) - Math.abs(debit ?? 0)
    }
    if (amount !== null && mapping.type >= 0) {
      const type = foldText(cells[mapping.type] ?? '').trim()
      if (/^(d|deb|debito|saida|s|-)$/.test(type) || type.startsWith('debit')) amount = -Math.abs(amount)
      else if (/^(c|cred|credito|entrada|e|\+)$/.test(type) || type.startsWith('credit')) amount = Math.abs(amount)
    }
    const description = mapping.description
      .map((index) => cells[index] ?? '')
      .filter(Boolean)
      .join(' · ')
      .replace(/\s+/g, ' ')
      .trim()
    // Linhas vazias, de saldo e de total não são transações
    if (!date && amount === null) continue
    if (/^(saldo|s a l d o|total)\b/.test(foldText(description))) continue
    result.push({ line, date, description, amount, externalId: null })
  }
  return result
}

// ── Do arquivo para a prévia ─────────────────────────────────────────────────

/** Como ler o sinal: na conta, negativo = gasto; na fatura do cartão, positivo = gasto. */
export type SignConvention = 'account' | 'card'

export function kindOf(amount: number, sign: SignConvention): EntryKind {
  return (sign === 'account' ? amount < 0 : amount > 0) ? 'expense' : 'income'
}

/** Fatura de cartão? (quase todos os valores positivos e sem crédito/débito separados) */
export function guessSign(rows: readonly StatementRow[], creditCard = false): SignConvention {
  if (creditCard) return 'account' // OFX de cartão: as compras já vêm negativas
  const values = rows.map((row) => row.amount).filter((value): value is number => value !== null && value !== 0)
  if (values.length < 3) return 'account'
  const positive = values.filter((value) => value > 0).length
  return positive / values.length >= 0.85 ? 'card' : 'account'
}

// ── Categorias sugeridas ─────────────────────────────────────────────────────

/** "UBER *TRIP 21/10 SAO PAULO" → "uber trip sao paulo": sem números, datas e símbolos. */
export function descriptionKey(text: string): string {
  return foldText(text)
    .replace(/\d+[/.-]\d+([/.-]\d+)?/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(pix|ted|doc|compra|pagamento|pgto|pag|debito|credito|cartao|transf|transferencia|enviado|enviada|recebido|recebida|no|na|de|do|da|em|para)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface CategoryHint {
  id: string
  name: string
}

/**
 * Sugere a categoria de uma descrição: a de um lançamento já classificado com a mesma
 * descrição (ou o mesmo começo, "uber trip" × "uber"), ou uma categoria cujo nome está
 * no texto. Só uma sugestão: aparece marcada na prévia.
 */
export function categorySuggester(entries: readonly Expense[], categories: readonly CategoryHint[]): (description: string, kind: EntryKind) => string | null {
  const known = new Set(categories.map((category) => category.id))
  const exact = new Map<string, Map<string, number>>()
  const firstWord = new Map<string, Map<string, number>>()
  const vote = (map: Map<string, Map<string, number>>, key: string, id: string) => {
    if (!key) return
    const votes = map.get(key) ?? new Map<string, number>()
    votes.set(id, (votes.get(id) ?? 0) + 1)
    map.set(key, votes)
  }
  for (const entry of entries) {
    if (!entry.categoryId || !known.has(entry.categoryId)) continue
    const key = descriptionKey(entry.description)
    vote(exact, `${entry.kind}|${key}`, entry.categoryId)
    const word = key.split(' ').find((part) => part.length >= 3)
    if (word) vote(firstWord, `${entry.kind}|${word}`, entry.categoryId)
  }
  const winner = (votes: Map<string, number> | undefined) => (votes ? [...votes.entries()].sort((a, b) => b[1] - a[1])[0]![0] : null)
  const names = categories.map((category) => ({ id: category.id, word: foldText(category.name).trim() })).filter((item) => item.word.length >= 3)
  return (description, kind) => {
    const key = descriptionKey(description)
    const found = winner(exact.get(`${kind}|${key}`))
    if (found) return found
    const word = key.split(' ').find((part) => part.length >= 3)
    const byWord = word ? winner(firstWord.get(`${kind}|${word}`)) : null
    if (byWord) return byWord
    const text = ` ${foldText(description)} `
    return names.find((item) => text.includes(` ${item.word} `))?.id ?? null
  }
}

// ── Duplicados ───────────────────────────────────────────────────────────────

export interface DuplicateMatch {
  entry: Expense
  /** Mesmo id do banco (certeza) × mesmo valor em data próxima (possível). */
  certain: boolean
}

/**
 * Já está registrado? Mesmo id do banco (OFX) = com certeza; mesmo tipo e valor em até 3
 * dias de diferença = possível (fica desmarcado na prévia, para você decidir). Cada
 * lançamento existente só "casa" com uma transação do arquivo.
 */
export function duplicateFinder(entries: readonly Expense[]): (row: { date: ISODate; amount: number; kind: EntryKind; externalId: string | null; description: string }) => DuplicateMatch | null {
  const byExternal = new Map<string, Expense>()
  for (const entry of entries) if (entry.externalId) byExternal.set(entry.externalId, entry)
  const used = new Set<string>()
  const candidates = entries.filter((entry) => entry.status !== 'cancelled')
  return (row) => {
    const external = row.externalId ? byExternal.get(row.externalId) : undefined
    if (external && !used.has(external.id)) {
      used.add(external.id)
      return { entry: external, certain: true }
    }
    const words = new Set(descriptionKey(row.description).split(' ').filter((word) => word.length >= 3))
    let best: { entry: Expense; score: number } | null = null
    for (const entry of candidates) {
      if (used.has(entry.id) || entry.kind !== row.kind || entry.amount !== row.amount) continue
      const day = entry.status === 'done' && entry.doneOn ? entry.doneOn : entry.date
      const distance = Math.abs(Date.parse(`${day}T12:00:00Z`) - Date.parse(`${row.date}T12:00:00Z`)) / 86_400_000
      if (distance > 3) continue
      const shared = descriptionKey(entry.description)
        .split(' ')
        .filter((word) => words.has(word)).length
      const score = shared * 10 - distance
      if (!best || score > best.score) best = { entry, score }
    }
    if (!best) return null
    used.add(best.entry.id)
    return { entry: best.entry, certain: false }
  }
}

/** Período coberto pelas transações (para dizer "21/09 a 20/10"). */
export function statementRange(rows: readonly { date: ISODate | null }[]): { from: ISODate; to: ISODate } | null {
  const dates = rows.map((row) => row.date).filter((date): date is ISODate => !!date).sort()
  return dates.length ? { from: dates[0]!, to: dates.at(-1)! } : null
}

/** Uma data a mais de 1 dia no futuro provavelmente foi lida no formato errado. */
export const suspiciousDate = (date: ISODate, today: ISODate) => date > addDays(today, 1)
