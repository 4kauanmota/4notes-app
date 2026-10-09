/**
 * Acesso à plataforma: o Electron no computador, o app Android no celular.
 *
 * As duas expõem a mesma API (`FourNotesApi`, em shared/ipc.ts) como `window.fourNotes`:
 * no desktop, pelo preload do Electron; no Android, pela camada de lib/mobile
 * (instalada por plugins/00.platform.client.ts antes de a interface abrir).
 */
import { DESKTOP_CAPABILITIES, type FourNotesApi, type PlatformCapabilities } from '#shared/ipc'

export function hasDesktopApi(): boolean {
  return typeof window !== 'undefined' && !!window.fourNotes
}

export function desktop(): FourNotesApi {
  const api = typeof window !== 'undefined' ? window.fourNotes : undefined
  if (!api) throw new Error('O 4notes precisa ser executado pelo Electron (npm run dev) ou pelo app Android.')
  return api
}

export function isMac(): boolean {
  return hasDesktopApi() ? desktop().bootstrap.platform === 'darwin' : /Mac/i.test(navigator.platform)
}

export function modKeyLabel(): string {
  return isMac() ? '⌘' : 'Ctrl'
}

/** O app Android (Capacitor). */
export function isAndroid(): boolean {
  return hasDesktopApi() && desktop().bootstrap?.platform === 'android'
}

/** O que a plataforma sabe fazer (o desktop faz tudo). */
export function capabilities(): PlatformCapabilities {
  return (hasDesktopApi() && desktop().bootstrap?.capabilities) || DESKTOP_CAPABILITIES
}

/** Dá para mostrar arquivos no gerenciador de arquivos do sistema ("Mostrar no Explorador")? */
export function canReveal(): boolean {
  return capabilities().reveal
}

/** Para onde vai o que é excluído (para as mensagens): a Lixeira do sistema ou a do workspace. */
export function trashPlace(): string {
  return capabilities().systemTrash ? 'a Lixeira' : 'a lixeira do workspace (.4notes/trash)'
}
