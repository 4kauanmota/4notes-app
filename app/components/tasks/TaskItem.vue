<script setup lang="ts">
/** Uma linha da lista de tarefas. Clique abre o painel de edição; o círculo conclui. */
import { computed, ref } from 'vue'
import { separator, showContextMenu, type MenuItemSpec } from '~/composables/useContextMenu'
import { paletteVar } from '~/lib/colors'
import { formatDateBR, relativeDayLabel } from '~/lib/dates'
import { refKey } from '~/lib/mentions/refs'
import type { Task } from '~/lib/tasks/model'
import { describeRecurrence } from '~/lib/tasks/recurrence'
import { descriptionPreview } from '~/lib/tasks/description'
import { useCategoriesStore } from '~/stores/categories'
import { useTasksStore } from '~/stores/tasks'

const props = defineProps<{ task: Task; showCategory?: boolean; mode?: 'pending' | 'scheduled' }>()
const tasks = useTasksStore()
const shared = useCategoriesStore()
const completing = ref(false)

const category = computed(() => (props.task.categoryId ? (tasks.categoryById.value.get(props.task.categoryId) ?? null) : null))
const selected = computed(() => tasks.state.drawer?.mode === 'edit' && tasks.state.drawer.id === props.task.id)

const dateInfo = computed(() => {
  const date = props.task.date
  if (!date) return null
  const today = tasks.today.value
  const label = relativeDayLabel(date, today)
  const tone = date < today ? 'overdue' : date === today ? 'today' : 'future'
  return { label: props.mode === 'scheduled' ? `Volta ${label === 'Amanhã' ? 'amanhã' : `em ${label.toLowerCase()}`}` : label, tone, full: formatDateBR(date) }
})

const recurrenceLabel = computed(() => (props.task.recurrence ? describeRecurrence(props.task.recurrence) : null))
/** Primeira linha da descrição, como aparece no editor (sem **, listas como •, menções pelo título). */
const notesPreview = computed(() => (props.task.notes.trim() ? descriptionPreview(props.task.notes) : ''))

function complete() {
  if (completing.value) return
  completing.value = true
  // Deixa a animação do "check" aparecer antes de a tarefa sair da lista
  setTimeout(() => {
    tasks.complete(props.task.id)
    completing.value = false
  }, 430)
}

async function openMenu() {
  const others = shared.availableFor('tasks')
  const moveTo: MenuItemSpec[] = [
    { id: 'cat:', label: 'Sem categoria', type: 'radio', checked: !props.task.categoryId },
    ...tasks.state.categories.map((c) => ({
      id: `cat:${c.id}`,
      label: c.name,
      type: 'radio' as const,
      checked: props.task.categoryId === c.id,
      swatch: paletteVar(c.color),
    })),
    // Categorias do app que ainda não estão nas Tarefas (1.7.0)
    ...(others.length
      ? [separator, { label: 'Outras categorias', submenu: others.map((c) => ({ id: `cat-attach:${c.id}`, label: c.name, swatch: paletteVar(c.color) })) }]
      : []),
  ]
  const choice = await showContextMenu([
    { id: 'edit', label: 'Editar…' },
    { id: 'complete', label: props.task.recurrence ? 'Concluir esta ocorrência' : 'Concluir' },
    ...(props.task.recurrence ? [{ id: 'skip', label: 'Pular esta ocorrência' }] : []),
    { label: 'Mover para', submenu: moveTo },
    separator,
    { id: 'delete', label: 'Excluir', danger: true },
  ])
  if (!choice) return
  if (choice === 'edit') tasks.openEditor(props.task.id)
  else if (choice === 'complete') complete()
  else if (choice === 'skip') tasks.skip(props.task.id)
  else if (choice === 'delete') tasks.deleteTask(props.task.id)
  else if (choice.startsWith('cat:')) tasks.updateTask(props.task.id, { categoryId: choice.slice(4) || null })
  else if (choice.startsWith('cat-attach:')) {
    const category = tasks.attachCategory(choice.slice('cat-attach:'.length))
    if (category) tasks.updateTask(props.task.id, { categoryId: category.id })
  }
}
</script>

<template>
  <div
    class="task"
    :class="{ completing, selected }"
    role="button"
    tabindex="0"
    :data-task="task.id"
    @click="tasks.openEditor(task.id)"
    @keydown.enter.self="tasks.openEditor(task.id)"
    @keydown.space.self.prevent="complete"
    @contextmenu.prevent="openMenu"
  >
    <TaskCheckbox :checked="completing" :color="category?.color" :recurring="!!task.recurrence" @toggle="complete" />
    <div class="task-body">
      <div class="task-title">{{ task.title }}</div>
      <div v-if="notesPreview" class="task-notes">{{ notesPreview }}</div>
      <div v-if="dateInfo || recurrenceLabel || (showCategory && category) || task.mentions.length" class="task-meta">
        <span v-if="dateInfo" class="meta date" :class="dateInfo.tone" :title="dateInfo.full">
          <AppIcon name="calendar" :size="12" /> {{ dateInfo.label }}
        </span>
        <span v-if="recurrenceLabel" class="meta recurrence"><AppIcon name="repeat" :size="12" /> {{ recurrenceLabel }}</span>
        <span v-if="showCategory && category" class="meta category" :data-task-category="category.id"
          ><SharedCategoryIcon :id="category.id" :color="category.color" :name="category.name" :size="14" /> {{ category.name }}</span
        >
        <MentionChip v-for="mention in task.mentions" :key="refKey(mention)" :mention="mention" class="meta-mention" />
      </div>
    </div>
    <div class="task-actions">
      <button v-if="task.recurrence" class="icon-btn sm" data-tip="Pular ocorrência" aria-label="Pular ocorrência" @click.stop="tasks.skip(task.id)">
        <AppIcon name="skip" :size="14" />
      </button>
      <button class="icon-btn sm danger" data-tip="Excluir" aria-label="Excluir tarefa" @click.stop="tasks.deleteTask(task.id)">
        <AppIcon name="trash" :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.task {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px 10px 10px;
  border-radius: var(--r-lg);
  cursor: pointer;
  transition: background var(--t-fast), box-shadow var(--t-fast);
}
html[data-touch] .task {
  padding: 12px 12px 12px 10px;
}
.task:hover {
  background: var(--hover);
}
.task.selected {
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 30%, transparent);
}
.task :deep(.task-checkbox) {
  margin-top: -2px;
}
.task-body {
  flex: 1;
  min-width: 0;
}
.task-title {
  position: relative;
  display: inline;
  font-size: 14px;
  line-height: 1.45;
  color: var(--text);
  overflow-wrap: anywhere;
  background-image: linear-gradient(var(--text-3), var(--text-3));
  background-repeat: no-repeat;
  background-position: 0 55%;
  background-size: 0 1.5px;
  transition: background-size 320ms var(--ease-out), color 320ms;
}
.completing .task-title {
  background-size: 100% 1.5px;
  color: var(--text-3);
}
.task-notes {
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--text-3);
}
.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 4px;
}
.meta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-3);
}
.meta.date.today {
  color: var(--accent-text);
  font-weight: 600;
}
.meta.date.overdue {
  color: var(--danger);
  font-weight: 600;
}
.meta.recurrence {
  color: var(--primary-text);
}
.task-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--t-fast);
}
.task:hover .task-actions,
.task:focus-within .task-actions {
  opacity: 1;
}
/* Toque: pular e excluir ficam no toque prolongado (botões invisíveis não podem receber o toque) */
html[data-touch] .task-actions {
  display: none;
}
</style>
