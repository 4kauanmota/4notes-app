<script setup lang="ts">
/** Configuração da recorrência: "[x] Tarefa recorrente" + frequência + prévia das próximas datas. */
import { computed, ref, watch } from 'vue'
import { formatShortDate, type ISODate } from '~/lib/dates'
import {
  clampInterval,
  describeRecurrence,
  presetFor,
  RECURRENCE_PRESETS,
  RECURRENCE_UNITS,
  upcomingOccurrences,
  type RecurrenceBasis,
  type RecurrenceDraft as RuleDraft,
  type RecurrencePreset,
  type RecurrenceUnit,
} from '~/lib/tasks/recurrence'

const props = defineProps<{ enabled: boolean; rule: RuleDraft; date: ISODate | null; today: ISODate }>()
const emit = defineEmits<{ 'update:enabled': [value: boolean]; 'update:rule': [value: RuleDraft] }>()

const custom = ref(!presetFor(props.rule))
watch(
  () => props.rule,
  (rule) => {
    if (!presetFor(rule)) custom.value = true
  },
)
const activePreset = computed(() => (custom.value ? null : (presetFor(props.rule)?.id ?? null)))

function choosePreset(preset: RecurrencePreset) {
  custom.value = false
  emit('update:rule', { ...props.rule, interval: preset.interval, unit: preset.unit })
}

function setInterval(value: string) {
  emit('update:rule', { ...props.rule, interval: clampInterval(value) })
}

function setUnit(value: string) {
  emit('update:rule', { ...props.rule, unit: value as RecurrenceUnit })
}

const basisModel = computed({
  get: () => props.rule.basis,
  set: (basis: RecurrenceBasis) => emit('update:rule', { ...props.rule, basis }),
})

const start = computed(() => props.date ?? props.today)
const upcoming = computed(() => upcomingOccurrences({ ...props.rule, anchor: start.value }, start.value, 4))
</script>

<template>
  <div class="recurrence" :class="{ on: enabled }">
    <label class="rec-toggle">
      <UiSwitch :model-value="enabled" label="Tarefa recorrente" @update:model-value="emit('update:enabled', $event)" />
      <span class="rec-toggle-text">
        <strong>Tarefa recorrente</strong>
        <small>Ao concluir, ela sai da lista e volta sozinha na próxima data.</small>
      </span>
    </label>

    <Transition name="expand">
      <div v-if="enabled" class="rec-body">
        <div class="presets">
          <button
            v-for="preset in RECURRENCE_PRESETS"
            :key="preset.id"
            type="button"
            class="preset"
            :class="{ active: activePreset === preset.id }"
            @click="choosePreset(preset)"
          >
            {{ preset.label }}
          </button>
          <button type="button" class="preset" :class="{ active: custom }" @click="custom = true">Personalizado</button>
        </div>

        <div v-if="custom" class="custom">
          <span>A cada</span>
          <input class="input interval" type="number" min="1" max="999" :value="rule.interval" @input="setInterval(($event.target as HTMLInputElement).value)" />
          <select class="select unit" :value="rule.unit" @change="setUnit(($event.target as HTMLSelectElement).value)">
            <option v-for="unit in RECURRENCE_UNITS" :key="unit.value" :value="unit.value">
              {{ rule.interval === 1 ? unit.singular : unit.plural }}
            </option>
          </select>
        </div>

        <div class="basis">
          <span class="basis-label">Contar a partir</span>
          <UiSegmented
            v-model="basisModel"
            size="sm"
            :options="[
              { value: 'schedule', label: 'da data programada' },
              { value: 'completion', label: 'da conclusão' },
            ]"
          />
        </div>

        <div class="preview">
          <AppIcon name="repeat" :size="14" />
          <span>
            <strong>{{ describeRecurrence(rule) }}</strong>
            <span class="muted"> · próximas datas:</span>
          </span>
          <div class="preview-dates">
            <span v-for="(day, index) in upcoming" :key="day" class="preview-date" :class="{ first: index === 0 }">
              {{ formatShortDate(day, today) }}
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.recurrence {
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-2);
  transition: border-color var(--t-med), box-shadow var(--t-med);
}
.recurrence.on {
  border-color: color-mix(in srgb, var(--primary) 45%, var(--border));
  box-shadow: 0 0 0 3px var(--primary-soft);
}
.rec-toggle {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
}
.rec-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.rec-toggle-text strong {
  font-size: 13.5px;
  font-weight: 600;
}
.rec-toggle-text small {
  font-size: 12px;
  color: var(--text-3);
}
.rec-body {
  display: grid;
  gap: 12px;
  padding: 2px 14px 14px;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.preset {
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition: all var(--t-fast);
}
.preset:hover {
  border-color: var(--border-strong);
  color: var(--text);
}
.preset.active {
  border-color: transparent;
  background: var(--primary);
  color: var(--on-primary);
}
.custom {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-2);
}
.interval {
  width: 72px;
  min-height: 32px;
  padding: 4px 8px;
}
.unit {
  width: auto;
  min-height: 32px;
  padding-top: 4px;
  padding-bottom: 4px;
  background-position: calc(100% - 16px) 13px, calc(100% - 11px) 13px;
}
.basis {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.basis-label {
  font-size: 12.5px;
  color: var(--text-2);
}
.preview {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 8px;
  align-items: center;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--surface);
  border: 1px dashed var(--border-strong);
  font-size: 12.5px;
  color: var(--text-2);
}
.preview > :deep(.app-icon) {
  color: var(--primary-text);
}
.preview-dates {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.preview-date {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-3);
  font-size: 12px;
}
.preview-date.first {
  background: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 600;
}

.expand-enter-active,
.expand-leave-active {
  transition: opacity 220ms var(--ease-out), transform 260ms var(--ease-out);
}
.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
