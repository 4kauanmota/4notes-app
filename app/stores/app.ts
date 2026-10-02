/**
 * Estado geral do aplicativo: inicialização, pasta de dados e coordenação dos módulos.
 *
 * Esta parte conhece os três módulos ao mesmo tempo só para tarefas de
 * infraestrutura (carregar, salvar tudo antes de fechar, sincronizar ao voltar para
 * a janela). A única ligação entre os módulos são as menções a notas nas tarefas
 * (stores/mentions.ts).
 */
import { reactive } from 'vue'
import { errorCode, errorMessage, workspaceNameProblem, type BootstrapInfo, type DataDirStatus } from '#shared/ipc'
import { choiceDialog, confirmDialog, promptDialog } from '~/composables/useDialog'
import { notifyError, showToast } from '~/composables/useToasts'
import { desktop, hasDesktopApi } from '~/lib/platform'
import { createJsonWriter, readJsonFile } from '~/lib/storage/json-file'
import { DATA_PATHS } from '~/lib/storage/paths'
import { installMentionTracking } from './mentions'
import { useMindmapStore } from './mindmap'
import { useNotesStore } from './notes'
import { useTasksStore } from './tasks'

export type AppPhase = 'booting' | 'no-desktop' | 'setup' | 'ready' | 'error'
export type ModuleId = 'notes' | 'tasks' | 'mindmap'

const state = reactive({
  phase: 'booting' as AppPhase,
  bootstrap: null as BootstrapInfo | null,
  dataDir: null as DataDirStatus | null,
  error: null as string | null,
  lastModule: 'notes' as ModuleId,
  settingsOpen: false,
})

const notes = useNotesStore()
const tasks = useTasksStore()
const mindmap = useMindmapStore()
const appUiWriter = createJsonWriter(DATA_PATHS.appUiState)

async function loadModules(): Promise<void> {
  installMentionTracking()
  const results = await Promise.allSettled([notes.load(), tasks.load(), mindmap.load(), readLastModule()])
  const failure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined
  if (failure) throw failure.reason
}

async function readLastModule(): Promise<void> {
  const result = await readJsonFile(DATA_PATHS.appUiState)
  const value = result.status === 'ok' ? (result.data as { lastModule?: unknown })?.lastModule : null
  if (value === 'notes' || value === 'tasks' || value === 'mindmap') state.lastModule = value
}

export function rememberModule(module: ModuleId): void {
  if (state.phase !== 'ready' || state.lastModule === module) return
  state.lastModule = module
  appUiWriter.save(() => ({ lastModule: state.lastModule }))
}

/** Salva tudo que estiver pendente (chamado antes de fechar a janela). */
export async function flushEverything(): Promise<void> {
  await Promise.allSettled([notes.flushAll(), tasks.flush(), mindmap.flushAll(), appUiWriter.flush()])
}

let focusTimer: ReturnType<typeof setTimeout> | null = null
function onWindowFocus(): void {
  if (focusTimer) clearTimeout(focusTimer)
  // Ao voltar para o 4notes, relê os arquivos (você pode tê-los editado em outro programa).
  focusTimer = setTimeout(() => {
    void notes.refreshFromDisk()
    void tasks.refreshFromDisk()
    void mindmap.refreshFromDisk()
  }, 200)
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
    window.addEventListener('focus', onWindowFocus)
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
        message: `O workspace “${workspaceName(info.path)}” vai começar vazio. Se preferir, copie para ele as notas, tarefas e mapas do workspace atual (nada é apagado do atual).`,
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
    openSettings: () => (state.settingsOpen = true),
    closeSettings: () => (state.settingsOpen = false),
    revealDataFolder: () => desktop().dataDir.reveal(),
  }
}
