<script setup lang="ts">
/**
 * Escolha do período (Histórico e Estatísticas): dia, semana, mês, ano ou um
 * intervalo de datas — e ‹ › para ir ao anterior e ao próximo. "Hoje" (ou "Atual")
 * volta para o período de agora. No Histórico existe também "Tudo".
 */
import { computed } from 'vue'
import { addDays, type ISODate } from '~/lib/dates'
import {
  containsDay,
  customPeriod,
  periodLabel,
  periodOf,
  PERIOD_LABELS,
  shiftPeriod,
  type Period,
  type PeriodKind,
  type WeekStart,
} from '~/lib/timer/stats'

const props = defineProps<{
  modelValue: Period | null
  weekStart: WeekStart
  today: ISODate
  /** Oferece "Tudo" (sem período) — no Histórico. */
  allowAll?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Period | null] }>()

type KindChoice = PeriodKind | 'all'

const options = computed(() => [
  ...(props.allowAll ? [{ value: 'all' as KindChoice, label: 'Tudo' }] : []),
  ...(Object.entries(PERIOD_LABELS) as [PeriodKind, string][]).map(([value, label]) => ({ value: value as KindChoice, label })),
  { value: 'custom' as KindChoice, label: 'Intervalo' },
])

const kind = computed<KindChoice>({
  get: () => props.modelValue?.kind ?? 'all',
  set: (value) => {
    if (value === 'all') return emit('update:modelValue', null)
    // O novo período fica perto do que você estava vendo (ou de hoje)
    const reference = props.modelValue && !containsDay(props.modelValue, props.today) ? props.modelValue.from : props.today
    if (value === 'custom') {
      const current = props.modelValue
      emit(
        'update:modelValue',
        current && current.kind !== 'day' ? customPeriod(current.from, current.to) : customPeriod(addDays(props.today, -13), props.today),
      )
      return
    }
    emit('update:modelValue', periodOf(value, reference, props.weekStart))
  },
})

const label = computed(() => (props.modelValue ? periodLabel(props.modelValue, props.today) : 'Todas as sessões'))
const isCurrent = computed(() => !props.modelValue || containsDay(props.modelValue, props.today))
const canGoNext = computed(() => !!props.modelValue && shiftPeriod(props.modelValue, 1, props.weekStart).from <= props.today)

function shift(delta: number) {
  if (!props.modelValue || (delta > 0 && !canGoNext.value)) return
  emit('update:modelValue', shiftPeriod(props.modelValue, delta, props.weekStart))
}

function goNow() {
  if (!props.modelValue) return
  if (props.modelValue.kind === 'custom') {
    const days = Math.max(0, Math.round((Date.parse(props.modelValue.to) - Date.parse(props.modelValue.from)) / 86_400_000))
    emit('update:modelValue', customPeriod(addDays(props.today, -days), props.today))
  } else {
    emit('update:modelValue', periodOf(props.modelValue.kind, props.today, props.weekStart))
  }
}

function setRange(edge: 'from' | 'to', value: string) {
  if (!props.modelValue || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return
  const from = edge === 'from' ? value : props.modelValue.from
  const to = edge === 'to' ? value : props.modelValue.to
  emit('update:modelValue', customPeriod(from, to))
}

const nowLabel = computed(() => (props.modelValue?.kind === 'day' ? 'Hoje' : 'Atual'))

defineExpose({ shift })
</script>

<template>
  <div class="period-nav">
    <div class="kinds">
      <UiSegmented v-model="kind" :options="options" size="sm" aria-label="Período" />
    </div>
    <div class="step">
      <template v-if="modelValue">
        <button type="button" class="icon-btn" aria-label="Período anterior" data-tip="Anterior (←)" @click="shift(-1)">
          <AppIcon name="chevron-left" :size="17" />
        </button>
        <template v-if="modelValue.kind === 'custom'">
          <input
            class="input date"
            type="date"
            :value="modelValue.from"
            :max="modelValue.to"
            aria-label="De"
            @change="setRange('from', ($event.target as HTMLInputElement).value)"
          />
          <span class="dash">–</span>
          <input
            class="input date"
            type="date"
            :value="modelValue.to"
            :min="modelValue.from"
            aria-label="Até"
            @change="setRange('to', ($event.target as HTMLInputElement).value)"
          />
        </template>
        <span v-else class="label" data-period-label>{{ label }}</span>
        <button type="button" class="icon-btn" aria-label="Próximo período" data-tip="Próximo (→)" :disabled="!canGoNext" @click="shift(1)">
          <AppIcon name="chevron-right" :size="17" />
        </button>
        <button v-if="!isCurrent" type="button" class="btn btn-sm btn-ghost now" @click="goNow">{{ nowLabel }}</button>
      </template>
      <span v-else class="label all">{{ label }}</span>
    </div>
  </div>
</template>

<style scoped>
.period-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  min-width: 0;
}
.kinds {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.step {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.label {
  min-width: 120px;
  padding: 0 4px;
  font-size: 14px;
  font-weight: 650;
  text-align: center;
  white-space: nowrap;
}
.label.all {
  min-width: 0;
  color: var(--text-2);
  font-weight: 600;
}
.icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.date {
  width: 138px;
  min-height: 30px;
  padding: 3px 8px;
  font-size: 12.5px;
}
.dash {
  color: var(--text-3);
}
.now {
  margin-left: 4px;
}
</style>
