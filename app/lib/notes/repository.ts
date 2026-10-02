/**
 * Persistência das notas rápidas: arquivos .md em <pasta de dados>/notes/.
 * Só este arquivo sabe ONDE as notas ficam; o store só sabe O QUE fazer.
 */
import type { FileEntry } from '#shared/ipc'
import { joinPath } from '../files/filename'
import { desktop } from '../platform'
import { readJsonFile, toJson } from '../storage/json-file'
import { DATA_PATHS } from '../storage/paths'

export interface NotesUiState {
  openTabs: string[]
  activeTab: string | null
  sidebarOpen: boolean
}

export const notesRepository = {
  dir: DATA_PATHS.notesDir,

  pathFor(baseName: string): string {
    return joinPath(DATA_PATHS.notesDir, `${baseName}.md`)
  },

  /** Lista as notas (só a pasta notes/, sem subpastas) já com o conteúdo. */
  list(): Promise<FileEntry[]> {
    return desktop().files.list(DATA_PATHS.notesDir, { extensions: ['.md'], withContent: true })
  },

  write: (path: string, content: string) => desktop().files.write(path, content),
  rename: (from: string, to: string) => desktop().files.rename(from, to),
  exists: (path: string) => desktop().files.exists(path),
  trash: (path: string) => desktop().files.trash(path),
  reveal: (path: string) => desktop().files.reveal(path),

  async readUiState(): Promise<NotesUiState> {
    const result = await readJsonFile(DATA_PATHS.notesUiState)
    const data = (result.status === 'ok' && result.data && typeof result.data === 'object' ? result.data : {}) as Partial<NotesUiState>
    return {
      openTabs: Array.isArray(data.openTabs) ? data.openTabs.filter((p): p is string => typeof p === 'string') : [],
      activeTab: typeof data.activeTab === 'string' ? data.activeTab : null,
      sidebarOpen: data.sidebarOpen !== false,
    }
  },

  serializeUiState: (state: NotesUiState) => toJson(state),
}
