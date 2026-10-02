<script setup lang="ts">
/**
 * Pendentes e categorias. "Agendadas" e "Concluídas" são acessadas por links
 * discretos dentro da tela de Pendentes (ver pages/tasks.vue).
 */
import { computed, ref } from 'vue'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import type { Category } from '~/lib/tasks/model'
import { useTasksStore } from '~/stores/tasks'

const tasks = useTasksStore()
const dialogOpen = ref(false)
const editing = ref<Category | null>(null)

/** Agendadas e Concluídas são "subtelas" de Pendentes: o item continua destacado nelas. */
const pendingActive = computed(() => ['pending', 'scheduled', 'done'].includes(tasks.state.selection))
const pendingCount = computed(() => tasks.pendingTasks.value.length)
const uncategorized = computed(() => tasks.pendingCountByCategory.value.get('none') ?? 0)

function newCategory() {
  editing.value = null
  dialogOpen.value = true
}

function editCategory(category: Category) {
  editing.value = category
  dialogOpen.value = true
}

async function openMenu(category: Category) {
  const choice = await showContextMenu([{ id: 'edit', label: 'Editar…' }, separator, { id: 'delete', label: 'Excluir categoria…', danger: true }])
  if (choice === 'edit') editCategory(category)
  if (choice === 'delete') void tasks.requestDeleteCategory(category.id)
}

// Reordenar categorias arrastando
const dragIndex = ref<number | null>(null)
function onDrop(index: number) {
  if (dragIndex.value !== null) tasks.moveCategory(dragIndex.value, index)
  dragIndex.value = null
}
</script>

<template>
  <aside class="tasks-sidebar" aria-label="Listas de tarefas">
    <div class="group">
      <button class="nav-item" :class="{ active: pendingActive }" @click="tasks.select('pending')">
        <AppIcon name="inbox" :size="17" />
        <span class="nav-label">Pendentes</span>
        <Transition name="pop"><span v-if="pendingCount" :key="pendingCount" class="count">{{ pendingCount }}</span></Transition>
      </button>
    </div>

    <div class="group-head">
      <span class="section-label">Categorias</span>
      <button class="icon-btn sm" data-tip="Nova categoria" aria-label="Nova categoria" @click="newCategory"><AppIcon name="plus" :size="15" /></button>
    </div>
    <div class="group categories">
      <TransitionGroup name="cat">
        <button
          v-for="(category, index) in tasks.state.categories"
          :key="category.id"
          class="nav-item"
          :class="{ active: tasks.state.selection === `cat:${category.id}`, dragging: dragIndex === index }"
          draggable="true"
          @click="tasks.select(`cat:${category.id}`)"
          @dblclick="editCategory(category)"
          @contextmenu.prevent="openMenu(category)"
          @dragstart="dragIndex = index"
          @dragover.prevent
          @drop.prevent="onDrop(index)"
          @dragend="dragIndex = null"
        >
          <CategoryDot :color="category.color" />
          <span class="nav-label">{{ category.name }}</span>
          <span v-if="tasks.pendingCountByCategory.value.get(category.id)" class="count">{{ tasks.pendingCountByCategory.value.get(category.id) }}</span>
          <span class="item-actions">
            <span class="icon-btn sm" role="button" data-tip="Editar" aria-label="Editar categoria" @click.stop="editCategory(category)">
              <AppIcon name="edit" :size="13" />
            </span>
            <span
              class="icon-btn sm danger"
              role="button"
              data-tip="Excluir categoria"
              aria-label="Excluir categoria"
              @click.stop="tasks.requestDeleteCategory(category.id)"
            >
              <AppIcon name="trash" :size="13" />
            </span>
          </span>
        </button>
      </TransitionGroup>
      <button v-if="uncategorized" class="nav-item" :class="{ active: tasks.state.selection === 'cat:none' }" @click="tasks.select('cat:none')">
        <CategoryDot :color="null" />
        <span class="nav-label">Sem categoria</span>
        <span class="count">{{ uncategorized }}</span>
      </button>
      <button v-if="!tasks.state.categories.length" class="empty-cats" @click="newCategory">+ Criar a primeira categoria</button>
    </div>

    <footer class="sidebar-foot">
      <button class="foot-link" @click="tasks.revealFile()"><AppIcon name="folder" :size="13" /> tasks.json</button>
    </footer>

    <CategoryDialog :open="dialogOpen" :category="editing" @close="dialogOpen = false" @saved="(c) => tasks.select(`cat:${c.id}`)" />
  </aside>
</template>

<style scoped>
.tasks-sidebar {
  display: flex;
  flex-direction: column;
  width: 240px;
  flex: none;
  padding: 14px 10px 0;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
  overflow-y: auto;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 22px 4px 6px 10px;
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-2);
  font-size: 13.5px;
  font-weight: 550;
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}
.nav-item:hover {
  background: var(--hover);
  color: var(--text);
}
.nav-item.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
}
.nav-item.active > :deep(.app-icon) {
  color: var(--primary-text);
}
.nav-item.dragging {
  opacity: 0.4;
}
.nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  min-width: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 11.5px;
  font-weight: 650;
  line-height: 20px;
  text-align: center;
}
.nav-item.active .count {
  background: var(--accent);
  color: var(--on-accent);
}
.item-actions {
  display: none;
  gap: 1px;
  margin-right: -4px;
}
.categories .nav-item:hover .item-actions {
  display: flex;
}
.categories .nav-item:hover .count {
  display: none;
}
.empty-cats {
  margin-top: 4px;
  padding: 8px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-3);
  font-size: 12.5px;
  cursor: pointer;
}
.sidebar-foot {
  margin-top: auto;
  padding: 12px 10px;
}
.foot-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  padding: 0;
  color: var(--text-3);
  font-family: var(--font-mono);
  font-size: 11.5px;
  cursor: pointer;
}
.foot-link:hover {
  color: var(--primary-text);
}
@media (max-width: 880px) {
  .tasks-sidebar {
    width: 200px;
  }
}
.cat-enter-active,
.cat-leave-active {
  transition: opacity 200ms, transform 220ms var(--ease-out);
}
.cat-enter-from,
.cat-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
.cat-move {
  transition: transform 220ms var(--ease-out);
}
</style>
