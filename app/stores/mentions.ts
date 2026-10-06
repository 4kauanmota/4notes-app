/**
 * Menções — a ponte entre Tarefas, Notas, Mapa Mental e Links (a única ligação
 * entre os módulos, pedida para as menções):
 *
 * - Tarefas mencionam notas (das Notas e de qualquer mapa): ficam no tasks.json.
 * - Notas (das Notas e do Mapa Mental) mencionam notas, tarefas e links salvos: são
 *   links Markdown dentro do texto (lib/notes/mention-links.ts). Um link salvo é um
 *   link comum, com o ícone do site na frente.
 * - Lista o que pode ser mencionado e abre o que foi mencionado (vai para o
 *   módulo certo, troca de mapa se precisar). Módulo desativado: avisa e oferece
 *   "Ativar" (stores/modules.ts) em vez de abrir uma tela que não está no menu.
 * - Quando uma nota, uma categoria ou um mapa muda de nome no app
 *   (lib/note-events.ts), ou uma tarefa muda de título, corrige as menções — nas
 *   tarefas, nas Notas, no mapa aberto e nos arquivos dos outros mapas — para
 *   elas continuarem funcionando depois de reabrir o app.
 */
import { computed, watch } from 'vue'
import { workspaceFileUrl } from '#shared/ipc'
import { showToast } from '~/composables/useToasts'
import type { MentionState, MentionTarget } from '~/lib/editor/host'
import { nameKey, stripExtension } from '~/lib/files/filename'
import { displayHost, searchLinks, urlKey, type SavedLink } from '~/lib/links/model'
import { mindmapRepository } from '~/lib/mindmap/repository'
import { onNoteChange } from '~/lib/note-events'
import { categoryOfPath } from '~/lib/notes/categories'
import { renameMentionLinks, retitleTaskLinks, taskIdOf, taskMentionPath } from '~/lib/notes/mention-links'
import { DATA_PATHS } from '~/lib/storage/paths'
import type { NoteRef } from '~/lib/tasks/mentions'
import type { Task } from '~/lib/tasks/model'
import { debounce } from '~/lib/utils/async'
import { useLinksStore } from './links'
import { useModulesStore } from './modules'
import { useMindmapStore } from './mindmap'
import { noteTitle, useNotesStore } from './notes'
import { useTasksStore } from './tasks'

export interface MentionCandidate {
  ref: NoteRef
  title: string
  /** "Notas", "Notas · Trabalho" ou "Mapa · Principal". */
  where: string
}

const notes = useNotesStore()
const mindmap = useMindmapStore()
const tasks = useTasksStore()
const links = useLinksStore()

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR')

/** Título atual da nota mencionada (o da menção, se a nota não estiver carregada). */
export function mentionTitle(ref: NoteRef): string {
  if (ref.kind === 'note') {
    const note = notes.findByPath(ref.path)
    return note ? noteTitle(note) : ref.title
  }
  return stripExtension(ref.note)
}

function notesWhere(path: string): string {
  const category = categoryOfPath(path)
  return category ? `Notas · ${notes.findCategory(category)?.name ?? category}` : 'Notas'
}

export function mentionWhere(ref: NoteRef): string {
  return ref.kind === 'note' ? notesWhere(ref.path) : `Mapa · ${ref.map}`
}

/** Notas que existem nos mapas fechados (anotado ao listar as notas para mencionar). */
const closedMapNotes = new Map<string, Set<string>>()

/** Todas as notas que podem ser mencionadas (as do mapa aberto já estão na memória). */
export async function mentionCandidates(): Promise<MentionCandidate[]> {
  const list: MentionCandidate[] = []
  for (const note of notes.visibleNotes.value) {
    if (!note.path) continue
    const title = noteTitle(note)
    list.push({ ref: { kind: 'note', path: note.path, title }, title, where: notesWhere(note.path) })
  }
  const maps = mindmap.state.maps.map((map) => map.name)
  for (const map of maps) {
    const names =
      map === mindmap.state.currentMap
        ? mindmap.state.notes.map((note) => note.id)
        : await mindmapRepository.listNoteNames(map).catch(() => [] as string[])
    if (map !== mindmap.state.currentMap) closedMapNotes.set(nameKey(map), new Set(names.map(nameKey)))
    for (const name of names) {
      const title = stripExtension(name)
      list.push({ ref: { kind: 'map', map, note: name, title }, title, where: `Mapa · ${map}` })
    }
  }
  return list
}

/**
 * Filtra pelo texto digitado e ordena: quem começa com o texto vem primeiro, depois
 * o que está no fim da fila (`late`: 1 = tarefas concluídas, 2 = links), depois em
 * ordem alfabética. Itens com `matched` já foram filtrados por outra regra (links:
 * título ou endereço).
 */
function rank<T extends { title: string; matched?: boolean }>(list: T[], query: string, limit: number, late?: (item: T) => number): T[] {
  const q = fold(query.trim())
  return list
    .map((item) => ({ item, title: fold(item.title), late: late?.(item) ?? 0 }))
    .filter(({ item, title }) => !q || item.matched || title.includes(q))
    .sort((a, b) => Number(!a.title.startsWith(q)) - Number(!b.title.startsWith(q)) || a.late - b.late || a.title.localeCompare(b.title, 'pt-BR'))
    .slice(0, limit)
    .map(({ item }) => item)
}

/** Filtra e ordena as notas (quem começa com o texto digitado vem primeiro). */
export function filterCandidates(list: MentionCandidate[], query: string, limit = 50): MentionCandidate[] {
  return rank(list, query, limit)
}

/** Abre a nota da menção no módulo dela. */
export async function openMention(ref: NoteRef): Promise<void> {
  if (!useModulesStore().requireModule(ref.kind === 'note' ? 'notes' : 'mindmap', () => void openMention(ref))) return
  const missing = () => {
    showToast({ message: `A nota “${ref.title}” não foi encontrada (foi apagada ou renomeada fora do app).`, icon: 'alert', tone: 'error' })
  }
  if (ref.kind === 'note') {
    const note = notes.findByPath(ref.path)
    if (!note) return missing()
    tasks.closeDrawer()
    await navigateTo('/notes')
    notes.openNote(note.id)
    return
  }
  if (!mindmap.state.maps.some((map) => nameKey(map.name) === nameKey(ref.map))) return missing()
  const map = mindmap.state.maps.find((item) => nameKey(item.name) === nameKey(ref.map))!.name
  if (map !== mindmap.state.currentMap) await mindmap.switchMap(map)
  const note = mindmap.state.notes.find((item) => nameKey(item.id) === nameKey(ref.note))
  if (!note) return missing()
  tasks.closeDrawer()
  await navigateTo('/mindmap')
  mindmap.openNote(note.id)
}

// ── Menções dentro das notas (Notas e Mapa Mental) ───────────────────────────

/** Caminho da nota no workspace — é o que fica no link da menção. */
export function refPath(ref: NoteRef): string {
  return ref.kind === 'note' ? ref.path : `${DATA_PATHS.mindmapDir}/${ref.map}/${ref.note}`
}

/** Caminho no workspace → nota (null se o caminho não é de uma nota do 4notes). */
export function refFromPath(path: string): NoteRef | null {
  const parts = path.split('/')
  const file = parts.at(-1) ?? ''
  if (!/\.md$/i.test(file)) return null
  // Notas: soltas (notes/X.md) ou numa categoria (notes/Trabalho/X.md)
  if ((parts.length === 2 || parts.length === 3) && parts[0] === DATA_PATHS.notesDir) return { kind: 'note', path, title: stripExtension(file) }
  if (parts.length === 3 && parts[0] === DATA_PATHS.mindmapDir) return { kind: 'map', map: parts[1]!, note: file, title: stripExtension(file) }
  return null
}

const taskWhere = (task: Task) => {
  if (task.done) return 'Tarefa · concluída'
  const category = task.categoryId ? tasks.categoryById.value.get(task.categoryId) : null
  return category ? `Tarefa · ${category.name}` : 'Tarefa'
}

/** Um item da lista do "@": o que vai para a nota (MentionTarget) + a ordem dele. */
type RankedTarget = MentionTarget & { late: number; matched?: boolean }

/** Notas, tarefas e links salvos para mencionar dentro de uma nota (sem a própria nota). */
export async function searchMentions(query: string, exceptPath: string | null): Promise<MentionTarget[]> {
  const except = exceptPath ? nameKey(exceptPath) : null
  const noteTargets: RankedTarget[] = (await mentionCandidates())
    .filter((candidate) => nameKey(refPath(candidate.ref)) !== except)
    .map((candidate) => ({ path: refPath(candidate.ref), title: candidate.title, where: candidate.where, late: 0 }))
  const taskTargets: RankedTarget[] = tasks.state.tasks.map((task) => ({ path: taskMentionPath(task.id), title: task.title, where: taskWhere(task), late: task.done ? 1 : 0 }))
  // Links: a busca procura no título e no endereço (como na tela dos Links)
  const linkTargets: RankedTarget[] = (query.trim() ? searchLinks(links.state.links, query) : links.state.links).map((link) => ({
    path: '',
    url: link.url,
    title: link.title,
    where: `Link · ${displayHost(link.url)}`,
    late: 2,
    matched: true,
  }))
  return rank([...noteTargets, ...taskTargets, ...linkTargets], query, 30, (item) => item.late).map(({ path, title, where, url }) =>
    url ? { path, title, where, url } : { path, title, where },
  )
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

/** Título atual de uma nota mencionada; null se ela não existe mais. */
export function titleOfMentionPath(path: string): string | null {
  const ref = refFromPath(path)
  if (!ref) return null
  if (ref.kind === 'note') {
    const note = notes.findByPath(ref.path)
    return note ? noteTitle(note) : null
  }
  const map = mindmap.state.maps.find((item) => nameKey(item.name) === nameKey(ref.map))
  if (!map) return null
  if (map.name === mindmap.state.currentMap) {
    return mindmap.state.notes.some((note) => nameKey(note.id) === nameKey(ref.note)) ? stripExtension(ref.note) : null
  }
  const known = closedMapNotes.get(nameKey(map.name))
  return !known || known.has(nameKey(ref.note)) ? stripExtension(ref.note) : null
}

/** Como está o que foi mencionado (nota ou tarefa); null = não existe mais. */
export function describeMention(path: string): MentionState | null {
  const taskId = taskIdOf(path)
  if (taskId) {
    const task = tasks.findTask(taskId)
    return task ? { title: task.title, done: task.done } : null
  }
  const title = titleOfMentionPath(path)
  return title === null ? null : { title }
}

/** Abre a nota ou a tarefa mencionada dentro de uma nota. */
export function openMentionPath(path: string): void {
  const taskId = taskIdOf(path)
  if (taskId) {
    if (!tasks.findTask(taskId)) {
      showToast({ message: 'A tarefa não foi encontrada (foi excluída).', icon: 'alert', tone: 'error' })
      return
    }
    const open = () => void Promise.resolve(navigateTo('/tasks')).then(() => tasks.openEditor(taskId))
    if (useModulesStore().requireModule('tasks', open)) open()
    return
  }
  const ref = refFromPath(path)
  if (ref) void openMention(ref)
  else showToast({ message: 'Esse link não aponta para uma nota do 4notes.', icon: 'alert', tone: 'error' })
}

/** Muda quando títulos/estados que aparecem nos chips mudam (os editores redesenham). */
export const mentionRevision = computed(() => {
  const parts: string[] = []
  for (const task of tasks.state.tasks) parts.push(`${task.id}:${task.done ? 1 : 0}:${task.title}`)
  for (const note of notes.state.notes) if (note.path) parts.push(`${note.path}:${noteTitle(note)}`)
  parts.push(`${mindmap.state.currentMap}/${mindmap.state.notes.map((note) => note.id).join('/')}`)
  parts.push(mindmap.state.maps.map((map) => map.name).join('/'))
  // Ícones dos links salvos (aparecem na frente dos links mencionados)
  let withIcon = 0
  for (const link of links.state.links) if (link.icon) withIcon++
  parts.push(`links:${links.state.links.length}:${withIcon}:${links.state.iconVersion}`)
  return parts.join('|')
})

// ── Correção das menções quando algo muda de nome ────────────────────────────

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

/** Títulos de tarefas que mudaram e ainda não foram levados para o texto das notas. */
let retitled = new Map<string, string>()
const retitleSoon = debounce(() => {
  const titles = retitled
  retitled = new Map()
  if (titles.size) rewriteEverywhere((content, dir) => retitleTaskLinks(content, dir, titles))
}, 1000)

let installed = false
/** Liga o acompanhamento de renomeações (chamado uma vez, na inicialização). */
export function installMentionTracking(): void {
  if (installed) return
  installed = true
  onNoteChange((change) => {
    tasks.applyNoteChange(change, (ref) => (ref.kind === 'note' ? mentionTitle(ref) : null))
    // Menções dentro das notas: o link (e o texto dele) acompanham a nota renomeada
    const title = change.type === 'note-renamed' ? titleOfMentionPath(change.to) : change.type === 'map-note-renamed' ? stripExtension(change.to) : null
    rewriteEverywhere((content, dir) => renameMentionLinks(content, dir, change, title))
  })

  // Tarefa com título novo: o texto das menções a ela acompanha (em lote, enquanto você digita)
  let known = new Map<string, string>()
  watch(
    () => tasks.state.tasks.map((task) => [task.id, task.title] as const),
    (entries) => {
      const current = new Map(entries)
      for (const [id, title] of current) {
        const before = known.get(id)
        if (before !== undefined && before !== title) retitled.set(id, title)
      }
      known = current
      if (retitled.size) retitleSoon()
    },
  )
}
