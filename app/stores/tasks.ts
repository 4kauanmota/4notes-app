/**
 * Estado do módulo TAREFAS.
 *
 * Os dados ficam em tasks/tasks.json. As regras (concluir, recorrência,
 * agrupamento) estão em lib/tasks/*.ts — aqui só conectamos essas regras à
 * interface e ao disco. As tarefas podem mencionar itens de todos os módulos
 * (lib/mentions/refs.ts); quem lista, abre e acompanha renomeações é o stores/mentions.ts.
 */
import { computed, reactive } from 'vue'
import { errorMessage } from '#shared/ipc'
import { confirmDialog } from '~/composables/useDialog'
import { useToday } from '~/composables/useToday'
import { notifyError, showToast } from '~/composables/useToasts'
import { formatShortDate, type ISODate } from '~/lib/dates'
import {
  categoryIdFor,
  compareTasks,
  completedEntries,
  completeTask,
  createTask,
  isPending,
  isScheduled,
  normalizeTasksFile,
  reopenTask,
  serializeTasks,
  skipOccurrence,
  todayProgress,
  type Category,
  type CategoryColor,
  type NewTaskInput,
  type Task,
} from '~/lib/tasks/model'
import { refKey, renamedRef, type MentionRef } from '~/lib/mentions/refs'
import type { NoteChange } from '~/lib/note-events'
import { clampInterval, type Recurrence } from '~/lib/tasks/recurrence'
import { tasksRepository as repo } from '~/lib/tasks/repository'
import { debounce, SerialQueue } from '~/lib/utils/async'

export type TaskSelection = 'pending' | 'scheduled' | 'done' | `cat:${string}`

/** Valores iniciais do painel "Nova tarefa" (ex.: vindos da barra de criação rápida). */
export interface TaskPrefill {
  title?: string
  date?: ISODate | null
  categoryId?: string | null
  mentions?: MentionRef[]
}

export type DrawerState = null | { mode: 'edit'; id: string } | { mode: 'create'; prefill: TaskPrefill; fromQuickAdd: boolean }

const { today, tomorrow } = useToday()

const state = reactive({
  loaded: false,
  /** Preenchido quando o tasks.json não pôde ser lido: nada é gravado até resolver. */
  error: null as string | null,
  categories: [] as Category[],
  tasks: [] as Task[],
  selection: 'pending' as TaskSelection,
  drawer: null as DrawerState,
  /** Texto da barra de criação rápida (fica aqui para o painel "Mais opções" poder usá-lo). */
  quickAddText: '',
  /** Notas mencionadas com @ na barra de criação rápida. */
  quickAddMentions: [] as MentionRef[],
})

let lastRaw: string | null = null
const queue = new SerialQueue()

function persist(): Promise<void> {
  return queue
    .run('tasks', async () => {
      if (state.error) return
      const raw = serializeTasks({ categories: state.categories, tasks: state.tasks })
      if (raw === lastRaw) return
      await repo.save(raw)
      lastRaw = raw
    })
    .catch((error) => notifyError(`Não foi possível salvar as tarefas: ${errorMessage(error)}`, error))
}

const scheduleSave = debounce(() => void persist(), 250)

async function flush(): Promise<void> {
  scheduleSave.flush()
  await queue.idle()
}

// ── Carregamento ────────────────────────────────────────────────────────────

async function load(): Promise<void> {
  try {
    const result = await repo.load()
    if (result.status === 'invalid') {
      state.error = result.error
    } else {
      state.categories = result.data.categories
      state.tasks = result.data.tasks
      lastRaw = result.raw
      state.error = null
      void repo.backup(result.raw).catch((error) => console.warn('[4notes] Backup das tarefas falhou:', error))
    }
  } catch (error) {
    state.error = errorMessage(error)
  }
  state.loaded = true
}

/** Recarrega se o tasks.json foi editado fora do app (chamado ao focar a janela). */
async function refreshFromDisk(): Promise<void> {
  if (!state.loaded || scheduleSave.pending() || queue.busy) return
  const raw = await repo.readRaw().catch(() => undefined)
  if (raw === undefined || raw === lastRaw) return
  if (raw === null) {
    // Arquivo apagado fora do app: recria com o que está na memória.
    if (!state.error) {
      lastRaw = null
      void persist()
    }
    return
  }
  try {
    const data = normalizeTasksFile(JSON.parse(raw))
    state.categories = data.categories
    state.tasks = data.tasks
    lastRaw = raw
    state.error = null
    if (state.drawer?.mode === 'edit' && !findTask(state.drawer.id)) state.drawer = null
  } catch (error) {
    state.error = `O arquivo tasks.json foi alterado fora do app e agora contém um erro (${errorMessage(error)}).`
  }
}

// ── Consultas ───────────────────────────────────────────────────────────────

function findTask(id: string): Task | undefined {
  return state.tasks.find((task) => task.id === id)
}

const categoryById = computed(() => new Map(state.categories.map((category) => [category.id, category])))
const pendingTasks = computed(() => state.tasks.filter((task) => isPending(task, today.value)))
const scheduledTasks = computed(() => state.tasks.filter((task) => isScheduled(task, today.value)).sort(compareTasks))
const completed = computed(() => completedEntries(state.tasks))
const progress = computed(() => todayProgress(state.tasks, today.value))

/** Chave da categoria de uma tarefa ("none" quando não tem ou a categoria não existe). */
function categoryKey(task: Task): string {
  return task.categoryId && categoryById.value.has(task.categoryId) ? task.categoryId : 'none'
}

const pendingCountByCategory = computed(() => {
  const counts = new Map<string, number>()
  for (const task of pendingTasks.value) counts.set(categoryKey(task), (counts.get(categoryKey(task)) ?? 0) + 1)
  return counts
})

// ── Ações: tarefas ──────────────────────────────────────────────────────────

/** Cópia independente (as tarefas são JSON puro). */
function cloneTask(task: Task): Task {
  return JSON.parse(JSON.stringify(task)) as Task
}

function touch(task: Task): void {
  task.updatedAt = new Date().toISOString()
  scheduleSave()
}

function replaceTask(id: string, next: Task): void {
  const index = state.tasks.findIndex((task) => task.id === id)
  if (index >= 0) state.tasks.splice(index, 1, next)
  scheduleSave()
}

function addTask(input: NewTaskInput): Task {
  const task = createTask(input, today.value)
  state.tasks.push(task)
  scheduleSave()
  return task
}

function updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'notes' | 'categoryId' | 'mentions'>>): void {
  const task = findTask(id)
  if (!task) return
  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (!title) return
    task.title = title
  }
  if (patch.notes !== undefined) task.notes = patch.notes
  if (patch.categoryId !== undefined) task.categoryId = patch.categoryId
  if (patch.mentions !== undefined) task.mentions = patch.mentions
  touch(task)
}

/** Acrescenta uma menção (sem repetir o mesmo item). */
export function withMention(list: MentionRef[], ref: MentionRef): MentionRef[] {
  return list.some((item) => refKey(item) === refKey(ref)) ? list : [...list, ref]
}

/**
 * Troca menções das tarefas (renomeações, endereço novo de um link salvo): `transform`
 * devolve a menção nova, ou null quando ela fica como está.
 */
function updateMentions(transform: (ref: MentionRef) => MentionRef | null): void {
  for (const task of state.tasks) {
    let changed = false
    const next = task.mentions.map((ref) => {
      const updated = transform(ref)
      if (updated) changed = true
      return updated ?? ref
    })
    if (!changed) continue
    task.mentions = next
    scheduleSave()
  }
  state.quickAddMentions = state.quickAddMentions.map((ref) => transform(ref) ?? ref)
}

/** Uma nota, categoria ou mapa mudou de nome: as menções passam a apontar para o nome novo. */
function applyNoteChange(change: NoteChange, titleOf?: (ref: MentionRef) => string | null): void {
  updateMentions((ref) => {
    const next = renamedRef(ref, change)
    if (!next) return null
    const title = titleOf?.(next)
    return title ? { ...next, title } : next
  })
}

/** Muda a data. Em tarefas recorrentes, a data é a "próxima ocorrência" e vira a nova âncora da série. */
function setTaskDate(id: string, date: ISODate | null): void {
  const task = findTask(id)
  if (!task) return
  if (task.recurrence) {
    const next = date ?? today.value
    task.date = next
    task.recurrence = { ...task.recurrence, anchor: next }
  } else {
    task.date = date
  }
  touch(task)
}

function setRecurrence(id: string, rule: Omit<Recurrence, 'anchor'> | null): void {
  const task = findTask(id)
  if (!task) return
  if (!rule) {
    task.recurrence = null
  } else {
    const date = task.date ?? today.value
    task.date = date
    task.recurrence = { interval: clampInterval(rule.interval), unit: rule.unit, basis: rule.basis, anchor: date }
    task.done = false
    task.completedAt = null
  }
  touch(task)
}

function complete(id: string): void {
  const task = findTask(id)
  if (!task) return
  const before = cloneTask(task)
  const updated = completeTask(task, today.value)
  replaceTask(id, updated)
  showToast({
    message: updated.recurrence && updated.date ? `Concluída! Volta em ${formatShortDate(updated.date, today.value)}` : 'Tarefa concluída',
    tone: 'success',
    icon: 'check',
    action: { label: 'Desfazer', run: () => replaceTask(id, before) },
  })
}

function reopen(id: string): void {
  const task = findTask(id)
  if (task) replaceTask(id, reopenTask(task))
}

function skip(id: string): void {
  const task = findTask(id)
  if (!task?.recurrence) return
  const before = cloneTask(task)
  const updated = skipOccurrence(task, today.value)
  replaceTask(id, updated)
  showToast({
    message: `Ocorrência pulada. Próxima: ${formatShortDate(updated.date!, today.value)}`,
    icon: 'skip',
    action: { label: 'Desfazer', run: () => replaceTask(id, before) },
  })
}

function deleteTask(id: string): void {
  const index = state.tasks.findIndex((task) => task.id === id)
  if (index < 0) return
  const [removed] = state.tasks.splice(index, 1)
  if (state.drawer?.mode === 'edit' && state.drawer.id === id) state.drawer = null
  scheduleSave()
  showToast({
    message: `“${removed!.title}” excluída`,
    icon: 'trash',
    action: {
      label: 'Desfazer',
      run: () => {
        state.tasks.splice(Math.min(index, state.tasks.length), 0, removed!)
        scheduleSave()
      },
    },
  })
}

function clearCompleted(): void {
  const removed = state.tasks.filter((task) => task.done && !task.recurrence)
  if (!removed.length) return
  state.tasks = state.tasks.filter((task) => !removed.includes(task))
  scheduleSave()
  showToast({
    message: `${removed.length} ${removed.length === 1 ? 'tarefa removida' : 'tarefas removidas'}`,
    icon: 'trash',
    action: {
      label: 'Desfazer',
      run: () => {
        state.tasks.push(...removed)
        scheduleSave()
      },
    },
  })
}

// ── Ações: categorias ───────────────────────────────────────────────────────

function addCategory(name: string, color: CategoryColor): Category {
  const category: Category = {
    id: categoryIdFor(name, (id) => categoryById.value.has(id)),
    name: name.trim(),
    color,
    createdAt: new Date().toISOString(),
  }
  state.categories.push(category)
  scheduleSave()
  return category
}

function updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'color'>>): void {
  const category = categoryById.value.get(id)
  if (!category) return
  if (patch.name?.trim()) category.name = patch.name.trim()
  if (patch.color) category.color = patch.color
  scheduleSave()
}

function deleteCategory(id: string): void {
  for (const task of state.tasks) if (task.categoryId === id) task.categoryId = null
  state.categories = state.categories.filter((category) => category.id !== id)
  if (state.selection === `cat:${id}`) state.selection = 'pending'
  scheduleSave()
}

/** Pede confirmação e exclui a categoria (as tarefas dela ficam sem categoria). */
async function requestDeleteCategory(id: string): Promise<boolean> {
  const category = categoryById.value.get(id)
  if (!category) return false
  const count = state.tasks.filter((task) => task.categoryId === id).length
  const ok = await confirmDialog({
    title: `Excluir a categoria “${category.name}”?`,
    message: count
      ? `${count} ${count === 1 ? 'tarefa ficará' : 'tarefas ficarão'} sem categoria. Nenhuma tarefa será apagada.`
      : 'Nenhuma tarefa usa esta categoria.',
    confirmLabel: 'Excluir categoria',
    danger: true,
  })
  if (ok) deleteCategory(id)
  return ok
}

function moveCategory(from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= state.categories.length || to >= state.categories.length) return
  const [category] = state.categories.splice(from, 1)
  state.categories.splice(to, 0, category!)
  scheduleSave()
}

// ── Interface ───────────────────────────────────────────────────────────────

function select(selection: TaskSelection): void {
  state.selection = selection
}

function openEditor(id: string): void {
  state.drawer = { mode: 'edit', id }
}

function openCreator(prefill: TaskPrefill = {}, options: { fromQuickAdd?: boolean } = {}): void {
  state.drawer = { mode: 'create', prefill, fromQuickAdd: options.fromQuickAdd === true }
}

function closeDrawer(): void {
  state.drawer = null
}

async function retry(): Promise<void> {
  state.error = null
  await load()
}

export function useTasksStore() {
  return {
    state,
    today,
    tomorrow,
    categoryById,
    pendingTasks,
    scheduledTasks,
    completed,
    progress,
    pendingCountByCategory,
    categoryKey,
    findTask,
    load,
    retry,
    flush,
    refreshFromDisk,
    addTask,
    updateTask,
    applyNoteChange,
    updateMentions,
    setTaskDate,
    setRecurrence,
    complete,
    reopen,
    skip,
    deleteTask,
    clearCompleted,
    addCategory,
    updateCategory,
    deleteCategory,
    requestDeleteCategory,
    moveCategory,
    select,
    openEditor,
    openCreator,
    closeDrawer,
    revealFile: () => repo.reveal(),
  }
}
