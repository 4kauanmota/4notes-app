/**
 * Datas "de calendário" no formato AAAA-MM-DD (ISO), sempre no fuso local.
 *
 * As contas são feitas em UTC "puro" para evitar problemas com horário de verão:
 * uma data é só um dia do calendário, sem horas.
 */

export type ISODate = string

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (n: number) => String(n).padStart(2, '0')

function parts(iso: ISODate): [number, number, number] {
  const match = ISO_RE.exec(iso)
  if (!match) throw new Error(`Data inválida: ${iso}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function format(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

function utc(iso: ISODate): Date {
  const [y, m, d] = parts(iso)
  return new Date(Date.UTC(y, m - 1, d))
}

function fromUtc(date: Date): ISODate {
  return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false
  const [y, m, d] = parts(value)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}

/** Converte um Date (horário local) em AAAA-MM-DD. */
export function toISODate(date: Date): ISODate {
  return format(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function todayISO(): ISODate {
  return toISODate(new Date())
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDays(iso: ISODate, days: number): ISODate {
  const date = utc(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return fromUtc(date)
}

/**
 * Soma meses mantendo o dia quando possível. Se o mês não tiver esse dia,
 * usa o último dia do mês (31/01 + 1 mês = 28/02 ou 29/02).
 */
export function addMonths(iso: ISODate, months: number): ISODate {
  const [y, m, d] = parts(iso)
  const total = y * 12 + (m - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return format(year, month, Math.min(d, daysInMonth(year, month)))
}

/** Quantos dias de `from` até `to` (negativo se `to` for antes). */
export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000)
}

/** Diferença em meses de calendário (ignora o dia). */
export function diffMonths(from: ISODate, to: ISODate): number {
  const [fy, fm] = parts(from)
  const [ty, tm] = parts(to)
  return ty * 12 + tm - (fy * 12 + fm)
}

export function weekday(iso: ISODate): number {
  return utc(iso).getUTCDay()
}

// ── Exibição em português ──────────────────────────────────────────────────
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** 05/10/2026 */
export function formatDateBR(iso: ISODate): string {
  const [y, m, d] = parts(iso)
  return `${pad(d)}/${pad(m)}/${y}`
}

/** "quarta-feira, 1 de outubro" */
export function formatLongDate(iso: ISODate): string {
  const [, m, d] = parts(iso)
  return `${WEEKDAYS[weekday(iso)]}, ${d} de ${MONTHS[m - 1]}`
}

/** "dom., 05 out." / "dom., 05 out. 2027" */
export function formatShortDate(iso: ISODate, today?: ISODate): string {
  const [y, m, d] = parts(iso)
  const sameYear = today ? parts(today)[0] === y : true
  return `${WEEKDAYS_SHORT[weekday(iso)]}., ${pad(d)} ${MONTHS_SHORT[m - 1]}.${sameYear ? '' : ` ${y}`}`
}

/** "Hoje", "Amanhã", "Ontem", "sexta", "05 out", "05 out 2027" */
export function relativeDayLabel(iso: ISODate, today: ISODate): string {
  const diff = diffDays(today, iso)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Amanhã'
  if (diff === -1) return 'Ontem'
  if (diff > 1 && diff < 7) {
    const name = WEEKDAYS[weekday(iso)]!.replace('-feira', '')
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  const [y, m, d] = parts(iso)
  return `${pad(d)} ${MONTHS_SHORT[m - 1]}${parts(today)[0] === y ? '' : ` ${y}`}`
}

/** "agora", "há 5 min", "há 3 h", "ontem", "12 set" */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 45) return 'agora'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  const day = toISODate(new Date(timestamp))
  const today = toISODate(new Date(now))
  if (hours < 24 && day === today) return `há ${hours} h`
  const diff = diffDays(day, today)
  if (diff === 1) return 'ontem'
  return relativeDayLabel(day, today).toLowerCase()
}
