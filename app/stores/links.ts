/**
 * Estado do módulo LINKS: links salvos, organizados em pastas.
 *
 * Os dados ficam em links/links.json (lib/links/model.ts); os ícones dos sites, em
 * links/icons/ — buscados pelo processo principal (electron/links.ts) quando um link
 * é salvo, e reaproveitados por todos os links do mesmo site. Este módulo não conhece
 * Notas, Tarefas nem o Mapa Mental.
 */
import { computed, nextTick, reactive } from 'vue'
import { errorMessage, type BookmarkFolder } from '#shared/ipc'
import { confirmDialog } from '~/composables/useDialog'
import { notifyError, showToast } from '~/composables/useToasts'
import type { PaletteColor } from '~/lib/colors'
import { planImport, type ImportCandidate, type ImportMode } from '~/lib/links/import'
import {
  folderIdFor,
  folderNameProblem,
  hostOf,
  normalizeUrl,
  placeholderTitle,
  searchLinks,
  serializeLinks,
  sortLinks,
  suggestFolderColor,
  urlKey,
  type LinkFolder,
  type LinkSort,
  type SavedLink,
} from '~/lib/links/model'
import { linksRepository as repo } from '~/lib/links/repository'
import { createJsonWriter } from '~/lib/storage/json-file'
import { DATA_PATHS } from '~/lib/storage/paths'
import { createId, debounce, SerialQueue } from '~/lib/utils/async'

export type LinkSelection = 'all' | 'none' | `folder:${string}`

const state = reactive({
  loaded: false,
  /** Preenchido quando o links.json não pôde ser lido: nada é gravado até resolver. */
  error: null as string | null,
  folders: [] as LinkFolder[],
  links: [] as SavedLink[],
  selection: 'all' as LinkSelection,
  search: '',
  sort: 'recent' as LinkSort,
  /** Links cujo título/ícone está sendo buscado agora. */
  fetching: new Set<string>(),
  /** Link em destaque (acabou de ser salvo, ou já existia ao tentar salvar de novo). */
  highlight: null as string | null,
  /** Muda quando um ícone é regravado (as imagens recarregam). */
  iconVersion: 0,
  /** Ícones sendo buscados em segundo plano (depois de uma importação, por exemplo). */
  iconJobs: { total: 0, done: 0 },
})

let lastRaw: string | null = null
const queue = new SerialQueue()
const uiWriter = createJsonWriter(DATA_PATHS.linksUiState)

function persist(): Promise<void> {
  return queue
    .run('links', async () => {
      if (state.error) return
      const raw = serializeLinks({ folders: state.folders, links: state.links })
      if (raw === lastRaw) return
      await repo.save(raw)
      lastRaw = raw
    })
    .catch((error) => notifyError(`Não foi possível salvar os links: ${errorMessage(error)}`, error))
}

const scheduleSave = debounce(() => void persist(), 250)

async function flush(): Promise<void> {
  scheduleSave.flush()
  await queue.idle()
  await uiWriter.flush()
}

// ── Carregamento ────────────────────────────────────────────────────────────

async function load(): Promise<void> {
  try {
    const [result, ui] = await Promise.all([repo.load(), repo.readUiState()])
    state.sort = ui.sort
    if (result.status === 'invalid') {
      state.error = result.error
    } else {
      state.folders = result.data.folders
      state.links = result.data.links
      lastRaw = result.raw
      state.error = null
      if (result.raw) void repo.backup(result.raw).catch((error) => console.warn('[4notes] Backup dos links falhou:', error))
    }
  } catch (error) {
    state.error = errorMessage(error)
  }
  state.loaded = true
}

/** Recarrega se o links.json foi editado fora do app (chamado ao focar a janela). */
async function refreshFromDisk(): Promise<void> {
  if (!state.loaded || scheduleSave.pending() || queue.busy) return
  const raw = await repo.readRaw().catch(() => undefined)
  if (raw === undefined || raw === lastRaw) return
  if (raw === null) {
    // Apagado fora do app: recria com o que está na memória (se havia algo)
    if (!state.error && lastRaw !== null) {
      lastRaw = null
      void persist()
    }
    return
  }
  const result = await repo.load()
  if (result.status === 'invalid') {
    state.error = `O arquivo links.json foi alterado fora do app e agora contém um erro (${result.error}).`
    return
  }
  state.folders = result.data.folders
  state.links = result.data.links
  lastRaw = raw
  state.error = null
  if (state.selection.startsWith('folder:') && !folderById.value.has(state.selection.slice(7))) state.selection = 'all'
}

async function retry(): Promise<void> {
  state.error = null
  await load()
}

// ── Consultas ───────────────────────────────────────────────────────────────

const folderById = computed(() => new Map(state.folders.map((folder) => [folder.id, folder])))

function findLink(id: string | null): SavedLink | undefined {
  return id ? state.links.find((link) => link.id === id) : undefined
}

function folderOf(link: SavedLink): LinkFolder | null {
  return link.folderId ? (folderById.value.get(link.folderId) ?? null) : null
}

const countByFolder = computed(() => {
  const counts = new Map<string, number>()
  for (const link of state.links) {
    const key = link.folderId && folderById.value.has(link.folderId) ? link.folderId : 'none'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
})

const selectedFolder = computed(() => (state.selection.startsWith('folder:') ? (folderById.value.get(state.selection.slice(7)) ?? null) : null))

/** Links mostrados: os da pasta escolhida (ou todos), filtrados pela busca — a busca procura em todas as pastas. */
const visibleLinks = computed(() => {
  const query = state.search.trim()
  let list = state.links
  if (!query) {
    if (state.selection === 'none') list = list.filter((link) => !folderOf(link))
    else if (selectedFolder.value) list = list.filter((link) => link.folderId === selectedFolder.value!.id)
  }
  return sortLinks(searchLinks(list, query), state.sort)
})

/** Domínio de um endereço (guardado: a lista inteira é percorrida a cada ícone que chega). */
const hostCache = new Map<string, string>()
function hostFor(url: string): string {
  let host = hostCache.get(url)
  if (host === undefined) {
    if (hostCache.size > 50_000) hostCache.clear()
    host = hostOf(url)
    hostCache.set(url, host)
  }
  return host
}

/** Ícone já conhecido de um site (outro link do mesmo site já tem). */
function iconForHost(host: string): string | null {
  for (const link of state.links) if (link.icon && hostFor(link.url) === host) return link.icon
  return null
}

/** Ícone já conhecido de cada site (para muitos links de uma vez, como numa importação). */
function knownIcons(): Map<string, string> {
  const icons = new Map<string, string>()
  for (const link of state.links) {
    const host = link.icon ? hostFor(link.url) : ''
    if (host && !icons.has(host)) icons.set(host, link.icon!)
  }
  return icons
}

// ── Título e ícone dos sites ────────────────────────────────────────────────

/** Sites cujo ícone já foi procurado nesta sessão (não procura de novo sozinho). */
const iconTried = new Set<string>()
/** Buscas em segundo plano ao mesmo tempo (as que você pede não esperam na fila). */
const MAX_PARALLEL = 3
let running = 0
const waiting: (() => void)[] = []

async function inBackground<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await task()
  } finally {
    running--
    waiting.shift()?.()
  }
}

function setFetching(id: string, on: boolean): void {
  if (on) state.fetching.add(id)
  else state.fetching.delete(id)
}

/** O ícone do site chegou: vale para todos os links desse site. */
function applyIcon(host: string, icon: string): void {
  let changed = false
  let rewritten = false
  for (const link of state.links) {
    if (hostFor(link.url) !== host) continue
    if (link.icon === icon) rewritten = true
    else {
      link.icon = icon
      changed = true
    }
  }
  // Mesmo arquivo regravado (ícone atualizado): as imagens precisam recarregar
  if (rewritten) state.iconVersion++
  if (changed) scheduleSave()
}

/**
 * Busca o título e/ou o ícone do site de um link.
 * `title: 'placeholder'` = só troca o título se ele ainda for o provisório (o domínio).
 * `background` = na fila, poucos de cada vez (ícones que faltam, depois de importar).
 */
async function enrich(id: string, options: { title: 'placeholder' | 'replace' | false; icon: boolean; background?: boolean }): Promise<void> {
  const link = findLink(id)
  if (!link) return
  const host = hostFor(link.url)
  const url = link.url
  if (options.icon) iconTried.add(host)
  const fetch = async () => {
    // Excluído (ou com outro endereço) enquanto esperava a vez: não busca
    if (findLink(id)?.url !== url) return null
    setFetching(id, true)
    try {
      return await repo.fetchMeta(url, options.icon)
    } finally {
      setFetching(id, false)
    }
  }
  try {
    const meta = await (options.background ? inBackground(fetch) : fetch())
    const current = findLink(id)
    if (!meta || !current || current.url !== url) return
    if (meta.title && options.title && (options.title === 'replace' || current.title === placeholderTitle(url))) {
      if (current.title !== meta.title) {
        current.title = meta.title
        current.updatedAt = new Date().toISOString()
        scheduleSave()
      }
    }
    if (meta.icon) applyIcon(host, meta.icon)
    if (options.title === 'replace' && !meta.reachable) showToast({ message: 'Não foi possível abrir o site agora (sem internet ou fora do ar).', icon: 'alert' })
  } catch (error) {
    console.warn('[4notes] Falha ao buscar o título/ícone do link:', error)
  }
}

/** Ícones que faltam (procura uma vez por sessão, em segundo plano, poucos de cada vez). */
function ensureIcons(): void {
  if (state.error) return
  const byHost = new Map<string, SavedLink>()
  for (const link of state.links) {
    if (link.icon) continue
    const host = hostFor(link.url)
    if (host && !iconTried.has(host) && !byHost.has(host)) byHost.set(host, link)
  }
  if (!byHost.size) return
  const jobs = state.iconJobs
  if (jobs.done >= jobs.total) Object.assign(jobs, { total: 0, done: 0 })
  jobs.total += byHost.size
  for (const link of byHost.values()) {
    void enrich(link.id, { title: false, icon: true, background: true }).finally(() => jobs.done++)
  }
}

// ── Ações: links ────────────────────────────────────────────────────────────

export type AddResult = { status: 'added' | 'exists'; link: SavedLink } | { status: 'invalid' }

/** Salva um link (o título e o ícone do site chegam logo depois). */
function addLink(input: string, folderId: string | null = null): AddResult {
  const url = normalizeUrl(input)
  if (!url) return { status: 'invalid' }
  const existing = state.links.find((link) => urlKey(link.url) === urlKey(url))
  if (existing) {
    const folder = folderOf(existing)
    const visible = visibleLinks.value.some((link) => link.id === existing.id)
    showToast({
      message: folder ? `Esse link já está salvo em ${folder.name}` : 'Esse link já está salvo',
      icon: 'info',
      ...(visible ? {} : { action: { label: 'Mostrar', run: () => reveal(existing.id) } }),
    })
    highlight(existing.id)
    return { status: 'exists', link: existing }
  }
  const now = new Date().toISOString()
  const host = hostFor(url)
  const link: SavedLink = {
    id: createId('l'),
    url,
    title: placeholderTitle(url),
    folderId: folderId && folderById.value.has(folderId) ? folderId : null,
    icon: iconForHost(host),
    createdAt: now,
    updatedAt: now,
  }
  state.links.push(link)
  highlight(link.id)
  scheduleSave()
  void enrich(link.id, { title: 'placeholder', icon: !link.icon })
  return { status: 'added', link: state.links.at(-1)! }
}

/** Destaca um link na lista (a página rola até ele). Repetir o mesmo link destaca de novo. */
function highlight(id: string): void {
  if (state.highlight !== id) {
    state.highlight = id
    return
  }
  state.highlight = null
  void nextTick(() => (state.highlight = id))
}

/** Abre a pasta do link e o destaca (ex.: "Mostrar" no aviso de link repetido). */
function reveal(id: string): void {
  const link = findLink(id)
  if (!link) return
  state.search = ''
  state.selection = folderOf(link) ? `folder:${link.folderId}` : 'none'
  highlight(id)
}

/** Muda título, endereço e/ou pasta. Devolve uma mensagem de erro, ou null se deu certo. */
function updateLink(id: string, patch: { title?: string; url?: string; folderId?: string | null }): string | null {
  const link = findLink(id)
  if (!link) return 'O link não existe mais.'
  let urlChanged = false
  if (patch.url !== undefined) {
    const url = normalizeUrl(patch.url)
    if (!url) return 'Isso não parece um endereço de site.'
    const duplicate = state.links.find((other) => other.id !== id && urlKey(other.url) === urlKey(url))
    if (duplicate) return `Esse endereço já está salvo${folderOf(duplicate) ? ` em ${folderOf(duplicate)!.name}` : ''}.`
    if (url !== link.url) {
      const hostChanged = hostFor(url) !== hostFor(link.url)
      link.url = url
      if (hostChanged) link.icon = iconForHost(hostFor(url))
      urlChanged = true
    }
  }
  if (patch.title !== undefined) link.title = patch.title.trim() || placeholderTitle(link.url)
  if (patch.folderId !== undefined) link.folderId = patch.folderId && folderById.value.has(patch.folderId) ? patch.folderId : null
  link.updatedAt = new Date().toISOString()
  scheduleSave()
  if (urlChanged && !link.icon) void enrich(id, { title: false, icon: true })
  return null
}

function moveLink(id: string, folderId: string | null, options: { undo?: boolean } = {}): void {
  const link = findLink(id)
  if (!link) return
  const previous = link.folderId
  const target = folderId && folderById.value.has(folderId) ? folderId : null
  if (previous === target) return
  link.folderId = target
  link.updatedAt = new Date().toISOString()
  scheduleSave()
  if (options.undo === false) return
  const folder = target ? folderById.value.get(target) : null
  showToast({
    message: folder ? `“${link.title}” foi para ${folder.name}` : `“${link.title}” ficou sem pasta`,
    icon: 'folder',
    action: { label: 'Desfazer', run: () => moveLink(id, previous, { undo: false }) },
  })
}

function deleteLink(id: string): void {
  const index = state.links.findIndex((link) => link.id === id)
  if (index < 0) return
  const [removed] = state.links.splice(index, 1)
  if (state.highlight === id) state.highlight = null
  scheduleSave()
  showToast({
    message: `“${removed!.title}” excluído`,
    icon: 'trash',
    action: {
      label: 'Desfazer',
      run: () => {
        if (findLink(removed!.id)) return
        state.links.splice(Math.min(index, state.links.length), 0, removed!)
        scheduleSave()
      },
    },
  })
}

/** "Atualizar título e ícone": busca de novo no site (o título atual é trocado). */
function refreshLink(id: string): void {
  void enrich(id, { title: 'replace', icon: true })
}

function openLink(id: string): void {
  const link = findLink(id)
  if (!link) return
  repo.openExternal(link.url).catch((error) => notifyError(`Não foi possível abrir o link: ${errorMessage(error)}`, error))
}

async function copyLink(id: string): Promise<void> {
  const link = findLink(id)
  if (!link) return
  await navigator.clipboard.writeText(link.url)
  showToast({ message: 'Endereço copiado', icon: 'copy' })
}

// ── Ações: pastas ───────────────────────────────────────────────────────────

function folderProblem(name: string, exceptId?: string): string | null {
  return folderNameProblem(
    name,
    state.folders.filter((folder) => folder.id !== exceptId).map((folder) => folder.name),
  )
}

function addFolder(name: string, color: PaletteColor, icon: string | null): LinkFolder | null {
  const problem = folderProblem(name)
  if (problem) {
    notifyError(problem)
    return null
  }
  const folder: LinkFolder = {
    id: folderIdFor(name, (id) => folderById.value.has(id)),
    name: name.trim(),
    color,
    icon,
    createdAt: new Date().toISOString(),
  }
  state.folders.push(folder)
  scheduleSave()
  return state.folders.at(-1)!
}

function updateFolder(id: string, patch: { name?: string; color?: PaletteColor; icon?: string | null }): boolean {
  const folder = folderById.value.get(id)
  if (!folder) return false
  if (patch.name !== undefined) {
    const problem = folderProblem(patch.name, id)
    if (problem) {
      notifyError(problem)
      return false
    }
    folder.name = patch.name.trim()
  }
  if (patch.color) folder.color = patch.color
  if (patch.icon !== undefined) folder.icon = patch.icon
  scheduleSave()
  return true
}

/** Exclui a pasta: os links dela ficam sem pasta (nenhum link é apagado). Com Desfazer. */
function deleteFolder(id: string): void {
  const index = state.folders.findIndex((folder) => folder.id === id)
  if (index < 0) return
  const [folder] = state.folders.splice(index, 1)
  const members = state.links.filter((link) => link.folderId === id).map((link) => link.id)
  for (const link of state.links) if (link.folderId === id) link.folderId = null
  if (state.selection === `folder:${id}`) state.selection = 'all'
  scheduleSave()
  showToast({
    message: `Pasta “${folder!.name}” excluída`,
    icon: 'trash',
    action: {
      label: 'Desfazer',
      run: () => {
        if (folderById.value.has(id)) return
        state.folders.splice(Math.min(index, state.folders.length), 0, folder!)
        for (const link of state.links) if (members.includes(link.id) && !link.folderId) link.folderId = id
        scheduleSave()
      },
    },
  })
}

async function requestDeleteFolder(id: string): Promise<boolean> {
  const folder = folderById.value.get(id)
  if (!folder) return false
  const count = countByFolder.value.get(id) ?? 0
  const ok = await confirmDialog({
    title: `Excluir a pasta “${folder.name}”?`,
    message: count ? `${count} ${count === 1 ? 'link fica' : 'links ficam'} sem pasta. Nenhum link é apagado.` : 'A pasta está vazia.',
    confirmLabel: 'Excluir pasta',
    danger: true,
  })
  if (ok) deleteFolder(id)
  return ok
}

function moveFolder(from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= state.folders.length || to >= state.folders.length) return
  const [folder] = state.folders.splice(from, 1)
  state.folders.splice(to, 0, folder!)
  scheduleSave()
}

// ── Importar do navegador ───────────────────────────────────────────────────

/** Importa os links marcados. Devolve quantos entraram e quantos já existiam. */
async function importLinks(candidates: ImportCandidate[], mode: ImportMode): Promise<{ added: number; skipped: number }> {
  const plan = planImport(candidates, { folders: state.folders, links: state.links }, mode)
  const created = new Map<string, string>()
  for (const name of plan.newFolders) {
    const folder = addFolder(name, suggestFolderColor(state.folders.map((item) => item.color)), null)
    if (folder) created.set(name, folder.id)
  }
  const now = Date.now()
  const icons = knownIcons()
  const added: SavedLink[] = []
  plan.links.forEach((item, index) => {
    const host = hostFor(item.url)
    // A ordem dos favoritos fica: os primeiros parecem os mais recentes
    const stamp = new Date(now - index).toISOString()
    added.push({
      id: createId('l'),
      url: item.url,
      title: item.title,
      folderId: item.folderId ?? (item.folderName ? (created.get(item.folderName) ?? null) : null),
      icon: icons.get(host) ?? null,
      createdAt: stamp,
      updatedAt: stamp,
    })
  })
  state.links.push(...added)
  scheduleSave()
  // Ícones embutidos no arquivo de favoritos (data:image/…): um por site
  const saved = new Set<string>()
  for (const item of plan.links) {
    if (!item.icon) continue
    const host = hostFor(item.url)
    if (saved.has(host) || icons.has(host)) continue
    saved.add(host)
    const icon = await repo.saveIcon(host, item.icon).catch(() => null)
    if (icon) {
      iconTried.add(host)
      applyIcon(host, icon)
    }
  }
  ensureIcons()
  return { added: added.length, skipped: plan.skipped }
}

/** Lê os favoritos de um navegador detectado ou de um arquivo HTML (null = cancelado). */
async function readBookmarks(source: { id: string } | 'file'): Promise<BookmarkFolder[] | null> {
  try {
    return source === 'file' ? await repo.pickBookmarksFile() : await repo.readBrowser(source.id)
  } catch (error) {
    notifyError(errorMessage(error), error)
    return null
  }
}

// ── Interface ───────────────────────────────────────────────────────────────

function select(selection: LinkSelection): void {
  state.selection = selection
}

function setSort(sort: LinkSort): void {
  state.sort = sort
  uiWriter.save(() => ({ sort: state.sort }))
}

export function useLinksStore() {
  return {
    state,
    folderById,
    countByFolder,
    selectedFolder,
    visibleLinks,
    findLink,
    folderOf,
    load,
    retry,
    flush,
    refreshFromDisk,
    ensureIcons,
    addLink,
    updateLink,
    moveLink,
    deleteLink,
    refreshLink,
    openLink,
    copyLink,
    reveal,
    folderProblem,
    addFolder,
    updateFolder,
    deleteFolder,
    requestDeleteFolder,
    moveFolder,
    importLinks,
    readBookmarks,
    browsers: () => repo.browsers(),
    select,
    setSort,
    iconPath: (link: SavedLink) => (link.icon ? repo.iconPath(link.icon) : null),
    revealFile: () => repo.reveal(),
  }
}
