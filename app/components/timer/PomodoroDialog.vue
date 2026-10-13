<script setup lang="ts">
/**
 * Ciclos do Pomodoro: minutos de foco, da pausa curta e da pausa longa, quantos
 * focos até a pausa longa e se a próxima etapa começa sozinha. Vale para as
 * próximas sessões (a que está em andamento continua com os tempos com que começou).
 */
import { reactive, watch } from 'vue'
import { DEFAULT_POMODORO, normalizePomodoroConfig, type PomodoroConfig } from '~/lib/timer/model'

const props = defineProps<{ open: boolean; config: PomodoroConfig }>()
const emit = defineEmits<{ close: []; save: [config: PomodoroConfig] }>()

const draft = reactive<PomodoroConfig>({ ...DEFAULT_POMODORO })

watch(
  () => props.open,
  (open) => {
    if (open) Object.assign(draft, props.config)
  },
  { immediate: true },
)

const FIELDS = [
  { key: 'focus', label: 'Foco', unit: 'min', max: 240 },
  { key: 'short', label: 'Pausa curta', unit: 'min', max: 120 },
  { key: 'long', label: 'Pausa longa', unit: 'min', max: 240 },
  { key: 'rounds', label: 'Focos até a pausa longa', unit: '', max: 12 },
] as const

function step(key: (typeof FIELDS)[number]['key'], delta: number) {
  draft[key] = Math.min(FIELDS.find((field) => field.key === key)!.max, Math.max(1, (Number(draft[key]) || 1) + delta))
}

function save() {
  emit('save', normalizePomodoroConfig({ ...draft }))
  emit('close')
}

function reset() {
  Object.assign(draft, DEFAULT_POMODORO)
}
</script>

<template>
  <UiModal :open="open" :width="380" label="Ciclos do Pomodoro" @close="emit('close')">
    <form class="pomodoro-dialog" @submit.prevent="save">
      <h2><AppIcon name="pomodoro" :size="18" /> Ciclos do Pomodoro</h2>
      <div v-for="field in FIELDS" :key="field.key" class="row">
        <label :for="`pomo-${field.key}`">{{ field.label }}</label>
        <div class="stepper">
          <button type="button" class="icon-btn" :aria-label="`Menos (${field.label})`" @click="step(field.key, -1)">
            <AppIcon name="chevron-left" :size="15" />
          </button>
          <input
            :id="`pomo-${field.key}`"
            v-model.number="draft[field.key]"
            class="input"
            type="number"
            min="1"
            :max="field.max"
            inputmode="numeric"
          />
          <button type="button" class="icon-btn" :aria-label="`Mais (${field.label})`" @click="step(field.key, 1)">
            <AppIcon name="chevron-right" :size="15" />
          </button>
          <span class="unit">{{ field.unit }}</span>
        </div>
      </div>
      <SettingRow
        label="Iniciar a próxima etapa sozinha"
        help="Quando uma etapa termina, a seguinte começa na hora. Desligado, ela espera você clicar."
      >
        <UiSwitch v-model="draft.autoStart" label="Iniciar a próxima etapa sozinha" />
      </SettingRow>
      <p class="hint">Só o foco conta como tempo da atividade; as pausas, não.</p>
      <div class="actions">
        <button type="button" class="btn btn-ghost reset" @click="reset">Padrão (25 · 5 · 15 · 4)</button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.pomodoro-dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 22px;
}
h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13.5px;
}
.stepper {
  display: flex;
  align-items: center;
  gap: 2px;
}
.stepper .input {
  width: 58px;
  min-height: 32px;
  padding: 4px 6px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
}
.stepper .input::-webkit-outer-spin-button,
.stepper .input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.unit {
  width: 26px;
  font-size: 12px;
  color: var(--text-3);
}
.hint {
  font-size: 12px;
  color: var(--text-3);
}
.actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.reset {
  margin-right: auto;
  padding-left: 8px;
  font-size: 12.5px;
}
</style>
