<script setup lang="ts">
/** Histórico de conclusões, agrupado por dia. */
import { computed } from 'vue'
import { formatShortDate, relativeDayLabel } from '~/lib/dates'
import type { CompletedEntry } from '~/lib/tasks/model'
import { useTasksStore } from '~/stores/tasks'

const props = defineProps<{ categoryKey?: string | null }>()
const tasks = useTasksStore()

const groups = computed(() => {
  const entries = props.categoryKey ? tasks.completed.value.filter((e) => tasks.categoryKey(e.task) === props.categoryKey) : tasks.completed.value
  const map = new Map<string, CompletedEntry[]>()
  for (const entry of entries.slice(0, 400)) {
    if (!map.has(entry.day)) map.set(entry.day, [])
    map.get(entry.day)!.push(entry)
  }
  return [...map.entries()].map(([day, items]) => ({ day, label: relativeDayLabel(day, tasks.today.value), items }))
})

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const categoryOf = (entry: CompletedEntry) => (entry.task.categoryId ? (tasks.categoryById.value.get(entry.task.categoryId) ?? null) : null)
</script>

<template>
  <div class="completed">
    <section v-for="group in groups" :key="group.day" class="day">
      <h3 class="day-label">{{ group.label }}</h3>
      <TransitionGroup name="done-row" tag="div" class="rows">
        <div v-for="entry in group.items" :key="entry.key" class="row">
          <span class="check"><AppIcon name="check" :size="12" :stroke="2.6" /></span>
          <div class="body">
            <span class="title">{{ entry.task.title }}</span>
            <div class="meta">
              <span>{{ time(entry.at) }}</span>
              <span v-if="entry.recurring" class="recurring">
                <AppIcon name="repeat" :size="11" /> ocorrência de {{ entry.due ? formatShortDate(entry.due, tasks.today.value) : '—' }}
              </span>
              <span v-if="categoryOf(entry)" class="category"
                ><SharedCategoryIcon :id="categoryOf(entry)!.id" :color="categoryOf(entry)!.color" :name="categoryOf(entry)!.name" :size="13" /> {{ categoryOf(entry)!.name }}</span
              >
            </div>
          </div>
          <div v-if="!entry.recurring" class="actions">
            <button class="btn btn-sm btn-ghost reopen" aria-label="Reabrir" @click="tasks.reopen(entry.task.id)">
              <AppIcon name="undo" :size="14" /><span class="reopen-label"> Reabrir</span>
            </button>
            <button class="icon-btn sm danger" aria-label="Excluir" data-tip="Excluir" @click="tasks.deleteTask(entry.task.id)">
              <AppIcon name="trash" :size="14" />
            </button>
          </div>
        </div>
      </TransitionGroup>
    </section>
  </div>
</template>

<style scoped>
.day + .day {
  margin-top: 22px;
}
.day-label {
  margin: 0 0 6px 10px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.rows {
  position: relative;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px 9px 12px;
  border-radius: var(--r-lg);
  transition: background var(--t-fast);
}
.row:hover {
  background: var(--hover);
}
.check {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 50%;
  background: var(--primary-soft-2);
  color: var(--primary-text);
}
.body {
  flex: 1;
  min-width: 0;
}
.title {
  color: var(--text-2);
  text-decoration: line-through;
  text-decoration-color: var(--text-3);
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-3);
}
.meta > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.recurring {
  color: var(--primary-text);
}
.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--t-fast);
}
.row:hover .actions {
  opacity: 1;
}
/* Toque: sem "passar o mouse" — os botões ficam à vista (no celular, só os ícones) */
html[data-touch] .actions {
  opacity: 1;
}
html[data-layout='compact'] .reopen-label {
  display: none;
}
.done-row-leave-active {
  transition: opacity 180ms, transform 200ms;
  position: absolute;
  width: 100%;
}
.done-row-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
.done-row-move {
  transition: transform 220ms var(--ease-out);
}
</style>
