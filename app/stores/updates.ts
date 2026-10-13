/**
 * Atualizações do 4notes (GitHub Releases — shared/updates.ts).
 *
 * - Ao abrir o app (com o workspace carregado), procura uma versão nova em segundo
 *   plano. Achou: pergunta "Existe uma nova versão… Deseja instalar?".
 * - "Agora não": a pergunta não volta para aquela versão — ela fica em Configurações ›
 *   Geral › Atualizações (e um ponto discreto na engrenagem), para instalar quando quiser.
 *   Uma versão ainda mais nova pergunta de novo.
 * - Instalar: salva tudo, baixa (com o andamento) e
 *     Windows → o 4notes fecha, instala e abre de novo;
 *     Android → abre o instalador do sistema (na primeira vez, a permissão para o 4notes
 *     instalar apps; ao voltar dela, o instalador abre sozinho).
 * - Sem internet ou sem o repositório configurado: nada aparece na abertura; as
 *   Configurações mostram o motivo.
 * A escolha "Agora não" fica neste aparelho (não no workspace).
 */
import { reactive } from 'vue'
import { errorMessage } from '#shared/ipc'
import { notesSummary, type UpdateCheck, type UpdateInfo } from '#shared/updates'
import { confirmDialog } from '~/composables/useDialog'
import { showToast } from '~/composables/useToasts'
import { desktop, hasDesktopApi } from '~/lib/platform'
import { readLocalValue, writeLocalValue } from '~/lib/storage/device-state'
import { flushEverything } from './app'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'installing'
  /** Android: falta permitir o 4notes instalar apps. */
  | 'permission'
  | 'unsupported'
  | 'error'

const DISMISSED_KEY = 'update-dismissed'
/** Espera depois de abrir, para não disputar com o carregamento do workspace. */
const STARTUP_DELAY_MS = 2500

const state = reactive({
  status: 'idle' as UpdateStatus,
  current: '',
  available: null as UpdateInfo | null,
  /** Andamento do download (0–100). */
  progress: 0,
  /** Motivo de "unsupported" ou mensagem de erro. */
  message: '',
  reason: null as 'dev' | 'not-configured' | null,
  checkedAt: null as number | null,
})

const api = () => (hasDesktopApi() ? desktop().updates : undefined)

/** A plataforma se atualiza sozinha (o Electron e o app Android). */
export function updatesSupported(): boolean {
  return !!api()
}

let progressWired = false
function wireProgress(): void {
  const updates = api()
  if (progressWired || !updates) return
  progressWired = true
  updates.onProgress((percent) => {
    state.progress = Math.round(percent)
  })
}

function apply(result: UpdateCheck): void {
  state.checkedAt = Date.now()
  state.message = ''
  state.reason = null
  if (result.status === 'available') {
    state.available = result.update
    state.status = 'available'
  } else if (result.status === 'latest') {
    state.available = null
    state.status = 'latest'
  } else if (result.status === 'unsupported') {
    state.available = null
    state.status = 'unsupported'
    state.reason = result.reason
  } else {
    state.status = 'error'
    state.message = result.message
  }
}

/** Procura agora (botão "Procurar atualização"). */
export async function checkForUpdates(): Promise<UpdateCheck | null> {
  const updates = api()
  if (!updates || state.status === 'checking' || state.status === 'downloading' || state.status === 'installing') return null
  wireProgress()
  state.current = desktop().bootstrap.appVersion
  const previous = state.status
  state.status = 'checking'
  try {
    const result = await updates.check()
    apply(result)
    return result
  } catch (error) {
    apply({ status: 'error', message: errorMessage(error) })
    return null
  } finally {
    if (state.status === 'checking') state.status = previous
  }
}

/** "Agora não" para esta versão: a pergunta não volta (fica nas Configurações). */
function dismiss(version: string): void {
  writeLocalValue(DISMISSED_KEY, version)
}

export function dismissedVersion(): string | null {
  return readLocalValue(DISMISSED_KEY)
}

/** Baixa e instala a versão encontrada. */
export async function installUpdate(): Promise<void> {
  const updates = api()
  if (!updates || !state.available || state.status === 'downloading' || state.status === 'installing') return
  wireProgress()
  state.progress = 0
  state.message = ''
  state.status = 'downloading'
  try {
    // Tudo salvo antes (no Windows o app fecha para instalar)
    await flushEverything()
    const result = await updates.install()
    if (result === 'permission') {
      state.status = 'permission'
      waitForPermission()
      return
    }
    state.status = 'installing'
  } catch (error) {
    state.status = 'error'
    state.message = errorMessage(error)
    showToast({ message: state.message, icon: 'alert', tone: 'error' })
  }
}

let waitingPermission = false
/** Android: ao voltar da tela de permissão, tenta instalar de novo (o APK já foi baixado). */
function waitForPermission(): void {
  if (waitingPermission) return
  waitingPermission = true
  const retry = () => {
    if (document.visibilityState !== 'visible' || state.status !== 'permission') return
    document.removeEventListener('visibilitychange', retry)
    waitingPermission = false
    void installUpdate()
  }
  document.addEventListener('visibilitychange', retry)
}

/** Pergunta se quer instalar a versão encontrada. */
async function offer(update: UpdateInfo): Promise<void> {
  const summary = notesSummary(update.notes)
  const install = await confirmDialog({
    title: `Existe uma nova versão do 4notes (${update.version}). Deseja instalar?`,
    message: `${summary ? `${summary}\n\n` : ''}Você está na versão ${state.current}. Se preferir depois, ela fica em Configurações › Geral › Atualizações.`,
    confirmLabel: 'Instalar',
    cancelLabel: 'Agora não',
    icon: 'download',
  })
  if (install) await installUpdate()
  else dismiss(update.version)
}

let startupDone = false
/** Na abertura: procura em segundo plano e pergunta (uma vez por versão). */
export function checkOnStartup(): void {
  if (startupDone || !api()) return
  startupDone = true
  setTimeout(async () => {
    const result = await checkForUpdates()
    if (result?.status !== 'available') return
    if (dismissedVersion() === result.update.version) return
    await offer(result.update)
  }, STARTUP_DELAY_MS)
}

export function useUpdatesStore() {
  return { state, checkForUpdates, installUpdate, checkOnStartup, updatesSupported, dismissedVersion }
}
