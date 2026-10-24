/**
 * Menções — a única ligação entre os módulos (pedida para as menções):
 *
 * - Notas (das Notas e do Mapa Mental) e Tarefas mencionam itens de todos os módulos:
 *   notas, notas dos mapas, mapas inteiros, tarefas, links salvos, registros do
 *   histórico do Timer e gastos das Finanças (1.7.0). Nas notas, a menção é um link Markdown
 *   (lib/notes/mention-links.ts); nas tarefas, fica na lista "Menções" (tasks.json,
 *   lib/mentions/refs.ts).
 * - Cada tipo de item tem um provedor (PROVIDERS): lista os itens para o "@", diz como
 *   está um item mencionado (título atual, concluída, não existe mais) e abre o item no
 *   módulo dele. Um módulo novo entra com um provedor novo (+ uma linha em
 *   lib/mentions/catalog.ts) — o "@", os chips e o "Ver menções" passam a achá-lo.
 * - Tarefas, registros do Timer e links salvos são achados pelo id; notas e mapas, pelo
 *   caminho, que é corrigido aqui quando muda (abaixo).
 * - Módulo desativado: avisa e oferece "Ativar" (stores/modules.ts) em vez de abrir uma
 *   tela que não está no menu.
 * - "Ver menções" (no Timer, nos Links e nas Finanças): procura onde um item foi mencionado — nas
 *   Notas, nas notas de todos os mapas e nas tarefas — e leva até lá.
 * - Quando uma nota, uma categoria ou um mapa muda de nome no app (lib/note-events.ts),
 *   quando uma tarefa ou um registro do Timer muda de título, ou quando um link salvo
 *   muda de endereço, corrige as menções — nas tarefas, nas Notas, no mapa aberto e nos
 *   arquivos dos outros mapas — para elas continuarem funcionando depois de reabrir o app.
 */
import { computed, reactive, watch } from 'vue'
import { workspaceFileUrl } from '#shared/ipc'
import { openCategoriesPanel } from '~/composables/useCategoryActions'
import { showToast } from '~/composables/useToasts'
import { paletteVar } from '~/lib/colors'
import { formatDateBR, type ISODate } from '~/lib/dates'
import { linkDestination } from '~/lib/editor/elements'
import type { CategoryMentionHost, MentionState, MentionTarget } from '~/lib/editor/host'
import { dirname, nameKey, stripExtension } from '~/lib/files/filename'
import { displayHost, urlKey, type SavedLink } from '~/lib/links/model'
import { MENTION_KINDS, rankMentions, type RankItem } from '~/lib/mentions/catalog'
import { refFromPath, refKey, refPath, type MentionRef } from '~/lib/mentions/refs'
import { mindmapRepository } from '~/lib/mindmap/repository'
import type { ModuleId } from '~/lib/modules'
import { onNoteChange } from '~/lib/note-events'
import { categoryOfPath } from '~/lib/notes/categories'
import {
  idMentionPath,
  idOf,
  linksIn,
  mapMentionPath,
  mapOfMentionPath,
  mentionKind,
  relinkCategory,
  relinkUrl,
  renameMentionLinks,
  retitleIdLinks,
  taskMentionPath,
  type MentionKind,
} from '~/lib/notes/mention-links'
import { DATA_PATHS } from '~/lib/storage/paths'
import { DESCRIPTION_DIR } from '~/lib/tasks/description'
import type { Task } from '~/lib/tasks/model'
import { formatMoney } from '~/lib/finance/format'
import type { Expense } from '~/lib/finance/model'
import { formatDuration } from '~/lib/timer/format'
import { MODE_LABELS, STATUS_LABELS, type TimerSession } from '~/lib/timer/model'
import { sessionDay, weekdayName } from '~/lib/timer/stats'
import { debounce } from '~/lib/utils/async'
import { suggestSharedColor } from '~/lib/categories/model'
import { useCategoriesStore, type SharedCategory } from './categories'
import { useFinanceStore } from './finance'
import { useLinksStore } from './links'
import { useModulesStore } from './modules'
import { useMindmapStore } from './mindmap'
import { noteTitle, useNotesStore } from './notes'
import { useTasksStore } from './tasks'
import { useTimerStore } from './timer'

const notes = useNotesStore()
const mindmap = useMindmapStore()
const tasks = useTasksStore()
const links = useLinksStore()
const timer = useTimerStore()
const finance = useFinanceStore()
const categories = useCategoriesStore()

/** Um item da lista do "@" (o que vai para a nota + o que decide a ordem). */
export type MentionItem = MentionTarget & RankItem

/** Como cada tipo de item é listado, descrito e aberto. */
interface MentionProvider {
  /** Módulo que precisa estar ativo para abrir o item (os links abrem no navegador). */
  module?: ModuleId
  items(): MentionItem[] | Promise<MentionItem[]>
  /** Título e estado atuais; null = não existe mais. */
  describe(path: string): MentionState | null
  open(path: string): void | Promise<void>
}

/** Aviso de item que não existe mais (foi excluído ou renomeado fora do app). */
function gone(kind: MentionKind): void {
  showToast({ message: MENTION_KINDS[kind].gone, icon: 'alert', tone: 'error' })
}
const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ')
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** "12/10" (deste ano) ou "12/10/2025". */
function shortDay(day: ISODate): string {
  const full = formatDateBR(day)
  return day.slice(0, 4) === String(new Date().getFullYear()) ? full.slice(0, 5) : full
}

// ── Notas ────────────────────────────────────────────────────────────────────

function notesWhere(path: string): string {
  const category = categoryOfPath(path)
  return category ? `Notas · ${notes.findCategory(category)?.name ?? category}` : 'Notas'
}

const notesProvider: MentionProvider = {
  module: 'notes',
  items: () =>
    notes.visibleNotes.value
      .filter((note) => note.path)
      // As mais recentes primeiro, como na lista lateral das Notas (1.6.3)
      .map((note) => ({ path: note.path!, title: noteTitle(note), where: notesWhere(note.path!), order: -note.mtimeMs })),
  describe: (path) => {
    const note = notes.findByPath(path)
    return note ? { title: noteTitle(note), detail: notesWhere(path) } : null
  },
  open: async (path) => {
    const note = notes.findByPath(path)
    if (!note) return gone('note')
    tasks.closeDrawer()
    await navigateTo('/notes')
    notes.openNote(note.id)
  },
}

// ── Notas dos mapas e mapas inteiros ─────────────────────────────────────────

/** Notas que existem nos mapas fechados (anotado ao listar as notas para mencionar). */
const closedMapNotes = new Map<string, Set<string>>()

const findMap = (name: string) => mindmap.state.maps.find((item) => nameKey(item.name) === nameKey(name))

/** "mindmap/Principal/Godot.md" → mapa e nota. */
function mapNoteOf(path: string): { map: string; note: string } | null {
  const ref = refFromPath(path)
  return ref?.kind === 'map' ? { map: ref.map, note: ref.note } : null
}

const mapNotesProvider: MentionProvider = {
  module: 'mindmap',
  async items() {
    const list: MentionItem[] = []
    for (const map of mindmap.state.maps.map((item) => item.name)) {
      const names =
        map === mindmap.state.currentMap
          ? mindmap.state.notes.map((note) => note.id)
          : await mindmapRepository.listNoteNames(map).catch(() => [] as string[])
      if (map !== mindmap.state.currentMap) closedMapNotes.set(nameKey(map), new Set(names.map(nameKey)))
      for (const name of names) {
        list.push({ path: `${DATA_PATHS.mindmapDir}/${map}/${name}`, title: stripExtension(name), where: `Mapa · ${map}` })
      }
    }
    return list
  },
  describe: (path) => {
    const ref = mapNoteOf(path)
    const map = ref && findMap(ref.map)
    if (!ref || !map) return null
    const detail = `Mapa · ${map.name}`
    if (map.name === mindmap.state.currentMap) {
      return mindmap.state.notes.some((note) => nameKey(note.id) === nameKey(ref.note)) ? { title: stripExtension(ref.note), detail } : null
    }
    const known = closedMapNotes.get(nameKey(map.name))
    return !known || known.has(nameKey(ref.note)) ? { title: stripExtension(ref.note), detail } : null
  },
  open: async (path) => {
    const ref = mapNoteOf(path)
    const map = ref && findMap(ref.map)
    if (!ref || !map) return gone('map')
    if (map.name !== mindmap.state.currentMap) await mindmap.switchMap(map.name)
    const note = mindmap.state.notes.find((item) => nameKey(item.id) === nameKey(ref.note))
    if (!note) return gone('map')
    tasks.closeDrawer()
    await navigateTo('/mindmap')
    mindmap.openNote(note.id)
  },
}

const mapWhere = (notesCount: number) => `Mapa mental · ${plural(notesCount, 'nota', 'notas')}`

const mapsProvider: MentionProvider = {
  module: 'mindmap',
  items: () => mindmap.state.maps.map((map) => ({ path: mapMentionPath(map.name), title: map.name, where: mapWhere(map.notes), late: 2 })),
  describe: (path) => {
    const map = findMap(mapOfMentionPath(path) ?? '')
    return map ? { title: map.name, detail: mapWhere(map.notes) } : null
  },
  open: async (path) => {
    const map = findMap(mapOfMentionPath(path) ?? '')
    if (!map) return gone('mindmap')
    if (map.name !== mindmap.state.currentMap) await mindmap.switchMap(map.name)
    tasks.closeDrawer()
    await navigateTo('/mindmap')
  },
}

// ── Tarefas ──────────────────────────────────────────────────────────────────

function taskDetail(task: Task): string {
  const category = task.categoryId ? tasks.categoryById.value.get(task.categoryId) : null
  return join(category?.name, task.date && shortDay(task.date), task.done && 'concluída')
}

const tasksProvider: MentionProvider = {
  module: 'tasks',
  items: () =>
    tasks.state.tasks.map((task) => {
      const category = task.categoryId ? tasks.categoryById.value.get(task.categoryId)?.name : ''
      return {
        path: taskMentionPath(task.id),
        title: task.title,
        where: join('Tarefa', taskDetail(task)),
        keywords: join(category, task.date && formatDateBR(task.date)),
        late: task.done ? 1 : 0,
      }
    }),
  describe: (path) => {
    const task = tasks.findTask(idOf(path)?.id ?? '')
    return task ? { title: task.title, done: task.done, detail: taskDetail(task) } : null
  },
  open: async (path) => {
    const id = idOf(path)?.id ?? ''
    if (!tasks.findTask(id)) return gone('task')
    await navigateTo('/tasks')
    tasks.openEditor(id)
  },
}

// ── Registros do Timer ───────────────────────────────────────────────────────

/** Título de um registro: a atividade (ou o modo, se ficou sem nome). */
const sessionTitle = (session: TimerSession) => session.activity || MODE_LABELS[session.mode]
const sessionDetail = (session: TimerSession) =>
  join(timer.categoryName(session.categoryId), shortDay(sessionDay(session)), formatDuration(session.duration * 1000, { seconds: false }))

const timerProvider: MentionProvider = {
  module: 'timer',
  items: () =>
    timer.state.sessions.map((session) => {
      const day = sessionDay(session)
      return {
        path: idMentionPath('timer', session.id),
        title: sessionTitle(session),
        where: `Timer · ${sessionDetail(session)}`,
        // Também acha pela categoria, pela data ("12/10", "sábado"), pelo modo e pela situação
        keywords: join(
          timer.categoryName(session.categoryId),
          formatDateBR(day),
          weekdayName(new Date(session.start).getDay()),
          MODE_LABELS[session.mode],
          STATUS_LABELS[session.status],
        ),
        late: 3,
        // Os mais recentes primeiro
        order: -session.start,
      }
    }),
  describe: (path) => {
    const session = timer.findSession(idOf(path)?.id ?? '')
    return session ? { title: sessionTitle(session), detail: sessionDetail(session) } : null
  },
  open: async (path) => {
    const id = idOf(path)?.id ?? ''
    if (!timer.findSession(id)) return gone('timer')
    tasks.closeDrawer()
    await navigateTo('/timer')
    timer.revealSession(id)
  },
}

// ── Links salvos ─────────────────────────────────────────────────────────────

/** Link pelo id (ou pelo endereço, se ele foi excluído e salvo de novo). */
function findSavedLink(id: string, url?: string): SavedLink | undefined {
  return links.findLink(id) ?? (url ? links.state.links.find((link) => urlKey(link.url) === urlKey(url)) : undefined)
}

const linkDetail = (link: SavedLink) => join(links.folderOf(link)?.name, displayHost(link.url))

function describeLink(id: string, url?: string): MentionState | null {
  const link = findSavedLink(id, url)
  return link ? { title: link.title, detail: linkDetail(link) } : null
}

function openSavedLink(id: string, url?: string): void {
  const link = findSavedLink(id, url)
  if (link) links.openLink(link.id)
  else gone('link')
}

const linksProvider: MentionProvider = {
  items: () =>
    links.state.links.map((link) => ({
      path: idMentionPath('link', link.id),
      url: link.url,
      title: link.title,
      where: join('Link', linkDetail(link)),
      keywords: link.url,
      late: 2,
    })),
  describe: (path) => describeLink(idOf(path)?.id ?? ''),
  open: (path) => openSavedLink(idOf(path)?.id ?? ''),
}

// ── Gastos das Finanças (1.7.0) ──────────────────────────────────────────────

/** Título de um lançamento: a descrição (ou "Gasto"/"Entrada", se ficou sem). */
const expenseTitle = (expense: Expense) => expense.description || (expense.kind === 'income' ? 'Entrada' : 'Gasto')
const expenseDetail = (expense: Expense) =>
  join(finance.categoryOf(expense)?.name, shortDay(expense.date), formatMoney(expense.amount), expense.status === 'pending' ? 'pendente' : expense.status === 'cancelled' ? 'pulada' : undefined)

const financeProvider: MentionProvider = {
  module: 'finance',
  items: () =>
    finance.state.expenses.map((expense) => ({
      path: idMentionPath('expense', expense.id),
      title: expenseTitle(expense),
      where: `${expense.kind === 'income' ? 'Entrada' : 'Gasto'} · ${expenseDetail(expense)}`,
      // Também acha pela categoria, pela data e pelo valor ("@mercado 21/10", "@52,30")
      keywords: join(finance.categoryOf(expense)?.name, formatDateBR(expense.date), formatMoney(expense.amount)),
      late: 3,
      // Os mais recentes primeiro
      order: -Date.parse(`${expense.date}T12:00:00`),
    })),
  describe: (path) => {
    const expense = finance.findExpense(idOf(path)?.id ?? '')
    return expense ? { title: expenseTitle(expense), detail: expenseDetail(expense) } : null
  },
  open: async (path) => {
    const id = idOf(path)?.id ?? ''
    if (!finance.findExpense(id)) return gone('expense')
    tasks.closeDrawer()
    await navigateTo('/finance')
    finance.revealExpense(id)
  },
}

// ── Categorias (o "#", 1.7.1) ────────────────────────────────────────────────

/** Onde a categoria aparece ("Notas, Tarefas"), para diferenciar na lista e na dica do chip. */
function categoryWhere(category: SharedCategory): string {
  const places = categories.usage(category.id).filter((item) => item.member || item.records.length)
  return places.length ? `Categoria · ${places.map((item) => item.label).join(', ')}` : 'Categoria'
}

const categoryTarget = (category: SharedCategory): MentionTarget => ({
  path: idMentionPath('category', category.id),
  title: category.name,
  where: categoryWhere(category),
  color: paletteVar(category.color),
})

const categoryProvider: MentionProvider = {
  // Categorias aparecem no "#", não na lista do "@"
  items: () => [],
  describe: (path) => {
    const category = categories.resolveCategory(idOf(path)?.id)
    return category ? { title: category.name, detail: categoryWhere(category), color: paletteVar(category.color) } : null
  },
  open: (path) => {
    const category = categories.resolveCategory(idOf(path)?.id)
    if (!category) return gone('category')
    tasks.closeDrawer()
    openCategoriesPanel(category.id)
  },
}

/**
 * O "#" dos editores (Notas, Mapa, descrição das tarefas, observações das Finanças): as
 * categorias do app pelo nome e "Criar categoria" (entra no app, ainda sem módulo: aparece
 * nas Configurações › Categorias e nos módulos onde for usada).
 */
export const categoryMentions: CategoryMentionHost = {
  search: (query) => {
    const ranked = rankMentions(
      categories.state.categories.map((category) => ({ category, title: category.name })),
      query,
      40,
    )
    return ranked.map((item) => categoryTarget(item.category))
  },
  create: (name) => {
    const existing = categories.findByName(name)
    if (existing) return categoryTarget(existing)
    const created = categories.createCategory({ name, color: suggestSharedColor(categories.state.categories.map((category) => category.color)) })
    if (!created) return null
    showToast({ message: `Categoria “${created.name}” criada`, icon: 'tag', tone: 'success' })
    return categoryTarget(created)
  },
}

const PROVIDERS: Record<MentionKind, MentionProvider> = {
  note: notesProvider,
  map: mapNotesProvider,
  mindmap: mapsProvider,
  task: tasksProvider,
  timer: timerProvider,
  link: linksProvider,
  expense: financeProvider,
  category: categoryProvider,
}

// ── Buscar, descrever e abrir ────────────────────────────────────────────────

export interface MentionSearchOptions {
  /** O próprio item (uma nota não menciona a si mesma; uma tarefa, também não). */
  exceptPath?: string | null
  /** Já mencionados (a lista "Menções" da tarefa). */
  exclude?: readonly MentionRef[]
}

/** Mesmo caminho de menção? (ids como estão; caminhos de arquivo sem diferenciar maiúsculas) */
function samePath(a: string, b: string): boolean {
  return idOf(a) || idOf(b) ? a === b : nameKey(a) === nameKey(b)
}

/** Todos os itens que podem ser mencionados (sem `exceptPath` e sem os de `exclude`), ainda sem ordem. */
export async function mentionItems(options: MentionSearchOptions = {}): Promise<MentionItem[]> {
  const all = (await Promise.all(Object.values(PROVIDERS).map((provider) => provider.items()))).flat()
  // O "de onde é" também acha o item ("@timer godot", "@trabalho")
  return all.filter((item) => isAvailable(item, options)).map((item) => ({ ...item, keywords: join(item.where, item.keywords) }))
}

/** O item pode entrar na lista? (não é o próprio item nem um já mencionado) */
export function isAvailable(item: MentionTarget, options: MentionSearchOptions): boolean {
  if (options.exceptPath && samePath(item.path, options.exceptPath)) return false
  if (!options.exclude?.length) return true
  const ref = refFromPath(item.path, item.title, item.url)
  return !ref || !options.exclude.some((other) => refKey(other) === refKey(ref))
}

/** Filtra pelo texto digitado e ordena (lib/mentions/catalog.ts). */
export function rankMentionItems(items: readonly MentionItem[], query: string, limit = 40): MentionTarget[] {
  return rankMentions(items, query, limit).map(({ path, title, where, url }) =>
    url ? { path, title, where, url } : { path, title, where },
  )
}

/** Itens de todos os módulos para o "@", filtrados pelo texto digitado e em ordem. */
export async function searchMentions(query: string, options: MentionSearchOptions = {}): Promise<MentionTarget[]> {
  return rankMentionItems(await mentionItems(options), query)
}

/** Como está o que foi mencionado (título, concluída…); null = não existe mais. */
export function describeMention(path: string): MentionState | null {
  return PROVIDERS[mentionKind(path)].describe(path)
}

/** Abre o item mencionado no módulo dele. */
export function openMentionPath(path: string): void {
  const provider = PROVIDERS[mentionKind(path)]
  const open = () => void provider.open(path)
  if (provider.module && !useModulesStore().requireModule(provider.module, open)) return
  open()
}

/** Menção guardada numa tarefa: como está agora. */
export function describeRef(ref: MentionRef): MentionState | null {
  return ref.kind === 'link' ? describeLink(ref.id, ref.url) : describeMention(refPath(ref))
}

export function openRef(ref: MentionRef): void {
  if (ref.kind === 'link') openSavedLink(ref.id, ref.url)
  else openMentionPath(refPath(ref))
}

/** Item escolhido na lista do "@" → menção para guardar na tarefa. */
export function refFromTarget(target: MentionTarget): MentionRef | null {
  return refFromPath(target.path, target.title, target.url)
}

/** Título atual de uma menção (o guardado, se o item não existe mais). */
export function mentionTitle(ref: MentionRef): string {
  return describeRef(ref)?.title ?? ref.title
}

// ── Links salvos dentro das notas ────────────────────────────────────────────

/** Endereço para comparar: o do arquivo da nota vem com ( ) < > codificados. */
const linkKey = (url: string) => urlKey(url.trim().replace(/%28/gi, '(').replace(/%29/gi, ')').replace(/%3C/gi, '<').replace(/%3E/gi, '>'))

const savedLinks = computed(() => {
  const map = new Map<string, SavedLink>()
  for (const link of links.state.links) map.set(linkKey(link.url), link)
  return map
})

/** Ícone do site (endereço da imagem) quando `url` é um link salvo no módulo Links; null = não é (ou ainda sem ícone). */
export function savedLinkIcon(url: string): string | null {
  const link = savedLinks.value.get(linkKey(url))
  const path = link ? links.iconPath(link) : null
  return path ? `${workspaceFileUrl(path)}?v=${links.state.iconVersion}` : null
}

/** Muda quando títulos/estados que aparecem nos chips mudam (os editores redesenham). */
export const mentionRevision = computed(() => {
  const parts: string[] = []
  for (const task of tasks.state.tasks) parts.push(`${task.id}:${task.done ? 1 : 0}:${task.title}:${task.categoryId}:${task.date}`)
  for (const note of notes.state.notes) if (note.path) parts.push(`${note.path}:${noteTitle(note)}`)
  parts.push(`${mindmap.state.currentMap}/${mindmap.state.notes.map((note) => note.id).join('/')}`)
  parts.push(mindmap.state.maps.map((map) => `${map.name}:${map.notes}`).join('/'))
  for (const session of timer.state.sessions) parts.push(`${session.id}:${session.activity}:${session.categoryId}:${session.duration}`)
  parts.push(timer.state.categories.map((category) => category.name).join('/'))
  for (const expense of finance.state.expenses) parts.push(`${expense.id}:${expense.description}:${expense.amount}:${expense.categoryId}:${expense.date}`)
  // Categorias (chips "#Nome": nome, cor e onde é usada)
  for (const category of categories.state.categories) parts.push(`c:${category.id}:${category.name}:${category.color}`)
  parts.push(`c:${Object.keys(categories.state.replaced).length}:${categories.state.revision}`)
  parts.push(finance.state.categories.map((category) => category.name).join('/'))
  // Ícones dos links salvos (aparecem na frente dos links mencionados)
  let withIcon = 0
  for (const link of links.state.links) if (link.icon) withIcon++
  parts.push(`links:${links.state.links.length}:${withIcon}:${links.state.iconVersion}`)
  return parts.join('|')
})

// ── "Ver menções": onde um item foi mencionado ───────────────────────────────

/** Um lugar onde o item foi mencionado: uma nota (das Notas ou de um mapa) ou uma tarefa. */
export interface MentionPlace {
  /** Caminho de menção do lugar (abre com openMentionPath). */
  path: string
  kind: MentionKind
  title: string
  where: string
}

/** O item a procurar: caminho de menção e, nos links salvos, o endereço. */
export interface MentionSubject {
  path: string
  title: string
  url?: string
}

/** Caminhos que também valem como o item: os ids antigos de uma categoria juntada a ela. */
function subjectAliases(subject: MentionSubject): string[] {
  const found = idOf(subject.path)
  return found?.kind === 'category' ? categories.aliasesOf(found.id).map((id) => idMentionPath('category', id)) : []
}

/** Procura nas Notas, nas notas de todos os mapas e nas tarefas. */
export async function findMentionPlaces(subject: MentionSubject): Promise<MentionPlace[]> {
  const subjectRef = refFromPath(subject.path, subject.title, subject.url)
  const subjectKey = subjectRef ? refKey(subjectRef) : null
  const urlKeyOf = subject.url ? linkKey(subject.url) : null
  const paths = [subject.path, ...subjectAliases(subject)]
  const mentions = (content: string, dir: string) =>
    linksIn(content, dir).some(
      (link) =>
        (link.path !== null && paths.some((path) => samePath(link.path!, path))) ||
        (urlKeyOf !== null && /^https?:/i.test(link.url) && linkKey(link.url) === urlKeyOf),
    )

  const places: MentionPlace[] = []
  for (const note of notes.state.notes) {
    if (!note.path || !mentions(note.content, dirname(note.path))) continue
    places.push({ path: note.path, kind: 'note', title: noteTitle(note), where: notesWhere(note.path) })
  }
  for (const map of mindmap.state.maps) {
    const dir = `${DATA_PATHS.mindmapDir}/${map.name}`
    const files =
      map.name === mindmap.state.currentMap
        ? mindmap.state.notes.map((note) => ({ name: note.id, content: note.content }))
        : (await mindmapRepository.listNotes(map.name).catch(() => [])).map((file) => ({ name: file.name, content: file.content ?? '' }))
    for (const file of files) {
      if (!mentions(file.content, dir)) continue
      places.push({ path: `${dir}/${file.name}`, kind: 'map', title: stripExtension(file.name), where: `Mapa · ${map.name}` })
    }
  }
  for (const task of tasks.state.tasks) {
    const inList = subjectKey !== null && task.mentions.some((ref) => refKey(ref) === subjectKey)
    if (!inList && !mentions(task.notes, DESCRIPTION_DIR)) continue
    places.push({ path: taskMentionPath(task.id), kind: 'task', title: task.title, where: join('Tarefa', taskDetail(task)) })
  }
  // Observações dos gastos e das entradas (só têm "#", 1.7.1)
  for (const record of finance.notedRecords()) {
    if (!mentions(record.notes, DATA_PATHS.financeDir)) continue
    places.push({ path: record.path, kind: 'expense', title: record.title, where: record.where })
  }
  return places
}

export const categorySubject = (category: SharedCategory): MentionSubject => ({
  path: idMentionPath('category', category.id),
  title: category.name,
})

/** O que o diálogo "Ver menções" está mostrando (components/shell/MentionsDialog.vue). */
export const mentionsDialog = reactive({ subject: null as MentionSubject | null })

/** Abre o "Ver menções" de um item (Timer: registro; Links: link salvo; Finanças: gasto). */
export function showMentionsOf(subject: MentionSubject): void {
  mentionsDialog.subject = { ...subject }
}

export const timerSessionSubject = (session: TimerSession): MentionSubject => ({
  path: idMentionPath('timer', session.id),
  title: sessionTitle(session),
})

export const expenseSubject = (expense: Expense): MentionSubject => ({
  path: idMentionPath('expense', expense.id),
  title: expenseTitle(expense),
})

export const savedLinkSubject = (link: SavedLink): MentionSubject => ({
  path: idMentionPath('link', link.id),
  title: link.title,
  url: link.url,
})

// ── Correção das menções quando algo muda ────────────────────────────────────

type Rewrite = (content: string, dir: string) => string | null

/** Correções que ainda faltam aplicar nos arquivos dos mapas fechados (feitas em lote). */
let pending: Rewrite[] = []
const applyPendingSoon = debounce(() => void applyPending(), 1200)

async function applyPending(): Promise<void> {
  const batch = pending
  pending = []
  if (!batch.length) return
  const combined: Rewrite = (content, dir) => {
    let text = content
    for (const rewrite of batch) text = rewrite(text, dir) ?? text
    return text === content ? null : text
  }
  await mindmap.rewriteAllMaps(combined)
}

/** Aplica a correção em todas as notas: Notas e mapa aberto agora; os outros mapas em lote. */
function rewriteEverywhere(rewrite: Rewrite): void {
  notes.rewriteContents(rewrite)
  mindmap.rewriteContents(rewrite)
  pending.push(rewrite)
  applyPendingSoon()
}

/** Termina as correções pendentes (chamado antes de fechar o app). */
export async function flushMentionUpdates(): Promise<void> {
  applyPendingSoon.cancel()
  retitleSoon.flush()
  await applyPending()
}

/** Títulos (de tarefas e registros do Timer) que mudaram e ainda não foram levados para o texto das notas. */
let retitled = new Map<string, string>()
const retitleSoon = debounce(() => {
  const titles = retitled
  retitled = new Map()
  if (titles.size) rewriteEverywhere((content, dir) => retitleIdLinks(content, dir, titles))
}, 1000)

/** Acompanha os títulos de uma lista (caminho de menção → título) e avisa o que mudou. */
function trackTitles(source: () => [string, string][]): void {
  let known = new Map<string, string>()
  watch(
    source,
    (entries) => {
      const current = new Map(entries)
      for (const [path, title] of current) {
        const before = known.get(path)
        if (before !== undefined && before !== title) retitled.set(path, title)
      }
      known = current
      if (retitled.size) retitleSoon()
    },
    { immediate: true },
  )
}

let installed = false
/** Liga o acompanhamento de renomeações (chamado uma vez, na inicialização). */
export function installMentionTracking(): void {
  if (installed) return
  installed = true
  onNoteChange((change) => {
    tasks.applyNoteChange(change, (ref) => (ref.kind === 'note' ? (describeRef(ref)?.title ?? null) : null))
    // Menções dentro das notas: o link (e o texto dele) acompanham a nota renomeada
    const title =
      change.type === 'note-renamed'
        ? (describeMention(change.to)?.title ?? null)
        : change.type === 'map-note-renamed'
          ? stripExtension(change.to)
          : null
    rewriteEverywhere((content, dir) => renameMentionLinks(content, dir, change, title))
  })

  // Tarefa, registro do Timer ou gasto com título novo: o texto das menções a eles acompanha (em lote)
  trackTitles(() => tasks.state.tasks.map((task) => [taskMentionPath(task.id), task.title]))
  trackTitles(() => timer.state.sessions.map((session) => [idMentionPath('timer', session.id), sessionTitle(session)]))
  trackTitles(() => finance.state.expenses.map((expense) => [idMentionPath('expense', expense.id), expenseTitle(expense)]))
  // Categoria renomeada (1.7.1): o texto das menções "#" acompanha
  trackTitles(() => categories.state.categories.map((category) => [idMentionPath('category', category.id), category.name]))

  // Categoria juntada a outra: as menções à antiga passam a apontar para a que ficou
  let merged = new Map(Object.entries(categories.state.replaced))
  watch(
    () => Object.entries(categories.state.replaced),
    (entries) => {
      for (const [from, to] of entries) {
        if (merged.has(from) || !to) continue
        const target = categories.resolveCategory(to)
        if (target) rewriteEverywhere((content, dir) => relinkCategory(content, dir, from, target.id, target.name))
      }
      merged = new Map(entries)
    },
  )

  // Link salvo com endereço novo: os links nas notas e as menções nas tarefas acompanham
  let urls = new Map<string, string>()
  watch(
    () => links.state.links.map((link) => [link.id, link.url] as const),
    (entries) => {
      const current = new Map(entries)
      for (const [id, url] of current) {
        const before = urls.get(id)
        if (before === undefined || before === url) continue
        const from = linkKey(before)
        rewriteEverywhere((content) => relinkUrl(content, (href) => /^https?:/i.test(href) && linkKey(href) === from, linkDestination(url)))
        tasks.updateMentions((ref) => (ref.kind === 'link' && ref.id === id ? { ...ref, url } : null))
      }
      urls = current
    },
    { immediate: true },
  )
}
