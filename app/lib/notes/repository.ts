/**
 * Persistência das notas rápidas: arquivos .md em <pasta de dados>/notes/ — soltos
 * (sem categoria) ou dentro da pasta de uma categoria (notes/<Categoria>/).
 * Só este arquivo sabe ONDE as notas ficam; o store só sabe O QUE fazer.
 */
import type { FileEntry } from '#shared/ipc'
import { joinPath } from '../files/filename'
import { desktop } from '../platform'
import { readJsonFile } from '../storage/json-file'
import { DATA_PATHS } from '../storage/paths'
import { CATEGORIES_FILE, normalizeCategories, serializeCategories, type NoteCategory } from './categories'

/** Como os nomes das pastas pelo título aparecem: como foram digitados ou em CAIXA ALTA. */
export type FolderCase = 'typed' | 'upper'

/** Configurações das Notas (Configurações › Módulos), guardadas no workspace (settings.json). */
export interface NotesSettings {
  /** Nota nova sem categoria vai para a categoria que já tem notas com o mesmo começo de título. */
  autoCategory: boolean
  folderCase: FolderCase
}

export const DEFAULT_NOTES_SETTINGS: NotesSettings = { autoCategory: false, folderCase: 'typed' }

/** Como as Notas estavam na tela deste aparelho (lib/storage/device-state.ts). */
export interface NotesViewState {
  openTabs: string[]
  activeTab: string | null
  sidebarOpen: boolean
  /** Categorias recolhidas na lista lateral. */
  collapsedCategories: string[]
  /** Pastas (pelo título) abertas na lista lateral. */
  openFolders: string[]
}

export type CategoriesResult = { status: 'ok' | 'missing'; categories: NoteCategory[]; raw: string | null } | { status: 'invalid'; raw: string }

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
const objectOf = (value: unknown) => (value && typeof value === 'object' ? value : {}) as Record<string, unknown>

/** Configurações das Notas a partir da seção "notes" do settings.json (tolerante). */
export function normalizeNotesSettings(raw: unknown): NotesSettings {
  const settings = objectOf(raw)
  return {
    autoCategory: settings.autoCategory === true,
    folderCase: settings.folderCase === 'upper' ? 'upper' : 'typed',
  }
}

/** Estado da tela guardado no aparelho (tolerante). */
export function normalizeNotesView(raw: unknown): NotesViewState {
  const data = objectOf(raw)
  return {
    openTabs: strings(data.openTabs),
    activeTab: typeof data.activeTab === 'string' ? data.activeTab : null,
    sidebarOpen: data.sidebarOpen !== false,
    collapsedCategories: strings(data.collapsedCategories),
    openFolders: strings(data.openFolders),
  }
}

export const notesRepository = {
  dir: DATA_PATHS.notesDir,

  /** Caminho de uma nota na pasta `dir` ("notes" ou "notes/<Categoria>"). */
  pathFor(dir: string, baseName: string): string {
    return joinPath(dir, `${baseName}.md`)
  },

  /** Lista as notas (notes/ e as pastas das categorias, um nível só) já com o conteúdo. */
  async list(): Promise<FileEntry[]> {
    const files = await desktop().files.list(DATA_PATHS.notesDir, { recursive: true, extensions: ['.md'], withContent: true })
    return files.filter((file) => file.path.split('/').length <= 3)
  },

  write: (path: string, content: string) => desktop().files.write(path, content),
  rename: (from: string, to: string) => desktop().files.rename(from, to),
  exists: (path: string) => desktop().files.exists(path),
  trash: (path: string) => desktop().files.trash(path),
  reveal: (path: string) => desktop().files.reveal(path),
  mkdir: (dir: string) => desktop().files.mkdir(dir),
  /** Todos os arquivos (visíveis) de uma pasta, de qualquer tipo. */
  listAll: (dir: string) => desktop().files.list(dir, { recursive: true }),
  /** Copia uma imagem do workspace (ex.: da biblioteca para a pasta da categoria). */
  copyImage: (from: string, to: string) => desktop().images.copy(from, to),
  /** Garante que a imagem está na biblioteca (attachments/); devolve o caminho dela lá. */
  keepInLibrary: (path: string) => desktop().library.adopt(path),

  async readCategories(): Promise<CategoriesResult> {
    const result = await readJsonFile(CATEGORIES_FILE)
    if (result.status === 'missing') return { status: 'missing', categories: [], raw: null }
    if (result.status === 'invalid') return { status: 'invalid', raw: result.raw }
    return { status: 'ok', categories: normalizeCategories(result.data), raw: result.raw }
  },

  /** Grava o categorias.json; devolve o texto gravado. */
  async writeCategories(categories: NoteCategory[]): Promise<string> {
    const raw = serializeCategories(categories)
    await desktop().files.write(CATEGORIES_FILE, raw)
    return raw
  },

  /** Guarda uma cópia de um categorias.json com erro antes de ele ser substituído. */
  async backupBrokenCategories(raw: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const path = joinPath(DATA_PATHS.backupsDir, `categorias-${stamp}.json`)
    await desktop().files.write(path, raw)
    return path
  },
}
