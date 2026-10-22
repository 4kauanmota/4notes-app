<script setup lang="ts">
/**
 * Configurações das Finanças (Configurações › Módulos › Finanças), guardadas no
 * workspace (.4notes/settings.json, seção "finance"). Período, filtros e a ordem do
 * histórico ficam na própria tela (usados toda hora).
 */
import { computed } from 'vue'
import type { WeekStart } from '~/lib/timer/stats'
import { useFinanceStore } from '~/stores/finance'

const finance = useFinanceStore()

const weekStart = computed({
  get: () => String(finance.state.settings.weekStart) as '0' | '1',
  set: (value: '0' | '1') => finance.updateSettings({ weekStart: Number(value) as WeekStart }),
})

const WEEK_STARTS: { value: '0' | '1'; label: string }[] = [
  { value: '1', label: 'Segunda' },
  { value: '0', label: 'Domingo' },
]
</script>

<template>
  <SettingRow label="A semana começa no" help="Usado no período por semana, no gráfico por semana e na comparação com a semana anterior.">
    <UiSegmented v-model="weekStart" size="sm" :options="WEEK_STARTS" aria-label="A semana começa no" />
  </SettingRow>
</template>
