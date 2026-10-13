/**
 * Modelo de dados das Tarefas + regras puras (sem Vue, sem disco).
 *
 * Tudo fica em <pasta de dados>/tasks/tasks.json:
 * {
 *   "app": "4notes", "version": 1,
 *   "categories": [{ "id": "estudos", "name": "Estudos", "color": "purple", ... }],
 *   "tasks": [{ "id": "t_x1", "title": "Estudar Godot", "date": "2026-10-05",
 *               "recurrence": { "interval": 7, "unit": "day", ... },
 *               "mentions": [{ "kind": "note", "path": "notes/Ideias.md", ... }], ... }]
 * }
 */
import { PALETTE, PALETTE_LABELS, type PaletteColor } from '../colors'
import { isISODate, toISODate, type ISODate } from '../dates'
import { createId } from '../utils/async'
import { normalizeRefs, type MentionRef } from '../mentions/refs'
import { clampInterval, nextDueAfterCompletion, type Recurrence } from './recurrence'

/** As categorias usam a paleta comum do app (lib/colors.ts). */
export const CATEGORY_COLORS = PALETTE
export type CategoryColor = PaletteColor
export const CATEGORY_COLOR_LABELS = PALETTE_LABELS

export interface Category {
  id: string
  name: string
  color: CategoryColor
  createdAt: string
}

/** Registro de cada vez que uma tarefa recorrente foi concluída. */
export interface Completion {
  /** Data da ocorrência concluída. */
  due: ISODate | null
  /** Momento da conclusão (ISO 8601). */
  at: string
}

export interface Task {
  id: string
  title: string
  notes: string
  categoryId: string | null
  /** Tarefa comum: prazo. Tarefa recorrente: data da próxima ocorrência. */
  date: ISODate | null
  recurrence: Recurrence | null
  /** Só usado por tarefas comuns (recorrentes nunca "terminam"). */
  done: boolean
  completedAt: string | null
  history: Completion[]
  /** Menções: notas, mapas, tarefas, links e registros do Timer — ver lib/mentions/refs.ts. */
  mentions: MentionRef[]
  createdAt: string
  updatedAt: string
}

export interface TasksData {
  categories: Category[]
  tasks: Task[]
}

export interface TasksFile extends TasksData {
  app: '4notes'
  version: 1
}

export const MAX_HISTORY = 200

// ── Normalização (tolerante a arquivos editados à mão) ───────────────────────
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)

function normalizeRecurrence(raw: unknown, date: ISODate | null): Recurrence | null {
  if (!isObject(raw)) return null
  const unit = ['day', 'week', 'month', 'year'].includes(raw.unit as string) ? (raw.unit as Recurrence['unit']) : null
  if (!unit) return null
  const anchor = isISODate(raw.anchor) ? raw.anchor : date
  if (!anchor) return null
  return {
    interval: clampInterval(raw.interval),
    unit,
    anchor,
    basis: raw.basis === 'completion' ? 'completion' : 'schedule',
  }
}

function normalizeTask(raw: unknown): Task | null {
  if (!isObject(raw)) return null
  const title = str(raw.title).trim()
  if (!title) return null
  const now = new Date().toISOString()
  const date = isISODate(raw.date) ? raw.date : null
  const recurrence = normalizeRecurrence(raw.recurrence, date)
  const history = Array.isArray(raw.history)
    ? raw.history
        .filter(isObject)
        .map((h) => ({ due: isISODate(h.due) ? h.due : null, at: str(h.at) }))
        .filter((h) => h.at)
    : []
  return {
    id: str(raw.id) || createId('t'),
    title,
    notes: str(raw.notes),
    categoryId: typeof raw.categoryId === 'string' && raw.categoryId ? raw.categoryId : null,
    date: date ?? recurrence?.anchor ?? null,
    recurrence,
    done: recurrence ? false : raw.done === true,
    completedAt: recurrence ? null : typeof raw.completedAt === 'string' ? raw.completedAt : null,
    history: history.slice(-MAX_HISTORY),
    mentions: normalizeRefs(raw.mentions),
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now),
  }
}

function normalizeCategory(raw: unknown): Category | null {
  if (!isObject(raw)) return null
  const name = str(raw.name).trim()
  const id = str(raw.id).trim()
  if (!name || !id) return null
  return {
    id,
    name,
    color: CATEGORY_COLORS.includes(raw.color as CategoryColor) ? (raw.color as CategoryColor) : 'gray',
    createdAt: str(raw.createdAt, new Date().toISOString()),
  }
}

/** Valida o conteúdo lido do tasks.json. Lança erro se não for um objeto. */
export function normalizeTasksFile(raw: unknown): TasksData {
  if (!isObject(raw)) throw new Error('O arquivo tasks.json não contém um objeto JSON válido.')
  const categories = (Array.isArray(raw.categories) ? raw.categories : []).map(normalizeCategory).filter((c): c is Category => !!c)
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).map(normalizeTask).filter((t): t is Task => !!t)
  // IDs duplicados (cópia manual de uma tarefa, por exemplo) recebem um novo ID.
  const seen = new Set<string>()
  for (const task of tasks) {
    if (seen.has(task.id)) task.id = createId('t')
    seen.add(task.id)
  }
  return { categories, tasks }
}

export function serializeTasks(data: TasksData): string {
  const file: TasksFile = { app: '4notes', version: 1, categories: data.categories, tasks: data.tasks }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** Arquivo novo: sem categorias — elas são criadas por você e ficam no tasks.json. */
export function defaultTasksData(): TasksData {
  return { categories: [], tasks: [] }
}

/** "Projetos Pessoais" → "projetos-pessoais" (IDs legíveis no JSON). */
export function categoryIdFor(name: string, taken: (id: string) => boolean): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'categoria'
  if (!taken(slug)) return slug
  for (let i = 2; ; i++) if (!taken(`${slug}-${i}`)) return `${slug}-${i}`
}

// ── Regras de exibição ───────────────────────────────────────────────────────

/** Aparece em "Pendentes"? Recorrentes só aparecem quando a data chega. */
export function isPending(task: Task, today: ISODate): boolean {
  if (task.done) return false
  if (!task.recurrence) return true
  return !task.date || task.date <= today
}

/** Recorrente "dormindo" até a próxima ocorrência. */
export function isScheduled(task: Task, today: ISODate): boolean {
  return !task.done && !!task.recurrence && !!task.date && task.date > today
}

export type DateSection = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'nodate'

export const SECTION_LABELS: Record<DateSection, string> = {
  overdue: 'Atrasadas',
  today: 'Hoje',
  tomorrow: 'Amanhã',
  upcoming: 'Próximas',
  nodate: 'Sem data',
}

const SECTION_ORDER: DateSection[] = ['overdue', 'today', 'tomorrow', 'upcoming', 'nodate']

export function dateSection(task: Task, today: ISODate, tomorrow: ISODate): DateSection {
  if (!task.date) return 'nodate'
  if (task.date < today) return 'overdue'
  if (task.date === today) return 'today'
  if (task.date === tomorrow) return 'tomorrow'
  return 'upcoming'
}

export function compareTasks(a: Task, b: Task): number {
  if (a.date !== b.date) {
    if (!a.date) return 1
    if (!b.date) return -1
    return a.date < b.date ? -1 : 1
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
}

export interface TaskGroup {
  key: DateSection
  label: string
  tasks: Task[]
}

export function groupByDate(tasks: Task[], today: ISODate, tomorrow: ISODate): TaskGroup[] {
  const buckets = new Map<DateSection, Task[]>()
  for (const task of [...tasks].sort(compareTasks)) {
    const key = dateSection(task, today, tomorrow)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(task)
  }
  return SECTION_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    key,
    label: SECTION_LABELS[key],
    tasks: buckets.get(key)!,
  }))
}

// ── Ações puras (devolvem uma nova tarefa) ──────────────────────────────────

export interface NewTaskInput {
  title: string
  notes?: string
  categoryId?: string | null
  date?: ISODate | null
  recurrence?: Omit<Recurrence, 'anchor'> | null
  mentions?: MentionRef[]
}

/**
 * Descrição (Markdown, como as notas): tira as linhas vazias do começo e os espaços do
 * fim — a indentação da primeira linha fica (pode ser um subitem de lista).
 */
export function trimDescription(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, '').trimEnd()
}

export function createTask(input: NewTaskInput, today: ISODate, now = new Date()): Task {
  const stamp = now.toISOString()
  const date = input.recurrence ? (input.date ?? today) : (input.date ?? null)
  return {
    id: createId('t'),
    title: input.title.trim(),
    notes: trimDescription(input.notes ?? ''),
    categoryId: input.categoryId ?? null,
    date,
    recurrence: input.recurrence && date ? { ...input.recurrence, interval: clampInterval(input.recurrence.interval), anchor: date } : null,
    done: false,
    completedAt: null,
    history: [],
    mentions: normalizeRefs(input.mentions),
    createdAt: stamp,
    updatedAt: stamp,
  }
}

/**
 * Concluir:
 *  - tarefa comum → vai para "Concluídas";
 *  - recorrente → registra no histórico e pula para a próxima data (sai de "Pendentes"
 *    e volta sozinha quando a data chegar).
 */
export function completeTask(task: Task, today: ISODate, now = new Date()): Task {
  const stamp = now.toISOString()
  if (task.recurrence) {
    const next = nextDueAfterCompletion(task.recurrence, task.date, today)
    return {
      ...task,
      date: next,
      recurrence: task.recurrence.basis === 'completion' ? { ...task.recurrence, anchor: next } : task.recurrence,
      history: [...task.history, { due: task.date, at: stamp }].slice(-MAX_HISTORY),
      updatedAt: stamp,
    }
  }
  return { ...task, done: true, completedAt: stamp, updatedAt: stamp }
}

/** Recorrente: pula para a próxima ocorrência sem registrar conclusão. */
export function skipOccurrence(task: Task, today: ISODate, now = new Date()): Task {
  if (!task.recurrence) return task
  const next = nextDueAfterCompletion({ ...task.recurrence, basis: 'schedule' }, task.date, today)
  return {
    ...task,
    date: next,
    recurrence: task.recurrence.basis === 'completion' ? { ...task.recurrence, anchor: next } : task.recurrence,
    updatedAt: now.toISOString(),
  }
}

export function reopenTask(task: Task, now = new Date()): Task {
  return { ...task, done: false, completedAt: null, updatedAt: now.toISOString() }
}

// ── Histórico ────────────────────────────────────────────────────────────────

export interface CompletedEntry {
  key: string
  task: Task
  at: string
  /** Dia (local) da conclusão. */
  day: ISODate
  due: ISODate | null
  recurring: boolean
}

export function completedEntries(tasks: Task[]): CompletedEntry[] {
  const entries: CompletedEntry[] = []
  for (const task of tasks) {
    if (task.done && task.completedAt) {
      entries.push({
        key: `${task.id}:done`,
        task,
        at: task.completedAt,
        day: toISODate(new Date(task.completedAt)),
        due: task.date,
        recurring: false,
      })
    }
    task.history.forEach((item, index) => {
      entries.push({
        key: `${task.id}:${index}:${item.at}`,
        task,
        at: item.at,
        day: toISODate(new Date(item.at)),
        due: item.due,
        recurring: true,
      })
    })
  }
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

/**
 * Progresso do dia: concluídas hoje × (concluídas hoje + pendentes para hoje).
 * "Pendentes para hoje" = atrasadas, de hoje e as sem data (só as de datas futuras ficam de fora).
 */
export function todayProgress(tasks: Task[], today: ISODate): { done: number; total: number } {
  let done = 0
  let remaining = 0
  for (const task of tasks) {
    if (task.done && task.completedAt && toISODate(new Date(task.completedAt)) === today) done++
    for (const item of task.history) if (toISODate(new Date(item.at)) === today) done++
    if (isPending(task, today) && (!task.date || task.date <= today)) remaining++
  }
  return { done, total: done + remaining }
}
