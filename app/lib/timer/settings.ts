/**
 * Configurações do Timer — seção "timer" do .4notes/settings.json (as mesmas no
 * computador e no celular):
 *
 *   "timer": {
 *     "sound": true,            ← som quando o tempo acaba
 *     "notify": true,           ← aviso do sistema com o 4notes minimizado
 *     "weekStart": 1,           ← a semana das estatísticas começa na segunda (0 = domingo)
 *     "countdown": 25,          ← última duração do temporizador (minutos)
 *     "pomodoro": { "focus": 25, "short": 5, "long": 15, "rounds": 4, "autoStart": false }
 *   }
 *
 * Os ciclos do Pomodoro e a duração do temporizador são ajustados na própria tela do
 * Timer (usados toda hora); o som, o aviso e o início da semana, em Configurações ›
 * Módulos › Timer.
 */
import { DEFAULT_POMODORO, normalizePomodoroConfig, type PomodoroConfig } from './model'
import type { WeekStart } from './stats'

export interface TimerSettings {
  sound: boolean
  notify: boolean
  weekStart: WeekStart
  /** Duração do temporizador (ms). */
  countdown: number
  pomodoro: PomodoroConfig
}

export const DEFAULT_COUNTDOWN_MS = 25 * 60_000
/** De 5 segundos a 24 horas. */
export const MAX_COUNTDOWN_MS = 24 * 3_600_000

export const DEFAULT_TIMER_SETTINGS: Readonly<TimerSettings> = {
  sound: true,
  notify: true,
  weekStart: 1,
  countdown: DEFAULT_COUNTDOWN_MS,
  pomodoro: { ...DEFAULT_POMODORO },
}

export function clampCountdown(ms: number): number {
  return Math.min(MAX_COUNTDOWN_MS, Math.max(5_000, Math.round(ms / 1000) * 1000))
}

/** Lê a seção (tolerante a arquivo editado à mão). A duração fica em minutos no arquivo. */
export function normalizeTimerSettings(raw: unknown): TimerSettings {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const minutes = typeof data.countdown === 'number' && Number.isFinite(data.countdown) && data.countdown > 0 ? data.countdown : null
  return {
    sound: data.sound !== false,
    notify: data.notify !== false,
    weekStart: data.weekStart === 0 ? 0 : 1,
    countdown: minutes === null ? DEFAULT_COUNTDOWN_MS : clampCountdown(minutes * 60_000),
    pomodoro: normalizePomodoroConfig(data.pomodoro),
  }
}

export function serializeTimerSettings(settings: TimerSettings): Record<string, unknown> {
  return {
    sound: settings.sound,
    notify: settings.notify,
    weekStart: settings.weekStart,
    // Minutos (90 s = 1.5; 5 s = 0.0833 — 4 casas guardam os segundos certinhos)
    countdown: Math.round((settings.countdown / 60_000) * 10_000) / 10_000,
    pomodoro: { ...settings.pomodoro },
  }
}
