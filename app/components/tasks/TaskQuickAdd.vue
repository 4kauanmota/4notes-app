<script setup lang="ts">
/**
 * Campo rápido para adicionar tarefas. Entende alguns atalhos no texto:
 *   "Estudar Godot amanhã #estudos"  → data = amanhã, categoria = Estudos
 *   "Revisar @ideias"                → menciona a nota "Ideias" (escolhida na lista)
 * "Mais opções" abre o painel completo já preenchido com o que foi digitado.
 */
import { computed, ref } from 'vue'
import { useMentionTrigger, type MentionPickerControls } from '~/composables/useMentionTrigger'
import { addDays, relativeDayLabel, type ISODate } from '~/lib/dates'
import { refKey, type NoteRef } from '~/lib/tasks/mentions'
import { useTasksStore, withMention } from '~/stores/tasks'

const props = defineProps<{ categoryId: string | null }>()
const tasks = useTasksStore()
// O texto fica no store: o painel "Mais opções" limpa a barra quando a tarefa é criada por lá.
const text = computed({
  get: () => tasks.state.quickAddText,
  set: (value: string) => (tasks.state.quickAddText = value),
})
const input = ref<HTMLInputElement>()
const flash = ref(false)
const picker = ref<MentionPickerControls>()

const mention = useMentionTrigger({
  getText: () => text.value,
  setText: (value) => (text.value = value),
  element: () => input.value,
  onPick: (item) => (tasks.state.quickAddMentions = withMention(tasks.state.quickAddMentions, item)),
})
const mentionQuery = mention.query

function removeMention(item: NoteRef) {
  tasks.state.quickAddMentions = tasks.state.quickAddMentions.filter((other) => refKey(other) !== refKey(item))
}

function onKeydown(event: KeyboardEvent) {
  if (mention.onKeydown(event, picker.value)) return
  if (event.key === 'Escape') {
    text.value = ''
    tasks.state.quickAddMentions = []
  }
}

function fold(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const parsed = computed(() => {
  let title = text.value.trim()
  let date: ISODate | null = null
  let categoryId = props.categoryId

  const tag = /(?:^|\s)#([\p{L}\p{N}_-]+)\s*$/u.exec(title)
  if (tag) {
    const match = tasks.state.categories.find((c) => fold(c.name).replace(/\s+/g, '') === fold(tag[1]!))
    if (match) {
      categoryId = match.id
      title = title.slice(0, tag.index).trim()
    }
  }
  const day = /\s(hoje|amanh[ãa])$/i.exec(title)
  if (day) {
    date = /hoje/i.test(day[1]!) ? tasks.today.value : addDays(tasks.today.value, 1)
    title = title.slice(0, day.index).trim()
  }
  return { title, date, categoryId }
})

const category = computed(() => (parsed.value.categoryId ? (tasks.categoryById.value.get(parsed.value.categoryId) ?? null) : null))

function submit() {
  const { title, date, categoryId } = parsed.value
  if (!title) return
  tasks.addTask({ title, date, categoryId, mentions: tasks.state.quickAddMentions })
  text.value = ''
  tasks.state.quickAddMentions = []
  flash.value = true
  setTimeout(() => (flash.value = false), 400)
}

/** Abre o painel completo com o título, a data e a categoria já reconhecidos no texto. */
function moreOptions() {
  const { title, date, categoryId } = parsed.value
  tasks.openCreator({ title, date, categoryId, mentions: [...tasks.state.quickAddMentions] }, { fromQuickAdd: true })
}

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <form class="quick-add" :class="{ flash }" @submit.prevent="submit">
    <input
      ref="input"
      v-model="text"
      class="qa-input"
      placeholder="Adicionar tarefa…  (ex.: Revisar @ideias amanhã #estudos)"
      spellcheck="true"
      aria-label="Nova tarefa"
      @input="mention.onInput()"
      @keydown="onKeydown"
    />
    <TransitionGroup name="pop" tag="span" class="qa-chips">
      <span v-if="parsed.date" key="date" class="qa-chip"><AppIcon name="calendar" :size="12" /> {{ relativeDayLabel(parsed.date, tasks.today.value) }}</span>
      <span v-if="category" key="cat" class="qa-chip"><CategoryDot :color="category.color" :size="7" /> {{ category.name }}</span>
      <MentionChip v-for="item in tasks.state.quickAddMentions" :key="refKey(item)" :mention="item" removable @remove="removeMention(item)" />
    </TransitionGroup>
    <button type="button" class="icon-btn qa-more" data-tip="Mais opções (data, recorrência…)" aria-label="Mais opções" @click="moreOptions">
      <AppIcon name="settings" :size="16" />
    </button>
    <NotePicker
      v-if="mentionQuery !== null && input"
      ref="picker"
      :anchor="input"
      :query="mentionQuery"
      :exclude="tasks.state.quickAddMentions"
      @pick="mention.pick"
      @close="mention.close()"
    />
  </form>
</template>

<style scoped>
.quick-add {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 8px 0 16px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-2);
  transition: border-color var(--t-fast), box-shadow var(--t-fast), background var(--t-fast), transform var(--t-med) var(--ease-spring);
}
.quick-add:focus-within {
  border-color: var(--primary);
  background: var(--surface);
  box-shadow: var(--focus-ring);
}
.quick-add.flash {
  transform: scale(0.99);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.qa-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14px;
}
.qa-input::placeholder {
  color: var(--text-3);
}
.qa-chips {
  display: flex;
  gap: 6px;
}
.qa-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
}
</style>
