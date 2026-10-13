<script setup lang="ts">
/**
 * Editar um registro do histórico: atividade, categoria, observações e o tempo
 * válido (o que conta nas estatísticas — no máximo o tempo entre o início e o fim).
 * Uma sessão cancelada pode ganhar um tempo válido aqui. "Ver menções" mostra onde o
 * registro foi mencionado (notas e tarefas).
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { formatDateBR, toISODate } from '~/lib/dates'
import { formatDuration, formatTimeOfDay } from '~/lib/timer/format'
import { knownActivities, MODE_ICONS, MODE_LABELS, STATUS_LABELS, type TimerSession } from '~/lib/timer/model'
import { showMentionsOf, timerSessionSubject } from '~/stores/mentions'
import { useTimerStore } from '~/stores/timer'

const props = defineProps<{ sessionId: string | null }>()
const emit = defineEmits<{ close: [] }>()
const timer = useTimerStore()
const activityInput = ref<HTMLInputElement>()

const session = computed<TimerSession | null>(() => (props.sessionId ? (timer.findSession(props.sessionId) ?? null) : null))
const draft = reactive({ activity: '', categoryId: null as string | null, notes: '', hours: 0, minutes: 0 })

watch(
  () => props.sessionId,
  async (id) => {
    const item = id ? timer.findSession(id) : null
    if (!item) return
    Object.assign(draft, {
      activity: item.activity,
      categoryId: item.categoryId && timer.categoryById.value.has(item.categoryId) ? item.categoryId : null,
      notes: item.notes,
      hours: Math.floor(item.duration / 3600),
      minutes: Math.round((item.duration % 3600) / 60),
    })
    await nextTick()
    activityInput.value?.focus()
  },
  { immediate: true },
)

/** No máximo o tempo entre o início e o fim (segundos). */
const maxSeconds = computed(() => (session.value ? Math.round((session.value.end - session.value.start) / 1000) : 0))
const draftSeconds = computed(() => Math.max(0, (Number(draft.hours) || 0) * 3600 + (Number(draft.minutes) || 0) * 60))
const tooLong = computed(() => draftSeconds.value > maxSeconds.value + 59)
const suggestions = computed(() => knownActivities(timer.state.sessions).slice(0, 60))

const when = computed(() => {
  const item = session.value
  if (!item) return ''
  const sameDay = toISODate(new Date(item.start)) === toISODate(new Date(item.end))
  return `${formatDateBR(toISODate(new Date(item.start)))}, ${formatTimeOfDay(item.start)} – ${sameDay ? '' : `${formatDateBR(toISODate(new Date(item.end)))}, `}${formatTimeOfDay(item.end)}`
})

function save() {
  const item = session.value
  if (!item || tooLong.value) return
  // Mesmo tempo de antes (em minutos): mantém os segundos medidos
  const unchanged = Math.round(item.duration / 60) === Math.round(draftSeconds.value / 60)
  timer.updateSession(item.id, {
    activity: draft.activity,
    categoryId: draft.categoryId,
    notes: draft.notes,
    duration: unchanged ? item.duration : Math.min(draftSeconds.value, maxSeconds.value),
  })
  emit('close')
}

function remove() {
  const id = session.value?.id
  emit('close')
  if (id) timer.deleteSession(id)
}

function showMentions() {
  const item = session.value
  emit('close')
  if (item) showMentionsOf(timerSessionSubject(item))
}

function useMeasured() {
  const seconds = session.value?.measured ?? 0
  draft.hours = Math.floor(seconds / 3600)
  draft.minutes = Math.round((seconds % 3600) / 60)
}
</script>

<template>
  <UiModal :open="!!session" :width="460" label="Editar sessão" @close="emit('close')">
    <form v-if="session" class="session-dialog" @submit.prevent="save">
      <header class="head">
        <span class="mode"><AppIcon :name="MODE_ICONS[session.mode]" :size="15" /> {{ MODE_LABELS[session.mode] }}</span>
        <span class="status" :class="session.status">{{ STATUS_LABELS[session.status] }}</span>
      </header>
      <p class="when">{{ when }}</p>
      <p class="facts">
        Medido: {{ formatDuration(session.measured * 1000) }}
        <template v-if="session.mode === 'pomodoro'">
          · {{ session.cycles }} {{ session.cycles === 1 ? 'ciclo' : 'ciclos' }} · pausas:
          {{ formatDuration(session.breaks * 1000, { seconds: false }) }}</template
        >
        <template v-if="session.mode === 'countdown' && session.target"> · definido: {{ formatDuration(session.target * 1000) }}</template>
      </p>

      <label class="field-label" for="session-activity">Atividade</label>
      <input
        id="session-activity"
        ref="activityInput"
        v-model="draft.activity"
        class="input"
        list="session-activities"
        maxlength="200"
        placeholder="Ex.: Estudando Godot"
        autocomplete="off"
      />
      <datalist id="session-activities">
        <option v-for="item in suggestions" :key="`${item.activity}|${item.categoryId}`" :value="item.activity" />
      </datalist>

      <span class="field-label gap">Categoria</span>
      <TimerCategoryPicker v-model="draft.categoryId" />

      <span class="field-label gap">Tempo válido</span>
      <div class="duration">
        <input v-model.number="draft.hours" class="input num" type="number" min="0" inputmode="numeric" aria-label="Horas" />
        <span>h</span>
        <input v-model.number="draft.minutes" class="input num" type="number" min="0" max="59" inputmode="numeric" aria-label="Minutos" />
        <span>min</span>
        <button
          v-if="session.status === 'canceled' || session.duration !== session.measured"
          type="button"
          class="btn btn-sm btn-ghost"
          @click="useMeasured"
        >
          Usar o tempo medido
        </button>
      </div>
      <p class="hint" :class="{ error: tooLong }">
        {{
          tooLong
            ? `No máximo ${formatDuration(maxSeconds * 1000, { seconds: false })} (do início ao fim).`
            : 'É o que conta nas estatísticas. Cancelada: 0, a não ser que você dê um tempo aqui.'
        }}
      </p>

      <label class="field-label gap" for="session-notes">Observações</label>
      <textarea id="session-notes" v-model="draft.notes" class="textarea" rows="3" placeholder="Detalhes da sessão (opcional)" />

      <div class="actions">
        <button type="button" class="btn btn-danger-ghost delete" @click="remove"><AppIcon name="trash" :size="15" /> Excluir</button>
        <button type="button" class="btn btn-ghost mentions" data-action="session-mentions" @click="showMentions">
          <AppIcon name="backlink" :size="15" /> Ver menções
        </button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Cancelar</button>
        <button type="submit" class="btn btn-primary" :disabled="tooLong">Salvar</button>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.session-dialog {
  display: flex;
  flex-direction: column;
  padding: 20px 22px 22px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.mode {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 650;
}
.status {
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--success-soft);
  color: var(--success);
  font-size: 11.5px;
  font-weight: 650;
}
.status.interrupted {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.status.canceled {
  background: var(--surface-3);
  color: var(--text-2);
}
.when {
  margin-top: 4px;
  font-size: 13px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.facts {
  margin: 2px 0 14px;
  font-size: 12.5px;
  color: var(--text-3);
}
.gap {
  margin-top: 14px;
}
.duration {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
}
.num {
  width: 72px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-3);
}
.hint.error {
  color: var(--danger);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
.delete {
  padding-left: 10px;
}
.mentions {
  margin-right: auto;
  padding-left: 10px;
}
</style>
