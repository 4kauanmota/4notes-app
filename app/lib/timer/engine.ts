/**
 * O relógio do Timer — regras puras, sem Vue e sem disco.
 *
 * Nada aqui depende de um contador sendo somado a cada segundo: a sessão guarda
 * QUANDO cada trecho começou e terminou (ms), e o tempo é sempre calculado a partir
 * do relógio (`now`). Por isso a contagem continua certa trocando de módulo,
 * minimizando, com o computador suspenso ou com o app fechado — ao voltar, `advance`
 * calcula o que aconteceu enquanto isso (o temporizador que acabou, a etapa do
 * Pomodoro que terminou).
 *
 * As funções devolvem uma sessão NOVA (não mexem na recebida).
 */
import { createId } from '../utils/async'
import {
  spansTotal,
  type ActiveSession,
  type PomodoroConfig,
  type PomodoroPhase,
  type PomodoroState,
  type SessionStatus,
  type Span,
  type TimerMode,
  type TimerSession,
} from './model'

const MINUTE = 60_000

/**
 * Uma etapa do Pomodoro que terminou há mais que isso (app fechado, computador
 * suspenso) não puxa a próxima sozinha, mesmo com o início automático: ela espera
 * você — senão o tempo em que você não estava ali contaria como foco.
 */
export const AUTO_START_TOLERANCE_MS = 15_000

/** Sessões canceladas com menos que isso (e sem tempo válido) nem entram no histórico. */
export const MIN_CANCELED_MS = 60_000
/** Sessões finalizadas com menos que isso (um clique sem querer) não são registradas. */
export const MIN_SESSION_MS = 1_000

export interface StartInput {
  mode: TimerMode
  activity?: string
  categoryId?: string | null
  /** Temporizador: duração (ms). */
  target?: number | null
  pomodoro?: PomodoroConfig | null
}

const clone = (session: ActiveSession): ActiveSession => ({
  ...session,
  spans: session.spans.map(([a, b]) => [a, b] as Span),
  pomodoro: session.pomodoro ? { ...session.pomodoro, config: { ...session.pomodoro.config } } : null,
})

export function phaseLength(config: PomodoroConfig, phase: PomodoroPhase): number {
  return (phase === 'focus' ? config.focus : phase === 'short' ? config.short : config.long) * MINUTE
}

/** A etapa que vem depois (a pausa longa a cada `rounds` ciclos de foco). */
export function nextPhase(state: Pick<PomodoroState, 'phase' | 'cycles' | 'config'>): PomodoroPhase {
  if (state.phase !== 'focus') return 'focus'
  return state.cycles > 0 && state.cycles % state.config.rounds === 0 ? 'long' : 'short'
}

export function startSession(input: StartInput, now: number, id = createId('s')): ActiveSession {
  const mode = input.mode
  return {
    id,
    mode,
    activity: (input.activity ?? '').trim().slice(0, 200),
    categoryId: input.categoryId ?? null,
    notes: '',
    startedAt: now,
    spans: [],
    runningSince: now,
    target: mode === 'countdown' ? Math.max(1_000, Math.round(input.target ?? 25 * MINUTE)) : null,
    pomodoro:
      mode === 'pomodoro'
        ? { config: { ...input.pomodoro! }, phase: 'focus', phaseElapsed: 0, cycles: 0, completedFocus: 0, breaks: 0, waiting: false }
        : null,
  }
}

export const isRunning = (session: ActiveSession) => session.runningSince !== null

/** Agora é tempo efetivo? (no Pomodoro, só o foco conta; os descansos não). */
const countsNow = (session: ActiveSession) => !session.pomodoro || session.pomodoro.phase === 'focus'

/** Tempo efetivo até agora (ms): sem pausas e sem os descansos do Pomodoro. */
export function elapsed(session: ActiveSession, now: number): number {
  const open = session.runningSince !== null && countsNow(session) ? Math.max(0, now - session.runningSince) : 0
  return spansTotal(session.spans) + open
}

/** Tempo efetivo dentro de [from, to) (ms) — ex.: quanto da sessão em andamento foi hoje. */
export function elapsedWithin(session: ActiveSession, from: number, to: number, now: number): number {
  const spans: Span[] = [...session.spans]
  if (session.runningSince !== null && countsNow(session)) spans.push([session.runningSince, now])
  let total = 0
  for (const [start, end] of spans) total += Math.max(0, Math.min(end, to) - Math.max(start, from))
  return total
}

/** Pomodoro: tempo corrido na etapa atual (ms). */
export function phaseElapsed(session: ActiveSession, now: number): number {
  const p = session.pomodoro
  if (!p) return 0
  return p.phaseElapsed + (session.runningSince !== null ? Math.max(0, now - session.runningSince) : 0)
}

/** Tempo que falta (ms): temporizador ou etapa do Pomodoro. null no cronômetro. */
export function remaining(session: ActiveSession, now: number): number | null {
  if (session.mode === 'countdown') return Math.max(0, session.target! - elapsed(session, now))
  if (session.pomodoro) return Math.max(0, phaseLength(session.pomodoro.config, session.pomodoro.phase) - phaseElapsed(session, now))
  return null
}

/** Quando o temporizador ou a etapa atual termina (ms) — null se pausado ou no cronômetro. */
export function deadline(session: ActiveSession, now: number): number | null {
  if (session.runningSince === null) return null
  const left = remaining(session, now)
  return left === null ? null : now + left
}

/** Fecha o trecho que está correndo em `at` (vira tempo efetivo ou descanso). */
function closeRun(session: ActiveSession, at: number): void {
  const since = session.runningSince
  if (since === null) return
  const end = Math.max(since, at)
  const length = end - since
  if (countsNow(session)) {
    if (length > 0) session.spans.push([since, end])
  } else if (session.pomodoro) {
    session.pomodoro.breaks += length
  }
  if (session.pomodoro) session.pomodoro.phaseElapsed += length
  session.runningSince = null
}

export function pause(session: ActiveSession, now: number): ActiveSession {
  if (session.runningSince === null) return session
  const next = clone(session)
  closeRun(next, now)
  return next
}

/** Retoma (ou começa a etapa que estava esperando no Pomodoro). */
export function resume(session: ActiveSession, now: number): ActiveSession {
  if (session.runningSince !== null) return session
  const next = clone(session)
  next.runningSince = now
  if (next.pomodoro) next.pomodoro.waiting = false
  return next
}

/** Pomodoro: termina a pausa agora e começa o próximo foco. */
export function skipBreak(session: ActiveSession, now: number): ActiveSession {
  if (!session.pomodoro || session.pomodoro.phase === 'focus') return session
  const next = clone(session)
  closeRun(next, now)
  const p = next.pomodoro!
  p.phase = 'focus'
  p.phaseElapsed = 0
  p.waiting = false
  next.runningSince = now
  return next
}

export type TimerEvent =
  | { type: 'phase-end'; from: PomodoroPhase; to: PomodoroPhase; at: number; autoStarted: boolean; cycles: number }
  | { type: 'countdown-end'; at: number }

export interface AdvanceResult {
  session: ActiveSession
  events: TimerEvent[]
  /** O temporizador chegou ao fim nesse momento (ms): a sessão deve ser finalizada. */
  finishedAt: number | null
}

/**
 * Leva a sessão até `now`: o temporizador que acabou, as etapas do Pomodoro que
 * terminaram (com o início automático, a próxima começa exatamente quando a outra
 * acabou — se isso aconteceu agora há pouco; senão, ela espera você).
 */
export function advance(session: ActiveSession, now: number, tolerance = AUTO_START_TOLERANCE_MS): AdvanceResult {
  const events: TimerEvent[] = []
  if (session.runningSince === null) return { session, events, finishedAt: null }

  if (session.mode === 'countdown') {
    const end = session.runningSince + (session.target! - spansTotal(session.spans))
    if (end > now) return { session, events, finishedAt: null }
    const next = clone(session)
    closeRun(next, end)
    events.push({ type: 'countdown-end', at: end })
    return { session: next, events, finishedAt: end }
  }

  if (!session.pomodoro) return { session, events, finishedAt: null }
  let next: ActiveSession | null = null
  // Cada volta fecha uma etapa (o limite só protege de um arquivo editado com valores absurdos)
  for (let guard = 0; guard < 1000; guard++) {
    const current = next ?? session
    const p = current.pomodoro!
    if (current.runningSince === null) break
    const doneAt = current.runningSince + (phaseLength(p.config, p.phase) - p.phaseElapsed)
    if (doneAt > now) break
    next ??= clone(session)
    const state = next.pomodoro!
    const from = state.phase
    closeRun(next, doneAt)
    if (from === 'focus') {
      state.cycles += 1
      state.completedFocus += phaseLength(state.config, 'focus')
    }
    state.phase = nextPhase(state)
    state.phaseElapsed = 0
    const autoStarted = state.config.autoStart && now - doneAt <= tolerance
    state.waiting = !autoStarted
    next.runningSince = autoStarted ? doneAt : null
    events.push({ type: 'phase-end', from, to: state.phase, at: doneAt, autoStarted, cycles: state.cycles })
  }
  return { session: next ?? session, events, finishedAt: null }
}

/** O que muda ao finalizar: só o fim (o resto é calculado). */
function statusOnFinish(session: ActiveSession, closed: ActiveSession): SessionStatus {
  if (session.mode === 'countdown') return spansTotal(closed.spans) >= session.target! - 1_000 ? 'completed' : 'interrupted'
  const p = closed.pomodoro
  if (p && p.phase === 'focus' && p.phaseElapsed > 0 && p.phaseElapsed < phaseLength(p.config, 'focus')) return 'interrupted'
  return 'completed'
}

/**
 * Encerra a sessão e devolve o registro do histórico (ou null quando não há o que
 * registrar: um clique sem querer, ou cancelada logo no começo sem tempo válido).
 *  - finish: o tempo medido conta. Temporizador parado antes do fim ou Pomodoro parado
 *    no meio de um foco = "interrompida" (o tempo feito continua contando).
 *  - cancel: "cancelada" — não conta, a não ser os ciclos de foco completos do Pomodoro
 *    (tempo válido). Dá para dar um tempo válido depois, editando o registro.
 */
export function finish(session: ActiveSession, now: number, how: 'finish' | 'cancel'): TimerSession | null {
  const closed = clone(session)
  closeRun(closed, now)
  const measuredMs = spansTotal(closed.spans)
  const end = Math.max(closed.startedAt, closed.runningSince ?? now, now)
  const p = closed.pomodoro
  let status: SessionStatus
  let countedMs: number
  if (how === 'cancel') {
    status = 'canceled'
    countedMs = Math.min(measuredMs, p?.completedFocus ?? 0)
    if (countedMs <= 0 && measuredMs < MIN_CANCELED_MS) return null
  } else {
    if (measuredMs < MIN_SESSION_MS) return null
    status = statusOnFinish(session, closed)
    countedMs = measuredMs
  }
  const seconds = (ms: number) => Math.round(ms / 1000)
  return {
    id: closed.id,
    mode: closed.mode,
    activity: closed.activity.trim(),
    categoryId: closed.categoryId,
    notes: closed.notes,
    start: closed.startedAt,
    end,
    duration: Math.min(seconds(countedMs), seconds(end - closed.startedAt)),
    measured: seconds(measuredMs),
    status,
    target: closed.mode === 'countdown' ? seconds(closed.target!) : p ? p.config.focus * 60 : null,
    cycles: p?.cycles ?? 0,
    breaks: p ? seconds(p.breaks) : 0,
    spans: closed.spans,
  }
}

/** Número do ciclo de foco atual dentro da rodada (1…rounds), para "Foco 2 de 4". */
export function cycleInRound(state: PomodoroState): number {
  const done = state.cycles % state.config.rounds
  // Na pausa longa (ou esperando por ela) a rodada inteira está completa
  if (state.phase === 'long') return state.config.rounds
  return state.phase === 'focus' ? done + 1 : done === 0 ? state.config.rounds : done
}

/** Ciclos completos da rodada atual (as bolinhas preenchidas). */
export function roundProgress(state: PomodoroState): number {
  const done = state.cycles % state.config.rounds
  return done === 0 && state.cycles > 0 && state.phase === 'long' ? state.config.rounds : done
}
