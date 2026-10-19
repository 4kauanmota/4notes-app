<script setup lang="ts">
/**
 * Módulo TIMER: Sessão (cronômetro, temporizador, Pomodoro), Histórico e Estatísticas.
 * A contagem fica no store (stores/timer.ts), não na tela: trocar de aba ou de módulo
 * não para nada.
 */
import { computed, ref } from 'vue'
import { useShortcuts } from '~/composables/useShortcuts'
import { canReveal } from '~/lib/platform'
import { useTimerStore, type TimerTab } from '~/stores/timer'

const timer = useTimerStore()
const reveal = canReveal()
const sessionRef = ref<{ focusActivity: () => void }>()
const historyRef = ref<{ shiftPeriod: (delta: number) => void }>()
const statsRef = ref<{ shiftPeriod: (delta: number) => void }>()

const tab = computed({
  get: () => timer.state.tab,
  set: (value: TimerTab) => timer.setTab(value),
})

const TABS = [
  { value: 'session' as const, label: 'Sessão', icon: 'timer' },
  { value: 'history' as const, label: 'Histórico', icon: 'history' },
  { value: 'stats' as const, label: 'Estatísticas', icon: 'chart' },
]

const subtitle = computed(() => {
  const active = timer.state.active
  if (!active) return 'Acompanhe o tempo dedicado às suas atividades.'
  return active.runningSince !== null ? 'Uma sessão está contando.' : 'Uma sessão está pausada.'
})

useShortcuts({
  // Espaço: iniciar, pausar ou retomar (fora dos campos de texto e dos botões, que usam o Espaço)
  space: (event) => {
    if (tab.value !== 'session' || timer.state.error) return false
    if (
      (event.target as HTMLElement | null)?.closest?.(
        'button, a, [role="button"], [role="tab"], [role="radio"], [role="switch"], [tabindex]',
      )
    )
      return false
    if (timer.state.active) timer.togglePause()
    else timer.start()
  },
  'mod+enter': () => {
    if (!timer.state.active) return false
    timer.finishActive()
  },
  'mod+n': () => {
    tab.value = 'session'
    requestAnimationFrame(() => sessionRef.value?.focusActivity())
  },
  arrowleft: () => shift(-1),
  arrowright: () => shift(1),
})

function shift(delta: number): boolean | void {
  if (tab.value === 'history') historyRef.value?.shiftPeriod(delta)
  else if (tab.value === 'stats') statsRef.value?.shiftPeriod(delta)
  else return false
}
</script>

<template>
  <div class="timer-page">
    <div class="timer-scroll">
      <div class="timer-content module-content">
        <header class="timer-header">
          <div class="title-block">
            <h1>Timer</h1>
            <p>{{ subtitle }}</p>
          </div>
          <div class="tabs" role="tablist" aria-label="Áreas do Timer">
            <button
              v-for="item in TABS"
              :key="item.value"
              type="button"
              role="tab"
              class="tab"
              :class="{ active: tab === item.value }"
              :aria-selected="tab === item.value"
              :data-tab="item.value"
              @click="tab = item.value"
            >
              <AppIcon :name="item.icon" :size="16" />
              <span>{{ item.label }}</span>
            </button>
          </div>
        </header>

        <div v-if="timer.state.error" class="timer-error">
          <AppIcon name="alert" :size="34" />
          <h2>Não foi possível ler o arquivo do Timer</h2>
          <p class="selectable">{{ timer.state.error }}</p>
          <p class="muted">
            Nada foi sobrescrito. Corrija o arquivo <code>timer/timer.json</code> (ou restaure um backup de <code>.4notes/backups</code>) e
            tente de novo.
          </p>
          <div class="error-actions">
            <button class="btn btn-primary" @click="timer.retry()">Tentar novamente</button>
            <button v-if="reveal" class="btn" @click="timer.revealFile()">Mostrar arquivo</button>
          </div>
        </div>

        <template v-else>
          <TimerSession v-show="tab === 'session'" ref="sessionRef" @history="tab = 'history'" />
          <TimerHistory v-if="tab === 'history'" ref="historyRef" @session="tab = 'session'" />
          <TimerStats v-if="tab === 'stats'" ref="statsRef" @session="tab = 'session'" />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timer-page {
  height: 100%;
}
.timer-scroll {
  height: 100%;
  overflow-y: auto;
}
.timer-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 16px;
  margin-bottom: 20px;
}
.title-block h1 {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 750;
  letter-spacing: -0.02em;
}
.title-block p {
  margin-top: 3px;
  color: var(--text-3);
  font-size: 13.5px;
}
.tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-3);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--t-fast),
    color var(--t-fast),
    box-shadow var(--t-fast);
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  background: var(--surface);
  color: var(--primary-text);
  box-shadow:
    var(--shadow-sm),
    0 0 0 1px var(--border);
}
.timer-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 20px;
  text-align: center;
  color: var(--text-2);
}
.timer-error > .app-icon {
  color: var(--danger);
}
.timer-error h2 {
  color: var(--text);
  font-family: var(--font-display);
  font-size: 19px;
}
.timer-error code {
  font-family: var(--font-mono);
  font-size: 0.9em;
}
.error-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
html[data-layout='compact'] .timer-header {
  margin-bottom: 14px;
}
html[data-layout='compact'] .title-block h1 {
  font-size: 22px;
}
html[data-layout='compact'] .tabs {
  display: flex;
  width: 100%;
}
html[data-layout='compact'] .tab {
  flex: 1;
  justify-content: center;
  height: 38px;
  padding: 0 8px;
}
</style>
