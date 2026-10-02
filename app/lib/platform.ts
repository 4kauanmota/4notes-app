/**
 * Acesso à camada desktop a partir da interface.
 *
 * `window.fourNotes` é criado pelo preload do Electron (electron/preload.ts).
 * Se a interface for aberta num navegador comum, ele não existe.
 */
import type { FourNotesApi } from '#shared/ipc'

export function hasDesktopApi(): boolean {
  return typeof window !== 'undefined' && !!window.fourNotes
}

export function desktop(): FourNotesApi {
  const api = typeof window !== 'undefined' ? window.fourNotes : undefined
  if (!api) throw new Error('O 4notes precisa ser executado pelo Electron (npm run dev).')
  return api
}

export function isMac(): boolean {
  return hasDesktopApi() ? desktop().bootstrap.platform === 'darwin' : /Mac/i.test(navigator.platform)
}

/** "Ctrl" no Windows/Linux, "⌘" no macOS — para exibir atalhos. */
export function modKeyLabel(): string {
  return isMac() ? '⌘' : 'Ctrl'
}
