/**
 * Estado do módulo MAPA MENTAL.
 *
 * - Você pode ter vários mapas; cada um é uma pasta em <pasta de dados>/mindmap/.
 * - Cada nó é uma nota permanente: um arquivo .md (só o texto) dentro da pasta do mapa.
 *   O título do nó é o nome do arquivo, o que garante nomes únicos dentro do mapa.
 * - As conexões (setas) e as cores ficam no mapa.json do mapa (ver lib/mindmap/model.ts).
 * - Só o mapa aberto fica na memória; trocar de mapa salva tudo e carrega o outro.
 * - Módulo independente: não lê as notas da aba Notas nem as Tarefas.
 */
import { computed, reactive } from 'vue'
import { errorCode, errorMessage, type FileEntry } from '#shared/ipc'
import { notifyError, showToast } from '~/composables/useToasts'
import type { PaletteColor } from '~/lib/colors'
import { toPlainText } from '~/lib/editor/markup'
import { emitNoteChange } from '~/lib/note-events'
import { basename, nameKey, sanitizeFileName, stripExtension } from '~/lib/files/filename'
import { buildGraph, noteNodeId } from '~/lib/mindmap/graph'
import {
  DEFAULT_MAP_NAME,
  colorOf,
  connectionsOf,
  emptyMapFile,
  findConnection,
  removeFromMap,
  renameInMap,
  type Connection,
  type MapFile,
} from '~/lib/mindmap/model'
import {
  DEFAULT_GRAPH_SETTINGS,
  GRAPH_SETTINGS_VERSION,
  mindmapRepository as repo,
  type GraphSettings,
  type Layout,
  type MapInfo,
} from '~/lib/mindmap/repository'
import { createJsonWriter } from '~/lib/storage/json-file'
import { DATA_PATHS } from '~/lib/storage/paths'
import { createId, debounce, SerialQueue, type Debounced } from '~/lib/utils/async'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

export interface PermanentNote {
  /** Chave estável durante a sessão (o nome do arquivo muda ao renomear). */
  key: string
  /** Nome do arquivo dentro da pasta do mapa, ex.: "Godot.md". */
  id: string
  /** Nome do arquivo sem ".md" — é o rótulo do nó. */
  title: string
  content: string
  savedContent: string
  mtimeMs: number
  status: SaveStatus
}

export interface Neighbor {
  noteId: string
  title: string
  /** true = a seta sai desta nota; false = chega nela. */
  outgoing: boolean
}

const SAVE_DELAY = 500

const state = reactive({
  loaded: false,
  maps: [] as MapInfo[],
  currentMap: '',
  notes: [] as PermanentNote[],
  /** Conexões e cores do mapa aberto (conteúdo do mapa.json). */
  mapData: emptyMapFile() as MapFile,
  selectedId: null as string | null,
  panelOpen: false,
  panelExpanded: false,
  search: '',
  settings: { ...DEFAULT_GRAPH_SETTINGS } as GraphSettings,
  /** Posições dos nós do mapa aberto (id do nó → [x, y]). */
  layout: {} as Layout,
  /** Pedido para o grafo centralizar um nó (o número muda a cada pedido). */
  focus: { nodeId: null as string | null, seq: 0 },
})

const queue = new SerialQueue()
const timers = new Map<string, Debounced<[]>>()
const uiWriter = createJsonWriter(DATA_PATHS.mindmapUiState, 800)
/** Posições dos outros mapas (o do mapa aberto fica em state.layout). */
let layouts: Record<string, Layout> = {}

// ── Consultas ───────────────────────────────────────────────────────────────

function findNote(id: string | null): PermanentNote | undefined {
  return id ? state.notes.find((note) => note.id === id) : undefined
}

function findByKey(key: string): PermanentNote | undefined {
  return state.notes.find((note) => note.key === key)
}

function findByTitle(title: string): PermanentNote | undefined {
  const key = nameKey(title)
  return state.notes.find((note) => nameKey(note.title) === key)
}

const graph = computed(() =>
  buildGraph(
    state.notes.map((note) => ({ id: note.id, title: note.title, color: colorOf(state.mapData, note.title) })),
    state.mapData.connections,
    { showOrphans: state.settings.showOrphans },
  ),
)

const selectedNote = computed(() => findNote(state.selectedId) ?? null)

/** Busca sem acentos: "programacao" encontra "Programação". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR')
}

const searchResults = computed(() => {
  const query = fold(state.search.trim())
  if (!query) return []
  const byTitle = state.notes.filter((note) => fold(note.title).includes(query))
  const byContent = state.notes.filter((note) => !byTitle.includes(note) && fold(toPlainText(note.content)).includes(query))
  return [...byTitle, ...byContent]
})

const searchMatchNodeIds = computed(() => {
  if (!state.search.trim()) return null
  return new Set(searchResults.value.map((note) => noteNodeId(note.id)))
})

/** Notas ligadas a uma nota (nos dois sentidos). */
function neighbors(id: string): Neighbor[] {
  const note = findNote(id)
  if (!note) return []
  const key = nameKey(note.title)
  const result: Neighbor[] = []
  for (const connection of connectionsOf(state.mapData.connections, note.title)) {
    const outgoing = nameKey(connection.from) === key
    const other = findByTitle(outgoing ? connection.to : connection.from)
    if (other) result.push({ noteId: other.id, title: other.title, outgoing })
  }
  return result
}

function noteColor(id: string): PaletteColor | null {
  const note = findNote(id)
  return note ? colorOf(state.mapData, note.title) : null
}

// ── Mapa aberto: salvar conexões/cores e estado da interface ────────────────

function saveMapNow(): Promise<void> {
  const map = state.currentMap
  const data: MapFile = JSON.parse(JSON.stringify(state.mapData))
  return queue
    .run(`map:${map}`, async () => {
      await repo.writeMap(map, data)
    })
    .catch((error) => notifyError(`Não foi possível salvar o mapa “${map}”: ${errorMessage(error)}`, error))
}
const scheduleMapSave = debounce(() => void saveMapNow(), 300)

function persistUi(): void {
  uiWriter.save(() => ({
    settingsVersion: GRAPH_SETTINGS_VERSION,
    settings: state.settings,
    currentMap: state.currentMap,
    layouts: { ...layouts, [state.currentMap]: state.layout },
  }))
}

let positionProvider: (() => Layout) | null = null

/** O componente do grafo registra aqui uma função que devolve as posições atuais. */
function registerPositionProvider(provider: () => Layout): () => void {
  positionProvider = provider
  return () => {
    if (positionProvider === provider) positionProvider = null
  }
}

function captureLayout(): void {
  if (positionProvider) state.layout = { ...state.layout, ...positionProvider() }
}

function updateLayout(positions: Layout): void {
  const known = new Set(state.notes.map((note) => noteNodeId(note.id)))
  const next: Layout = {}
  for (const [id, position] of Object.entries({ ...state.layout, ...positions })) if (known.has(id)) next[id] = position
  state.layout = next
  persistUi()
}

function updateSettings(patch: Partial<GraphSettings>): void {
  Object.assign(state.settings, patch)
  persistUi()
}

// ── Carregamento e troca de mapa ────────────────────────────────────────────

function fromFile(entry: FileEntry): PermanentNote {
  const id = repo.noteIdFromPath(entry.path)
  const content = entry.content ?? ''
  return { key: createId('m'), id, title: stripExtension(id), content, savedContent: content, mtimeMs: entry.mtimeMs, status: 'saved' }
}

async function readMapData(map: string): Promise<MapFile> {
  const result = await repo.readMap(map)
  if (result.status !== 'invalid') return result.data
  // mapa.json editado à mão com erro: guarda uma cópia e recomeça as conexões
  const backup = await repo.backupBrokenMap(map, result.raw).catch(() => null)
  showToast({
    message: `O mapa.json de “${map}” estava com erro e foi recriado${backup ? ` (cópia em ${backup})` : ''}.`,
    icon: 'alert',
    tone: 'error',
    duration: 9000,
  })
  return emptyMapFile()
}

async function openMap(name: string): Promise<void> {
  const [files, data] = await Promise.all([repo.listNotes(name), readMapData(name)])
  if (state.currentMap) layouts[state.currentMap] = state.layout
  state.currentMap = name
  state.notes = files.map(fromFile)
  state.mapData = data
  state.layout = layouts[name] ?? {}
  state.selectedId = null
  state.panelOpen = false
  state.panelExpanded = false
  state.search = ''
  persistUi()
}

function syncMapCount(): void {
  const info = state.maps.find((map) => map.name === state.currentMap)
  if (info) info.notes = state.notes.length
}

async function load(): Promise<void> {
  const ui = await repo.readUiState()
  state.settings = ui.settings
  layouts = ui.layouts

  const migration = await repo.migrateLegacy().catch((error) => {
    notifyError(`Não foi possível converter o mapa mental antigo: ${errorMessage(error)}`, error)
    return null
  })
  if (migration) {
    // Reaproveita as posições salvas pela 1.0.0
    const translated: Layout = {}
    for (const [legacyId, fileName] of migration.renames) {
      const position = ui.legacyLayout?.[`note:${legacyId}`]
      if (position) translated[noteNodeId(fileName)] = position
    }
    layouts[migration.map] = { ...translated, ...layouts[migration.map] }
    ui.currentMap = migration.map
    showToast({
      message: `Mapa mental atualizado: suas notas estão no mapa “${migration.map}” e os [[links]] viraram conexões. Backup em ${migration.backupDir}.`,
      icon: 'sparkle',
      duration: 10000,
    })
  }

  let maps = await repo.listMaps()
  if (!maps.length) {
    await repo.createMap(DEFAULT_MAP_NAME)
    maps = [{ name: DEFAULT_MAP_NAME, notes: 0 }]
  }
  state.maps = maps
  const current = maps.find((map) => nameKey(map.name) === nameKey(ui.currentMap ?? '')) ?? maps.find((map) => map.name === DEFAULT_MAP_NAME) ?? maps[0]!
  await openMap(current.name)
  state.loaded = true
}

/** Troca o mapa aberto (salva tudo antes). */
async function switchMap(name: string): Promise<void> {
  if (name === state.currentMap) return
  await flushAll()
  try {
    await openMap(name)
  } catch (error) {
    notifyError(`Não foi possível abrir o mapa: ${errorMessage(error)}`, error)
  }
}

function validateMapName(raw: string, except?: string): string | null {
  if (!raw.trim()) return 'Digite um nome para o mapa.'
  const name = sanitizeFileName(raw)
  if (state.maps.some((map) => nameKey(map.name) === nameKey(name) && map.name !== except)) return 'Já existe um mapa com esse nome.'
  return null
}

async function createMap(raw: string): Promise<boolean> {
  if (validateMapName(raw)) return false
  const name = sanitizeFileName(raw)
  try {
    if (await repo.mapExists(name)) {
      notifyError('Já existe uma pasta com esse nome em mindmap/.')
      return false
    }
    await repo.createMap(name)
  } catch (error) {
    notifyError(`Não foi possível criar o mapa: ${errorMessage(error)}`, error)
    return false
  }
  state.maps = [...state.maps, { name, notes: 0 }].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  await switchMap(name)
  return true
}

async function renameMap(from: string, raw: string): Promise<boolean> {
  const name = sanitizeFileName(raw)
  if (name === from) return true
  if (validateMapName(raw, from)) return false
  await flushAll()
  try {
    await repo.renameMap(from, name)
  } catch (error) {
    notifyError(
      errorCode(error) === 'EEXIST' ? 'Já existe uma pasta com esse nome em mindmap/.' : `Não foi possível renomear o mapa: ${errorMessage(error)}`,
      error,
    )
    return false
  }
  const info = state.maps.find((map) => map.name === from)
  if (info) info.name = name
  state.maps.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  if (layouts[from]) {
    layouts[name] = layouts[from]!
    delete layouts[from]
  }
  if (state.currentMap === from) state.currentMap = name
  persistUi()
  emitNoteChange({ type: 'map-renamed', from, to: name })
  showToast({ message: 'Mapa renomeado', icon: 'edit' })
  return true
}

/** Exclui um mapa (a pasta vai para a Lixeira). Sempre sobra pelo menos um mapa. */
async function deleteMap(name: string): Promise<boolean> {
  if (state.maps.length < 2) return false
  await flushAll()
  try {
    await repo.trashMap(name)
  } catch (error) {
    notifyError(`Não foi possível excluir o mapa: ${errorMessage(error)}`, error)
    return false
  }
  state.maps = state.maps.filter((map) => map.name !== name)
  delete layouts[name]
  if (state.currentMap === name) {
    state.currentMap = ''
    await openMap(state.maps[0]!.name)
  }
  persistUi()
  showToast({ message: `O mapa “${name}” foi para a Lixeira`, icon: 'trash' })
  return true
}

// ── Seleção / painel ────────────────────────────────────────────────────────

function requestFocus(nodeId: string): void {
  state.focus = { nodeId, seq: state.focus.seq + 1 }
}

function openNote(id: string, options: { focus?: boolean } = {}): void {
  if (!findNote(id)) return
  state.selectedId = id
  state.panelOpen = true
  if (options.focus !== false) requestFocus(noteNodeId(id))
}

function closePanel(): void {
  state.panelOpen = false
  state.panelExpanded = false
  state.selectedId = null
}

// ── Edição e salvamento das notas ───────────────────────────────────────────

function scheduleSave(key: string): void {
  let timer = timers.get(key)
  if (!timer) {
    timer = debounce(() => void saveNote(key), SAVE_DELAY)
    timers.set(key, timer)
  }
  timer()
}

function saveNote(key: string): Promise<void> {
  const map = state.currentMap
  return queue.run(key, async () => {
    const note = findByKey(key)
    if (!note || note.content === note.savedContent) {
      if (note) note.status = 'saved'
      return
    }
    const content = note.content
    note.status = 'saving'
    try {
      const entry = await repo.write(map, note.id, content)
      note.savedContent = content
      note.mtimeMs = entry.mtimeMs
      note.status = note.content === content ? 'saved' : 'dirty'
    } catch (error) {
      note.status = 'error'
      notifyError(`Não foi possível salvar “${note.title}”: ${errorMessage(error)}`, error)
    }
  })
}

async function flushNote(key: string): Promise<void> {
  const timer = timers.get(key)
  if (timer?.pending()) {
    timer.cancel()
    await saveNote(key)
  } else {
    await queue.run(key, async () => undefined)
  }
}

function updateContent(id: string, content: string): void {
  const note = findNote(id)
  if (!note || note.content === content) return
  note.content = content
  if (note.status !== 'saving') note.status = content === note.savedContent ? 'saved' : 'dirty'
  scheduleSave(note.key)
}

async function flushAll(): Promise<void> {
  for (const [key, timer] of timers) {
    if (timer.pending()) {
      timer.cancel()
      void saveNote(key)
    }
  }
  scheduleMapSave.flush()
  await queue.idle()
  captureLayout()
  persistUi()
  await uiWriter.flush()
}

// ── Conexões e cores ────────────────────────────────────────────────────────

/** Cria a conexão de `fromId` para `toId` (arrastando a seta no mapa). */
function connectNotes(fromId: string, toId: string): boolean {
  const from = findNote(fromId)
  const to = findNote(toId)
  if (!from || !to || from === to) return false
  if (findConnection(state.mapData.connections, from.title, to.title)) {
    showToast({ message: `“${from.title}” e “${to.title}” já estão conectadas`, icon: 'link' })
    return false
  }
  state.mapData.connections.push({ from: from.title, to: to.title })
  scheduleMapSave()
  return true
}

/** Remove a conexão entre duas notas (com "Desfazer"). */
function disconnectNotes(aId: string, bId: string): void {
  const a = findNote(aId)
  const b = findNote(bId)
  const connection = a && b ? findConnection(state.mapData.connections, a.title, b.title) : undefined
  if (!connection) return
  const map = state.currentMap
  const removed: Connection = { from: connection.from, to: connection.to }
  state.mapData.connections = state.mapData.connections.filter((c) => c !== connection)
  scheduleMapSave()
  showToast({
    message: 'Conexão removida',
    icon: 'unlink',
    action: {
      label: 'Desfazer',
      run: () => {
        if (state.currentMap !== map || findConnection(state.mapData.connections, removed.from, removed.to)) return
        state.mapData.connections.push(removed)
        scheduleMapSave()
      },
    },
  })
}

function setColor(id: string, color: PaletteColor | null): void {
  const note = findNote(id)
  if (!note) return
  const key = nameKey(note.title)
  const colors = Object.fromEntries(Object.entries(state.mapData.colors).filter(([title]) => nameKey(title) !== key))
  if (color) colors[note.title] = color
  state.mapData.colors = colors
  scheduleMapSave()
}

// ── Criar / renomear / excluir notas ────────────────────────────────────────

/** Cria uma nota (um novo nó). Se já existir uma com o mesmo nome, abre ela. */
async function createNote(
  rawTitle: string,
  options: { linkFrom?: string; position?: [number, number]; open?: boolean } = {},
): Promise<PermanentNote | null> {
  if (!rawTitle.trim()) return null
  const title = sanitizeFileName(rawTitle)
  const existing = findByTitle(title)
  if (existing) {
    if (options.linkFrom && options.linkFrom !== existing.id) connectNotes(options.linkFrom, existing.id)
    if (options.open !== false) openNote(existing.id)
    return existing
  }

  const id = `${title}.md`
  const map = state.currentMap
  try {
    if (await repo.exists(map, id)) {
      // Criada fora do app desde a última leitura: apenas sincroniza.
      await refreshFromDisk()
      const synced = findNote(id) ?? findByTitle(title)
      if (synced && options.open !== false) openNote(synced.id)
      return synced ?? null
    }
    const entry = await repo.write(map, id, '')
    captureLayout()
    if (options.position) state.layout = { ...state.layout, [noteNodeId(id)]: options.position }
    const note: PermanentNote = { key: createId('m'), id, title, content: '', savedContent: '', mtimeMs: entry.mtimeMs, status: 'saved' }
    state.notes.push(note)
    syncMapCount()
    if (options.linkFrom) connectNotes(options.linkFrom, id)
    if (options.open !== false) openNote(id)
    persistUi()
    return note
  } catch (error) {
    notifyError(`Não foi possível criar a nota: ${errorMessage(error)}`, error)
    return null
  }
}

async function renameNote(id: string, rawTitle: string): Promise<boolean> {
  const note = findNote(id)
  if (!note || !rawTitle.trim()) return false
  const title = sanitizeFileName(rawTitle)
  if (title === note.title) return true
  const conflict = findByTitle(title)
  if (conflict && conflict.key !== note.key) {
    notifyError(`Já existe uma nota chamada “${conflict.title}” neste mapa.`)
    return false
  }

  await flushNote(note.key)
  const newId = `${title}.md`
  try {
    await repo.rename(state.currentMap, note.id, newId)
  } catch (error) {
    notifyError(`Não foi possível renomear: ${errorMessage(error)}`, error)
    return false
  }

  // Mantém a posição do nó, as conexões e a cor
  captureLayout()
  const oldNode = noteNodeId(note.id)
  if (state.layout[oldNode]) state.layout = { ...state.layout, [noteNodeId(newId)]: state.layout[oldNode]! }
  state.mapData = renameInMap(state.mapData, note.title, title)
  scheduleMapSave()

  const oldId = note.id
  note.id = newId
  note.title = title
  if (state.selectedId === id) state.selectedId = newId
  persistUi()
  emitNoteChange({ type: 'map-note-renamed', map: state.currentMap, from: oldId, to: newId })
  return true
}

async function deleteNote(id: string): Promise<void> {
  const note = findNote(id)
  if (!note) return
  timers.get(note.key)?.cancel()
  await queue.run(note.key, async () => undefined)
  const map = state.currentMap
  try {
    await repo.trash(map, note.id)
  } catch (error) {
    notifyError(`Não foi possível excluir: ${errorMessage(error)}`, error)
    return
  }
  captureLayout()
  const removed = removeFromMap(state.mapData, note.title)
  const snapshot = { id: note.id, title: note.title, content: note.content, position: state.layout[noteNodeId(note.id)] }
  state.mapData = removed.data
  scheduleMapSave()
  state.notes = state.notes.filter((other) => other.key !== note.key)
  timers.delete(note.key)
  syncMapCount()
  if (state.selectedId === id) closePanel()
  showToast({
    message: `“${note.title}” foi para a Lixeira`,
    icon: 'trash',
    action: {
      label: 'Desfazer',
      run: async () => {
        if (state.currentMap !== map || findNote(snapshot.id)) return
        const entry = await repo.write(map, snapshot.id, snapshot.content)
        if (snapshot.position) state.layout = { ...state.layout, [noteNodeId(snapshot.id)]: snapshot.position }
        state.notes.push({
          key: createId('m'),
          id: snapshot.id,
          title: snapshot.title,
          content: snapshot.content,
          savedContent: snapshot.content,
          mtimeMs: entry.mtimeMs,
          status: 'saved',
        })
        for (const connection of removed.connections) {
          if (!findConnection(state.mapData.connections, connection.from, connection.to)) state.mapData.connections.push(connection)
        }
        if (removed.color) state.mapData.colors = { ...state.mapData.colors, [snapshot.title]: removed.color }
        scheduleMapSave()
        syncMapCount()
      },
    },
  })
}

function revealNote(id: string): void {
  if (findNote(id)) void repo.reveal(state.currentMap, id)
}

// ── Sincronização com mudanças feitas fora do app ───────────────────────────

let refreshing = false
async function refreshFromDisk(): Promise<void> {
  if (!state.loaded || refreshing) return
  refreshing = true
  try {
    for (const [key, timer] of timers) {
      if (timer.pending()) {
        timer.cancel()
        void saveNote(key)
      }
    }
    await queue.idle()

    const maps = await repo.listMaps()
    if (!maps.some((map) => nameKey(map.name) === nameKey(state.currentMap))) {
      // O mapa aberto sumiu (apagado ou renomeado fora do app)
      if (!maps.length) {
        await repo.createMap(DEFAULT_MAP_NAME)
        maps.push({ name: DEFAULT_MAP_NAME, notes: 0 })
      }
      state.maps = maps
      await openMap(maps[0]!.name)
      return
    }
    state.maps = maps

    const files = await repo.listNotes(state.currentMap)
    const remaining = new Map(files.map((file) => [nameKey(basename(file.path)), file]))
    for (const note of [...state.notes]) {
      const key = nameKey(note.id)
      const file = remaining.get(key)
      remaining.delete(key)
      if (!file) {
        if (note.status === 'saved') {
          state.notes = state.notes.filter((other) => other.key !== note.key)
          if (state.selectedId === note.id) closePanel()
        }
        continue
      }
      if (note.status === 'saved' && (file.content ?? '') !== note.savedContent) {
        note.content = file.content ?? ''
        note.savedContent = note.content
        note.mtimeMs = file.mtimeMs
      }
    }
    for (const file of remaining.values()) state.notes.push(fromFile(file))
    syncMapCount()

    if (!scheduleMapSave.pending()) {
      const result = await repo.readMap(state.currentMap)
      if (result.status !== 'invalid' && JSON.stringify(result.data) !== JSON.stringify(state.mapData)) state.mapData = result.data
    }
  } catch (error) {
    console.warn('[4notes] Falha ao sincronizar o mapa mental:', error)
  } finally {
    refreshing = false
  }
}

export function useMindmapStore() {
  return {
    state,
    graph,
    selectedNote,
    searchResults,
    searchMatchNodeIds,
    findNote,
    findByTitle,
    neighbors,
    noteColor,
    load,
    switchMap,
    createMap,
    renameMap,
    deleteMap,
    validateMapName,
    revealMap: (name: string) => void repo.revealMap(name),
    openNote,
    closePanel,
    requestFocus,
    updateContent,
    flushAll,
    createNote,
    renameNote,
    deleteNote,
    revealNote,
    connectNotes,
    disconnectNotes,
    setColor,
    refreshFromDisk,
    updateSettings,
    updateLayout,
    registerPositionProvider,
  }
}
