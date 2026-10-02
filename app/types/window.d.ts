import type { FourNotesApi } from '#shared/ipc'

declare global {
  interface Window {
    /** API exposta pelo preload do Electron. */
    fourNotes?: FourNotesApi
    /** Ganchos de inspeção usados apenas pelos testes automatizados. */
    __fourNotesTest?: Record<string, unknown>
  }
}

export {}
