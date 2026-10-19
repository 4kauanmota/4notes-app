<script setup lang="ts">
/**
 * Módulo TAREFAS: categorias à esquerda, lista no centro, painel de edição à direita.
 * Clicar fora do painel (na lista, nas categorias…) fecha o painel.
 */
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import TaskDrawer from '~/components/tasks/TaskDrawer.vue'
import TaskQuickAdd from '~/components/tasks/TaskQuickAdd.vue'
import { confirmDialog } from '~/composables/useDialog'
import { useLayoutSize } from '~/composables/useLayoutSize'
import { hasOpenModal } from '~/composables/useModalStack'
import { registerShortcut, useShortcuts } from '~/composables/useShortcuts'
import { formatLongDate, relativeDayLabel } from '~/lib/dates'
import { canReveal } from '~/lib/platform'
import { groupByDate, type Task } from '~/lib/tasks/model'
import { useTasksStore } from '~/stores/tasks'

const tasks = useTasksStore()
const quickAdd = ref<InstanceType<typeof TaskQuickAdd>>()
const drawer = ref<InstanceType<typeof TaskDrawer>>()
const categoryDialog = ref(false)
const reveal = canReveal()

/** Celular (layout compact): as listas (Pendentes, categorias) ficam numa gaveta. */
const { isCompact } = useLayoutSize()
const listsOpen = ref(false)
// Escolheu uma lista na gaveta: ela fecha e mostra a lista escolhida
watch(
  () => tasks.state.selection,
  () => (listsOpen.value = false),
)

const selection = computed(() => tasks.state.selection)
const categoryKey = computed(() => (selection.value.startsWith('cat:') ? selection.value.slice(4) : null))
const category = computed(() => (categoryKey.value && categoryKey.value !== 'none' ? (tasks.categoryById.value.get(categoryKey.value) ?? null) : null))
const inCategory = (task: Task) => !categoryKey.value || tasks.categoryKey(task) === categoryKey.value

const pending = computed(() => tasks.pendingTasks.value.filter(inCategory))
const pendingGroups = computed(() => groupByDate(pending.value, tasks.today.value, tasks.tomorrow.value))
const scheduled = computed(() => tasks.scheduledTasks.value.filter(inCategory))
const scheduledGroups = computed(() => {
  const map = new Map<string, Task[]>()
  for (const task of scheduled.value) {
    const key = task.date!
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(task)
  }
  return [...map.entries()].map(([date, items]) => ({ key: date, label: relativeDayLabel(date, tasks.today.value), tasks: items }))
})
const doneOneOffs = computed(() => tasks.state.tasks.filter((task) => task.done && !task.recurrence).length)

const header = computed(() => {
  const today = formatLongDate(tasks.today.value)
  switch (selection.value) {
    case 'pending':
      return { title: 'Pendentes', subtitle: today.charAt(0).toUpperCase() + today.slice(1) }
    case 'scheduled':
      return { title: 'Agendadas', subtitle: 'Tarefas recorrentes aguardando a próxima data — elas voltam sozinhas para Pendentes.' }
    case 'done':
      return { title: 'Concluídas', subtitle: 'Histórico do que você já fez.' }
    default: {
      const count = pending.value.length
      return {
        title: category.value?.name ?? 'Sem categoria',
        subtitle: count ? `${count} ${count === 1 ? 'tarefa pendente' : 'tarefas pendentes'}` : 'Nenhuma tarefa pendente',
      }
    }
  }
})

const showQuickAdd = computed(() => selection.value === 'pending' || !!categoryKey.value)

async function clearCompleted() {
  const ok = await confirmDialog({
    title: 'Limpar tarefas concluídas?',
    message: `${doneOneOffs.value} ${doneOneOffs.value === 1 ? 'tarefa concluída será removida' : 'tarefas concluídas serão removidas'}. O histórico das recorrentes é mantido.`,
    confirmLabel: 'Limpar',
    danger: true,
  })
  if (ok) tasks.clearCompleted()
}

function newTask() {
  if (showQuickAdd.value) quickAdd.value?.focus()
  else tasks.openCreator()
}

useShortcuts({ 'mod+n': newTask })

// ── Clique fora do painel da tarefa fecha o painel (como no Mapa Mental) ─────

/** O clique começou fora do painel (arrastar para selecionar texto do painel não conta). */
let pressedOutside = false

function onPagePointerDown(event: PointerEvent) {
  pressedOutside = !!tasks.state.drawer && event.button === 0 && !drawer.value?.contains(event.target as Node | null)
}

function onPageClick(event: MouseEvent) {
  const outside = pressedOutside
  pressedOutside = false
  // detail 0 = "clique" do teclado (Enter/Espaço num botão): não é clicar fora
  if (!outside || event.detail === 0 || !tasks.state.drawer || drawer.value?.contains(event.target as Node | null) || drawer.value?.hasDraft()) return
  const current = tasks.state.drawer
  // O clique faz o que ele faz normalmente (concluir, trocar de categoria…). Se ele mesmo
  // mexeu no painel (abriu outra tarefa, "Nova tarefa"), o painel fica; senão, fecha.
  setTimeout(() => {
    if (tasks.state.drawer === current) tasks.closeDrawer()
  })
}

/**
 * O Esc é de algo aberto por cima do painel ou dentro dele: um diálogo (nova categoria),
 * a lista de notas para mencionar, a lista do "@" ou a tela cheia de um bloco da
 * descrição, o campo do endereço do link na barra de formatação.
 */
function escapeBelongsElsewhere(): boolean {
  if (hasOpenModal()) return true
  if (document.querySelector('.mention-picker, .code-fullscreen, .drawer .cm-tooltip-autocomplete')) return true
  return !!document.activeElement?.closest('.format-toolbar')
}

// Esc fecha o painel (também quando o foco está num campo)
let disposeEscape: (() => void) | null = null
const bindEscape = () => {
  disposeEscape ??= registerShortcut(
    'escape',
    () => {
      if (!tasks.state.drawer || escapeBelongsElsewhere()) return false
      tasks.closeDrawer()
    },
    { allowInInputs: true },
  )
}
const unbindEscape = () => {
  disposeEscape?.()
  disposeEscape = null
}
onMounted(bindEscape)
onActivated(bindEscape)
onDeactivated(unbindEscape)
onUnmounted(unbindEscape)
</script>

<template>
  <div class="tasks-page" @pointerdown.capture="onPagePointerDown" @click.capture="onPageClick">
    <MobileDrawer v-model:open="listsOpen" label="Listas de tarefas">
      <TasksSidebar />
    </MobileDrawer>
    <section class="tasks-main" :class="{ 'drawer-open': !!tasks.state.drawer }">
      <div v-if="tasks.state.error" class="tasks-error">
        <AppIcon name="alert" :size="34" />
        <h2>Não foi possível ler o arquivo de tarefas</h2>
        <p class="selectable">{{ tasks.state.error }}</p>
        <p class="muted">Nada foi sobrescrito. Corrija o arquivo <code>tasks/tasks.json</code> (ou restaure um backup de <code>.4notes/backups</code>) e tente de novo.</p>
        <div class="error-actions">
          <button class="btn btn-primary" @click="tasks.retry()">Tentar novamente</button>
          <button v-if="reveal" class="btn" @click="tasks.revealFile()">Mostrar arquivo</button>
        </div>
      </div>

      <template v-else>
        <div class="tasks-scroll">
          <div class="tasks-content module-content">
            <button v-if="selection === 'scheduled' || selection === 'done'" class="back-link" @click="tasks.select('pending')">
              <AppIcon name="arrow-left" :size="14" /> Pendentes
            </button>
            <header class="tasks-header">
              <button v-if="isCompact" class="icon-btn lists-toggle" aria-label="Listas e categorias" data-action="task-lists" @click="listsOpen = true">
                <AppIcon name="sidebar" :size="19" />
              </button>
              <div class="title-block">
                <h1>
                  <CategoryDot v-if="categoryKey" :color="category?.color ?? null" :size="12" />
                  {{ header.title }}
                </h1>
                <p>{{ header.subtitle }}</p>
              </div>
              <div class="header-side">
                <div v-if="selection === 'pending' && tasks.progress.value.total" class="progress-block" data-tip="Concluídas hoje">
                  <ProgressRing :value="tasks.progress.value.done" :total="tasks.progress.value.total" />
                  <div class="progress-text">
                    <strong>{{ tasks.progress.value.done }}/{{ tasks.progress.value.total }}</strong>
                    <span>hoje</span>
                  </div>
                </div>
                <button v-if="category" class="btn btn-sm btn-ghost" @click="categoryDialog = true"><AppIcon name="edit" :size="14" /> Editar</button>
                <button v-if="selection === 'done' && doneOneOffs" class="btn btn-sm" @click="clearCompleted"><AppIcon name="trash" :size="14" /> Limpar concluídas</button>
                <button class="btn btn-sm btn-primary new-task" aria-label="Nova tarefa" @click="tasks.openCreator()">
                  <AppIcon name="plus" :size="15" /><span class="new-task-label"> Nova tarefa</span>
                </button>
              </div>
            </header>

            <TaskQuickAdd v-if="showQuickAdd" ref="quickAdd" :category-id="category?.id ?? null" class="quick-add-slot" />

            <!-- Concluídas -->
            <template v-if="selection === 'done'">
              <CompletedList v-if="tasks.completed.value.length" />
              <TasksEmpty v-else icon="done" title="Nada concluído ainda" text="Quando você concluir uma tarefa, ela aparece aqui." />
            </template>

            <!-- Agendadas -->
            <template v-else-if="selection === 'scheduled'">
              <TransitionGroup name="section" tag="div">
                <section v-for="group in scheduledGroups" :key="group.key" class="group">
                  <h3 class="group-label">{{ group.label }}</h3>
                  <TransitionGroup name="task" tag="div" class="group-list">
                    <TaskItem v-for="task in group.tasks" :key="task.id" :task="task" mode="scheduled" show-category />
                  </TransitionGroup>
                </section>
              </TransitionGroup>
              <TasksEmpty
                v-if="!scheduled.length"
                icon="clock"
                title="Nenhuma tarefa aguardando"
                text="Tarefas recorrentes concluídas ficam aqui até a próxima data e então voltam sozinhas para Pendentes."
              />
            </template>

            <!-- Pendentes / categoria -->
            <template v-else>
              <TransitionGroup name="section" tag="div">
                <section v-for="group in pendingGroups" :key="group.key" class="group" :class="`group-${group.key}`">
                  <h3 class="group-label">
                    {{ group.label }}
                    <span class="group-count">{{ group.tasks.length }}</span>
                  </h3>
                  <TransitionGroup name="task" tag="div" class="group-list">
                    <TaskItem v-for="task in group.tasks" :key="task.id" :task="task" :show-category="!categoryKey" />
                  </TransitionGroup>
                </section>
              </TransitionGroup>
              <TasksEmpty
                v-if="!pending.length"
                icon="check"
                celebrate
                :title="categoryKey ? 'Nada pendente aqui' : 'Tudo em dia!'"
                :text="categoryKey ? 'Adicione uma tarefa acima.' : 'Nenhuma tarefa pendente. Adicione uma acima ou aproveite o dia.'"
              />
              <section v-if="categoryKey && scheduled.length" class="group group-scheduled">
                <h3 class="group-label"><AppIcon name="clock" :size="13" /> Agendadas <span class="group-count">{{ scheduled.length }}</span></h3>
                <TransitionGroup name="task" tag="div" class="group-list">
                  <TaskItem v-for="task in scheduled" :key="task.id" :task="task" mode="scheduled" />
                </TransitionGroup>
              </section>
              <!-- Acesso discreto às tarefas agendadas e às concluídas -->
              <footer v-if="selection === 'pending'" class="more-links">
                <button class="more-link" @click="tasks.select('scheduled')">
                  <AppIcon name="clock" :size="13" /> Ver tarefas agendadas<template v-if="scheduled.length"> ({{ scheduled.length }})</template>
                </button>
                <button class="more-link faint" @click="tasks.select('done')">Ver concluídas</button>
              </footer>
            </template>
          </div>
        </div>
        <TaskDrawer ref="drawer" />
      </template>
    </section>
    <CategoryDialog :open="categoryDialog" :category="category" @close="categoryDialog = false" />
  </div>
</template>

<style scoped>
.tasks-page {
  display: flex;
  height: 100%;
}
.tasks-main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.tasks-scroll {
  flex: 1;
  overflow-y: auto;
  transition: padding-right 320ms var(--ease-out);
}
/* Em janelas largas, a lista "abre espaço" para o painel (420 px, TaskDrawer.vue) em vez de ficar por baixo dele */
@media (min-width: 1240px) {
  .tasks-main.drawer-open .tasks-scroll {
    padding-right: 420px;
  }
}
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: -6px 0 10px -6px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-3);
  font-size: 12.5px;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}
.back-link:hover {
  background: var(--hover);
  color: var(--text);
}
.more-links {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-top: 26px;
  padding: 0 10px;
}
.more-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  border: none;
  background: none;
  color: var(--text-3);
  font-size: 12.5px;
  cursor: pointer;
  transition: color var(--t-fast);
}
.more-link:hover {
  color: var(--primary-text);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.more-link.faint {
  font-size: 12px;
  opacity: 0.8;
}
.tasks-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.title-block h1 {
  display: flex;
  align-items: center;
  gap: 10px;
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
.header-side {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.progress-block {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 6px;
}
.progress-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.progress-text strong {
  font-size: 14px;
}
.progress-text span {
  font-size: 11.5px;
  color: var(--text-3);
}
.quick-add-slot {
  margin-bottom: 22px;
}
.group {
  margin-bottom: 18px;
}
.group-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 4px 10px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.group-overdue .group-label {
  color: var(--danger);
}
.group-today .group-label {
  color: var(--accent-text);
}
.group-scheduled {
  margin-top: 28px;
  padding-top: 14px;
  border-top: 1px dashed var(--border-strong);
}
.group-count {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 11px;
  line-height: 18px;
}
.group-list {
  position: relative;
}
.tasks-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  padding: 32px;
  text-align: center;
  color: var(--text-2);
}
.tasks-error > :deep(.app-icon) {
  color: var(--danger);
}
.tasks-error h2 {
  color: var(--text);
  font-family: var(--font-display);
  font-size: 19px;
}
.tasks-error code {
  font-family: var(--font-mono);
  font-size: 0.9em;
}
.error-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

/* Animações da lista */
.task-enter-active {
  transition: opacity 260ms var(--ease-out), transform 300ms var(--ease-spring);
}
.task-leave-active {
  transition: opacity 220ms ease, transform 260ms var(--ease-out);
  position: absolute;
  left: 0;
  right: 0;
}
.task-enter-from {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}
.task-leave-to {
  opacity: 0;
  transform: translateX(28px);
}
.task-move {
  transition: transform 300ms var(--ease-out);
}
.section-enter-active,
.section-leave-active {
  transition: opacity 220ms var(--ease-out);
}
.section-enter-from,
.section-leave-to {
  opacity: 0;
}

@media (max-width: 980px) {
  .progress-block {
    display: none;
  }
}

/* ── Celular ── */
.lists-toggle {
  flex: none;
  margin: 0 -2px 0 -8px;
}
html[data-layout='compact'] .tasks-header {
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
html[data-layout='compact'] .title-block {
  flex: 1;
  min-width: 0;
}
html[data-layout='compact'] .title-block h1 {
  font-size: 22px;
}
html[data-layout='compact'] .title-block h1,
html[data-layout='compact'] .title-block p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
html[data-layout='compact'] .header-side {
  gap: 6px;
}
/* Só o + (o nome cabe no botão do painel) */
html[data-layout='compact'] .new-task {
  width: 40px;
  padding: 0;
  justify-content: center;
}
html[data-layout='compact'] .new-task-label {
  display: none;
}
</style>
