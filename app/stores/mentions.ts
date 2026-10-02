/**
 * Menções a notas — a ponte entre Tarefas, Notas e Mapa Mental (a única ligação
 * entre os módulos, pedida para as menções):
 *
 * - Lista as notas que podem ser mencionadas (Notas e todos os mapas).
 * - Abre a nota de uma menção (vai para o módulo certo, troca de mapa se precisar).
 * - Menções nas tarefas ficam no tasks.json; menções dentro das Notas são links
 *   Markdown para o .md da nota (lib/notes/mention-links.ts).
 * - Quando uma nota ou um mapa é renomeado no app (lib/note-events.ts), corrige as
 *   menções das tarefas e das Notas, para elas continuarem funcionando depois de
 *   reabrir o app.
 */
import { showToast } from '~/composables/useToasts'
import type { MentionTarget } from '~/lib/editor/host'
import { nameKey, stripExtension } from '~/lib/files/filename'
import { mindmapRepository } from '~/lib/mindmap/repository'
import { onNoteChange } from '~/lib/note-events'
import { renameMentionLinks } from '~/lib/notes/mention-links'
import { DATA_PATHS } from '~/lib/storage/paths'
import type { NoteRef } from '~/lib/tasks/mentions'
import { useMindmapStore } from './mindmap'
import { noteTitle, useNotesStore } from './notes'
import { useTasksStore } from './tasks'

export interface MentionCandidate {
  ref: NoteRef
  title: string
  /** "Notas" ou "Mapa · Principal". */
  where: string
}

const notes = useNotesStore()
const mindmap = useMindmapStore()
const tasks = useTasksStore()

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR')

/** Título atual da nota mencionada (o da menção, se a nota não estiver carregada). */
export function mentionTitle(ref: NoteRef): string {
  if (ref.kind === 'note') {
    const note = notes.findByPath(ref.path)
    return note ? noteTitle(note) : ref.title
  }
  return stripExtension(ref.note)
}

export function mentionWhere(ref: NoteRef): string {
  return ref.kind === 'note' ? 'Notas' : `Mapa · ${ref.map}`
}

/** Notas que existem nos mapas fechados (anotado ao listar as notas para mencionar). */
const closedMapNotes = new Map<string, Set<string>>()

/** Todas as notas que podem ser mencionadas (as do mapa aberto já estão na memória). */
export async function mentionCandidates(): Promise<MentionCandidate[]> {
  const list: MentionCandidate[] = []
  for (const note of notes.visibleNotes.value) {
    if (!note.path) continue
    const title = noteTitle(note)
    list.push({ ref: { kind: 'note', path: note.path, title }, title, where: 'Notas' })
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

/** Filtra e ordena (quem começa com o texto digitado vem primeiro). */
export function filterCandidates(list: MentionCandidate[], query: string, limit = 50): MentionCandidate[] {
  const q = fold(query.trim())
  const scored = list
    .map((item) => ({ item, title: fold(item.title) }))
    .filter(({ title }) => !q || title.includes(q))
    .sort((a, b) => Number(!a.title.startsWith(q)) - Number(!b.title.startsWith(q)) || a.title.localeCompare(b.title, 'pt-BR'))
  return scored.slice(0, limit).map(({ item }) => item)
}

/** Abre a nota da menção no módulo dela. */
export async function openMention(ref: NoteRef): Promise<void> {
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

// ── Menções dentro das Notas ─────────────────────────────────────────────────

/** Caminho da nota no workspace — é o que fica no link da menção. */
export function refPath(ref: NoteRef): string {
  return ref.kind === 'note' ? ref.path : `${DATA_PATHS.mindmapDir}/${ref.map}/${ref.note}`
}

/** Caminho no workspace → nota (null se o caminho não é de uma nota do 4notes). */
export function refFromPath(path: string): NoteRef | null {
  const parts = path.split('/')
  const file = parts.at(-1) ?? ''
  if (!/\.md$/i.test(file)) return null
  if (parts.length === 2 && parts[0] === DATA_PATHS.notesDir) return { kind: 'note', path, title: stripExtension(file) }
  if (parts.length === 3 && parts[0] === DATA_PATHS.mindmapDir) return { kind: 'map', map: parts[1]!, note: file, title: stripExtension(file) }
  return null
}

/** Notas para mencionar dentro de uma nota (sem a própria nota). */
export async function searchNoteMentions(query: string, exceptPath: string | null): Promise<MentionTarget[]> {
  const except = exceptPath ? nameKey(exceptPath) : null
  const list = (await mentionCandidates()).filter((candidate) => nameKey(refPath(candidate.ref)) !== except)
  return filterCandidates(list, query, 30).map((candidate) => ({ path: refPath(candidate.ref), title: candidate.title, where: candidate.where }))
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

/** Abre a nota mencionada dentro de uma nota. */
export function openMentionPath(path: string): void {
  const ref = refFromPath(path)
  if (ref) void openMention(ref)
  else showToast({ message: 'Esse link não aponta para uma nota do 4notes.', icon: 'alert', tone: 'error' })
}

let installed = false
/** Liga o acompanhamento de renomeações (chamado uma vez, na inicialização). */
export function installMentionTracking(): void {
  if (installed) return
  installed = true
  onNoteChange((change) => {
    tasks.applyNoteChange(change, (ref) => (ref.kind === 'note' ? mentionTitle(ref) : null))
    // Menções dentro das Notas: o link (e o texto dele) acompanham a nota renomeada
    const title = change.type === 'note-renamed' ? titleOfMentionPath(change.to) : change.type === 'map-note-renamed' ? stripExtension(change.to) : null
    notes.rewriteContents((content) => renameMentionLinks(content, DATA_PATHS.notesDir, change, title))
  })
}
