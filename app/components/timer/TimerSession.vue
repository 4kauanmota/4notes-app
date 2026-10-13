<script setup lang="ts">
/**
 * Timer › Sessão: escolher o modo (cronômetro, temporizador, Pomodoro), iniciar e
 * acompanhar. Atividade e categoria são opcionais — dá para começar só com "Iniciar"
 * e preencher depois (inclusive com a sessão contando). Ao lado, o resumo de hoje.
 */
import { computed, ref } from 'vue'
import { useToday } from '~/composables/useToday'
import { cycleInRound, elapsed, elapsedWithin, isRunning, phaseLength, remaining, roundProgress } from '~/lib/timer/engine'
import { formatClock, formatDuration, formatTimeOfDay, parseDurationInput } from '~/lib/timer/format'
import {
  lastCategoryOf,
  knownActivities,
  MODE_ICONS,
  MODE_LABELS,
  PHASE_LABELS,
  recentActivities,
  STATUS_LABELS,
  TIMER_MODES,
  type TimerMode,
} from '~/lib/timer/model'
import { aggregate, periodBounds, periodOf, sessionInRange } from '~/lib/timer/stats'
import { useTimerStore } from '~/stores/timer'

const emit = defineEmits<{ history: [] }>()
const timer = useTimerStore()
const { today } = useToday()
const activityInput = ref<HTMLInputElement>()
const pomodoroOpen = ref(false)
const customOpen = ref(false)
const customText = ref('')
const customError = ref(false)

const active = computed(() => timer.state.active)
const now = computed(() => timer.state.now)
const settings = computed(() => timer.state.settings)

const mode = computed<TimerMode>({
  get: () => active.value?.mode ?? timer.state.mode,
  set: (value) => timer.setMode(value),
})
const modeOptions = TIMER_MODES.map((value) => ({ value, label: MODE_LABELS[value], icon: MODE_ICONS[value] }))

// ── O que aparece no mostrador ──────────────────────────────────────────────

type DialState = 'idle' | 'running' | 'paused' | 'done'

const dial = computed(() => {
  const session = active.value
  const config = settings.value.pomodoro
  if (!session) {
    if (mode.value === 'countdown')
      return {
        time: formatClock(settings.value.countdown, 'down'),
        progress: 1,
        caption: 'Pronto para começar',
        state: 'idle' as DialState,
      }
    if (mode.value === 'pomodoro')
      return {
        time: formatClock(config.focus * 60_000, 'down'),
        progress: 1,
        caption: `Foco · 1 de ${config.rounds}`,
        dots: { total: config.rounds, filled: 0 },
        state: 'idle' as DialState,
      }
    return { time: formatClock(0), sweep: 0, caption: 'Pronto para começar', state: 'idle' as DialState }
  }
  const running = isRunning(session)
  if (session.mode === 'stopwatch') {
    const ms = elapsed(session, now.value)
    return {
      time: formatClock(ms),
      sweep: (ms % 60_000) / 60_000,
      caption: running ? 'Contando' : 'Pausado',
      state: (running ? 'running' : 'paused') as DialState,
    }
  }
  const left = remaining(session, now.value) ?? 0
  if (session.mode === 'countdown') {
    return {
      time: formatClock(left, 'down'),
      progress: left / session.target!,
      caption: running ? 'Contando' : 'Pausado',
      state: (running ? 'running' : 'paused') as DialState,
    }
  }
  const p = session.pomodoro!
  const label = PHASE_LABELS[p.phase]
  return {
    time: formatClock(left, 'down'),
    progress: left / phaseLength(p.config, p.phase),
    caption: p.phase === 'focus' ? `${label} · ${cycleInRound(p)} de ${p.config.rounds}` : label,
    tone: (p.phase === 'focus' ? 'focus' : 'break') as 'focus' | 'break',
    dots: { total: p.config.rounds, filled: roundProgress(p) },
    state: (running ? 'running' : p.waiting ? 'done' : 'paused') as DialState,
  }
})

/** A linha de baixo do mostrador: quando termina, desde quando conta, quanto de foco. */
const statusLine = computed(() => {
  const session = active.value
  if (!session) {
    if (mode.value === 'pomodoro') {
      const c = settings.value.pomodoro
      return `${c.focus} min de foco · ${c.short} min de pausa · pausa longa de ${c.long} min a cada ${c.rounds}`
    }
    return mode.value === 'countdown' ? 'Escolha a duração abaixo e inicie.' : 'Conta o tempo até você finalizar.'
  }
  const running = isRunning(session)
  const left = remaining(session, now.value)
  if (session.pomodoro) {
    const focus = formatDuration(elapsed(session, now.value), { seconds: false })
    if (session.pomodoro.waiting) return `Etapa pronta — foco até agora: ${focus}`
    return running && left !== null
      ? `Termina às ${formatTimeOfDay(now.value + left)} · foco até agora: ${focus}`
      : `Pausado · foco até agora: ${focus}`
  }
  if (session.mode === 'countdown')
    return running && left !== null ? `Termina às ${formatTimeOfDay(now.value + left)}` : 'Pausado — o tempo não está passando.'
  return running ? `Desde as ${formatTimeOfDay(session.startedAt)}` : 'Pausado — o tempo não está contando.'
})

// ── Campos (da sessão em andamento ou da próxima) ───────────────────────────

const activity = computed({
  get: () => (active.value ? active.value.activity : timer.state.draft.activity),
  set: (value: string) => {
    if (active.value) timer.updateActive({ activity: value })
    else timer.state.draft.activity = value
  },
})
const categoryId = computed<string | null>({
  get: () => (active.value ? active.value.categoryId : timer.state.draft.categoryId),
  set: (value) => {
    if (active.value) timer.updateActive({ categoryId: value })
    else timer.state.draft.categoryId = value
  },
})

/** Atividade já usada antes, sem categoria escolhida: usa a categoria da última vez. */
function onActivityChange() {
  if (categoryId.value) return
  const previous = lastCategoryOf(timer.state.sessions, activity.value)
  if (previous && timer.categoryById.value.has(previous)) categoryId.value = previous
}

const suggestions = computed(() => knownActivities(timer.state.sessions).slice(0, 60))
const recents = computed(() => recentActivities(timer.state.sessions, 4))

function useRecent(item: { activity: string; categoryId: string | null }) {
  timer.state.draft.activity = item.activity
  timer.state.draft.categoryId = item.categoryId && timer.categoryById.value.has(item.categoryId) ? item.categoryId : null
}

// ── Temporizador: duração ───────────────────────────────────────────────────

const PRESETS = [5, 10, 15, 25, 30, 45, 60]
const presetActive = (minutes: number) => settings.value.countdown === minutes * 60_000
const customActive = computed(() => !PRESETS.some(presetActive))

function applyCustom() {
  const ms = parseDurationInput(customText.value)
  customError.value = ms === null
  if (ms === null) return
  timer.setCountdown(ms)
  customOpen.value = false
}

function openCustom() {
  customOpen.value = true
  customError.value = false
  const minutes = settings.value.countdown / 60_000
  customText.value = customActive.value && Number.isInteger(minutes) ? String(minutes) : ''
}

// ── Ações ───────────────────────────────────────────────────────────────────

const waitingLabel = computed(() => {
  const p = active.value?.pomodoro
  if (!p?.waiting) return null
  return p.phase === 'focus'
    ? 'Iniciar foco'
    : `Iniciar ${PHASE_LABELS[p.phase].toLowerCase()} (${p.phase === 'short' ? p.config.short : p.config.long} min)`
})
const onBreak = computed(() => !!active.value?.pomodoro && active.value.pomodoro.phase !== 'focus')

// ── Hoje ────────────────────────────────────────────────────────────────────

const todayRange = computed(() => periodBounds(periodOf('day', today.value)))
const todayData = computed(() => aggregate(timer.state.sessions, todayRange.value, { knownCategories: timer.knownCategoryIds.value }))
const liveToday = computed(() => (active.value ? elapsedWithin(active.value, todayRange.value[0], todayRange.value[1], now.value) : 0))
const todaySessions = computed(() =>
  timer.state.sessions
    .filter((session) => sessionInRange(session, todayRange.value))
    .slice(-6)
    .reverse(),
)

defineExpose({
  focusActivity: () => {
    activityInput.value?.focus()
    activityInput.value?.select()
  },
})
</script>

<template>
  <div class="session-layout">
    <section class="session-card" aria-label="Sessão">
      <div class="mode-row">
        <UiSegmented v-if="!active" v-model="mode" :options="modeOptions" aria-label="Modo" data-timer-modes />
        <span v-else class="mode-badge"><AppIcon :name="MODE_ICONS[active.mode]" :size="15" /> {{ MODE_LABELS[active.mode] }}</span>
      </div>

      <TimerDial
        :time="dial.time"
        :caption="dial.caption"
        :progress="'progress' in dial ? dial.progress : null"
        :sweep="'sweep' in dial ? dial.sweep : null"
        :tone="'tone' in dial ? dial.tone : 'focus'"
        :state="dial.state"
        :dots="'dots' in dial ? dial.dots : null"
      />
      <p class="status-line">{{ statusLine }}</p>

      <Transition name="fade">
        <div v-if="timer.state.alert" class="alert" role="alert" data-timer-alert>
          <AppIcon :name="timer.state.alert.kind === 'countdown-end' ? 'hourglass' : 'pomodoro'" :size="18" />
          <span>{{ timer.state.alert.message }}</span>
          <button type="button" class="btn btn-sm" @click="timer.dismissAlert()">OK</button>
        </div>
      </Transition>

      <div class="controls">
        <template v-if="!active">
          <button type="button" class="btn btn-primary btn-lg start" data-action="timer-start" @click="timer.start()">
            <AppIcon name="play" :size="17" /> Iniciar
          </button>
        </template>
        <template v-else>
          <button v-if="waitingLabel" type="button" class="btn btn-primary btn-lg" data-action="timer-resume" @click="timer.togglePause()">
            <AppIcon name="play" :size="17" /> {{ waitingLabel }}
          </button>
          <button
            v-else-if="active.runningSince !== null"
            type="button"
            class="btn btn-lg"
            data-action="timer-pause"
            @click="timer.togglePause()"
          >
            <AppIcon name="pause" :size="17" /> Pausar
          </button>
          <button v-else type="button" class="btn btn-primary btn-lg" data-action="timer-resume" @click="timer.togglePause()">
            <AppIcon name="play" :size="17" /> Retomar
          </button>
          <button v-if="onBreak" type="button" class="btn btn-lg" data-action="timer-skip" @click="timer.skipPause()">
            <AppIcon name="skip" :size="16" /> Pular pausa
          </button>
          <button
            type="button"
            class="btn btn-lg finish"
            :class="{ 'btn-primary': active.runningSince !== null && !waitingLabel }"
            data-action="timer-finish"
            @click="timer.finishActive()"
          >
            <AppIcon name="stop" :size="15" /> Finalizar
          </button>
          <button type="button" class="btn btn-ghost cancel" data-action="timer-cancel" @click="timer.cancelActive()">Cancelar</button>
        </template>
      </div>

      <!-- Duração do temporizador -->
      <div v-if="!active && mode === 'countdown'" class="options durations" aria-label="Duração">
        <button
          v-for="minutes in PRESETS"
          :key="minutes"
          type="button"
          class="opt-chip"
          :class="{ active: presetActive(minutes) }"
          @click="timer.setCountdown(minutes * 60_000)"
        >
          {{ minutes < 60 ? `${minutes} min` : `${minutes / 60} h` }}
        </button>
        <form v-if="customOpen" class="custom" @submit.prevent="applyCustom">
          <input
            v-model="customText"
            class="input"
            :class="{ invalid: customError }"
            placeholder="Ex.: 40, 1:30, 2h"
            aria-label="Outra duração"
            autofocus
            @keydown.esc.stop.prevent="customOpen = false"
          />
          <button type="submit" class="btn btn-sm btn-primary">Usar</button>
        </form>
        <button v-else type="button" class="opt-chip" :class="{ active: customActive }" @click="openCustom">
          {{ customActive ? formatDuration(settings.countdown) : 'Outro…' }}
        </button>
      </div>

      <!-- Ciclos do Pomodoro -->
      <div v-if="!active && mode === 'pomodoro'" class="options">
        <button type="button" class="opt-chip" data-action="pomodoro-config" @click="pomodoroOpen = true">
          <AppIcon name="sliders" :size="14" /> Ajustar ciclos
        </button>
        <span v-if="settings.pomodoro.autoStart" class="auto-note"><AppIcon name="repeat" :size="13" /> as etapas começam sozinhas</span>
      </div>

      <div class="fields">
        <label class="field-label" for="timer-activity">Atividade <span class="optional">(opcional)</span></label>
        <input
          id="timer-activity"
          ref="activityInput"
          v-model="activity"
          class="input"
          list="timer-activities"
          maxlength="200"
          placeholder="No que você vai trabalhar? Ex.: Estudando Godot"
          autocomplete="off"
          data-field="timer-activity"
          @change="onActivityChange"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
        <datalist id="timer-activities">
          <option v-for="item in suggestions" :key="`${item.activity}|${item.categoryId}`" :value="item.activity" />
        </datalist>
        <span class="field-label cat-label">Categoria</span>
        <TimerCategoryPicker v-model="categoryId" />
        <div v-if="!active && recents.length" class="recents">
          <span class="recents-label">Recentes</span>
          <button
            v-for="item in recents"
            :key="`${item.activity}|${item.categoryId}`"
            type="button"
            class="recent-chip"
            @click="useRecent(item)"
          >
            <CategoryDot :color="item.categoryId ? (timer.categoryById.value.get(item.categoryId)?.color ?? null) : null" :size="7" />
            {{ item.activity }}
          </button>
        </div>
      </div>
    </section>

    <aside class="today-card" aria-label="Hoje">
      <h3>Hoje</h3>
      <p class="today-total">{{ formatDuration(todayData.total + liveToday, { seconds: false }) }}</p>
      <p class="today-sub">
        {{ todayData.sessions }} {{ todayData.sessions === 1 ? 'sessão' : 'sessões'
        }}<template v-if="liveToday > 0"> + a sessão em andamento</template>
      </p>
      <ul v-if="todaySessions.length" class="today-list">
        <li v-for="session in todaySessions" :key="session.id" :class="{ canceled: session.status === 'canceled' }">
          <span class="when">{{ formatTimeOfDay(session.start) }}</span>
          <span class="what">
            <CategoryDot :color="session.categoryId ? (timer.categoryById.value.get(session.categoryId)?.color ?? null) : null" :size="7" />
            <span class="what-text">{{ session.activity || MODE_LABELS[session.mode] }}</span>
          </span>
          <span class="dur" :title="session.status !== 'completed' ? STATUS_LABELS[session.status] : undefined">{{
            formatDuration(session.duration * 1000, { seconds: false })
          }}</span>
        </li>
      </ul>
      <p v-else class="today-empty">Nenhuma sessão hoje ainda.</p>
      <button type="button" class="more-link" @click="emit('history')"><AppIcon name="history" :size="13" /> Ver histórico</button>
    </aside>

    <PomodoroDialog :open="pomodoroOpen" :config="settings.pomodoro" @close="pomodoroOpen = false" @save="timer.setPomodoro" />
  </div>
</template>

<style scoped>
.session-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 24px;
  align-items: start;
}
.session-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 22px 24px 26px;
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
  background: var(--surface-2);
}
.mode-row {
  display: flex;
  justify-content: center;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.mode-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary-text);
  font-size: 13px;
  font-weight: 650;
}
.status-line {
  min-height: 20px;
  margin-top: -4px;
  font-size: 13px;
  color: var(--text-3);
  text-align: center;
}
.alert {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 480px;
  padding: 10px 12px 10px 14px;
  border-radius: var(--r-lg);
  background: var(--accent-soft);
  color: var(--text);
  font-size: 13.5px;
  font-weight: 550;
  animation: alert-in 420ms var(--ease-spring);
}
.alert > .app-icon {
  color: var(--accent-text);
}
.controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}
.controls .start {
  min-width: 180px;
}
.cancel {
  height: 42px;
}
.options {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 6px;
  max-width: 520px;
}
.opt-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: all var(--t-fast);
}
html[data-touch] .opt-chip {
  height: 36px;
}
.opt-chip:hover {
  border-color: var(--border-strong);
  color: var(--text);
}
.opt-chip.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary-text);
}
.custom {
  display: flex;
  gap: 6px;
}
.custom .input {
  width: 150px;
  min-height: 30px;
  padding: 4px 10px;
}
.custom .input.invalid {
  border-color: var(--danger);
}
.auto-note {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-3);
}
.fields {
  width: min(520px, 100%);
  margin-top: 6px;
}
.optional {
  font-weight: 500;
  color: var(--text-3);
}
.cat-label {
  margin-top: 14px;
}
.recents {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
}
.recents-label {
  margin-right: 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
}
.recent-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background var(--t-fast),
    color var(--t-fast);
}
.recent-chip:hover {
  background: var(--primary-soft);
  color: var(--text);
}
.today-card {
  padding: 18px 18px 14px;
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
}
.today-card h3 {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.today-total {
  margin-top: 4px;
  font-size: 28px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.today-sub {
  font-size: 12.5px;
  color: var(--text-3);
}
.today-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 12px 0 6px;
  padding: 0;
  list-style: none;
}
.today-list li {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 12.5px;
  border-top: 1px solid var(--border);
}
.today-list li:first-child {
  border-top: none;
}
.today-list li.canceled {
  opacity: 0.55;
}
.when,
.dur {
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.dur {
  color: var(--text-2);
}
.what {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.what-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.today-empty {
  margin: 12px 0 8px;
  font-size: 12.5px;
  color: var(--text-3);
}
.more-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border: none;
  background: none;
  color: var(--text-3);
  font-size: 12.5px;
  cursor: pointer;
}
.more-link:hover {
  color: var(--primary-text);
  text-decoration: underline;
  text-underline-offset: 3px;
}
@keyframes alert-in {
  from {
    opacity: 0;
    transform: scale(0.94);
  }
}
@media (max-width: 980px) {
  .session-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
html[data-layout='compact'] .session-card {
  padding: 16px 14px 20px;
  border-radius: var(--r-lg);
}
html[data-layout='compact'] .controls .btn-lg {
  flex: 1 1 140px;
}
html[data-layout='compact'] .cancel {
  flex-basis: 100%;
  height: 36px;
}
</style>
