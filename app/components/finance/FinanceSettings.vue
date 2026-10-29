<script setup lang="ts">
/**
 * Configurações das Finanças (Configurações › Módulos › Finanças), guardadas no
 * workspace (.4notes/settings.json, seção "finance"). Período, filtros e a ordem do
 * histórico ficam na própria tela (usados toda hora).
 */
import { computed } from 'vue'
import { hasDesktopApi, isAndroid } from '~/lib/platform'
import type { WeekStart } from '~/lib/timer/stats'
import { useFinanceStore } from '~/stores/finance'

const finance = useFinanceStore()

const weekStart = computed({
  get: () => String(finance.state.settings.weekStart) as '0' | '1',
  set: (value: '0' | '1') => finance.updateSettings({ weekStart: Number(value) as WeekStart }),
})

/** Aviso do sistema das contas (só no computador: o celular não tem como receber, 1.7.1). */
const systemNotices = hasDesktopApi() && !isAndroid() && typeof window !== 'undefined' && 'Notification' in window
const notify = computed({
  get: () => finance.state.settings.notify,
  set: (value: boolean) => finance.updateSettings({ notify: value }),
})

/** Categoria dos gastos que a categoria automática não reconhece (1.7.2). */
const defaultCategory = computed({
  get: () => (finance.state.settings.defaultCategory && finance.categoryById.value.has(finance.state.settings.defaultCategory) ? finance.state.settings.defaultCategory : null),
  set: (value: string | null) => finance.updateSettings({ defaultCategory: value }),
})

const WEEK_STARTS: { value: '0' | '1'; label: string }[] = [
  { value: '1', label: 'Segunda' },
  { value: '0', label: 'Domingo' },
]
</script>

<template>
  <SettingRow
    label="Categoria padrão"
    help="Vai para os gastos que a categoria automática não reconhece (ao registrar, importar extrato e buscar no banco). Você pode trocar antes de salvar."
  >
    <CategorySelect v-model="defaultCategory" module="finance" size="sm" none-label="Nenhuma" label="Categoria padrão" data-setting="default-category" />
  </SettingRow>
  <SettingRow
    v-if="systemNotices"
    label="Aviso do sistema das contas"
    help="Com o 4notes aberto em segundo plano, as contas com “Me lembre de pagar” que vencem também aparecem como aviso do Windows."
  >
    <UiSwitch v-model="notify" label="Aviso do sistema das contas" />
  </SettingRow>
  <SettingRow label="A semana começa no" help="Usado no período por semana, no gráfico por semana e na comparação com a semana anterior.">
    <UiSegmented v-model="weekStart" size="sm" :options="WEEK_STARTS" aria-label="A semana começa no" />
  </SettingRow>
  <BankSettings />
</template>
