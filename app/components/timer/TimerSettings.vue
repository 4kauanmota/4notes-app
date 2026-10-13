<script setup lang="ts">
/**
 * Configurações do Timer (Configurações › Módulos › Timer), guardadas no workspace
 * (.4notes/settings.json, seção "timer"). Os tempos do Pomodoro e a duração do
 * temporizador ficam na própria tela do Timer (usados toda hora).
 */
import { computed } from 'vue'
import { isAndroid } from '~/lib/platform'
import type { WeekStart } from '~/lib/timer/stats'
import { useTimerStore } from '~/stores/timer'

const timer = useTimerStore()
/** O celular não mostra avisos do sistema (o aviso aparece ao voltar para o app). */
const systemNotices = !isAndroid() && typeof window !== 'undefined' && 'Notification' in window

const sound = computed({
  get: () => timer.state.settings.sound,
  set: (value: boolean) => timer.updateSettings({ sound: value }),
})
const notify = computed({
  get: () => timer.state.settings.notify,
  set: (value: boolean) => timer.updateSettings({ notify: value }),
})
const weekStart = computed({
  get: () => String(timer.state.settings.weekStart) as '0' | '1',
  set: (value: '0' | '1') => timer.updateSettings({ weekStart: Number(value) as WeekStart }),
})

const WEEK_STARTS: { value: '0' | '1'; label: string }[] = [
  { value: '1', label: 'Segunda' },
  { value: '0', label: 'Domingo' },
]
</script>

<template>
  <SettingRow label="Som ao terminar" help="Um toque curto quando o temporizador ou uma etapa do Pomodoro termina.">
    <UiSwitch v-model="sound" label="Som ao terminar" />
  </SettingRow>
  <SettingRow
    v-if="systemNotices"
    label="Aviso do sistema"
    help="Com o 4notes minimizado, o fim do tempo também aparece como aviso do Windows."
  >
    <UiSwitch v-model="notify" label="Aviso do sistema" />
  </SettingRow>
  <SettingRow label="A semana começa no" help="Usado nas estatísticas por semana e na comparação com a semana anterior.">
    <UiSegmented v-model="weekStart" size="sm" :options="WEEK_STARTS" aria-label="A semana começa no" />
  </SettingRow>
</template>
