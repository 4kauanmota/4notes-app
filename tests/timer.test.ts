import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listLibrary, removeFromLibrary } from '../electron/library'
import { createTask, trimDescription } from '~/lib/tasks/model'
import { descriptionPreview } from '~/lib/tasks/description'
import {
  advance,
  AUTO_START_TOLERANCE_MS,
  cycleInRound,
  deadline,
  elapsed,
  finish,
  pause,
  remaining,
  resume,
  roundProgress,
  skipBreak,
  startSession,
} from '~/lib/timer/engine'
import { formatClock, formatDuration, formatPercent, formatShortDuration, parseDurationInput } from '~/lib/timer/format'
import {
  defaultTimerData,
  knownActivities,
  lastCategoryOf,
  normalizeTimerFile,
  recentActivities,
  serializeTimer,
  withoutCategory,
  type PomodoroConfig,
  type TimerSession,
} from '~/lib/timer/model'
import { normalizeTimerSettings, serializeTimerSettings } from '~/lib/timer/settings'
import {
  aggregate,
  busiestDay,
  compare,
  comparisonRanges,
  customPeriod,
  evolution,
  partsOfDay,
  periodBounds,
  periodLabel,
  periodOf,
  shiftPeriod,
  variation,
} from '~/lib/timer/stats'

const MIN = 60_000
const HOUR = 60 * MIN
/** Horário local (os testes não dependem do fuso do computador). */
const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime()
const T0 = at(2026, 10, 7, 14, 0) // quarta-feira, 7 de outubro de 2026, 14:00

const POMODORO: PomodoroConfig = { focus: 25, short: 5, long: 15, rounds: 2, autoStart: false }

function session(partial: Partial<TimerSession> & { start: number; end: number }): TimerSession {
  const measured = Math.round((partial.end - partial.start) / 1000)
  return {
    id: partial.id ?? `s_${partial.start}`,
    mode: 'stopwatch',
    activity: '',
    categoryId: null,
    notes: '',
    duration: measured,
    measured,
    status: 'completed',
    target: null,
    cycles: 0,
    breaks: 0,
    spans: [[partial.start, partial.end]],
    ...partial,
  }
}

describe('Timer: cronômetro', () => {
  it('conta pelo relógio: pausas não contam, retomar continua de onde parou', () => {
    let s = startSession({ mode: 'stopwatch', activity: '  Estudando Godot ', categoryId: 'estudo' }, T0, 's_1')
    expect(s.activity).toBe('Estudando Godot')
    expect(elapsed(s, T0 + 10 * MIN)).toBe(10 * MIN)
    s = pause(s, T0 + 10 * MIN)
    // Pausado: o tempo não anda, por mais que o relógio ande
    expect(elapsed(s, T0 + 3 * HOUR)).toBe(10 * MIN)
    s = resume(s, T0 + 30 * MIN)
    expect(elapsed(s, T0 + 35 * MIN)).toBe(15 * MIN)
    expect(remaining(s, T0)).toBeNull()
    expect(deadline(s, T0)).toBeNull()
    const entry = finish(s, T0 + 40 * MIN, 'finish')!
    expect(entry).toMatchObject({
      id: 's_1',
      mode: 'stopwatch',
      status: 'completed',
      duration: 20 * 60,
      measured: 20 * 60,
      categoryId: 'estudo',
    })
    expect(entry.start).toBe(T0)
    expect(entry.end).toBe(T0 + 40 * MIN)
    expect(entry.spans).toEqual([
      [T0, T0 + 10 * MIN],
      [T0 + 30 * MIN, T0 + 40 * MIN],
    ])
  })

  it('as funções não mexem na sessão recebida', () => {
    const s = startSession({ mode: 'stopwatch' }, T0)
    const paused = pause(s, T0 + MIN)
    expect(s.runningSince).toBe(T0)
    expect(s.spans).toEqual([])
    expect(paused.runningSince).toBeNull()
  })

  it('um clique sem querer não vira registro; cancelar logo no começo também não', () => {
    const s = startSession({ mode: 'stopwatch' }, T0)
    expect(finish(s, T0 + 400, 'finish')).toBeNull()
    expect(finish(s, T0 + 30_000, 'cancel')).toBeNull()
  })

  it('cancelada fica no histórico, mas o tempo não conta', () => {
    const s = startSession({ mode: 'stopwatch' }, T0)
    const entry = finish(s, T0 + 12 * MIN, 'cancel')!
    expect(entry).toMatchObject({ status: 'canceled', duration: 0, measured: 12 * 60 })
  })
})

describe('Timer: temporizador', () => {
  it('termina na hora certa, mesmo calculado depois (app minimizado ou fechado)', () => {
    let s = startSession({ mode: 'countdown', target: 10 * MIN }, T0)
    expect(remaining(s, T0 + 4 * MIN)).toBe(6 * MIN)
    expect(deadline(s, T0 + 4 * MIN)).toBe(T0 + 10 * MIN)
    // Pausa de 5 minutos: o fim vai para depois
    s = pause(s, T0 + 4 * MIN)
    expect(deadline(s, T0 + 5 * MIN)).toBeNull()
    s = resume(s, T0 + 9 * MIN)
    expect(deadline(s, T0 + 9 * MIN)).toBe(T0 + 15 * MIN)
    expect(advance(s, T0 + 14 * MIN).finishedAt).toBeNull()
    // Só "olhou" de novo 2 horas depois: o fim é o real, não a hora em que você voltou
    const result = advance(s, T0 + 2 * HOUR)
    expect(result.finishedAt).toBe(T0 + 15 * MIN)
    expect(result.events).toEqual([{ type: 'countdown-end', at: T0 + 15 * MIN }])
    const entry = finish(result.session, result.finishedAt!, 'finish')!
    expect(entry).toMatchObject({ status: 'completed', duration: 10 * 60, target: 10 * 60, end: T0 + 15 * MIN })
  })

  it('parado antes do fim: interrompida, e o tempo feito conta', () => {
    const s = startSession({ mode: 'countdown', target: 25 * MIN }, T0)
    expect(finish(s, T0 + 7 * MIN, 'finish')).toMatchObject({ status: 'interrupted', duration: 7 * 60 })
  })
})

describe('Timer: Pomodoro', () => {
  it('foco → pausa curta → foco → pausa longa, esperando você entre as etapas', () => {
    let s = startSession({ mode: 'pomodoro', activity: 'Godot', pomodoro: POMODORO }, T0)
    expect(cycleInRound(s.pomodoro!)).toBe(1)
    expect(remaining(s, T0 + 5 * MIN)).toBe(20 * MIN)
    let r = advance(s, T0 + 25 * MIN + 500)
    s = r.session
    expect(r.events).toMatchObject([{ type: 'phase-end', from: 'focus', to: 'short', at: T0 + 25 * MIN, autoStarted: false, cycles: 1 }])
    expect(s.pomodoro).toMatchObject({ phase: 'short', cycles: 1, waiting: true, completedFocus: 25 * MIN })
    expect(s.runningSince).toBeNull()
    expect(roundProgress(s.pomodoro!)).toBe(1)
    // Esperando: o tempo de foco não anda
    expect(elapsed(s, T0 + 40 * MIN)).toBe(25 * MIN)
    // Começa a pausa 2 minutos depois; descanso não conta como foco
    s = resume(s, T0 + 27 * MIN)
    expect(elapsed(s, T0 + 30 * MIN)).toBe(25 * MIN)
    r = advance(s, T0 + 33 * MIN)
    s = r.session
    expect(r.events[0]).toMatchObject({ from: 'short', to: 'focus', at: T0 + 32 * MIN })
    s = resume(s, T0 + 33 * MIN)
    expect(cycleInRound(s.pomodoro!)).toBe(2)
    s = advance(s, T0 + 58 * MIN).session
    // Segundo foco da rodada (rounds = 2): agora a pausa longa
    expect(s.pomodoro).toMatchObject({ phase: 'long', cycles: 2, waiting: true })
    expect(roundProgress(s.pomodoro!)).toBe(2)
    expect(cycleInRound(s.pomodoro!)).toBe(2)
    const entry = finish(s, T0 + 60 * MIN, 'finish')!
    expect(entry).toMatchObject({
      mode: 'pomodoro',
      status: 'completed',
      cycles: 2,
      duration: 50 * 60,
      breaks: 5 * 60,
      target: 25 * 60,
      activity: 'Godot',
    })
    expect(entry.spans).toEqual([
      [T0, T0 + 25 * MIN],
      [T0 + 33 * MIN, T0 + 58 * MIN],
    ])
  })

  it('início automático encadeia as etapas sem esperar', () => {
    let s = startSession({ mode: 'pomodoro', pomodoro: { ...POMODORO, autoStart: true } }, T0)
    // O tique chegou 2 s depois do fim do foco
    const r = advance(s, T0 + 25 * MIN + 2000)
    s = r.session
    expect(r.events[0]).toMatchObject({ autoStarted: true })
    expect(s.pomodoro).toMatchObject({ phase: 'short', waiting: false })
    expect(s.runningSince).toBe(T0 + 25 * MIN)
    expect(remaining(s, T0 + 26 * MIN)).toBe(4 * MIN)
  })

  it('com o app fechado (ou o computador suspenso), a próxima etapa espera você', () => {
    const s = startSession({ mode: 'pomodoro', pomodoro: { ...POMODORO, autoStart: true } }, T0)
    const r = advance(s, T0 + 25 * MIN + AUTO_START_TOLERANCE_MS + 60_000)
    expect(r.events).toHaveLength(1)
    expect(r.session.pomodoro).toMatchObject({ phase: 'short', waiting: true, cycles: 1 })
    expect(r.session.runningSince).toBeNull()
    // Nenhum foco a mais foi inventado enquanto você estava fora
    expect(elapsed(r.session, T0 + 5 * HOUR)).toBe(25 * MIN)
  })

  it('pular a pausa começa o próximo foco na hora', () => {
    let s = startSession({ mode: 'pomodoro', pomodoro: POMODORO }, T0)
    s = advance(s, T0 + 26 * MIN).session
    s = resume(s, T0 + 26 * MIN)
    s = skipBreak(s, T0 + 27 * MIN)
    expect(s.pomodoro).toMatchObject({ phase: 'focus', breaks: MIN, phaseElapsed: 0 })
    expect(s.runningSince).toBe(T0 + 27 * MIN)
  })

  it('parado no meio de um foco: interrompida; cancelada: só os ciclos completos contam', () => {
    let s = startSession({ mode: 'pomodoro', pomodoro: POMODORO }, T0)
    s = advance(s, T0 + 25 * MIN).session
    s = resume(s, T0 + 25 * MIN)
    s = skipBreak(s, T0 + 30 * MIN)
    expect(finish(s, T0 + 40 * MIN, 'finish')).toMatchObject({ status: 'interrupted', duration: 35 * 60, cycles: 1 })
    expect(finish(s, T0 + 40 * MIN, 'cancel')).toMatchObject({ status: 'canceled', duration: 25 * 60, measured: 35 * 60 })
  })
})

describe('Timer: arquivo (timer.json)', () => {
  it('grava e lê de volta (com a sessão em andamento)', () => {
    const active = pause(
      startSession({ mode: 'pomodoro', activity: 'Ler', categoryId: 'estudo', pomodoro: POMODORO }, T0, 's_live'),
      T0 + 5 * MIN,
    )
    const data = {
      categories: [{ id: 'estudo', name: 'Estudo', color: 'purple' as const, createdAt: '2026-10-01T00:00:00.000Z' }],
      sessions: [session({ id: 's_a', start: T0 - HOUR, end: T0 - 30 * MIN, activity: 'Godot', categoryId: 'estudo' })],
      active,
    }
    const raw = serializeTimer(data)
    expect(JSON.parse(raw)).toMatchObject({
      app: '4notes',
      version: 1,
      sessions: [{ id: 's_a', start: new Date(T0 - HOUR).toISOString(), duration: 1800 }],
    })
    expect(normalizeTimerFile(JSON.parse(raw))).toEqual(data)
  })

  it('tolera arquivo editado à mão e não duplica registros', () => {
    const data = normalizeTimerFile({
      categories: [{ id: 'x', name: 'X', color: 'roxo' }, { id: 'x', name: 'Repetida' }, { name: 'sem id' }],
      sessions: [
        { id: 'a', start: '2026-10-07T10:00:00Z', end: '2026-10-07T11:00:00Z', duration: 9999999 },
        { id: 'a', start: '2026-10-07T10:00:00Z', end: '2026-10-07T11:00:00Z' },
        { id: 'b', start: 'ontem' },
        'lixo',
      ],
      // Já está no histórico (finalizada em outro aparelho): não volta como "em andamento"
      active: { id: 'a', mode: 'stopwatch', startedAt: '2026-10-07T10:00:00Z' },
    })
    expect(data.categories).toEqual([{ id: 'x', name: 'X', color: 'gray', createdAt: expect.any(String) }])
    expect(data.sessions).toHaveLength(1)
    // O tempo válido nunca passa do tempo entre o início e o fim
    expect(data.sessions[0]!.duration).toBe(3600)
    expect(data.active).toBeNull()
    expect(() => normalizeTimerFile([])).toThrow()
    expect(normalizeTimerFile({})).toEqual(defaultTimerData())
  })

  it('excluir uma categoria preserva o histórico (as sessões ficam sem categoria)', () => {
    const data = {
      categories: [
        { id: 'estudo', name: 'Estudo', color: 'purple' as const, createdAt: '' },
        { id: 'lazer', name: 'Lazer', color: 'green' as const, createdAt: '' },
      ],
      sessions: [
        session({ start: T0, end: T0 + HOUR, categoryId: 'estudo' }),
        session({ start: T0 + 2 * HOUR, end: T0 + 3 * HOUR, categoryId: 'lazer' }),
      ],
      active: startSession({ mode: 'stopwatch', categoryId: 'estudo' }, T0 + 4 * HOUR),
    }
    const next = withoutCategory(data, 'estudo')
    expect(next.categories.map((category) => category.id)).toEqual(['lazer'])
    expect(next.sessions).toHaveLength(2)
    expect(next.sessions.map((item) => item.categoryId)).toEqual([null, 'lazer'])
    expect(next.sessions[0]!.duration).toBe(3600)
    expect(next.active!.categoryId).toBeNull()
  })

  it('atividades recentes, sem repetir, e a última categoria usada com cada uma', () => {
    const list = [
      session({ start: T0, end: T0 + MIN, activity: 'Estudando Godot', categoryId: 'estudo' }),
      session({ start: T0 + HOUR, end: T0 + HOUR + MIN, activity: 'Correr', categoryId: 'exercicio' }),
      session({ start: T0 + 2 * HOUR, end: T0 + 2 * HOUR + MIN, activity: 'estudando  godot', categoryId: 'estudo' }),
    ]
    expect(recentActivities(list)).toEqual([
      { activity: 'estudando  godot', categoryId: 'estudo' },
      { activity: 'Correr', categoryId: 'exercicio' },
    ])
    expect(knownActivities(list)).toHaveLength(2)
    expect(lastCategoryOf(list, 'Estudando godot')).toBe('estudo')
    expect(lastCategoryOf(list, 'Nunca')).toBeUndefined()
  })

  it('configurações: padrões, limites e ida e volta', () => {
    expect(normalizeTimerSettings(undefined)).toEqual({
      sound: true,
      notify: true,
      weekStart: 1,
      countdown: 25 * MIN,
      pomodoro: { focus: 25, short: 5, long: 15, rounds: 4, autoStart: false },
    })
    const odd = normalizeTimerSettings({
      sound: false,
      weekStart: 0,
      countdown: 0.01,
      pomodoro: { focus: 999, short: -3, rounds: 2.4, autoStart: true },
    })
    expect(odd).toMatchObject({
      sound: false,
      weekStart: 0,
      countdown: 5000,
      pomodoro: { focus: 240, short: 1, long: 15, rounds: 2, autoStart: true },
    })
    const settings = normalizeTimerSettings({ countdown: 1.5 })
    expect(settings.countdown).toBe(90_000)
    expect(normalizeTimerSettings(serializeTimerSettings(settings))).toEqual(settings)
  })
})

describe('Timer: períodos', () => {
  it('semana começando na segunda ou no domingo; mês; ano', () => {
    expect(periodOf('week', '2026-10-07', 1)).toEqual({ kind: 'week', from: '2026-10-05', to: '2026-10-11' })
    expect(periodOf('week', '2026-10-07', 0)).toEqual({ kind: 'week', from: '2026-10-04', to: '2026-10-10' })
    expect(periodOf('week', '2026-10-11', 1).from).toBe('2026-10-05')
    expect(periodOf('month', '2026-02-14')).toEqual({ kind: 'month', from: '2026-02-01', to: '2026-02-28' })
    expect(periodOf('year', '2026-02-14')).toEqual({ kind: 'year', from: '2026-01-01', to: '2026-12-31' })
  })

  it('anterior e próximo', () => {
    expect(shiftPeriod(periodOf('day', '2026-10-01'), -1)).toEqual({ kind: 'day', from: '2026-09-30', to: '2026-09-30' })
    expect(shiftPeriod(periodOf('week', '2026-10-07'), 1)).toEqual({ kind: 'week', from: '2026-10-12', to: '2026-10-18' })
    expect(shiftPeriod(periodOf('month', '2026-03-31'), -1)).toEqual({ kind: 'month', from: '2026-02-01', to: '2026-02-28' })
    expect(shiftPeriod(periodOf('year', '2026-03-31'), -1).from).toBe('2025-01-01')
    expect(shiftPeriod(customPeriod('2026-10-10', '2026-10-01'), -1)).toEqual({ kind: 'custom', from: '2026-09-21', to: '2026-09-30' })
  })

  it('nomes dos períodos', () => {
    const today = '2026-10-07'
    expect(periodLabel(periodOf('day', today), today)).toBe('Hoje')
    expect(periodLabel(periodOf('day', '2026-10-06'), today)).toBe('Ontem')
    expect(periodLabel(periodOf('week', today), today)).toBe('5 – 11 de out.')
    expect(periodLabel(periodOf('week', '2026-09-30'), today)).toBe('28 de set. – 4 de out.')
    expect(periodLabel(periodOf('month', today), today)).toBe('Outubro')
    expect(periodLabel(periodOf('month', '2025-12-01'), today)).toBe('Dezembro de 2025')
    expect(periodLabel(customPeriod('2025-12-20', '2026-01-05'), today)).toBe('20 de dez. de 2025 – 5 de jan.')
  })
})

describe('Timer: estatísticas', () => {
  const week = periodOf('week', '2026-10-07')
  const sessions: TimerSession[] = [
    // Segunda 23:00 → terça 01:00: metade em cada dia
    session({ id: 'virada', start: at(2026, 10, 5, 23), end: at(2026, 10, 6, 1), activity: 'Godot', categoryId: 'estudo' }),
    // Quarta 14:00–15:30, com 30 min de pausa no meio (1 h de tempo efetivo)
    session({
      id: 'pausa',
      start: at(2026, 10, 7, 14),
      end: at(2026, 10, 7, 15, 30),
      duration: 3600,
      measured: 3600,
      spans: [
        [at(2026, 10, 7, 14), at(2026, 10, 7, 14, 30)],
        [at(2026, 10, 7, 15), at(2026, 10, 7, 15, 30)],
      ],
      activity: 'Godot',
      categoryId: 'estudo',
    }),
    // Cancelada: não conta
    session({
      id: 'cancelada',
      start: at(2026, 10, 7, 9),
      end: at(2026, 10, 7, 10),
      status: 'canceled',
      duration: 0,
      activity: 'Correr',
      categoryId: 'exercicio',
    }),
    // Editada: 2 h medidas, só 1 h válida
    session({
      id: 'editada',
      start: at(2026, 10, 8, 8),
      end: at(2026, 10, 8, 10),
      duration: 3600,
      activity: 'Correr',
      categoryId: 'exercicio',
    }),
    // Semana passada
    session({ id: 'antes', start: at(2026, 9, 29, 10), end: at(2026, 9, 29, 12), activity: 'Godot', categoryId: 'estudo' }),
    // Categoria excluída
    session({ id: 'orfa', start: at(2026, 10, 9, 20), end: at(2026, 10, 9, 20, 30), activity: '', categoryId: 'apagada' }),
  ]
  const known = new Set(['estudo', 'exercicio'])

  it('divide o tempo pelos dias e horas em que ele aconteceu, só o tempo válido', () => {
    const data = aggregate(sessions, periodBounds(week), { knownCategories: known })
    expect(data.total).toBe(2 * HOUR + HOUR + HOUR + 30 * MIN)
    expect(data.sessions).toBe(4)
    expect(data.average).toBeCloseTo(data.total / 4)
    expect(data.days.get('2026-10-05')).toBe(HOUR)
    expect(data.days.get('2026-10-06')).toBe(HOUR)
    expect(data.days.get('2026-10-07')).toBe(HOUR)
    expect(data.days.get('2026-10-08')).toBe(HOUR)
    // A pausa (14:30–15:00) não conta em nenhuma hora
    expect(data.hours[14]).toBe(30 * MIN)
    expect(data.hours[15]).toBe(30 * MIN)
    // Editada: 2 h medidas viram 1 h, meio a meio
    expect(data.hours[8]).toBe(30 * MIN)
    expect(data.hours[9]).toBe(30 * MIN)
    expect(data.heat[3]![14]).toBe(30 * MIN)
    expect(data.categories.map((item) => [item.categoryId, item.ms])).toEqual([
      ['estudo', 3 * HOUR],
      ['exercicio', HOUR],
      [null, 30 * MIN],
    ])
    expect(data.activities[0]).toMatchObject({ activity: 'Godot', categoryId: 'estudo', ms: 3 * HOUR, sessions: 2 })
    expect(busiestDay(data.days)?.ms).toBe(HOUR)
    expect(partsOfDay(data.hours).map((part) => part.ms)).toEqual([HOUR, HOUR, HOUR, 90 * MIN])
  })

  it('filtra por categoria (e "sem categoria")', () => {
    expect(aggregate(sessions, periodBounds(week), { category: 'exercicio', knownCategories: known }).total).toBe(HOUR)
    expect(aggregate(sessions, periodBounds(week), { category: null, knownCategories: known }).total).toBe(30 * MIN)
  })

  it('evolução: os 7 dias da semana, com o futuro marcado', () => {
    const points = evolution(sessions, week, at(2026, 10, 8, 12), { knownCategories: known })
    expect(points.map((point) => point.label)).toEqual(['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'])
    expect(points.map((point) => point.ms / MIN)).toEqual([60, 60, 60, 60, 30, 0, 0])
    expect(points.find((point) => point.current)?.key).toBe('2026-10-08')
    expect(points.filter((point) => point.future).map((point) => point.key)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11'])
    expect(evolution(sessions, periodOf('day', '2026-10-07'), T0)).toHaveLength(24)
    expect(evolution(sessions, periodOf('year', '2026-10-07'), T0)).toHaveLength(12)
  })

  it('compara com o mesmo trecho do período anterior quando o atual ainda não acabou', () => {
    // Quinta, 8 de outubro, 12:00: a semana atual vai de segunda 00:00 até agora
    const now = at(2026, 10, 8, 12)
    const ranges = comparisonRanges(week, now)
    expect(ranges.partial).toBe(true)
    expect(ranges.current).toEqual([at(2026, 10, 5), now])
    expect(ranges.previous).toEqual([at(2026, 9, 28), at(2026, 10, 1, 12)])
    const result = compare(sessions, ranges, { knownCategories: known })
    expect(result.current.total).toBe(4 * HOUR)
    expect(result.previous.total).toBe(2 * HOUR)
    expect(result.diff).toBe(2 * HOUR)
    expect(result.pct).toBe(1)
    const estudo = result.categories.find((item) => item.categoryId === 'estudo')!
    expect(estudo).toMatchObject({ current: 3 * HOUR, previous: 2 * HOUR, diff: HOUR, pct: 0.5 })
    const correr = result.activities.find((item) => item.label === 'Correr')!
    // Não existia antes: sem percentual enganoso
    expect(correr).toMatchObject({ previous: 0, pct: null })
  })

  it('períodos completos comparam inteiros; mês mais curto não invade o seguinte', () => {
    const past = comparisonRanges(periodOf('week', '2026-09-30'), at(2026, 10, 8))
    expect(past.partial).toBe(false)
    expect(past.previous).toEqual(periodBounds(periodOf('week', '2026-09-23')))
    const march = comparisonRanges(periodOf('month', '2026-03-31'), at(2026, 3, 31, 18))
    expect(march.previous[1]).toBe(at(2026, 3, 1))
  })

  it('variação: sem dados antes não há percentual', () => {
    expect(variation(10, 0)).toBeNull()
    expect(variation(0, 0)).toBeNull()
    expect(variation(0, 10)).toBe(-1)
    expect(variation(15, 10)).toBe(0.5)
  })
})

describe('Timer: textos', () => {
  it('relógio e durações', () => {
    expect(formatClock(25 * MIN)).toBe('25:00')
    expect(formatClock(59_400, 'down')).toBe('01:00')
    expect(formatClock(59_400, 'up')).toBe('00:59')
    expect(formatClock(HOUR + 2 * MIN + 3000)).toBe('1:02:03')
    expect(formatDuration(45_000)).toBe('45 s')
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(65 * MIN)).toBe('1 h 05 min')
    expect(formatDuration(2 * HOUR)).toBe('2 h')
    expect(formatShortDuration(90 * MIN)).toBe('1,5 h')
    expect(formatShortDuration(40 * MIN)).toBe('40 min')
    expect(formatPercent(0.254)).toBe('+25%')
    expect(formatPercent(-0.5)).toBe('−50%')
    expect(formatPercent(42)).toBe('+999%')
  })

  it('entende a duração digitada', () => {
    expect(parseDurationInput('25')).toBe(25 * MIN)
    expect(parseDurationInput('1:30')).toBe(90 * MIN)
    expect(parseDurationInput('1h30')).toBe(90 * MIN)
    expect(parseDurationInput('2 h')).toBe(2 * HOUR)
    expect(parseDurationInput('90 min')).toBe(90 * MIN)
    expect(parseDurationInput('0:45:30')).toBe(45 * MIN + 30_000)
    expect(parseDurationInput('1,5h')).toBe(90 * MIN)
    expect(parseDurationInput('abc')).toBeNull()
    expect(parseDurationInput('0')).toBeNull()
    expect(parseDurationInput('1:75')).toBeNull()
  })
})

// ── Tarefas: descrição com a formatação das notas ────────────────────────────

describe('Tarefas: descrição formatada', () => {
  it('guarda o Markdown (sem as linhas vazias do começo nem os espaços do fim)', () => {
    expect(trimDescription('\n\n  - item\n    - subitem\n\n')).toBe('  - item\n    - subitem')
    const task = createTask({ title: 'Ler', notes: '\n**Capítulo 3** do livro\n- [ ] resumo\n' }, '2026-10-07')
    expect(task.notes).toBe('**Capítulo 3** do livro\n- [ ] resumo')
  })

  it('a prévia na lista mostra o texto como no editor, sem a marcação', () => {
    expect(descriptionPreview('**Capítulo 3** do <u>livro</u>\n- [ ] resumo')).toBe('Capítulo 3 do livro')
    expect(descriptionPreview('\n- [x] feito\n')).toBe('☑ feito')
    expect(descriptionPreview('# Título\ntexto')).toBe('Título')
    expect(descriptionPreview('Veja o [site](https://nuxt.com)')).toBe('Veja o site')
    expect(descriptionPreview('texto comum')).toBe('texto comum')
  })
})

describe('Biblioteca de imagens: descrição das tarefas', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex')

  it('uma imagem colada na descrição de uma tarefa está "em uso" (não pode ser excluída)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), '4n-tasks-'))
    dirs.push(root)
    fs.mkdirSync(path.join(root, 'attachments'))
    fs.mkdirSync(path.join(root, 'tasks'))
    fs.writeFileSync(path.join(root, 'attachments', 'print.png'), PNG)
    fs.writeFileSync(
      path.join(root, 'tasks', 'tasks.json'),
      JSON.stringify({
        tasks: [
          { id: 't1', title: 'Bug', notes: 'Veja:\n![](../attachments/print.png)' },
          { id: 't2', title: 'Outra', notes: 7 },
        ],
      }),
    )
    const [image] = await listLibrary(root)
    expect(image).toMatchObject({ path: 'attachments/print.png', usage: ['1 tarefa'] })
    expect(await removeFromLibrary(root, 'attachments/print.png')).toBe('in-use')
  })
})
