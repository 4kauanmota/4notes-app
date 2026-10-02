/**
 * Estado do módulo NOTAS (notas rápidas, no estilo do Bloco de Notas).
 *
 * - Cada nota é um arquivo .md em <pasta de dados>/notes/.
 * - O título é a primeira linha com texto (sem o "#" do Markdown) e o nome do
 *   arquivo acompanha o título: "# Ideias" → notes/Ideias.md.
 * - Salvamento automático 0,6 s depois que você para de digitar, ao fechar a aba
 *   e ao fechar o app.
 * - Este módulo não conhece Tarefas nem o Mapa Mental; ao renomear uma nota ele só
 *   avisa (lib/note-events.ts), para as menções continuarem certas (stores/mentions.ts).
 */
import { computed, reactive } from 'vue'
import { errorCode, errorMessage, type FileEntry } from '#shared/ipc'
import { notifyError, showToast } from '~/composables/useToasts'
import { basename, nameKey, sanitizeFileName, stripExtension, uniqueName, UNTITLED } from '~/lib/files/filename'
import { notesRepository as repo } from '~/lib/notes/repository'
import { deriveTitle } from '~/lib/notes/title'
import { createJsonWriter } from '~/lib/storage/json-file'
import { emitNoteChange } from '~/lib/note-events'
import { DATA_PATHS } from '~/lib/storage/paths'
import { createId, debounce, SerialQueue, type Debounced } from '~/lib/utils/async'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

export interface QuickNote {
  /** Identificador da sessão (não é gravado no arquivo). */
  id: string
  /** Caminho relativo, ex.: "notes/Ideias.md". null = ainda não foi salva. */
  path: string | null
  content: string
  /** Último conteúdo gravado no disco. */
  savedContent: string
  mtimeMs: number
  status: SaveStatus
  error: string | null
}

const SAVE_DELAY = 600

const state = reactive({
  loaded: false,
  notes: [] as QuickNote[],
  openIds: [] as string[],
  activeId: null as string | null,
  sidebarOpen: true,
  search: '',
})

const queue = new SerialQueue()
const timers = new Map<string, Debounced<[]>>()
const closedTabs: string[] = []
const uiWriter = createJsonWriter(DATA_PATHS.notesUiState)

// ── Consultas ───────────────────────────────────────────────────────────────

function findNote(id: string | null): QuickNote | undefined {
  return id ? state.notes.find((note) => note.id === id) : undefined
}

function findByPath(path: string): QuickNote | undefined {
  const key = nameKey(path)
  return state.notes.find((note) => note.path !== null && nameKey(note.path) === key)
}

export function noteTitle(note: QuickNote): string {
  return deriveTitle(note.content) || UNTITLED
}

const visibleNotes = computed(() =>
  state.notes.filter((note) => note.path !== null || note.content.trim() !== '').sort((a, b) => b.mtimeMs - a.mtimeMs),
)

const filteredNotes = computed(() => {
  const query = state.search.trim().toLocaleLowerCase('pt-BR')
  if (!query) return visibleNotes.value
  return visibleNotes.value.filter((note) => note.content.toLocaleLowerCase('pt-BR').includes(query))
})

const openTabs = computed(() => state.openIds.map((id) => findNote(id)).filter((note): note is QuickNote => !!note))
const activeNote = computed(() => findNote(state.activeId) ?? null)

// ── Estado da interface (abas abertas) ──────────────────────────────────────

function persistUi(): void {
  uiWriter.save(() => {
    const pathOf = (id: string | null) => findNote(id)?.path ?? null
    return {
      openTabs: state.openIds.map(pathOf).filter((path): path is string => !!path),
      activeTab: pathOf(state.activeId),
      sidebarOpen: state.sidebarOpen,
    }
  })
}

// ── Carregamento ────────────────────────────────────────────────────────────

function fromFile(entry: FileEntry): QuickNote {
  const content = entry.content ?? ''
  return { id: createId('n'), path: entry.path, content, savedContent: content, mtimeMs: entry.mtimeMs, status: 'saved', error: null }
}

async function load(): Promise<void> {
  const [files, ui] = await Promise.all([repo.list(), repo.readUiState()])
  state.notes = files.map(fromFile)
  state.sidebarOpen = ui.sidebarOpen
  const ids: string[] = []
  for (const path of ui.openTabs) {
    const note = findByPath(path)
    if (note && !ids.includes(note.id)) ids.push(note.id)
  }
  state.openIds = ids
  state.activeId = (ui.activeTab ? findByPath(ui.activeTab)?.id : undefined) ?? ids[0] ?? null
  state.loaded = true
}

// ── Abas ────────────────────────────────────────────────────────────────────

function openNote(id: string): void {
  if (!findNote(id)) return
  if (!state.openIds.includes(id)) state.openIds.push(id)
  state.activeId = id
  persistUi()
}

function createNote(content = ''): QuickNote {
  const note: QuickNote = {
    id: createId('n'),
    path: null,
    content,
    savedContent: '',
    mtimeMs: Date.now(),
    status: content ? 'dirty' : 'saved',
    error: null,
  }
  state.notes.push(note)
  openNote(note.id)
  if (content) scheduleSave(note.id)
  return note
}

function removeFromState(id: string): void {
  const index = state.openIds.indexOf(id)
  if (index >= 0) {
    state.openIds.splice(index, 1)
    if (state.activeId === id) state.activeId = state.openIds[Math.min(index, state.openIds.length - 1)] ?? null
  }
  const position = state.notes.findIndex((note) => note.id === id)
  if (position >= 0) state.notes.splice(position, 1)
  timers.get(id)?.cancel()
  timers.delete(id)
  persistUi()
}

async function closeTab(id: string): Promise<void> {
  const index = state.openIds.indexOf(id)
  if (index < 0) return
  state.openIds.splice(index, 1)
  if (state.activeId === id) state.activeId = state.openIds[Math.min(index, state.openIds.length - 1)] ?? null
  persistUi()
  await flushNote(id)
  const note = findNote(id)
  if (!note) return
  if (!note.path && !note.content.trim()) {
    removeFromState(id) // aba vazia que nunca foi salva: simplesmente descarta
  } else {
    closedTabs.push(id)
    if (closedTabs.length > 30) closedTabs.shift()
  }
}

function closeOtherTabs(id: string): void {
  for (const other of [...state.openIds]) if (other !== id) void closeTab(other)
}

function reopenClosedTab(): boolean {
  while (closedTabs.length) {
    const id = closedTabs.pop()!
    if (findNote(id) && !state.openIds.includes(id)) {
      openNote(id)
      return true
    }
  }
  return false
}

function activate(id: string): void {
  if (!state.openIds.includes(id) || state.activeId === id) return
  state.activeId = id
  persistUi()
}

function cycleTab(direction: 1 | -1): void {
  const count = state.openIds.length
  if (count < 2) return
  const current = state.activeId ? state.openIds.indexOf(state.activeId) : 0
  state.activeId = state.openIds[(current + direction + count) % count]!
  persistUi()
}

function moveTab(from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= state.openIds.length || to >= state.openIds.length) return
  const [id] = state.openIds.splice(from, 1)
  state.openIds.splice(to, 0, id!)
  persistUi()
}

function toggleSidebar(): void {
  state.sidebarOpen = !state.sidebarOpen
  persistUi()
}

// ── Edição e salvamento ─────────────────────────────────────────────────────

function updateContent(id: string, content: string): void {
  const note = findNote(id)
  if (!note || note.content === content) return
  note.content = content
  if (note.status !== 'saving') note.status = note.path && content === note.savedContent ? 'saved' : 'dirty'
  scheduleSave(id)
}

/**
 * Reescreve o texto das notas com `transform` (null = sem mudança). Usado para
 * manter as menções em dia quando outra nota muda de nome.
 */
function rewriteContents(transform: (content: string) => string | null): void {
  for (const note of state.notes) {
    const next = transform(note.content)
    if (next !== null && next !== note.content) updateContent(note.id, next)
  }
}

function scheduleSave(id: string): void {
  let timer = timers.get(id)
  if (!timer) {
    timer = debounce(() => void saveNote(id), SAVE_DELAY)
    timers.set(id, timer)
  }
  timer()
}

/** Salva imediatamente (se houver algo pendente) e espera terminar. */
async function flushNote(id: string): Promise<void> {
  const timer = timers.get(id)
  if (timer?.pending()) {
    timer.cancel()
    await saveNote(id)
  } else {
    await queue.run(id, async () => undefined)
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** O nome atual já corresponde ao título? ("Ideia (2)" também conta para "Ideia".) */
function nameMatchesTitle(path: string, desiredBase: string): boolean {
  const current = stripExtension(basename(path))
  return current === desiredBase || new RegExp(`^${escapeRegExp(desiredBase)} \\(\\d+\\)$`, 'i').test(current)
}

/** Encontra um caminho livre para o nome desejado (conferindo a memória e o disco). */
async function freePath(base: string, note: QuickNote): Promise<string> {
  const skip = new Set<string>()
  const takenInMemory = (candidate: string) => {
    const key = nameKey(repo.pathFor(candidate))
    return state.notes.some((other) => other.id !== note.id && other.path !== null && nameKey(other.path) === key)
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = uniqueName(base, (candidate) => takenInMemory(candidate) || skip.has(nameKey(candidate)))
    const path = repo.pathFor(name)
    const own = note.path !== null && nameKey(note.path) === nameKey(path)
    if (own || !(await repo.exists(path))) return path
    skip.add(nameKey(name))
  }
  return repo.pathFor(`${base} ${Date.now()}`)
}

function saveNote(id: string): Promise<void> {
  return queue.run(id, async () => {
    const note = findNote(id)
    if (!note) return
    const content = note.content
    if (!note.path && !content.trim()) {
      note.status = 'saved' // nota nova e vazia: não cria arquivo
      return
    }

    const title = deriveTitle(content)
    const desiredBase = sanitizeFileName(title || UNTITLED)
    let target = note.path
    if (!target || (title && !nameMatchesTitle(target, desiredBase))) target = await freePath(desiredBase, note)
    if (target === note.path && content === note.savedContent) {
      note.status = 'saved'
      return
    }

    note.status = 'saving'
    try {
      if (note.path && target !== note.path) {
        try {
          await repo.rename(note.path, target)
        } catch (error) {
          const code = errorCode(error)
          if (code === 'EEXIST') {
            target = await freePath(desiredBase, note)
            await repo.rename(note.path, target)
          } else if (code !== 'ENOENT') {
            throw error // ENOENT = o arquivo antigo sumiu; ele será recriado com o novo nome
          }
        }
        const previous = note.path
        note.path = target
        persistUi()
        emitNoteChange({ type: 'note-renamed', from: previous, to: target })
      }
      const entry = await repo.write(target, content)
      const isNew = note.path === null
      note.path = target
      note.savedContent = content
      note.mtimeMs = entry.mtimeMs
      note.error = null
      note.status = note.content === content ? 'saved' : 'dirty'
      if (isNew) persistUi()
    } catch (error) {
      note.status = 'error'
      note.error = errorMessage(error)
      notifyError(`Não foi possível salvar a nota: ${note.error}`, error)
    }
  })
}

async function saveNow(id: string): Promise<void> {
  timers.get(id)?.cancel()
  await saveNote(id)
}

async function flushAll(): Promise<void> {
  for (const [id, timer] of timers) {
    if (timer.pending()) {
      timer.cancel()
      void saveNote(id)
    }
  }
  await queue.idle()
  await uiWriter.flush()
}

// ── Excluir / duplicar ──────────────────────────────────────────────────────

async function deleteNote(id: string): Promise<void> {
  const note = findNote(id)
  if (!note) return
  timers.get(id)?.cancel()
  await queue.run(id, async () => undefined) // espera salvamentos em andamento
  const snapshot = { content: note.content, wasOpen: state.openIds.includes(id), title: noteTitle(note) }
  if (note.path) {
    try {
      await repo.trash(note.path)
    } catch (error) {
      notifyError(`Não foi possível excluir: ${errorMessage(error)}`, error)
      return
    }
  }
  removeFromState(id)
  if (!snapshot.content.trim()) return
  showToast({
    message: `“${snapshot.title}” foi para a Lixeira`,
    icon: 'trash',
    action: {
      label: 'Desfazer',
      run: async () => {
        const restored = createNote(snapshot.content)
        if (!snapshot.wasOpen) {
          void closeTab(restored.id)
        }
        await saveNow(restored.id)
      },
    },
  })
}

function duplicateNote(id: string): void {
  const note = findNote(id)
  if (note) createNote(note.content)
}

function revealNote(id: string): void {
  const note = findNote(id)
  if (note?.path) void repo.reveal(note.path)
}

// ── Sincronização com mudanças feitas fora do app ───────────────────────────

let refreshing = false
async function refreshFromDisk(): Promise<void> {
  if (!state.loaded || refreshing) return
  refreshing = true
  try {
    await flushAll()
    const files = await repo.list()
    const remaining = new Map(files.map((file) => [nameKey(file.path), file]))
    for (const note of [...state.notes]) {
      if (!note.path) continue
      const key = nameKey(note.path)
      const file = remaining.get(key)
      remaining.delete(key)
      if (!file) {
        // Apagado fora do app: some da lista (se tiver alterações não salvas, será recriado)
        if (note.status === 'saved') removeFromState(note.id)
        else note.path = null
        continue
      }
      if (file.path !== note.path) {
        emitNoteChange({ type: 'note-renamed', from: note.path, to: file.path })
        note.path = file.path
      }
      if (note.status === 'saved' && (file.content ?? '') !== note.savedContent) {
        note.content = file.content ?? ''
        note.savedContent = note.content
        note.mtimeMs = file.mtimeMs
      }
    }
    for (const file of remaining.values()) state.notes.push(fromFile(file))
  } catch (error) {
    console.warn('[4notes] Falha ao sincronizar notas:', error)
  } finally {
    refreshing = false
  }
}

export function useNotesStore() {
  return {
    state,
    visibleNotes,
    filteredNotes,
    openTabs,
    activeNote,
    findByPath,
    load,
    createNote,
    openNote,
    closeTab,
    closeOtherTabs,
    reopenClosedTab,
    activate,
    cycleTab,
    moveTab,
    toggleSidebar,
    updateContent,
    rewriteContents,
    saveNow,
    flushAll,
    deleteNote,
    duplicateNote,
    revealNote,
    refreshFromDisk,
  }
}
