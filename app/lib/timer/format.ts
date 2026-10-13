/** Como o Timer escreve tempos e durações (sem Vue). */

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Relógio grande: "25:00", "4:59", "1:02:03".
 * `up` (cronômetro, tempo feito) arredonda para baixo; a contagem regressiva, para
 * cima (o "00:00" só aparece quando o tempo acabou de verdade).
 */
export function formatClock(ms: number, direction: 'up' | 'down' = 'up'): string {
  const total = Math.max(0, direction === 'down' ? Math.ceil(ms / 1000 - 1e-6) : Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** Duração legível: "45 s", "12 min", "1 h", "1 h 05 min", "126 h 30 min". */
export function formatDuration(ms: number, options: { seconds?: boolean } = {}): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return options.seconds !== false && total > 0 ? `${total} s` : total > 0 ? '< 1 min' : '0 min'
  const minutesTotal = Math.round(total / 60)
  const hours = Math.floor(minutesTotal / 60)
  const minutes = minutesTotal % 60
  if (!hours) return `${minutes} min`
  return minutes ? `${hours} h ${pad(minutes)} min` : `${hours} h`
}

/** Valor curto para eixos e rótulos de barras: "2 h", "1,5 h", "40 min". */
export function formatShortDuration(ms: number): string {
  const minutes = ms / 60_000
  if (minutes < 1) return ms > 0 ? '< 1 min' : '0'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10
  return `${String(rounded).replace('.', ',')} h`
}

/** "14:05" (horário local). */
export function formatTimeOfDay(ms: number): string {
  const date = new Date(ms)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** "+12%", "−8%", "0%" (sem casas decimais; acima de 999%, "+999%"). */
export function formatPercent(fraction: number): string {
  const value = Math.round(fraction * 100)
  const capped = Math.min(999, Math.abs(value))
  return value > 0 ? `+${capped}%` : value < 0 ? `−${capped}%` : '0%'
}

/** Diferença com sinal: "+1 h 05 min", "−20 min". */
export function formatSignedDuration(ms: number): string {
  if (Math.round(ms / 1000) === 0) return '0 min'
  return `${ms > 0 ? '+' : '−'}${formatDuration(Math.abs(ms))}`
}

/** Minutos digitados ("25", "1:30", "1h30", "90 min") → ms; null se não der para entender. */
export function parseDurationInput(text: string): number | null {
  const value = text.trim().toLowerCase().replace(',', '.')
  if (!value) return null
  let match = /^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/.exec(value)
  if (match) {
    // "1:30" = 1 h 30 min; "1:30:15" = 1 h 30 min 15 s
    const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
    if (m >= 60 || s >= 60) return null
    return ((h * 60 + m) * 60 + s) * 1000
  }
  match = /^(?:(\d{1,3}(?:\.\d+)?)\s*h)?\s*(?:(\d{1,4}(?:\.\d+)?)\s*(?:m|min|mins|minutos?)?)?$/.exec(value)
  if (match && (match[1] || match[2])) {
    const ms = (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60_000
    return ms > 0 ? Math.round(ms) : null
  }
  return null
}
