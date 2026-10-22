/**
 * Estado do módulo NOTAS (notas rápidas, no estilo do Bloco de Notas).
 *
 * - Cada nota é um arquivo .md em <pasta de dados>/notes/ — solto (sem categoria)
 *   ou na pasta de uma categoria: notes/<Categoria>/ (ver lib/notes/categories.ts).
 * - O título é a primeira linha com texto (sem o "#" do Markdown) e o nome do
 *   arquivo acompanha o título: "# Ideias" → notes/Ideias.md.
 * - Salvamento automático 0,6 s depois que você para de digitar, ao fechar a aba
 *   e ao fechar o app.
 * - Este módulo não conhece Tarefas nem o Mapa Mental; quando uma nota muda de
 *   nome ou de pasta ele só avisa (lib/note-events.ts), para as menções
 *   continuarem certas (stores/mentions.ts).
 */
import { computed, reactive, watch } from 'vue'
import { errorCode, errorMessage, type FileEntry } from '#shared/ipc'
import { notifyError, showToast } from '~/composables/useToasts'
import type { PaletteColor } from '~/lib/colors'
import { basename, nameKey, sanitizeFileName, stripExtension, uniqueName, UNTITLED } from '~/lib/files/filename'
import {
  categoryDir,
  categoryImageName,
  categoryImagePath,
  categoryNameProblem,
  categoryOfDir,
  categoryOfPath,
  mergeWithFolders,
  noteDirOf,
  type NoteCategory,
} from '~/lib/notes/categories'
import { matchCategory, titleLineFinished } from '~/lib/notes/auto-category'
import { rebaseLinks } from '~/lib/notes/mention-links'
import { DEFAULT_NOTES_SETTINGS, normalizeNotesSettings, normalizeNotesView, notesRepository as repo, type NotesSettings } from '~/lib/notes/repository'
import { deriveTitle } from '~/lib/notes/title'
import { nextVersion, previousVersion } from '~/lib/notes/versions'
import { emitNoteChange } from '~/lib/note-events'
import { readDeviceState, writeDeviceState } from '~/lib/storage/device-state'
import { DATA_PATHS } from '~/lib/storage/paths'
import { createId, debounce, SerialQueue, type Debounced } from '~/lib/utils/async'
import { onSettingsChange, settingsSection, updateSettingsSection } from './settings'
import { trashPlace } from '~/lib/platform'
import { registerCategoryModule, useCategoriesStore, type MemberRef, type SharedCategory } from './categories'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

export interface QuickNote {
  /** Identificador da sessão (não é gravado no arquivo). */
  id: string
  /** Caminho relativo, ex.: "notes/Ideias.md". null = ainda não foi salva. */
  path: string | null
  /** Pasta da nota: "notes" (sem categoria) ou "notes/<Categoria>". */
  dir: string
  content: string
  /** Último conteúdo gravado no disco. */
  savedContent: string
  mtimeMs: number
  status: SaveStatus
  error: string | null
  /**
   * Texto com que a nota nova começou (ex.: "# 4notes ", criada pelo + de uma pasta
   * pelo título). Enquanto o texto for só isso, a nota conta como vazia: não cria
   * arquivo, não aparece na lista e fechar a aba simplesmente a descarta.
   */
  template?: string
  /**
   * Nota nova criada fora das categorias, nesta sessão: com a "categoria automática
   * pelo título" ligada, vai para a categoria em comum quando o título fica pronto.
   */
  autoCategory?: boolean
}

const SAVE_DELAY = 600
const ROOT = DATA_PATHS.notesDir

const state = reactive({
  loaded: false,
  notes: [] as QuickNote[],
  openIds: [] as string[],
  activeId: null as string | null,
  /**
   * A aba temporária (1.7.0), como nos editores de código: o clique simples numa nota
   * da lista abre nela, trocando a nota que estava ali em vez de criar outra aba. Vira
   * fixa com o duplo clique (na lista ou na aba), ao editar a nota ou pelo menu da aba.
   * No máximo uma; null = todas as abas são fixas.
   */
  previewId: null as string | null,
  sidebarOpen: true,
  search: '',
  /** Categorias, na ordem do categorias.json (as pastas criadas fora do app vêm no fim). */
  categories: [] as NoteCategory[],
  /** Categorias recolhidas na lista lateral (chaves sem diferenciar maiúsculas). */
  collapsedCategories: [] as string[],
  /** Pastas (pelo título) abertas na lista lateral: "<categoria>|<chave da pasta>". */
  openFolders: [] as string[],
  /** Muda quando a imagem de uma categoria é trocada (a lista recarrega a imagem). */
  imageVersion: 0,
  /** Configurações das Notas (Configurações › Módulos), guardadas no settings.json do workspace. */
  settings: { ...DEFAULT_NOTES_SETTINGS } as NotesSettings,
})

const queue = new SerialQueue()
const timers = new Map<string, Debounced<[]>>()
const closedTabs: string[] = []
/** Último categorias.json lido ou gravado (para perceber edições feitas fora do app). */
let categoriesRaw: string | null = null

// ── Consultas ───────────────────────────────────────────────────────────────

const sameDir = (a: string, b: string) => nameKey(a) === nameKey(b)

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

/** Nota nova que ainda não tem nada de seu (vazia ou só com o texto inicial): não vira arquivo. */
export function isBlankNote(note: QuickNote): boolean {
  return !note.path && (!note.content.trim() || note.content === note.template)
}

function findCategory(name: string | null): NoteCategory | undefined {
  return name ? state.categories.find((category) => nameKey(category.name) === nameKey(name)) : undefined
}

/** Categoria da nota (null = sem categoria). */
function categoryOf(note: QuickNote): NoteCategory | null {
  return findCategory(categoryOfDir(note.dir)) ?? null
}

const visibleNotes = computed(() => state.notes.filter((note) => !isBlankNote(note)).sort((a, b) => b.mtimeMs - a.mtimeMs))

const filteredNotes = computed(() => {
  const query = state.search.trim().toLocaleLowerCase('pt-BR')
  if (!query) return visibleNotes.value
  return visibleNotes.value.filter((note) => note.content.toLocaleLowerCase('pt-BR').includes(query))
})

const openTabs = computed(() => state.openIds.map((id) => findNote(id)).filter((note): note is QuickNote => !!note))
const activeNote = computed(() => findNote(state.activeId) ?? null)

/** As outras notas da mesma categoria (ou as sem categoria), onde ficam as versões de `note`. */
function versionSiblings(note: QuickNote): QuickNote[] {
  return visibleNotes.value.filter((other) => other.id !== note.id && sameDir(other.dir, note.dir))
}

/**
 * Versão anterior da nota ("4notes 1.4.1" → "4notes 1.4.0"), entre as notas da mesma
 * categoria (ou entre as sem categoria) — regras em lib/notes/versions.ts. null = não há.
 */
function previousVersionOf(note: QuickNote): { note: QuickNote; label: string } | null {
  if (isBlankNote(note)) return null
  const found = previousVersion(noteTitle(note), versionSiblings(note), noteTitle)
  return found ? { note: found.item, label: found.version.label } : null
}

/** Próxima versão da nota ("4notes 1.4.0" → "4notes 1.4.1"), com as mesmas regras. null = não há. */
function nextVersionOf(note: QuickNote): { note: QuickNote; label: string } | null {
  if (isBlankNote(note)) return null
  const found = nextVersion(noteTitle(note), versionSiblings(note), noteTitle)
  return found ? { note: found.item, label: found.version.label } : null
}

// ── Estado da tela (abas abertas, lista lateral): deste aparelho ────────────

/** Grava o estado da tela no aparelho (os caminhos são lidos na hora de gravar). */
const persistUi = debounce(() => {
  const pathOf = (id: string | null) => findNote(id)?.path ?? null
  writeDeviceState('notes', {
    openTabs: state.openIds.map(pathOf).filter((path): path is string => !!path),
    activeTab: pathOf(state.activeId),
    previewTab: pathOf(state.previewId),
    sidebarOpen: state.sidebarOpen,
    collapsedCategories: state.collapsedCategories,
    openFolders: state.openFolders,
  })
}, 200)

// ── Configurações (settings.json do workspace: iguais em todos os aparelhos) ──

function updateSettings(patch: Partial<NotesSettings>): void {
  Object.assign(state.settings, patch)
  updateSettingsSection('notes', { ...state.settings })
}

// Mudaram em outro aparelho (settings.json relido)
onSettingsChange((changed) => {
  if (changed.has('notes')) state.settings = normalizeNotesSettings(settingsSection('notes'))
})

// ── Carregamento ────────────────────────────────────────────────────────────

function fromFile(entry: FileEntry): QuickNote {
  const content = entry.content ?? ''
  return {
    id: createId('n'),
    path: entry.path,
    dir: noteDirOf(entry.path),
    content,
    savedContent: content,
    mtimeMs: entry.mtimeMs,
    status: 'saved',
    error: null,
  }
}

/** Pastas de categoria que têm notas (inclusive as criadas fora do app). */
function foldersWithNotes(): string[] {
  const folders = new Map<string, string>()
  for (const note of state.notes) {
    const folder = note.path ? categoryOfPath(note.path) : null
    if (folder && !folders.has(nameKey(folder))) folders.set(nameKey(folder), folder)
  }
  return [...folders.values()]
}

async function readSavedCategories(): Promise<NoteCategory[]> {
  const result = await repo.readCategories()
  if (result.status !== 'invalid') {
    categoriesRaw = result.raw
    return result.categories
  }
  // categorias.json editado à mão com erro: guarda uma cópia; as pastas continuam valendo
  categoriesRaw = result.raw
  const backup = await repo.backupBrokenCategories(result.raw).catch(() => null)
  showToast({
    message: `O categorias.json estava com erro; as cores e imagens das categorias voltaram ao padrão${backup ? ` (cópia em ${backup})` : ''}.`,
    icon: 'alert',
    tone: 'error',
    duration: 9000,
  })
  return []
}

async function load(): Promise<void> {
  const files = await repo.list()
  const ui = normalizeNotesView(readDeviceState('notes'))
  state.notes = files.map(fromFile)
  state.categories = mergeWithFolders(await readSavedCategories(), foldersWithNotes())
  state.sidebarOpen = ui.sidebarOpen
  state.collapsedCategories = ui.collapsedCategories
  state.openFolders = ui.openFolders
  state.settings = normalizeNotesSettings(settingsSection('notes'))
  const ids: string[] = []
  for (const path of ui.openTabs) {
    const note = findByPath(path)
    if (note && !ids.includes(note.id)) ids.push(note.id)
  }
  state.openIds = ids
  state.activeId = (ui.activeTab ? findByPath(ui.activeTab)?.id : undefined) ?? ids[0] ?? null
  const preview = ui.previewTab ? findByPath(ui.previewTab)?.id : undefined
  state.previewId = preview && ids.includes(preview) ? preview : null
  state.loaded = true
}

// ── Abas ────────────────────────────────────────────────────────────────────

/** Quem quer saber quando uma nota é aberta (no celular, a tela troca da lista para a nota). */
const openListeners = new Set<(id: string) => void>()

export function onNoteOpened(listener: (id: string) => void): () => void {
  openListeners.add(listener)
  return () => openListeners.delete(listener)
}

export interface OpenNoteOptions {
  /**
   * true = abre na aba temporária (o clique simples na lista): se já houver uma, a nota
   * que estava nela sai (salva antes) e esta entra no mesmo lugar. Uma nota que já está
   * aberta só é selecionada, temporária ou fixa.
   * false (padrão) = aba fixa; se a nota já estiver na aba temporária, ela vira fixa.
   */
  preview?: boolean
}

function openNote(id: string, options: OpenNoteOptions = {}): void {
  if (!findNote(id)) return
  if (state.openIds.includes(id)) {
    if (!options.preview && state.previewId === id) state.previewId = null
  } else if (options.preview && state.previewId && state.openIds.includes(state.previewId)) {
    // Troca a nota da aba temporária (no mesmo lugar da faixa)
    const replaced = state.previewId
    state.openIds.splice(state.openIds.indexOf(replaced), 1, id)
    state.previewId = id
    void retireTab(replaced)
  } else {
    state.openIds.push(id)
    state.previewId = options.preview ? id : state.previewId
  }
  state.activeId = id
  persistUi()
  for (const listener of openListeners) listener(id)
}

/** A aba temporária vira fixa: não é mais trocada pelo clique simples em outra nota. */
function pinTab(id: string): void {
  if (state.previewId !== id) return
  state.previewId = null
  persistUi()
}

/**
 * Uma nota que saiu das abas (fechada ou trocada na aba temporária): grava o que
 * estiver pendente; uma nota nova que ficou vazia é descartada, as outras podem ser
 * reabertas (Ctrl+Shift+T).
 */
async function retireTab(id: string): Promise<void> {
  await flushNote(id)
  const note = findNote(id)
  if (!note || state.openIds.includes(id)) return
  if (isBlankNote(note)) {
    removeFromState(id) // aba vazia (ou só com o texto inicial) que nunca foi salva: simplesmente descarta
  } else {
    closedTabs.push(id)
    if (closedTabs.length > 30) closedTabs.shift()
    void considerAutoCategory(id, true)
  }
}

/**
 * Nota nova (vazia ou com `content`) na categoria `category` (null = sem categoria).
 * `template: true` = `content` é só o começo sugerido (ex.: o título da pasta): a nota
 * só vira arquivo quando você escrever algo além dele.
 * `autoCategory: true` = criada por você fora das categorias: pode ir sozinha para a
 * categoria em comum (se a configuração estiver ligada).
 */
function createNote(content = '', category: string | null = null, options: { template?: boolean; autoCategory?: boolean } = {}): QuickNote {
  const template = options.template === true && !!content
  const target = findCategory(category)?.name ?? null
  const note: QuickNote = {
    id: createId('n'),
    path: null,
    dir: categoryDir(target),
    content,
    savedContent: '',
    mtimeMs: Date.now(),
    status: content && !template ? 'dirty' : 'saved',
    error: null,
    template: template ? content : undefined,
    autoCategory: !target && options.autoCategory === true ? true : undefined,
  }
  state.notes.push(note)
  openNote(note.id)
  if (content && !template) scheduleSave(note.id)
  return note
}

function removeFromState(id: string): void {
  const index = state.openIds.indexOf(id)
  if (index >= 0) {
    state.openIds.splice(index, 1)
    if (state.activeId === id) state.activeId = state.openIds[Math.min(index, state.openIds.length - 1)] ?? null
  }
  if (state.previewId === id) state.previewId = null
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
  if (state.previewId === id) state.previewId = null
  persistUi()
  await retireTab(id)
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

// ── Lista lateral: categorias recolhidas e pastas abertas ────────────────────

function isCategoryCollapsed(name: string): boolean {
  return state.collapsedCategories.includes(nameKey(name))
}

function setCategoryCollapsed(name: string, collapsed: boolean): void {
  const key = nameKey(name)
  const list = state.collapsedCategories.filter((item) => item !== key)
  if (collapsed) list.push(key)
  state.collapsedCategories = list
  persistUi()
}

/** Chave de uma pasta (pelo título) dentro de uma categoria (null = sem categoria). */
export const folderStateKey = (category: string | null, folderKey: string) => `${category ? nameKey(category) : ''}|${folderKey}`

function isFolderOpen(category: string | null, folderKey: string): boolean {
  return state.openFolders.includes(folderStateKey(category, folderKey))
}

function setFolderOpen(category: string | null, folderKey: string, open: boolean): void {
  const key = folderStateKey(category, folderKey)
  if (open === state.openFolders.includes(key)) return
  state.openFolders = open ? [...state.openFolders, key] : state.openFolders.filter((item) => item !== key)
  persistUi()
}

// ── Edição e salvamento ─────────────────────────────────────────────────────

function updateContent(id: string, content: string): void {
  const note = findNote(id)
  if (!note || note.content === content) return
  note.content = content
  if (note.status !== 'saving') note.status = isBlankNote(note) || (note.path && content === note.savedContent) ? 'saved' : 'dirty'
  scheduleSave(id)
  if (note.autoCategory && titleLineFinished(content)) void considerAutoCategory(id)
}

// ── Categoria automática pelo título ────────────────────────────────────────

/**
 * Nota nova sem categoria: quando o título fica pronto (Enter depois dele, ou ao
 * sair da nota), vai para a categoria que já tem notas com o mesmo começo de título
 * — se a configuração estiver ligada. Decide uma vez só.
 */
async function considerAutoCategory(id: string, leaving = false): Promise<void> {
  const note = findNote(id)
  if (!note?.autoCategory || isBlankNote(note)) return
  if (!state.settings.autoCategory || !sameDir(note.dir, ROOT)) {
    note.autoCategory = undefined
    return
  }
  const title = deriveTitle(note.content)
  if (!title || (!leaving && !titleLineFinished(note.content))) return
  note.autoCategory = undefined
  const groups = state.categories.map((category) => {
    const dir = categoryDir(category.name)
    const titles = state.notes.filter((other) => other.id !== id && !isBlankNote(other) && sameDir(other.dir, dir)).map((other) => deriveTitle(other.content))
    return { category: category.name, titles: titles.filter(Boolean) }
  })
  const target = matchCategory(title, groups)
  if (target) await moveToCategory(id, target, { auto: true })
}

// Saiu de uma nota nova (outra aba, outra nota): o título dela está pronto
watch(
  () => state.activeId,
  (_current, previous) => {
    if (previous) void considerAutoCategory(previous, true)
  },
)

/**
 * Reescreve o texto das notas com `transform` (recebe o texto e a pasta da nota;
 * null = sem mudança). Usado para manter as menções em dia quando algo muda de nome.
 */
function rewriteContents(transform: (content: string, dir: string) => string | null): void {
  for (const note of state.notes) {
    const next = transform(note.content, note.dir)
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

/** Encontra um caminho livre para o nome desejado na pasta `dir` (conferindo a memória e o disco). */
async function freePath(dir: string, base: string, note: QuickNote): Promise<string> {
  const skip = new Set<string>()
  const takenInMemory = (candidate: string) => {
    const key = nameKey(repo.pathFor(dir, candidate))
    return state.notes.some((other) => other.id !== note.id && other.path !== null && nameKey(other.path) === key)
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = uniqueName(base, (candidate) => takenInMemory(candidate) || skip.has(nameKey(candidate)))
    const path = repo.pathFor(dir, name)
    const own = note.path !== null && nameKey(note.path) === nameKey(path)
    if (own || !(await repo.exists(path))) return path
    skip.add(nameKey(name))
  }
  return repo.pathFor(dir, `${base} ${Date.now()}`)
}

function saveNote(id: string): Promise<void> {
  return queue.run(id, async () => {
    const note = findNote(id)
    if (!note) return
    const content = note.content
    if (isBlankNote(note)) {
      note.status = 'saved' // nota nova e vazia (ou só com o texto inicial): não cria arquivo
      return
    }

    const title = deriveTitle(content)
    const desiredBase = sanitizeFileName(title || UNTITLED)
    let target = note.path
    if (!target || (title && !nameMatchesTitle(target, desiredBase))) target = await freePath(note.dir, desiredBase, note)
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
            target = await freePath(note.dir, desiredBase, note)
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
  persistUi.flush()
}

// ── Excluir / duplicar ──────────────────────────────────────────────────────

async function deleteNote(id: string): Promise<void> {
  const note = findNote(id)
  if (!note) return
  timers.get(id)?.cancel()
  await queue.run(id, async () => undefined) // espera salvamentos em andamento
  const snapshot = { content: note.content, wasOpen: state.openIds.includes(id), title: noteTitle(note), category: categoryOf(note)?.name ?? null }
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
    message: `“${snapshot.title}” foi para ${trashPlace()}`,
    icon: 'trash',
    action: {
      label: 'Desfazer',
      run: async () => {
        const restored = createNote(snapshot.content, snapshot.category)
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
  if (note) createNote(note.content, categoryOf(note)?.name ?? null)
}

function revealNote(id: string): void {
  const note = findNote(id)
  if (note?.path) void repo.reveal(note.path)
}

// ── Mover entre categorias ──────────────────────────────────────────────────

/** Roda `task` com as filas dessas notas paradas: nenhum salvamento delas acontece no meio. */
function withNotesLocked<T>(ids: string[], task: () => Promise<T>): Promise<T> {
  const [first, ...rest] = ids
  return first ? queue.run(first, () => withNotesLocked(rest, task)) : task()
}

/** Operações que mexem em pastas inteiras (categorias) acontecem uma de cada vez. */
const structural = <T>(task: () => Promise<T>) => queue.run('§categories', task)

/**
 * Move o arquivo da nota para a pasta `toDir` e refaz os links relativos dela.
 * Quem chama já está com a fila da nota parada.
 */
async function relocate(note: QuickNote, toDir: string): Promise<boolean> {
  const fromDir = note.dir
  if (!note.path) {
    // Ainda sem arquivo: só a pasta muda — mas os links e imagens dela já precisam acompanhar
    note.dir = toDir
    const rebased = rebaseLinks(note.content, fromDir, toDir)
    if (rebased !== null && rebased !== note.content) {
      note.content = rebased
      if (!isBlankNote(note)) {
        note.status = 'dirty'
        scheduleSave(note.id)
      }
    }
    return true
  }
  timers.get(note.id)?.cancel()
  const from = note.path
  const to = await freePath(toDir, stripExtension(basename(from)), { ...note, path: null })
  try {
    await repo.rename(from, to)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      notifyError(`Não foi possível mover “${noteTitle(note)}”: ${errorMessage(error)}`, error)
      return false
    }
  }
  note.path = to
  note.dir = toDir
  // Os links e imagens da nota são relativos à pasta dela: acompanham a mudança
  const rebased = rebaseLinks(note.content, fromDir, toDir)
  if (rebased !== null) note.content = rebased
  const content = note.content
  if (content !== note.savedContent) {
    try {
      const entry = await repo.write(to, content)
      note.savedContent = content
      note.mtimeMs = entry.mtimeMs
    } catch (error) {
      notifyError(`Não foi possível salvar “${noteTitle(note)}”: ${errorMessage(error)}`, error)
    }
  }
  note.status = note.content === note.savedContent ? 'saved' : 'dirty'
  if (note.status === 'dirty') scheduleSave(note.id)
  persistUi()
  emitNoteChange({ type: 'note-renamed', from, to })
  return true
}

/** Coloca a nota na categoria `category` (null = sem categoria). `auto` = pela categoria automática pelo título. */
async function moveToCategory(id: string, category: string | null, options: { undo?: boolean; auto?: boolean } = {}): Promise<boolean> {
  const note = findNote(id)
  const target = category ? findCategory(category) : null
  if (!note || (category && !target)) return false
  const toDir = categoryDir(target?.name ?? null)
  if (sameDir(note.dir, toDir)) return true
  const previous = categoryOf(note)?.name ?? null
  if (target) await ensureFolder(target)
  const moved = await structural(() => queue.run(id, () => relocate(note, toDir)))
  if (moved && options.undo !== false) {
    showToast({
      message: target ? `“${noteTitle(note)}” foi para ${target.name}${options.auto ? ' (categoria em comum)' : ''}` : `“${noteTitle(note)}” ficou sem categoria`,
      icon: 'folder',
      action: { label: 'Desfazer', run: () => void moveToCategory(id, previous, { undo: false }) },
    })
  }
  return moved
}

// ── Categorias ──────────────────────────────────────────────────────────────

async function persistCategories(): Promise<void> {
  try {
    categoriesRaw = await queue.run('§categories-file', () => repo.writeCategories(state.categories))
  } catch (error) {
    notifyError(`Não foi possível salvar as categorias: ${errorMessage(error)}`, error)
  }
}

/** A pasta da categoria existe no disco? (categorias sem notas podem não ter pasta). */
async function ensureFolder(category: NoteCategory): Promise<void> {
  await repo.mkdir(categoryDir(category.name)).catch(() => undefined)
}

const imageExtension = (file: string) => file.slice(file.lastIndexOf('.') + 1)

export interface CategoryInput {
  name: string
  color: PaletteColor
  /** Ícone pronto (lib/category-icons.ts) ou null (sem ícone: a inicial do nome). */
  icon?: string | null
  /** Imagem escolhida na biblioteca (caminho no workspace), null = sem imagem, undefined = manter a atual. */
  image?: string | null
}

const shared = useCategoriesStore()

/**
 * Problema no nome de uma categoria (ou null). `except` = categoria sendo editada.
 * Os nomes valem para o app inteiro (categorias compartilhadas) e viram nomes de pasta.
 */
function categoryProblem(name: string, except?: string): string | null {
  const editing = except ? findCategory(except) : undefined
  return (
    categoryNameProblem(
      name,
      state.categories.filter((category) => !except || nameKey(category.name) !== nameKey(except)).map((category) => category.name),
    ) ?? shared.nameProblem(name, editing?.id ?? null)
  )
}

/** A imagem que sai da categoria continua na biblioteca (attachments/) para ser usada de novo. */
async function keepInLibrary(path: string | null): Promise<void> {
  if (path) await repo.keepInLibrary(path).catch((error) => console.warn('[4notes] Não foi possível guardar a imagem na biblioteca:', error))
}

/**
 * Foto da categoria: uma cópia da imagem escolhida na biblioteca fica na pasta da
 * categoria, com o nome dela ("notes/Dev/Dev.png"). null = sem foto.
 */
async function writeCategoryImage(category: NoteCategory, image: string | null): Promise<void> {
  const dir = categoryDir(category.name)
  const previous = category.image ? `${dir}/${category.image}` : null
  if (image) {
    const file = categoryImageName(category.name, imageExtension(image))
    const target = `${dir}/${file}`
    if (!previous || nameKey(image) !== nameKey(previous)) {
      await keepInLibrary(previous)
      await repo.copyImage(image, target)
      if (previous && nameKey(previous) !== nameKey(target)) await repo.trash(previous).catch(() => undefined)
    }
    category.image = file
  } else {
    category.image = null
    if (previous) {
      await keepInLibrary(previous)
      await repo.trash(previous).catch(() => undefined)
    }
  }
  state.imageVersion++
}

/**
 * Categoria nova: entra no app inteiro (stores/categories.ts) e vira uma pasta nas
 * Notas. Com um nome que já existe no app (em outro módulo), usa aquela categoria.
 */
async function createCategory(input: CategoryInput): Promise<NoteCategory | null> {
  const name = input.name.trim()
  const existing = shared.findByName(name)
  if (existing) return attachShared(existing)
  const problem = categoryProblem(name)
  if (problem) {
    notifyError(problem)
    return null
  }
  const category = shared.createCategory({ name, color: input.color, icon: input.icon ?? null, image: input.image ?? null })
  return category ? attachShared(category) : null
}

/** A categoria do app nas Notas (pelo id; uma pasta ainda sem id vale pelo nome). */
function memberOf(ref: MemberRef): NoteCategory | undefined {
  return (ref.id ? state.categories.find((category) => category.id === ref.id) : undefined) ?? state.categories.find((category) => !category.id && nameKey(category.name) === nameKey(ref.name))
}

/** Copia a foto da categoria do app para a pasta dela (ou tira a foto). Quem chama já está na fila das categorias. */
async function syncImage(category: NoteCategory, image: string | null): Promise<boolean> {
  if ((category.source ?? null) === image && (!!category.image === !!image)) return false
  await ensureFolder(category)
  await writeCategoryImage(category, image)
  category.source = image
  return true
}

/**
 * Uma categoria do app passa a aparecer nas Notas: a pasta notes/<nome>/ é criada
 * (se preciso) e entra no categorias.json com o id. null = o nome não serve para pasta.
 */
function attachShared(source: SharedCategory): Promise<NoteCategory | null> {
  return structural(async () => {
    const known = memberOf({ id: source.id, name: source.name })
    if (known) {
      if (!known.id) {
        known.id = source.id
        await persistCategories()
      }
      return known
    }
    const problem = categoryNameProblem(
      source.name,
      state.categories.map((category) => category.name),
    )
    if (problem) {
      notifyError(`“${source.name}” não pode virar uma pasta nas Notas: ${problem} Renomeie a categoria em Ver categorias.`)
      return null
    }
    try {
      await repo.mkdir(categoryDir(source.name))
    } catch (error) {
      notifyError(`Não foi possível criar a categoria: ${errorMessage(error)}`, error)
      return null
    }
    state.categories.push({ name: source.name, color: source.color, image: null, icon: source.image ? null : source.icon, id: source.id, source: null })
    const category = state.categories.at(-1)!
    if (source.image) {
      try {
        await syncImage(category, source.image)
      } catch (error) {
        notifyError(`A categoria foi criada, mas não foi possível copiar a imagem: ${errorMessage(error)}`, error)
      }
    }
    await persistCategories()
    shared.touch()
    return category
  })
}

/** "Usar categoria existente": uma categoria do app passa a aparecer nas Notas. */
async function attachCategory(id: string): Promise<NoteCategory | null> {
  const category = shared.findCategory(id)
  return category ? attachShared(category) : null
}

/** Renomeia a pasta da categoria (e a imagem dela); as notas vão junto. */
async function renameCategoryFolder(category: NoteCategory, name: string): Promise<boolean> {
  const fromDir = categoryDir(category.name)
  const toDir = categoryDir(name)
  const members = state.notes.filter((note) => sameDir(note.dir, fromDir))
  return withNotesLocked(
    members.map((note) => note.id),
    async () => {
      try {
        if (await repo.exists(fromDir)) await repo.rename(fromDir, toDir)
        else await repo.mkdir(toDir)
      } catch (error) {
        notifyError(
          errorCode(error) === 'EEXIST' ? `Já existe uma pasta “${name}” em notes/.` : `Não foi possível renomear a categoria: ${errorMessage(error)}`,
          error,
        )
        return false
      }
      for (const note of state.notes) {
        if (!sameDir(note.dir, fromDir)) continue
        note.dir = toDir
        if (note.path) note.path = `${toDir}/${basename(note.path)}`
      }
      // A imagem acompanha o nome da categoria
      if (category.image) {
        const file = categoryImageName(name, imageExtension(category.image))
        try {
          await repo.rename(`${toDir}/${category.image}`, `${toDir}/${file}`)
          category.image = file
        } catch (error) {
          if (errorCode(error) === 'ENOENT') category.image = null
        }
        state.imageVersion++
      }
      const oldKey = nameKey(category.name)
      const newKey = nameKey(name)
      state.collapsedCategories = state.collapsedCategories.map((key) => (key === oldKey ? newKey : key))
      state.openFolders = state.openFolders.map((key) => (key.startsWith(`${oldKey}|`) ? `${newKey}|${key.slice(oldKey.length + 1)}` : key))
      category.name = name
      persistUi()
      emitNoteChange({ type: 'notes-folder-renamed', from: fromDir, to: toDir })
      return true
    },
  )
}

/**
 * Muda nome, cor, ícone e/ou imagem de uma categoria, no app inteiro (stores/categories.ts);
 * a pasta e a foto daqui acompanham pelo `sync` abaixo.
 */
async function updateCategory(currentName: string, input: CategoryInput): Promise<boolean> {
  let category = findCategory(currentName)
  if (!category) return false
  if (!category.id) {
    await shared.reconcile()
    category = findCategory(currentName)
  }
  if (!category?.id) return false
  const problem = categoryProblem(input.name, category.name)
  if (problem) {
    notifyError(problem)
    return false
  }
  return shared.updateCategory(category.id, { name: input.name, color: input.color, icon: input.icon, image: input.image })
}

/** Nome, cor, ícone e foto da categoria do app (repassados pelo stores/categories.ts). */
function syncFromShared(source: SharedCategory): Promise<boolean> {
  return structural(async () => {
    const category = state.categories.find((item) => item.id === source.id)
    if (!category) return true
    let changed = false
    if (category.name !== source.name) {
      if (!(await renameCategoryFolder(category, source.name))) return false
      changed = true
    }
    const icon = source.image ? null : source.icon
    if (category.color !== source.color || category.icon !== icon) {
      category.color = source.color
      category.icon = icon
      changed = true
    }
    try {
      if (await syncImage(category, source.image)) changed = true
    } catch (error) {
      notifyError(`Não foi possível copiar a imagem da categoria “${category.name}”: ${errorMessage(error)}`, error)
    }
    if (changed) await persistCategories()
    return true
  })
}

/**
 * Os registros de `from` passam para `to` (juntar, excluir transferindo): se `to` ainda
 * não está nas Notas, a pasta de `from` vira a de `to` (renomeada); se já está, as notas
 * vão para a pasta dela (com os links refeitos) e a pasta de `from` sai.
 */
function remapCategory(from: MemberRef, to: SharedCategory): Promise<boolean> {
  const source = memberOf(from)
  if (!source) return Promise.resolve(true)
  const target = state.categories.find((category) => category !== source && (category.id === to.id || (!category.id && nameKey(category.name) === nameKey(to.name))))
  if (!target) {
    return structural(async () => {
      if (source.name !== to.name && !(await renameCategoryFolder(source, to.name))) return false
      source.id = to.id
      await persistCategories()
      return true
    }).then(async (ok) => ok && (await syncFromShared(to)))
  }
  return mergeFolders(source, target)
}

/** As notas de `source` vão para `target`; a pasta de `source` sai (vai para a Lixeira se ficar vazia). */
function mergeFolders(source: NoteCategory, target: NoteCategory): Promise<boolean> {
  return structural(async () => {
    const fromDir = categoryDir(source.name)
    const toDir = categoryDir(target.name)
    await ensureFolder(target)
    const members = state.notes.filter((note) => sameDir(note.dir, fromDir))
    const moved = await withNotesLocked(
      members.map((note) => note.id),
      async () => {
        let ok = true
        for (const note of members) ok = (await relocate(note, toDir)) && ok
        return ok
      },
    )
    if (!moved) return false
    await removeCategoryFolder(source)
    state.categories = state.categories.filter((item) => item !== source)
    forgetCategoryUi(source.name)
    await persistCategories()
    return true
  })
}

/** A pasta da categoria vai para a Lixeira, se não sobrar nenhum outro arquivo nela (a foto fica na biblioteca). */
async function removeCategoryFolder(category: NoteCategory): Promise<void> {
  const dir = categoryDir(category.name)
  await keepInLibrary(categoryImagePath(category))
  try {
    const leftovers = (await repo.listAll(dir)).filter((file) => !category.image || nameKey(file.name) !== nameKey(category.image))
    if (!leftovers.length) await repo.trash(dir)
    else showToast({ message: `A pasta “${category.name}” foi mantida porque tem outros arquivos.`, icon: 'folder' })
  } catch (error) {
    console.warn('[4notes] Não foi possível remover a pasta da categoria:', error)
  }
}

function forgetCategoryUi(name: string): void {
  state.collapsedCategories = state.collapsedCategories.filter((key) => key !== nameKey(name))
  state.openFolders = state.openFolders.filter((key) => !key.startsWith(`${nameKey(name)}|`))
  persistUi()
}

/**
 * Tira a categoria das Notas: as notas dela voltam a ficar sem categoria (nenhuma nota
 * é apagada) e a pasta vai para a Lixeira — só se não sobrar nenhum outro arquivo nela.
 * (Excluir a categoria do app, com a escolha do destino das notas, fica no
 * stores/categories.ts, que chama isto.)
 */
async function deleteCategory(name: string): Promise<boolean> {
  const category = findCategory(name)
  if (!category) return false
  return structural(async () => {
    const dir = categoryDir(category.name)
    const members = state.notes.filter((note) => sameDir(note.dir, dir))
    const moved = await withNotesLocked(
      members.map((note) => note.id),
      async () => {
        let ok = true
        for (const note of members) ok = (await relocate(note, ROOT)) && ok
        return ok
      },
    )
    if (!moved) return false
    await removeCategoryFolder(category)
    state.categories = state.categories.filter((item) => item !== category)
    forgetCategoryUi(category.name)
    await persistCategories()
    return true
  })
}

registerCategoryModule({
  id: 'notes',
  ready: () => state.loaded,
  members: () =>
    state.categories.map((category) => ({
      id: category.id ?? null,
      name: category.name,
      color: category.color,
      icon: category.icon,
      image: category.source ?? categoryImagePath(category),
    })),
  records: (id) => {
    const category = state.categories.find((item) => item.id === id)
    if (!category) return []
    const dir = categoryDir(category.name)
    return visibleNotes.value
      .filter((note) => note.path && sameDir(note.dir, dir))
      .map((note) => ({ id: note.id, title: noteTitle(note), detail: new Date(note.mtimeMs).toLocaleDateString('pt-BR'), path: note.path! }))
  },
  sync: (category) => syncFromShared(category),
  attach: async (category) => !!(await attachShared(category)),
  remap: (from, to) => remapCategory(from, to),
  detach: async (from) => {
    const category = memberOf(from)
    return category ? deleteCategory(category.name) : true
  },
  acceptProblem: (from, to) => {
    const source = memberOf(from)
    if (!source || state.categories.some((category) => category !== source && category.id === to.id)) return null
    const problem = categoryNameProblem(
      to.name,
      state.categories.filter((category) => category !== source).map((category) => category.name),
    )
    return problem ? `“${to.name}” não pode virar uma pasta nas Notas: ${problem}` : null
  },
})

function revealCategory(name: string): void {
  const category = findCategory(name)
  if (!category) return
  void ensureFolder(category).then(() => repo.reveal(categoryDir(category.name)))
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
        note.dir = noteDirOf(file.path)
      }
      if (note.status === 'saved' && (file.content ?? '') !== note.savedContent) {
        note.content = file.content ?? ''
        note.savedContent = note.content
        note.mtimeMs = file.mtimeMs
      }
    }
    for (const file of remaining.values()) state.notes.push(fromFile(file))

    // Categorias: categorias.json editado fora do app e pastas novas com notas
    await queue.idle()
    const saved = await repo.readCategories()
    let base = state.categories
    if (saved.status !== 'invalid' && saved.raw !== categoriesRaw) {
      categoriesRaw = saved.raw
      base = saved.categories
    }
    const merged = mergeWithFolders(base, foldersWithNotes())
    if (JSON.stringify(merged) !== JSON.stringify(state.categories)) state.categories = merged
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
    findNote,
    findByPath,
    findCategory,
    categoryOf,
    previousVersionOf,
    nextVersionOf,
    isBlank: isBlankNote,
    load,
    createNote,
    openNote,
    pinTab,
    closeTab,
    closeOtherTabs,
    reopenClosedTab,
    activate,
    cycleTab,
    moveTab,
    toggleSidebar,
    isCategoryCollapsed,
    setCategoryCollapsed,
    isFolderOpen,
    setFolderOpen,
    updateContent,
    rewriteContents,
    saveNow,
    flushAll,
    deleteNote,
    duplicateNote,
    revealNote,
    moveToCategory,
    categoryProblem,
    createCategory,
    attachCategory,
    updateCategory,
    deleteCategory,
    revealCategory,
    updateSettings,
    refreshFromDisk,
  }
}
