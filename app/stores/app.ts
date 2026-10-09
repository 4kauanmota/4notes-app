/**
 * Estado geral do aplicativo: inicialização, pasta de dados e coordenação dos módulos.
 *
 * Esta parte conhece os quatro módulos ao mesmo tempo só para tarefas de
 * infraestrutura (carregar, salvar tudo antes de fechar, sincronizar ao voltar para
 * a janela). A única ligação entre os módulos são as menções (stores/mentions.ts).
 * Quais módulos estão ativos (e o último aberto) fica em stores/modules.ts: todos
 * os módulos carregam e salvam os dados, ativos ou não.
 */
import { reactive } from 'vue'
import { errorCode, errorMessage, workspaceNameProblem, type BootstrapInfo, type DataDirStatus } from '#shared/ipc'
import { choiceDialog, confirmDialog, promptDialog } from '~/composables/useDialog'
import { applyWorkspaceTheme } from '~/composables/useTheme'
import { notifyError, showToast } from '~/composables/useToasts'
import { desktop, hasDesktopApi } from '~/lib/platform'
import type { ModuleId } from '~/lib/modules'
import { useLinksStore } from './links'
import { flushMentionUpdates, installMentionTracking } from './mentions'
import { useMindmapStore } from './mindmap'
import { useModulesStore } from './modules'
import { useNotesStore } from './notes'
import { flushSettings, loadSettings, refreshSettings, settingsSection } from './settings'
import { useTasksStore } from './tasks'

export type AppPhase = 'booting' | 'no-desktop' | 'setup' | 'ready' | 'error'
/** Abas das Configurações (os atalhos ficam nos Tutoriais, F1). */
export type SettingsTab = 'general' | 'modules'
export { isModuleId, type ModuleId } from '~/lib/modules'

const state = reactive({
  phase: 'booting' as AppPhase,
  bootstrap: null as BootstrapInfo | null,
  dataDir: null as DataDirStatus | null,
  error: null as string | null,
  settingsOpen: false,
  settingsTab: 'general' as SettingsTab,
  /** Módulo a mostrar ao abrir a aba Módulos (ex.: o botão de ajustes do mapa leva ao Mapa Mental). */
  settingsSection: null as ModuleId | null,
})

/** Abre as Configurações (opcionalmente numa aba e no trecho de um módulo). */
function openSettings(tab: SettingsTab = 'general', section: ModuleId | null = null): void {
  state.settingsTab = tab
  state.settingsSection = section
  state.settingsOpen = true
}

const notes = useNotesStore()
const tasks = useTasksStore()
const mindmap = useMindmapStore()
const links = useLinksStore()
const modules = useModulesStore()

async function loadModules(): Promise<void> {
  installMentionTracking()
  // Primeiro as configurações do workspace (os módulos leem a parte deles)
  await loadSettings()
  applyWorkspaceTheme(settingsSection('theme'))
  // Todos os módulos carregam (ativos ou não): desativar só tira o módulo do menu
  const results = await Promise.allSettled([notes.load(), tasks.load(), mindmap.load(), links.load(), modules.load()])
  const failure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined
  if (failure) throw failure.reason
}

/** Guarda o último módulo aberto (só depois de carregar o workspace). */
export function rememberModule(module: ModuleId): void {
  if (state.phase === 'ready') modules.remember(module)
}

/** Salva tudo que estiver pendente (chamado antes de fechar a janela). */
export async function flushEverything(): Promise<void> {
  // Primeiro as menções que ainda estavam para ser corrigidas (elas mexem nas notas)
  await flushMentionUpdates().catch((error) => console.warn('[4notes] Falha ao atualizar menções:', error))
  await Promise.allSettled([notes.flushAll(), tasks.flush(), mindmap.flushAll(), links.flush(), flushSettings()])
}

let focusTimer: ReturnType<typeof setTimeout> | null = null
/**
 * Relê os arquivos do workspace: eles podem ter mudado em outro programa ou em outro
 * aparelho (a pasta sincronizada pelo Google Drive, por exemplo).
 */
function refreshWorkspace(): void {
  if (focusTimer) clearTimeout(focusTimer)
  focusTimer = setTimeout(() => {
    void refreshSettings()
    void notes.refreshFromDisk()
    void tasks.refreshFromDisk()
    void mindmap.refreshFromDisk()
    void links.refreshFromDisk()
  }, 200)
}

/** De quanto em quanto tempo o app relê o workspace enquanto está aberto (outros aparelhos). */
const REFRESH_EVERY_MS = 60_000

function watchWorkspace(): void {
  // Ao voltar para o 4notes (janela, ou o app no celular)
  window.addEventListener('focus', refreshWorkspace)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshWorkspace()
    // Indo para o fundo (celular): salva o que estiver pendente
    else void flushEverything()
  })
  desktop().app.onResume?.(refreshWorkspace)
  // Enquanto fica aberto, de tempos em tempos (só com o app visível)
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshWorkspace()
  }, REFRESH_EVERY_MS)
}

export async function startApp(): Promise<void> {
  if (!hasDesktopApi()) {
    state.phase = 'no-desktop'
    return
  }
  const api = desktop()
  state.bootstrap = api.bootstrap
  state.dataDir = api.bootstrap.dataDir
  api.app.onBeforeClose(flushEverything)

  if (!state.dataDir.ready) {
    state.phase = 'setup'
    return
  }
  try {
    await loadModules()
    state.phase = 'ready'
    watchWorkspace()
  } catch (error) {
    state.error = errorMessage(error)
    state.phase = 'error'
  }
}

// ── Workspace (a pasta de dados) ────────────────────────────────────────────

/** O nome do workspace é o nome da pasta dele. */
export function workspaceName(path: string | null | undefined): string {
  if (!path) return ''
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) || path
}

function samePath(a: string, b: string): boolean {
  const normalize = (p: string) => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
  return normalize(a) === normalize(b)
}

/**
 * Abre `path` como workspace (qualquer pasta serve).
 * @param initial true na primeira execução (ou quando o workspace anterior sumiu)
 */
export async function applyDataFolder(path: string, initial: boolean): Promise<boolean> {
  const api = desktop()
  const info = await api.dataDir.inspect(path)
  if (info.exists && !info.writable) {
    notifyError('O 4notes não tem permissão para gravar nessa pasta. Escolha outra.')
    return false
  }

  if (info.exists && !info.isEmpty && !info.hasData) {
    const choice = await choiceDialog({
      title: 'Essa pasta já tem outros arquivos',
      message: `Para manter tudo organizado, você pode criar um workspace (uma pasta nova, com o nome que quiser) dentro de “${info.path}”.`,
      icon: 'folder',
      buttons: [
        { id: 'cancel', label: 'Cancelar', variant: 'ghost' },
        { id: 'here', label: 'Usar assim mesmo' },
        { id: 'new', label: 'Criar workspace dentro dela…', variant: 'primary' },
      ],
      defaultButton: 'new',
    })
    if (!choice || choice === 'cancel') return false
    if (choice === 'new') return createWorkspace(initial, info.path)
  }

  let copyFromCurrent = false
  const current = state.dataDir?.ready ? state.dataDir.path : null
  if (!initial && current) {
    if (samePath(current, info.path)) {
      showToast({ message: 'Esse já é o workspace aberto.', icon: 'info' })
      return false
    }
    if (!info.hasData) {
      const choice = await choiceDialog({
        title: 'Pasta ainda sem dados do 4notes',
        message: `O workspace “${workspaceName(info.path)}” vai começar vazio. Se preferir, copie para ele as notas, tarefas, mapas e links do workspace atual (nada é apagado do atual).`,
        icon: 'folder',
        buttons: [
          { id: 'cancel', label: 'Cancelar', variant: 'ghost' },
          { id: 'copy', label: 'Copiar dados do atual' },
          { id: 'empty', label: 'Começar vazio', variant: 'primary' },
        ],
        defaultButton: 'empty',
      })
      if (!choice || choice === 'cancel') return false
      copyFromCurrent = choice === 'copy'
    }
    await flushEverything()
  }

  try {
    await api.dataDir.use(info.path, { copyFromCurrent })
  } catch (error) {
    notifyError(`Não foi possível usar essa pasta: ${errorMessage(error)}`, error)
    return false
  }
  // Recarrega a interface: todos os módulos leem o workspace do zero.
  window.location.reload()
  return true
}

/** Abrir workspace: você escolhe qualquer pasta (se ela tiver dados do 4notes, eles aparecem). */
export async function openWorkspace(initial: boolean): Promise<boolean> {
  const picked = await desktop().dataDir.pick({ title: 'Abrir workspace', buttonLabel: 'Abrir workspace' })
  if (!picked) return false
  return applyDataFolder(picked, initial)
}

/**
 * Criar workspace: você escolhe onde (seletor de pastas, sem pasta sugerida) e dá
 * um nome; o 4notes cria lá dentro uma pasta com esse nome e guarda tudo nela.
 */
export async function createWorkspace(initial: boolean, parent?: string): Promise<boolean> {
  const api = desktop()
  const location = parent ?? (await api.dataDir.pick({ title: 'Onde criar o workspace?', buttonLabel: 'Criar aqui' }))
  if (!location) return false
  let suggestion = ''
  for (;;) {
    const name = await promptDialog({
      title: 'Nome do workspace',
      message: `Será criada uma pasta com esse nome em “${location}”, com todos os dados do workspace.`,
      label: 'Nome do workspace',
      value: suggestion,
      placeholder: 'Ex.: Pessoal, Trabalho, Estudos',
      confirmLabel: 'Criar workspace',
      icon: 'workspace',
      validate: workspaceNameProblem,
    })
    if (!name) return false
    if (!initial && state.dataDir?.ready) await flushEverything()
    try {
      await api.dataDir.create(location, name)
    } catch (error) {
      // Nome já usado nesse local: avisa e pede outro nome (não é um erro do app)
      if (errorCode(error) === 'EEXIST') {
        notifyError(errorMessage(error))
        suggestion = name
        continue
      }
      notifyError(`Não foi possível criar o workspace: ${errorMessage(error)}`, error)
      return false
    }
    window.location.reload()
    return true
  }
}

export function useAppStore() {
  return {
    state,
    startApp,
    flushEverything,
    rememberModule,
    applyDataFolder,
    openWorkspace,
    createWorkspace,
    workspaceName: () => workspaceName(state.dataDir?.path),
    openSettings,
    closeSettings: () => (state.settingsOpen = false),
    revealDataFolder: () => desktop().dataDir.reveal(),
  }
}
