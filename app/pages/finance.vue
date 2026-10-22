<script setup lang="ts">
/**
 * Módulo FINANÇAS (1.7.0): registrar gastos, o histórico e o painel com os gráficos.
 * Os dados ficam no store (stores/finance.ts) e em finance/finance.json.
 */
import { computed, nextTick, ref } from 'vue'
import { useShortcuts } from '~/composables/useShortcuts'
import { formatMoney } from '~/lib/finance/format'
import { filterExpenses, totalOf } from '~/lib/finance/model'
import { canReveal } from '~/lib/platform'
import { periodOf } from '~/lib/timer/stats'
import { useFinanceStore, type FinanceTab } from '~/stores/finance'

const finance = useFinanceStore()
const reveal = canReveal()
const addRef = ref<{ focusAmount: () => void }>()
const historyRef = ref<{ shiftPeriod: (delta: number) => void; focusSearch: () => void }>()
const dashboardRef = ref<{ shiftPeriod: (delta: number) => void }>()

const tab = computed({
  get: () => finance.state.tab,
  set: (value: FinanceTab) => finance.setTab(value),
})

const TABS = [
  { value: 'expenses' as const, label: 'Gastos', icon: 'wallet' },
  { value: 'dashboard' as const, label: 'Painel', icon: 'chart' },
]

/** "Este mês: R$ 1.234,56 em 18 gastos" (sempre o mês de hoje, com todos os gastos). */
const subtitle = computed(() => {
  const month = periodOf('month', finance.today.value)
  const list = filterExpenses(finance.state.expenses, { from: month.from, to: month.to })
  if (!list.length) return 'Registre seus gastos e veja para onde vai o seu dinheiro.'
  return `Este mês: ${formatMoney(totalOf(list))} em ${list.length} ${list.length === 1 ? 'gasto' : 'gastos'}.`
})

async function focusAdd() {
  tab.value = 'expenses'
  await nextTick()
  addRef.value?.focusAmount()
}

useShortcuts({
  'mod+n': () => void focusAdd(),
  'mod+f': () => {
    if (tab.value !== 'expenses') return false
    historyRef.value?.focusSearch()
  },
  arrowleft: () => shift(-1),
  arrowright: () => shift(1),
})

function shift(delta: number): boolean | void {
  if (tab.value === 'expenses') historyRef.value?.shiftPeriod(delta)
  else if (tab.value === 'dashboard') dashboardRef.value?.shiftPeriod(delta)
  else return false
}
</script>

<template>
  <div class="finance-page">
    <div class="finance-scroll">
      <div class="finance-content module-content">
        <header class="finance-header">
          <div class="title-block">
            <h1>Finanças</h1>
            <p data-finance-subtitle>{{ subtitle }}</p>
          </div>
          <div class="tabs" role="tablist" aria-label="Áreas das Finanças">
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

        <div v-if="finance.state.error" class="finance-error">
          <AppIcon name="alert" :size="34" />
          <h2>Não foi possível ler o arquivo das Finanças</h2>
          <p class="selectable">{{ finance.state.error }}</p>
          <p class="muted">
            Nada foi sobrescrito. Corrija o arquivo <code>finance/finance.json</code> (ou restaure um backup de <code>.4notes/backups</code>) e tente de
            novo.
          </p>
          <div class="error-actions">
            <button class="btn btn-primary" @click="finance.retry()">Tentar novamente</button>
            <button v-if="reveal" class="btn" @click="finance.revealFile()">Mostrar arquivo</button>
          </div>
        </div>

        <template v-else>
          <div v-if="tab === 'expenses'" class="expenses-area">
            <ExpenseQuickAdd ref="addRef" />
            <FinanceHistory ref="historyRef" @add="focusAdd" />
          </div>
          <FinanceDashboard v-else ref="dashboardRef" @add="focusAdd" />
        </template>
      </div>
    </div>
    <ExpenseDialog />
  </div>
</template>

<style scoped>
.finance-page {
  height: 100%;
}
.finance-scroll {
  height: 100%;
  overflow-y: auto;
}
.finance-header {
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
.expenses-area {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.finance-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 20px;
  text-align: center;
  color: var(--text-2);
}
.finance-error > .app-icon {
  color: var(--danger);
}
.finance-error h2 {
  color: var(--text);
  font-family: var(--font-display);
  font-size: 19px;
}
.finance-error code {
  font-family: var(--font-mono);
  font-size: 0.9em;
}
.error-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
html[data-layout='compact'] .finance-header {
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
