/**
 * Estado do módulo DOCUMENTOS (1.7.3).
 *
 * O índice fica em documents/documents.json (lib/documents/model.ts), os arquivos em
 * documents/arquivos/ e as anotações de cada PDF em documents/anotacoes/<id>.json
 * (lib/documents/annotations.ts). Importar copia o arquivo para o workspace (o
 * original fica onde estava). Excluir manda o arquivo e as anotações para a Lixeira.
 *
 * As categorias são as compartilhadas do app (stores/categories.ts), como nas Finanças
 * e no Timer.
 */
import { computed, reactive } from 'vue'
import { errorMessage } from '#shared/ipc'
import { MAX_DOCUMENT_BYTES } from '#shared/files'
import { requestCategoryRemoval } from '~/composables/useCategoryActions'
import { confirmDialog } from '~/composables/useDialog'
import { notifyError, showToast } from '~/composables/useToasts'
import type { CategorySource } from '~/lib/category-source'
import type { PaletteColor } from '~/lib/colors'
import { annotationsPath, cloneAnnotations, normalizeAnnotations, serializeAnnotations, type Annotation } from '~/lib/documents/annotations'
import {
  defaultDocumentsData,
  displayName,
  formatSize,
  KIND_LABELS,
  matchesSearch,
  MAX_NAME,
  newDocument,
  normalizeDocumentsFile,
  serializeDocuments,
  sortDocuments,
  type DocumentCategory,
  type DocumentSort,
  type StoredDocument,
} from '~/lib/documents/model'
import { desktop } from '~/lib/platform'
import { readDeviceState, writeDeviceState } from '~/lib/storage/device-state'
import { readJsonFile } from '~/lib/storage/json-file'
import { debounce, SerialQueue } from '~/lib/utils/async'
import { registerCategoryModule, useCategoriesStore, type SharedCategory } from './categories'

export const DOCUMENTS_FILE = 'documents/documents.json'

export type DocumentSelection = 'all' | 'none' | `category:${string}`

const SORTS: readonly DocumentSort[] = ['recent', 'name', 'kind']

const state = reactive({
  loaded: false,
  /** Preenchido quando o documents.json não pôde ser lido: nada é gravado até resolver. */
  error: null as string | null,
  categories: [] as DocumentCategory[],
  documents: [] as StoredDocument[],
  selection: 'all' as DocumentSelection,
  search: '',
  sort: 'recent' as DocumentSort,
  /** Documentos marcados (para mudar a categoria ou excluir vários). */
  checked: [] as string[],
  /** Documento aberto no leitor. */
  openId: null as string | null,
  /** Importação em andamento (quantos de quantos). */
  importing: null as { done: number; total: number } | null,
})

let lastRaw: string | null = null
const queue = new SerialQueue()
const shared = useCategoriesStore()

function persist(): Promise<void> {
  return queue
    .run('documents', async () => {
      if (state.error) return
      // Sem nada guardado, o arquivo nem é criado
      if (lastRaw === null && !state.documents.length && !state.categories.length) return
      const raw = serializeDocuments({ categories: state.categories, documents: state.documents })
      if (raw === lastRaw) return
      await desktop().files.write(DOCUMENTS_FILE, raw)
      lastRaw = raw
    })
    .catch((error) => notifyError(`Não foi possível salvar os documentos: ${errorMessage(error)}`, error))
}

const scheduleSave = debounce(() => void persist(), 250)

async function flush(): Promise<void> {
  scheduleSave.flush()
  await Promise.all([queue.idle(), flushAnnotations()])
}

function guard(): boolean {
  if (!state.error) return true
  showToast({ message: 'O arquivo dos documentos tem um erro: corrija antes de mudar algo.', icon: 'alert' })
  return false
}

// ── Carregamento ────────────────────────────────────────────────────────────

function adopt(data: { categories: DocumentCategory[]; documents: StoredDocument[] }): void {
  state.categories = data.categories
  state.documents = data.documents
  const ids = new Set(data.documents.map((doc) => doc.id))
  state.checked = state.checked.filter((id) => ids.has(id))
  if (state.openId && !ids.has(state.openId)) state.openId = null
  if (state.selection.startsWith('category:') && !data.categories.some((category) => `category:${category.id}` === state.selection)) state.selection = 'all'
}

async function readIndex(): Promise<{ status: 'ok'; raw: string | null; data: ReturnType<typeof defaultDocumentsData> } | { status: 'invalid'; error: string }> {
  const result = await readJsonFile(DOCUMENTS_FILE)
  if (result.status === 'missing') return { status: 'ok', raw: null, data: defaultDocumentsData() }
  if (result.status === 'invalid') return { status: 'invalid', error: `JSON inválido: ${result.error}` }
  try {
    return { status: 'ok', raw: result.raw, data: normalizeDocumentsFile(result.data) }
  } catch (error) {
    return { status: 'invalid', error: error instanceof Error ? error.message : String(error) }
  }
}

async function load(): Promise<void> {
  try {
    const view = readDeviceState('documents') ?? {}
    if (SORTS.includes(view.sort as DocumentSort)) state.sort = view.sort as DocumentSort
    const result = await readIndex()
    if (result.status === 'invalid') {
      state.error = result.error
    } else {
      adopt(result.data)
      lastRaw = result.raw
      state.error = null
    }
  } catch (error) {
    state.error = errorMessage(error)
  } finally {
    state.loaded = true
  }
}

/** O documents.json mudou fora do app (outro aparelho): relê, se nada estiver pendente. */
async function refreshFromDisk(): Promise<void> {
  if (!state.loaded || scheduleSave.pending() || queue.busy) return
  const raw = await desktop().files.read(DOCUMENTS_FILE).catch(() => undefined)
  if (raw === undefined || raw === lastRaw || raw === null) return
  const result = await readIndex()
  if (result.status === 'invalid') {
    state.error = `O arquivo documents.json foi alterado fora do app e agora contém um erro (${result.error}).`
    return
  }
  adopt(result.data)
  lastRaw = raw
  state.error = null
}

async function retry(): Promise<void> {
  state.loaded = false
  state.error = null
  await load()
}

// ── Consultas ───────────────────────────────────────────────────────────────

const categoryById = computed(() => new Map(state.categories.map((category) => [category.id, category])))

function categoryOf(doc: StoredDocument): DocumentCategory | null {
  return doc.categoryId ? (categoryById.value.get(doc.categoryId) ?? null) : null
}

const selectedCategory = computed(() => (state.selection.startsWith('category:') ? (categoryById.value.get(state.selection.slice(9)) ?? null) : null))

const countByCategory = computed(() => {
  const counts = new Map<string, number>()
  for (const doc of state.documents) {
    const key = doc.categoryId ?? 'none'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
})

/** Os documentos da lista: a busca procura em todos; senão, os da seleção. */
const visibleDocuments = computed(() => {
  const query = state.search.trim()
  const list = query
    ? state.documents.filter((doc) => matchesSearch(doc, query, categoryOf(doc)?.name ?? ''))
    : state.selection === 'all'
      ? state.documents
      : state.selection === 'none'
        ? state.documents.filter((doc) => !doc.categoryId)
        : state.documents.filter((doc) => `category:${doc.categoryId}` === state.selection)
  return sortDocuments(list, state.sort)
})

const openDocument = computed(() => (state.openId ? (state.documents.find((doc) => doc.id === state.openId) ?? null) : null))

function findDocument(id: string): StoredDocument | undefined {
  return state.documents.find((doc) => doc.id === id)
}

// ── Lista ───────────────────────────────────────────────────────────────────

function select(selection: DocumentSelection): void {
  state.selection = selection
  state.checked = []
}

function setSort(sort: DocumentSort): void {
  state.sort = sort
  writeDeviceState('documents', { sort })
}

function toggleChecked(id: string, on?: boolean): void {
  const has = state.checked.includes(id)
  const next = on ?? !has
  if (next && !has) state.checked = [...state.checked, id]
  else if (!next && has) state.checked = state.checked.filter((item) => item !== id)
}

function setChecked(ids: string[]): void {
  state.checked = [...new Set(ids)]
}

// ── Importar ────────────────────────────────────────────────────────────────

/**
 * Copia os arquivos para documents/arquivos/ e acrescenta ao índice, na categoria
 * `categoryId` (ou sem categoria). Devolve os documentos novos.
 */
async function importFiles(files: File[], categoryId: string | null = null): Promise<StoredDocument[]> {
  if (!guard() || !files.length) return []
  const target = categoryId && categoryById.value.has(categoryId) ? categoryId : null
  const added: StoredDocument[] = []
  const failed: string[] = []
  state.importing = { done: 0, total: files.length }
  try {
    for (const file of files) {
      try {
        if (file.size > MAX_DOCUMENT_BYTES) throw new Error(`grande demais (${formatSize(file.size)}; o máximo é 200 MB)`)
        const data = new Uint8Array(await file.arrayBuffer())
        const saved = await desktop().documents.save(file.name, data)
        const doc = newDocument(saved, target, file.name)
        // O mesmo nome de outro documento: fica o nome do arquivo gravado ("Lista (2)")
        if (state.documents.some((item) => item.name.toLowerCase() === doc.name.toLowerCase())) doc.name = displayName(saved.name)
        state.documents.push(doc)
        added.push(doc)
        scheduleSave()
      } catch (error) {
        failed.push(`${file.name}: ${errorMessage(error)}`)
      }
      state.importing.done++
    }
  } finally {
    state.importing = null
  }
  await flush()
  if (added.length) {
    showToast({
      message: added.length === 1 ? `“${added[0]!.name}” foi guardado nos Documentos.` : `${added.length} documentos guardados.`,
      icon: 'check',
      tone: 'success',
    })
  }
  if (failed.length) notifyError(`Não foi possível importar: ${failed.join('; ')}`)
  return added
}

// ── Editar ──────────────────────────────────────────────────────────────────

function renameDocument(id: string, name: string): boolean {
  if (!guard()) return false
  const doc = findDocument(id)
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
  if (!doc || !clean) return false
  if (doc.name === clean) return true
  doc.name = clean
  doc.updatedAt = new Date().toISOString()
  scheduleSave()
  return true
}

/** Muda a categoria de um ou mais documentos (null = sem categoria). Com Desfazer. */
function setCategory(ids: string[], categoryId: string | null): number {
  if (!guard()) return 0
  const target = categoryId && categoryById.value.has(categoryId) ? categoryId : null
  const before = new Map<string, string | null>()
  const now = new Date().toISOString()
  for (const doc of state.documents) {
    if (!ids.includes(doc.id) || doc.categoryId === target) continue
    before.set(doc.id, doc.categoryId)
    doc.categoryId = target
    doc.updatedAt = now
  }
  if (!before.size) return 0
  scheduleSave()
  const name = target ? (categoryById.value.get(target)?.name ?? '') : null
  showToast({
    message: `${before.size === 1 ? 'Documento' : `${before.size} documentos`} ${name ? `em “${name}”` : 'sem categoria'}.`,
    icon: 'check',
    action: {
      label: 'Desfazer',
      run: () => {
        for (const doc of state.documents) if (before.has(doc.id)) doc.categoryId = before.get(doc.id) ?? null
        scheduleSave()
      },
    },
  })
  return before.size
}

/** Marca o documento como aberto (para "Recentes") e abre no leitor. */
function open(id: string | null): void {
  state.openId = id
  const doc = id ? findDocument(id) : undefined
  if (doc && !state.error) {
    doc.openedAt = new Date().toISOString()
    scheduleSave()
  }
}

/** Exclui (Lixeira) os documentos e as anotações deles, depois de perguntar. */
async function requestDelete(ids: string[]): Promise<boolean> {
  if (!guard()) return false
  const docs = state.documents.filter((doc) => ids.includes(doc.id))
  if (!docs.length) return false
  const ok = await confirmDialog({
    title: docs.length === 1 ? `Excluir “${docs[0]!.name}”?` : `Excluir ${docs.length} documentos?`,
    message: 'O arquivo e as anotações vão para a Lixeira (no celular, para .4notes/trash).',
    confirmLabel: 'Excluir',
    danger: true,
  })
  if (!ok) return false
  for (const doc of docs) {
    try {
      await desktop().files.trash(doc.file)
    } catch (error) {
      // Arquivo que já não existe: sai do índice do mesmo jeito
      if (await desktop().files.exists(doc.file).catch(() => true)) {
        notifyError(`Não foi possível excluir “${doc.name}”: ${errorMessage(error)}`, error)
        continue
      }
    }
    annotationCache.delete(doc.id)
    const notes = annotationsPath(doc.id)
    if (await desktop().files.exists(notes).catch(() => false)) await desktop().files.trash(notes).catch(() => undefined)
    state.documents = state.documents.filter((item) => item.id !== doc.id)
    state.checked = state.checked.filter((item) => item !== doc.id)
    if (state.openId === doc.id) state.openId = null
  }
  scheduleSave()
  await flush()
  return true
}

function revealDocument(id: string): void {
  const doc = findDocument(id)
  if (doc) void desktop().files.reveal(doc.file).catch((error) => notifyError(errorMessage(error), error))
}

/** Abre no programa do sistema (formatos que o 4notes não mostra). */
async function openExternal(id: string): Promise<void> {
  const doc = findDocument(id)
  const api = desktop().documents
  if (!doc) return
  if (!api.openExternal) {
    showToast({ message: 'Este formato não abre no 4notes do celular.', icon: 'info' })
    return
  }
  await api.openExternal(doc.file).catch((error) => notifyError(errorMessage(error), error))
}

/** Os bytes do arquivo (o leitor de PDF). null = o arquivo sumiu. */
function readBytes(doc: StoredDocument): Promise<Uint8Array | null> {
  return desktop().documents.read(doc.file)
}

function readText(doc: StoredDocument): Promise<string | null> {
  return desktop().files.read(doc.file)
}

// ── Anotações (PDF) ─────────────────────────────────────────────────────────

const annotationCache = new Map<string, Annotation[]>()
const annotationQueue = new SerialQueue()
const pendingAnnotations = new Map<string, Annotation[]>()

async function loadAnnotations(id: string): Promise<Annotation[]> {
  const cached = annotationCache.get(id)
  if (cached) return cached
  const result = await readJsonFile(annotationsPath(id))
  const items = result.status === 'ok' ? normalizeAnnotations(result.data) : []
  if (result.status === 'invalid') notifyError('As anotações deste documento têm um erro e não foram carregadas (o arquivo não foi mudado).')
  annotationCache.set(id, items)
  return items
}

function writeAnnotations(id: string): Promise<void> {
  return annotationQueue
    .run(id, async () => {
      const items = pendingAnnotations.get(id)
      if (!items) return
      pendingAnnotations.delete(id)
      const path = annotationsPath(id)
      // Sem anotações e sem arquivo: nada a gravar
      if (!items.length && !(await desktop().files.exists(path))) return
      await desktop().files.write(path, serializeAnnotations(id, items))
    })
    .catch((error) => notifyError(`Não foi possível salvar as anotações: ${errorMessage(error)}`, error))
}

const scheduleAnnotations = debounce(() => {
  for (const id of [...pendingAnnotations.keys()]) void writeAnnotations(id)
}, 400)

/** Guarda as anotações do documento (gravadas logo depois, sem esperar você fechar). */
function saveAnnotations(id: string, items: Annotation[]): void {
  if (!findDocument(id)) return
  const copy = cloneAnnotations(items)
  annotationCache.set(id, copy)
  pendingAnnotations.set(id, copy)
  scheduleAnnotations()
}

async function flushAnnotations(): Promise<void> {
  scheduleAnnotations.flush()
  await annotationQueue.idle()
}

// ── Categorias (as do app) ──────────────────────────────────────────────────

function attachShared(category: SharedCategory): DocumentCategory {
  const existing = categoryById.value.get(category.id)
  if (existing) return existing
  state.categories.push({ id: category.id, name: category.name, color: category.color, createdAt: new Date().toISOString() })
  scheduleSave()
  shared.touch()
  return state.categories.at(-1)!
}

function addCategory(name: string, color: PaletteColor): DocumentCategory | null {
  const category = shared.findByName(name) ?? shared.createCategory({ name, color })
  return category ? attachShared(category) : null
}

function attachCategory(id: string): DocumentCategory | null {
  const category = shared.findCategory(id)
  return category ? attachShared(category) : null
}

function updateCategory(id: string, patch: { name?: string; color?: PaletteColor }): Promise<boolean> {
  return shared.updateCategory(id, patch)
}

function detachCategory(id: string): void {
  state.categories = state.categories.filter((category) => category.id !== id)
  for (const doc of state.documents) if (doc.categoryId === id) doc.categoryId = null
  if (state.selection === `category:${id}`) state.selection = 'all'
  scheduleSave()
}

function remapCategory(fromId: string, to: SharedCategory): void {
  let used = false
  for (const doc of state.documents) {
    if (doc.categoryId !== fromId) continue
    doc.categoryId = to.id
    used = true
  }
  const index = state.categories.findIndex((category) => category.id === fromId)
  if (index >= 0) {
    if (state.categories.some((category) => category.id === to.id)) state.categories.splice(index, 1)
    else state.categories.splice(index, 1, { id: to.id, name: to.name, color: to.color, createdAt: state.categories[index]!.createdAt })
  } else if (used) {
    attachShared(to)
  }
  if (state.selection === `category:${fromId}`) state.selection = `category:${to.id}`
  scheduleSave()
}

function requestDeleteCategory(id: string): Promise<boolean> {
  return requestCategoryRemoval(id, 'documents')
}

function moveCategory(id: string, delta: number): void {
  const from = state.categories.findIndex((category) => category.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= state.categories.length) return
  const [category] = state.categories.splice(from, 1)
  state.categories.splice(to, 0, category!)
  scheduleSave()
}

registerCategoryModule({
  id: 'documents',
  ready: () => state.loaded && !state.error,
  members: () => state.categories.map((category) => ({ id: category.id, name: category.name, color: category.color })),
  records: (id) =>
    sortDocuments(
      state.documents.filter((doc) => doc.categoryId === id),
      'name',
    ).map((doc) => ({ id: doc.id, title: doc.name, detail: `${KIND_LABELS[doc.kind]} · ${formatSize(doc.size)}`, path: `${DOCUMENTS_FILE}#${doc.id}` })),
  counts: () => {
    const counts = new Map<string, number>()
    for (const doc of state.documents) if (doc.categoryId) counts.set(doc.categoryId, (counts.get(doc.categoryId) ?? 0) + 1)
    return counts
  },
  sync: (category) => {
    const mine = categoryById.value.get(category.id)
    if (mine && (mine.name !== category.name || mine.color !== category.color)) {
      mine.name = category.name
      mine.color = category.color
      scheduleSave()
    }
    return true
  },
  attach: (category) => !!attachShared(category),
  remap: (from, to) => {
    if (from.id) remapCategory(from.id, to)
    return true
  },
  detach: (from) => {
    if (from.id) detachCategory(from.id)
    return true
  },
})

const categorySource: CategorySource = {
  module: 'documents',
  get categories() {
    return state.categories
  },
  add: (name, color) => addCategory(name, color),
  attach: (id) => attachCategory(id),
  update: (id, patch) => updateCategory(id, patch),
  requestDelete: (id) => requestDeleteCategory(id),
}

export function useDocumentsStore() {
  return {
    state,
    categorySource,
    categoryById,
    selectedCategory,
    countByCategory,
    visibleDocuments,
    openDocument,
    load,
    retry,
    refreshFromDisk,
    flush,
    categoryOf,
    findDocument,
    select,
    setSort,
    toggleChecked,
    setChecked,
    importFiles,
    renameDocument,
    setCategory,
    open,
    requestDelete,
    revealDocument,
    openExternal,
    readBytes,
    readText,
    loadAnnotations,
    saveAnnotations,
    flushAnnotations,
    addCategory,
    attachCategory,
    updateCategory,
    moveCategory,
    requestDeleteCategory,
  }
}
