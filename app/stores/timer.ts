/**
 * Estado do módulo TIMER.
 *
 * Os dados ficam em timer/timer.json (lib/timer/repository.ts): as categorias, o
 * histórico e a sessão em andamento. As regras estão em lib/timer/*.ts — aqui só
 * ligamos essas regras à interface, ao disco e ao relógio:
 *
 * - O tempo vem sempre do relógio (Date.now()), nunca de um contador somado na tela:
 *   trocar de módulo, minimizar ou fechar o app não atrapalha a contagem. O "tique"
 *   (4 por segundo) só atualiza o que aparece, e só com a janela visível.
 * - Um alarme (setTimeout) marca o fim do temporizador ou da etapa do Pomodoro; ao
 *   voltar para o app (ou ao abrir), `advance` calcula o que aconteceu enquanto isso.
 * - A sessão em andamento é gravada a cada mudança (iniciar, pausar, retomar, trocar
 *   de etapa) — não a cada segundo. Finalizar passa ela para o histórico de uma vez,
 *   com o mesmo id (nunca duas cópias).
 */
import { computed, reactive } from 'vue'
import { errorMessage } from '#shared/ipc'
import { confirmDialog } from '~/composables/useDialog'
import { notifyError, showToast } from '~/composables/useToasts'
import type { PaletteColor } from '~/lib/colors'
import type { CategorySource } from '~/lib/category-source'
import { readDeviceState, writeDeviceState } from '~/lib/storage/device-state'
import {
  advance,
  deadline,
  elapsed,
  finish,
  isRunning,
  pause,
  phaseLength,
  resume,
  skipBreak,
  startSession,
  type TimerEvent,
} from '~/lib/timer/engine'
import { formatDuration, formatTimeOfDay } from '~/lib/timer/format'
import {
  categoryIdFor,
  MODE_LABELS,
  PHASE_LABELS,
  serializeTimer,
  suggestColor,
  TIMER_MODES,
  withoutCategory,
  normalizeTimerFile,
  type ActiveSession,
  type PomodoroConfig,
  type TimerCategory,
  type TimerMode,
  type TimerSession,
} from '~/lib/timer/model'
import { timerRepository as repo } from '~/lib/timer/repository'
import {
  clampCountdown,
  DEFAULT_TIMER_SETTINGS,
  normalizeTimerSettings,
  serializeTimerSettings,
  type TimerSettings,
} from '~/lib/timer/settings'
import { playTimerSound, primeAudio } from '~/lib/sounds'
import { debounce, SerialQueue } from '~/lib/utils/async'
import { onSettingsChange, settingsSection, updateSettingsSection } from './settings'

/** As áreas do módulo. */
export type TimerTab = 'session' | 'history' | 'stats'
const TABS: readonly TimerTab[] = ['session', 'history', 'stats']

/** O último aviso de "acabou" (a tela mostra até você dispensar ou começar outra coisa). */
export interface TimerAlert {
  kind: 'countdown-end' | 'phase-end'
  message: string
  at: number
}

const state = reactive({
  loaded: false,
  /** Preenchido quando o timer.json não pôde ser lido: nada é gravado até resolver. */
  error: null as string | null,
  categories: [] as TimerCategory[],
  sessions: [] as TimerSession[],
  active: null as ActiveSession | null,
  /** Relógio da tela (ms) — atualizado pelo tique enquanto há uma sessão contando. */
  now: Date.now(),
  settings: { ...DEFAULT_TIMER_SETTINGS, pomodoro: { ...DEFAULT_TIMER_SETTINGS.pomodoro } } as TimerSettings,
  // Tela (deste aparelho)
  tab: 'session' as TimerTab,
  /** Modo escolhido para a próxima sessão. */
  mode: 'stopwatch' as TimerMode,
  /** O que vai na próxima sessão (a atividade e a categoria escolhidas antes de iniciar). */
  draft: { activity: '', categoryId: null as string | null },
  alert: null as TimerAlert | null,
  /** Registro a mostrar no Histórico (uma menção foi aberta): a lista rola até ele e o destaca. */
  reveal: null as { id: string; seq: number } | null,
})

let lastRaw: string | null = null
const queue = new SerialQueue()

function snapshot(): string {
  return serializeTimer({ categories: state.categories, sessions: state.sessions, active: state.active })
}

function persist(): Promise<void> {
  return queue
    .run('timer', async () => {
      if (state.error) return
      const raw = snapshot()
      if (raw === lastRaw) return
      await repo.save(raw)
      lastRaw = raw
    })
    .catch((error) => notifyError(`Não foi possível salvar o Timer: ${errorMessage(error)}`, error))
}

const scheduleSave = debounce(() => void persist(), 300)

/** Grava já (início, pausa, fim: o que não pode se perder se o app fechar logo depois). */
function saveNow(): void {
  scheduleSave.cancel()
  void persist()
}

async function flush(): Promise<void> {
  scheduleSave.flush()
  await queue.idle()
}

// ── Tela deste aparelho ─────────────────────────────────────────────────────

function saveDeviceState(): void {
  writeDeviceState('timer', { tab: state.tab, mode: state.mode })
}

function setTab(tab: TimerTab): void {
  if (state.tab === tab) return
  state.tab = tab
  saveDeviceState()
}

function setMode(mode: TimerMode): void {
  if (state.active || state.mode === mode) return
  state.mode = mode
  saveDeviceState()
}

// ── Configurações (settings.json) ───────────────────────────────────────────

function applySettings(): void {
  state.settings = normalizeTimerSettings(settingsSection('timer'))
}

onSettingsChange((changed) => {
  if (changed.has('timer')) applySettings()
})

function updateSettings(patch: Partial<TimerSettings>): void {
  state.settings = { ...state.settings, ...patch }
  updateSettingsSection('timer', serializeTimerSettings(state.settings))
}

function setCountdown(ms: number): void {
  updateSettings({ countdown: clampCountdown(ms) })
}

function setPomodoro(config: PomodoroConfig): void {
  updateSettings({ pomodoro: { ...config } })
}

// ── Relógio ─────────────────────────────────────────────────────────────────

let ticker: ReturnType<typeof setInterval> | null = null
let alarm: ReturnType<typeof setTimeout> | null = null
let clockInstalled = false

function stopTicker(): void {
  if (ticker) clearInterval(ticker)
  ticker = null
}

/** Liga/desliga o tique da tela e reagenda o alarme do próximo fim. */
function scheduleClock(): void {
  const active = state.active
  const visible = typeof document === 'undefined' || document.visibilityState === 'visible'
  if (active && isRunning(active) && visible) ticker ??= setInterval(tick, 250)
  else stopTicker()
  if (alarm) clearTimeout(alarm)
  alarm = null
  const end = active ? deadline(active, Date.now()) : null
  // Um setTimeout único (não repetido): o navegador não o atrasa com a janela minimizada
  if (end !== null) alarm = setTimeout(tick, Math.max(0, end - Date.now()) + 15)
}

function installClock(): void {
  if (clockInstalled || typeof window === 'undefined') return
  clockInstalled = true
  // Voltou para o app (janela, celular): recalcula na hora
  document.addEventListener('visibilitychange', () => {
    tick()
    scheduleClock()
  })
  window.addEventListener('focus', () => tick())
}

/** Avisos de que algo acabou: na tela, com som e (minimizado) pelo sistema. */
function announce(events: TimerEvent[], options: { recovered?: boolean } = {}): void {
  if (!events.length) return
  const last = events.at(-1)!
  let message: string
  if (last.type === 'countdown-end') {
    message = options.recovered
      ? `O temporizador terminou às ${formatTimeOfDay(last.at)}, com o 4notes fechado. A sessão foi salva no histórico.`
      : 'O tempo acabou! A sessão foi salva no histórico.'
  } else if (last.to === 'focus') {
    message = last.autoStarted ? 'Pausa encerrada — o foco começou.' : 'Pausa encerrada. Pronto para o próximo foco?'
  } else {
    const pause = PHASE_LABELS[last.to].toLowerCase()
    message = last.autoStarted ? `Foco concluído! A ${pause} começou.` : `Foco concluído! Hora da ${pause}.`
  }
  state.alert = { kind: last.type, message, at: last.at }
  if (options.recovered) return
  if (state.settings.sound) playTimerSound(last.type === 'countdown-end' ? 'timer-end' : 'phase-end')
  systemNotice(last.type === 'countdown-end' ? 'Timer' : 'Pomodoro', message)
}

/** Aviso do Windows (só com o 4notes minimizado ou em segundo plano). */
function systemNotice(title: string, body: string): void {
  if (!state.settings.notify || typeof window === 'undefined' || !('Notification' in window)) return
  if (document.visibilityState === 'visible' && document.hasFocus()) return
  try {
    if (Notification.permission !== 'granted') return
    const notice = new Notification(title, { body, silent: true, tag: '4notes-timer' })
    notice.onclick = () => window.focus()
  } catch {
    // sem avisos do sistema (o aviso continua na tela)
  }
}

/** Leva a sessão até agora: o temporizador que acabou, a etapa do Pomodoro que terminou. */
function tick(): void {
  state.now = Date.now()
  const active = state.active
  if (!active) return stopTicker()
  const result = advance(active, state.now)
  if (result.session === active && !result.events.length) return
  state.active = result.session
  announce(result.events)
  if (result.finishedAt !== null) record(result.session, result.finishedAt, 'finish', { quiet: true })
  else saveNow()
  scheduleClock()
}

// ── Carregamento ────────────────────────────────────────────────────────────

function adopt(data: { categories: TimerCategory[]; sessions: TimerSession[]; active: ActiveSession | null }): void {
  state.categories = data.categories
  state.sessions = data.sessions
  state.active = data.active
  if (state.draft.categoryId && !data.categories.some((category) => category.id === state.draft.categoryId)) state.draft.categoryId = null
}

/** Uma sessão estava em andamento quando o app fechou: continua de onde parou. */
function recover(): void {
  const active = state.active
  if (!active) return
  // Com o app fechado, a próxima etapa do Pomodoro nunca começa sozinha: ela espera você
  const result = advance(active, Date.now(), 0)
  state.active = result.session
  if (result.events.length) announce(result.events, { recovered: true })
  if (result.finishedAt !== null) {
    record(result.session, result.finishedAt, 'finish', { quiet: true })
    return
  }
  if (result.events.length) saveNow()
  else
    showToast({
      message: `${MODE_LABELS[active.mode]} em andamento desde as ${formatTimeOfDay(active.startedAt)}${isRunning(active) ? '' : ' (pausado)'}.`,
      icon: 'clock',
    })
}

async function load(): Promise<void> {
  applySettings()
  const device = readDeviceState('timer')
  if (TABS.includes(device?.tab as TimerTab)) state.tab = device!.tab as TimerTab
  if ((TIMER_MODES as readonly string[]).includes(device?.mode as string)) state.mode = device!.mode as TimerMode
  try {
    const result = await repo.load()
    if (result.status === 'invalid') {
      state.error = result.error
    } else {
      adopt(result.data)
      lastRaw = result.raw
      state.error = null
      if (result.raw) void repo.backup(result.raw).catch((error) => console.warn('[4notes] Backup do Timer falhou:', error))
      recover()
    }
  } catch (error) {
    state.error = errorMessage(error)
  }
  state.loaded = true
  installClock()
  state.now = Date.now()
  scheduleClock()
}

/** Relê o timer.json se ele mudou fora do app (outro programa, outro aparelho). */
async function refreshFromDisk(): Promise<void> {
  if (!state.loaded || scheduleSave.pending() || queue.busy) return
  const raw = await repo.readRaw().catch(() => undefined)
  if (raw === undefined || raw === lastRaw) return
  if (raw === null) {
    // Apagado fora do app: grava de novo o que está na memória (se houver algo)
    if (!state.error && (state.sessions.length || state.categories.length || state.active)) {
      lastRaw = null
      void persist()
    }
    return
  }
  try {
    adopt(normalizeTimerFile(JSON.parse(raw)))
    lastRaw = raw
    state.error = null
    tick()
    scheduleClock()
  } catch (error) {
    state.error = `O arquivo timer.json foi alterado fora do app e agora contém um erro (${errorMessage(error)}).`
  }
}

async function retry(): Promise<void> {
  state.error = null
  await load()
}

// ── Sessão em andamento ─────────────────────────────────────────────────────

const categoryById = computed(() => new Map(state.categories.map((category) => [category.id, category])))
const knownCategoryIds = computed(() => new Set(state.categories.map((category) => category.id)))

function categoryName(id: string | null): string {
  return (id && categoryById.value.get(id)?.name) || 'Sem categoria'
}

function start(): void {
  if (state.active || state.error) return
  primeAudio()
  const now = Date.now()
  state.alert = null
  state.active = startSession(
    {
      mode: state.mode,
      activity: state.draft.activity,
      categoryId: state.draft.categoryId && categoryById.value.has(state.draft.categoryId) ? state.draft.categoryId : null,
      target: state.mode === 'countdown' ? state.settings.countdown : null,
      pomodoro: state.mode === 'pomodoro' ? state.settings.pomodoro : null,
    },
    now,
  )
  state.now = now
  saveNow()
  scheduleClock()
}

function togglePause(): void {
  const active = state.active
  if (!active) return
  primeAudio()
  const now = Date.now()
  tick()
  if (!state.active || state.active.id !== active.id) return
  state.active = isRunning(state.active) ? pause(state.active, now) : resume(state.active, now)
  if (isRunning(state.active)) state.alert = null
  state.now = now
  saveNow()
  scheduleClock()
}

/** Pomodoro: termina a pausa agora e começa o próximo foco. */
function skipPause(): void {
  if (!state.active?.pomodoro || state.active.pomodoro.phase === 'focus') return
  primeAudio()
  const now = Date.now()
  state.active = skipBreak(state.active, now)
  state.alert = null
  state.now = now
  saveNow()
  scheduleClock()
}

/** Atividade, categoria ou observações da sessão em andamento (ou da próxima). */
function updateActive(patch: Partial<Pick<ActiveSession, 'activity' | 'categoryId' | 'notes'>>): void {
  if (!state.active) return
  state.active = { ...state.active, ...patch }
  scheduleSave()
}

/**
 * Passa a sessão para o histórico (finalizar ou cancelar). Com aviso e "Desfazer"
 * (a sessão volta como estava). `quiet`: o fim veio do próprio temporizador.
 */
function record(session: ActiveSession, at: number, how: 'finish' | 'cancel', options: { quiet?: boolean } = {}): TimerSession | null {
  const before = session
  const entry = finish(session, at, how)
  state.active = null
  // A próxima sessão começa com a mesma atividade e categoria (é só apertar Iniciar)
  state.draft = { activity: session.activity, categoryId: session.categoryId }
  if (entry && !state.sessions.some((item) => item.id === entry.id)) state.sessions.push(entry)
  saveNow()
  scheduleClock()
  const undo = () => {
    if (state.active) return
    state.sessions = state.sessions.filter((item) => item.id !== before.id)
    state.active = before
    state.alert = null
    saveNow()
    scheduleClock()
  }
  if (options.quiet) return entry
  if (!entry) {
    showToast({
      message: how === 'cancel' ? 'Sessão descartada.' : 'Sessão curta demais para registrar.',
      icon: 'info',
      action: { label: 'Desfazer', run: undo },
    })
  } else if (how === 'cancel') {
    showToast({
      message: entry.duration
        ? `Sessão cancelada (${formatDuration(entry.duration * 1000)} de ciclos completos contam).`
        : 'Sessão cancelada — o tempo não conta.',
      icon: 'x',
      action: { label: 'Desfazer', run: undo },
    })
  } else {
    showToast({
      message: `Sessão salva: ${formatDuration(entry.duration * 1000)}${entry.activity ? ` · ${entry.activity}` : ''}`,
      tone: 'success',
      icon: 'check',
      action: { label: 'Desfazer', run: undo },
    })
  }
  return entry
}

function finishActive(): TimerSession | null {
  if (!state.active) return null
  tick()
  if (!state.active) return null
  state.alert = null
  return record(state.active, Date.now(), 'finish')
}

/** Cancelar: pergunta antes quando já há tempo (ele não vai contar). */
async function cancelActive(): Promise<void> {
  const active = state.active
  if (!active) return
  const time = elapsed(active, Date.now())
  if (time >= 60_000) {
    const valid = active.pomodoro?.completedFocus ?? 0
    const ok = await confirmDialog({
      title: 'Cancelar a sessão?',
      message: valid
        ? `Só os ciclos de foco completos (${formatDuration(valid)}) vão contar. A sessão fica no histórico como cancelada.`
        : `${formatDuration(time)} não vão contar como tempo realizado. A sessão fica no histórico como cancelada.`,
      confirmLabel: 'Cancelar sessão',
      cancelLabel: 'Continuar',
      danger: true,
    })
    if (!ok || state.active?.id !== active.id) return
  }
  state.alert = null
  record(state.active!, Date.now(), 'cancel')
}

function dismissAlert(): void {
  state.alert = null
}

// ── Histórico ───────────────────────────────────────────────────────────────

function findSession(id: string): TimerSession | undefined {
  return state.sessions.find((session) => session.id === id)
}

let revealSeq = 0
/** Mostra um registro no Histórico (abrir uma menção a ele). Devolve false se ele não existe mais. */
function revealSession(id: string): boolean {
  if (!findSession(id)) return false
  state.reveal = { id, seq: ++revealSeq }
  setTab('history')
  return true
}

/** Editar um registro: atividade, categoria, observações e o tempo válido. */
function updateSession(id: string, patch: Partial<Pick<TimerSession, 'activity' | 'categoryId' | 'notes' | 'duration'>>): void {
  const index = state.sessions.findIndex((session) => session.id === id)
  if (index < 0) return
  const session = state.sessions[index]!
  const next = { ...session, ...patch }
  next.activity = next.activity.trim().slice(0, 200)
  // O tempo válido fica entre 0 e o tempo entre o início e o fim
  next.duration = Math.max(0, Math.min(Math.round((session.end - session.start) / 1000), Math.round(next.duration)))
  state.sessions.splice(index, 1, next)
  scheduleSave()
}

function deleteSession(id: string): void {
  const index = state.sessions.findIndex((session) => session.id === id)
  if (index < 0) return
  const [removed] = state.sessions.splice(index, 1)
  saveNow()
  showToast({
    message: `Registro excluído${removed!.activity ? `: ${removed!.activity}` : ''}`,
    icon: 'trash',
    action: {
      label: 'Desfazer',
      run: () => {
        if (state.sessions.some((session) => session.id === removed!.id)) return
        state.sessions.splice(Math.min(index, state.sessions.length), 0, removed!)
        saveNow()
      },
    },
  })
}

// ── Categorias ──────────────────────────────────────────────────────────────

function addCategory(name: string, color?: PaletteColor): TimerCategory {
  const category: TimerCategory = {
    id: categoryIdFor(name, (id) => categoryById.value.has(id)),
    name: name.trim(),
    color: color ?? suggestColor(state.categories.map((item) => item.color)),
    createdAt: new Date().toISOString(),
  }
  state.categories.push(category)
  saveNow()
  return category
}

function updateCategory(id: string, patch: Partial<Pick<TimerCategory, 'name' | 'color'>>): void {
  const category = categoryById.value.get(id)
  if (!category) return
  if (patch.name?.trim()) category.name = patch.name.trim()
  if (patch.color) category.color = patch.color
  scheduleSave()
}

/** Exclui a categoria (com confirmação). O histórico fica: as sessões dela ficam sem categoria. */
async function requestDeleteCategory(id: string): Promise<boolean> {
  const category = categoryById.value.get(id)
  if (!category) return false
  const used = state.sessions.filter((session) => session.categoryId === id).length
  const ok = await confirmDialog({
    title: `Excluir a categoria “${category.name}”?`,
    message: used
      ? `${used} ${used === 1 ? 'sessão do histórico ficará' : 'sessões do histórico ficarão'} sem categoria. Nenhum registro de tempo será apagado.`
      : 'Nenhuma sessão usa esta categoria.',
    confirmLabel: 'Excluir categoria',
    danger: true,
  })
  if (!ok) return false
  const next = withoutCategory({ categories: state.categories, sessions: state.sessions, active: state.active }, id)
  adopt(next)
  if (state.draft.categoryId === id) state.draft.categoryId = null
  saveNow()
  return true
}

/** Sobe (−1) ou desce (+1) uma categoria na lista. */
function moveCategory(id: string, delta: number): void {
  const from = state.categories.findIndex((category) => category.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= state.categories.length) return
  const [category] = state.categories.splice(from, 1)
  state.categories.splice(to, 0, category!)
  scheduleSave()
}

// ── Consultas para a tela ───────────────────────────────────────────────────

/** Tempo da etapa/sessão para mostrar agora (reativo ao tique). */
const activeElapsed = computed(() => (state.active ? elapsed(state.active, state.now) : 0))

/** Tempo de foco de cada ciclo da sessão em andamento (ms). */
const activeFocusLength = computed(() => (state.active?.pomodoro ? phaseLength(state.active.pomodoro.config, 'focus') : 0))

/** As categorias do Timer no formato do diálogo de categoria (o mesmo das Tarefas). */
const categorySource: CategorySource = {
  get categories() {
    return state.categories
  },
  add: (name, color) => addCategory(name, color),
  update: (id, patch) => updateCategory(id, patch),
  requestDelete: (id) => requestDeleteCategory(id),
}

export function useTimerStore() {
  return {
    state,
    categorySource,
    categoryById,
    knownCategoryIds,
    activeElapsed,
    activeFocusLength,
    categoryName,
    load,
    retry,
    flush,
    refreshFromDisk,
    setTab,
    setMode,
    updateSettings,
    setCountdown,
    setPomodoro,
    start,
    togglePause,
    skipPause,
    updateActive,
    finishActive,
    cancelActive,
    dismissAlert,
    findSession,
    revealSession,
    updateSession,
    deleteSession,
    addCategory,
    updateCategory,
    requestDeleteCategory,
    moveCategory,
    tick,
    revealFile: () => repo.reveal(),
  }
}
