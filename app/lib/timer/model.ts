/**
 * Modelo de dados do TIMER + regras puras (sem Vue, sem disco).
 *
 * Tudo fica em <workspace>/timer/timer.json:
 * {
 *   "app": "4notes", "version": 1,
 *   "categories": [{ "id": "estudo", "name": "Estudo", "color": "purple", "createdAt": "…" }],
 *   "sessions": [{
 *     "id": "s_k3j9x0a2qm", "mode": "pomodoro", "activity": "Estudando Godot", "categoryId": "estudo",
 *     "start": "2026-10-09T13:00:00.000Z", "end": "2026-10-09T15:10:00.000Z",
 *     "duration": 6000,            ← tempo que conta (segundos)
 *     "measured": 6000,            ← tempo medido (segundos), sem pausas nem descansos
 *     "status": "completed",       ← completed | interrupted | canceled
 *     "target": 1500, "cycles": 4, "breaks": 1200,
 *     "spans": [["2026-10-09T13:00:00.000Z", "2026-10-09T13:25:00.000Z"], …],
 *     "notes": ""
 *   }],
 *   "active": { … a sessão em andamento (ver ActiveSession), ou null }
 * }
 *
 * Os "spans" são os trechos de tempo efetivo (sem pausas e sem os descansos do
 * Pomodoro): é com eles que as estatísticas dividem o tempo por dia e por hora.
 * Na memória, os horários são números (ms desde 1970); no arquivo, datas ISO.
 */
import { isPaletteColor, PALETTE, type PaletteColor } from '../colors'
import { createId } from '../utils/async'

export type TimerMode = 'stopwatch' | 'countdown' | 'pomodoro'
export type SessionStatus = 'completed' | 'interrupted' | 'canceled'
export type PomodoroPhase = 'focus' | 'short' | 'long'

export const TIMER_MODES: readonly TimerMode[] = ['stopwatch', 'countdown', 'pomodoro']
export const MODE_LABELS: Record<TimerMode, string> = { stopwatch: 'Cronômetro', countdown: 'Temporizador', pomodoro: 'Pomodoro' }
export const MODE_ICONS: Record<TimerMode, string> = { stopwatch: 'timer', countdown: 'hourglass', pomodoro: 'pomodoro' }
export const STATUS_LABELS: Record<SessionStatus, string> = { completed: 'Concluída', interrupted: 'Interrompida', canceled: 'Cancelada' }
export const PHASE_LABELS: Record<PomodoroPhase, string> = { focus: 'Foco', short: 'Pausa curta', long: 'Pausa longa' }

export interface TimerCategory {
  id: string
  name: string
  color: PaletteColor
  createdAt: string
}

/** Trecho de tempo efetivo: [início, fim] em ms. */
export type Span = [number, number]

/** Uma sessão registrada no histórico. */
export interface TimerSession {
  id: string
  mode: TimerMode
  /** O que foi feito ("Estudando Godot"); pode ficar vazio. */
  activity: string
  categoryId: string | null
  notes: string
  /** Início e fim (ms). */
  start: number
  end: number
  /** Tempo que conta nas estatísticas (segundos). Cancelada: 0, a não ser que haja tempo válido. */
  duration: number
  /** Tempo medido (segundos): a soma dos spans. */
  measured: number
  status: SessionStatus
  /** Temporizador: duração definida. Pomodoro: foco de cada ciclo. Em segundos. */
  target: number | null
  /** Pomodoro: ciclos de foco completos. */
  cycles: number
  /** Pomodoro: tempo de descanso (segundos) — não conta como tempo da atividade. */
  breaks: number
  spans: Span[]
}

/** Ciclos do Pomodoro (minutos). */
export interface PomodoroConfig {
  focus: number
  short: number
  long: number
  /** Ciclos de foco até a pausa longa. */
  rounds: number
  /** A próxima etapa começa sozinha quando a anterior termina. */
  autoStart: boolean
}

export const DEFAULT_POMODORO: Readonly<PomodoroConfig> = { focus: 25, short: 5, long: 15, rounds: 4, autoStart: false }

export interface PomodoroState {
  /** Os ciclos combinados quando a sessão começou (mudar a configuração não mexe nela). */
  config: PomodoroConfig
  phase: PomodoroPhase
  /** Tempo já corrido na etapa atual, antes de `runningSince` (ms). */
  phaseElapsed: number
  /** Ciclos de foco completos. */
  cycles: number
  /** Tempo de foco dos ciclos completos (ms) — é o que vale se a sessão for cancelada. */
  completedFocus: number
  /** Tempo de descanso (ms). */
  breaks: number
  /** A etapa anterior acabou e esta espera você começar. */
  waiting: boolean
}

/** A sessão em andamento (fica no timer.json: reabrir o app continua de onde parou). */
export interface ActiveSession {
  id: string
  mode: TimerMode
  activity: string
  categoryId: string | null
  notes: string
  /** Quando começou (ms). */
  startedAt: number
  /** Trechos de tempo efetivo já fechados. */
  spans: Span[]
  /** Contando desde (ms); null = pausada (ou esperando a próxima etapa do Pomodoro). */
  runningSince: number | null
  /** Temporizador: duração definida (ms). */
  target: number | null
  pomodoro: PomodoroState | null
}

export interface TimerData {
  categories: TimerCategory[]
  sessions: TimerSession[]
  active: ActiveSession | null
}

// ── Normalização (tolerante a arquivos editados à mão) ───────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)

/** Data ISO (ou número) → ms; null se inválida. */
function time(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string' || !v) return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

const iso = (ms: number) => new Date(ms).toISOString()

/** Número inteiro ≥ 0 (segundos, ciclos…). */
function count(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback
}

function minutes(v: unknown, fallback: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(1, Math.round(v))) : fallback
}

export function normalizePomodoroConfig(raw: unknown): PomodoroConfig {
  const data = isObject(raw) ? raw : {}
  return {
    focus: minutes(data.focus, DEFAULT_POMODORO.focus, 240),
    short: minutes(data.short, DEFAULT_POMODORO.short, 120),
    long: minutes(data.long, DEFAULT_POMODORO.long, 240),
    rounds: minutes(data.rounds, DEFAULT_POMODORO.rounds, 12),
    autoStart: data.autoStart === true,
  }
}

function normalizeSpans(raw: unknown): Span[] {
  if (!Array.isArray(raw)) return []
  const spans: Span[] = []
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue
    const start = time(item[0])
    const end = time(item[1])
    if (start !== null && end !== null && end > start) spans.push([start, end])
  }
  return spans.sort((a, b) => a[0] - b[0])
}

export const spansTotal = (spans: readonly Span[]) => spans.reduce((sum, [start, end]) => sum + (end - start), 0)

const isMode = (v: unknown): v is TimerMode => typeof v === 'string' && (TIMER_MODES as readonly string[]).includes(v)
const isStatus = (v: unknown): v is SessionStatus => v === 'completed' || v === 'interrupted' || v === 'canceled'
const isPhase = (v: unknown): v is PomodoroPhase => v === 'focus' || v === 'short' || v === 'long'

export function normalizeSession(raw: unknown): TimerSession | null {
  if (!isObject(raw)) return null
  const spans = normalizeSpans(raw.spans)
  const start = time(raw.start) ?? spans[0]?.[0] ?? null
  const end = time(raw.end) ?? spans.at(-1)?.[1] ?? null
  if (start === null || end === null || end < start) return null
  const measured = count(raw.measured, Math.round(spansTotal(spans) / 1000))
  const status: SessionStatus = isStatus(raw.status) ? raw.status : 'completed'
  // O tempo que conta nunca passa do tempo entre o início e o fim
  const span = Math.round((end - start) / 1000)
  const duration = Math.min(span, count(raw.duration, status === 'canceled' ? 0 : measured))
  return {
    id: str(raw.id) || createId('s'),
    mode: isMode(raw.mode) ? raw.mode : 'stopwatch',
    activity: str(raw.activity).trim().slice(0, 200),
    categoryId: typeof raw.categoryId === 'string' && raw.categoryId ? raw.categoryId : null,
    notes: str(raw.notes),
    start,
    end,
    duration,
    measured,
    status,
    target: typeof raw.target === 'number' && raw.target > 0 ? Math.round(raw.target) : null,
    cycles: count(raw.cycles),
    breaks: count(raw.breaks),
    spans,
  }
}

function normalizeActive(raw: unknown): ActiveSession | null {
  if (!isObject(raw)) return null
  const startedAt = time(raw.startedAt)
  if (startedAt === null) return null
  const mode = isMode(raw.mode) ? raw.mode : 'stopwatch'
  const target = typeof raw.target === 'number' && raw.target > 0 ? raw.target : null
  if (mode === 'countdown' && target === null) return null
  let pomodoro: PomodoroState | null = null
  if (mode === 'pomodoro') {
    const data = isObject(raw.pomodoro) ? raw.pomodoro : {}
    pomodoro = {
      config: normalizePomodoroConfig(data.config),
      phase: isPhase(data.phase) ? data.phase : 'focus',
      phaseElapsed: count(data.phaseElapsed),
      cycles: count(data.cycles),
      completedFocus: count(data.completedFocus),
      breaks: count(data.breaks),
      waiting: data.waiting === true,
    }
  }
  return {
    id: str(raw.id) || createId('s'),
    mode,
    activity: str(raw.activity).slice(0, 200),
    categoryId: typeof raw.categoryId === 'string' && raw.categoryId ? raw.categoryId : null,
    notes: str(raw.notes),
    startedAt,
    spans: normalizeSpans(raw.spans),
    runningSince: time(raw.runningSince),
    target,
    pomodoro,
  }
}

function normalizeCategory(raw: unknown): TimerCategory | null {
  if (!isObject(raw)) return null
  const name = str(raw.name).trim()
  const id = str(raw.id).trim()
  if (!name || !id) return null
  return { id, name, color: isPaletteColor(raw.color) ? raw.color : 'gray', createdAt: str(raw.createdAt, new Date().toISOString()) }
}

/** Valida o conteúdo lido do timer.json. Lança erro se não for um objeto. */
export function normalizeTimerFile(raw: unknown): TimerData {
  if (!isObject(raw)) throw new Error('O arquivo timer.json não contém um objeto JSON válido.')
  const categories: TimerCategory[] = []
  const categoryIds = new Set<string>()
  for (const item of Array.isArray(raw.categories) ? raw.categories : []) {
    const category = normalizeCategory(item)
    if (!category || categoryIds.has(category.id)) continue
    categoryIds.add(category.id)
    categories.push(category)
  }
  // A mesma sessão duas vezes (cópia manual, conflito de sincronização): fica uma só
  const seen = new Set<string>()
  const sessions: TimerSession[] = []
  for (const item of Array.isArray(raw.sessions) ? raw.sessions : []) {
    const session = normalizeSession(item)
    if (!session || seen.has(session.id)) continue
    seen.add(session.id)
    sessions.push(session)
  }
  sessions.sort((a, b) => a.start - b.start)
  const active = normalizeActive(raw.active)
  // A sessão em andamento já foi registrada (finalizada em outro aparelho): não continua
  return { categories, sessions, active: active && !seen.has(active.id) ? active : null }
}

function serializeSession(session: TimerSession): Record<string, unknown> {
  return {
    id: session.id,
    mode: session.mode,
    activity: session.activity,
    categoryId: session.categoryId,
    start: iso(session.start),
    end: iso(session.end),
    duration: session.duration,
    measured: session.measured,
    status: session.status,
    target: session.target,
    cycles: session.cycles,
    breaks: session.breaks,
    notes: session.notes,
    spans: session.spans.map(([start, end]) => [iso(start), iso(end)]),
  }
}

function serializeActive(active: ActiveSession): Record<string, unknown> {
  return {
    id: active.id,
    mode: active.mode,
    activity: active.activity,
    categoryId: active.categoryId,
    notes: active.notes,
    startedAt: iso(active.startedAt),
    spans: active.spans.map(([start, end]) => [iso(start), iso(end)]),
    runningSince: active.runningSince === null ? null : iso(active.runningSince),
    target: active.target,
    pomodoro: active.pomodoro,
  }
}

export function serializeTimer(data: TimerData): string {
  const file = {
    app: '4notes',
    version: 1,
    categories: data.categories,
    sessions: data.sessions.map(serializeSession),
    active: data.active ? serializeActive(data.active) : null,
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

export function defaultTimerData(): TimerData {
  return { categories: [], sessions: [], active: null }
}

// ── Categorias ───────────────────────────────────────────────────────────────

/** "Desenvolvimento de jogos" → "desenvolvimento-de-jogos" (IDs legíveis no JSON). */
export function categoryIdFor(name: string, taken: (id: string) => boolean): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'categoria'
  if (!taken(slug)) return slug
  for (let i = 2; ; i++) if (!taken(`${slug}-${i}`)) return `${slug}-${i}`
}

/** Uma cor ainda não usada pelas categorias (ou roxo). */
export function suggestColor(used: Iterable<PaletteColor>): PaletteColor {
  const taken = new Set(used)
  return PALETTE.find((color) => !taken.has(color)) ?? 'purple'
}

/**
 * Excluir uma categoria não apaga nada do histórico: as sessões dela ficam sem
 * categoria (e a sessão em andamento também).
 */
export function withoutCategory(data: TimerData, id: string): TimerData {
  return {
    categories: data.categories.filter((category) => category.id !== id),
    sessions: data.sessions.map((session) => (session.categoryId === id ? { ...session, categoryId: null } : session)),
    active: data.active?.categoryId === id ? { ...data.active, categoryId: null } : data.active,
  }
}

// ── Atividades ───────────────────────────────────────────────────────────────

/** Chave para juntar a mesma atividade escrita de jeitos diferentes ("Estudando  godot"). */
export function activityKey(activity: string): string {
  return activity.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
}

export interface RecentActivity {
  activity: string
  categoryId: string | null
}

/** Atividades usadas por último (sem repetir), para começar de novo com um clique. */
export function recentActivities(sessions: readonly TimerSession[], limit = 5): RecentActivity[] {
  const seen = new Set<string>()
  const list: RecentActivity[] = []
  for (let i = sessions.length - 1; i >= 0 && list.length < limit; i--) {
    const session = sessions[i]!
    if (!session.activity) continue
    const key = `${activityKey(session.activity)}|${session.categoryId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ activity: session.activity, categoryId: session.categoryId })
  }
  return list
}

/** Todas as atividades já usadas (sugestões do campo), das mais recentes para as mais antigas. */
export function knownActivities(sessions: readonly TimerSession[]): RecentActivity[] {
  return recentActivities(sessions, Number.POSITIVE_INFINITY)
}

/** A categoria usada da última vez com essa atividade (para preencher sozinha). */
export function lastCategoryOf(sessions: readonly TimerSession[], activity: string): string | null | undefined {
  const key = activityKey(activity)
  if (!key) return undefined
  for (let i = sessions.length - 1; i >= 0; i--) if (activityKey(sessions[i]!.activity) === key) return sessions[i]!.categoryId
  return undefined
}

/** A sessão conta nas estatísticas? (tempo válido maior que zero) */
export const counts = (session: TimerSession) => session.duration > 0
