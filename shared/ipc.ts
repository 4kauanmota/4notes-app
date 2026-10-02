/**
 * Contrato entre o processo principal do Electron (Node.js) e a interface (Nuxt).
 *
 *   Interface (Nuxt/Vue)  ──window.fourNotes──▶  preload.ts  ──IPC──▶  main.ts (Node.js)
 *
 * - O preload implementa a interface `FourNotesApi` e a expõe como `window.fourNotes`.
 * - O processo principal registra um "handler" para cada canal listado em `IPC`.
 * - A interface NUNCA acessa o disco diretamente: ela pede ao processo principal,
 *   que valida o caminho e só permite ler/escrever DENTRO da pasta de dados escolhida.
 *
 * Este arquivo é importado pelos dois lados, então só pode conter tipos e constantes
 * simples (nada de Node.js nem de Vue).
 */

export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppSettings {
  theme: ThemePreference
}

/** Por que a pasta de dados não pode ser usada (ou null se está tudo certo). */
export type DataDirProblem = 'not-configured' | 'missing' | 'not-writable'

export interface DataDirStatus {
  /** Caminho absoluto da pasta de dados (ex.: C:\Users\Kauan\Documents\4notes). */
  path: string | null
  ready: boolean
  problem: DataDirProblem | null
}

/** Informações entregues de forma síncrona assim que a janela abre. */
export interface BootstrapInfo {
  appVersion: string
  platform: string
  isDev: boolean
  settings: AppSettings
  dataDir: DataDirStatus
  /** Somente para testes automatizados: força a data de "hoje" (AAAA-MM-DD). */
  fakeToday: string | null
  /** Somente para testes automatizados: expõe ganchos de inspeção na janela. */
  testMode: boolean
}

export interface FileEntry {
  /** Caminho relativo à pasta de dados, sempre com "/" (ex.: "notes/Ideias.md"). */
  path: string
  /** Nome do arquivo com extensão. */
  name: string
  size: number
  mtimeMs: number
  /** Presente quando `withContent: true`. */
  content?: string
}

export interface ListOptions {
  /** Entra em subpastas (ignorando pastas ocultas que começam com "."). */
  recursive?: boolean
  /** Filtra por extensão, ex.: ['.md']. */
  extensions?: string[]
  /** Já devolve o conteúdo de cada arquivo (evita uma chamada por arquivo). */
  withContent?: boolean
}

export interface FolderInspection {
  path: string
  exists: boolean
  isEmpty: boolean
  /** A pasta já contém dados do 4notes (notes/, tasks/, mindmap/ ou .4notes/). */
  hasData: boolean
  writable: boolean
}

export interface UseDataDirOptions {
  /** Copia os dados da pasta atual para a nova (sem sobrescrever nada). */
  copyFromCurrent?: boolean
}

/**
 * Nome de workspace: vira o nome da pasta, então não pode ter caracteres que o
 * Windows recusa. Devolve a mensagem de erro, ou null se o nome serve.
 */
export function workspaceNameProblem(name: string): string | null {
  const value = name.trim()
  if (!value) return 'Digite um nome para o workspace.'
  if (value.length > 80) return 'Use um nome com até 80 caracteres.'
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(value)) return 'O nome não pode ter estes caracteres: < > : " / \\ | ? *'
  if (/[. ]$/.test(value)) return 'O nome não pode terminar com ponto ou espaço.'
  if (/^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(value)) return 'Esse nome é reservado pelo Windows. Escolha outro.'
  return null
}

/**
 * Protocolo que mostra as imagens do workspace na interface:
 * workspace://files/attachments/imagem.png → <pasta de dados>/attachments/imagem.png
 */
export const WORKSPACE_SCHEME = 'workspace'

/** Endereço de um arquivo do workspace (caminho relativo, com "/"). */
export function workspaceFileUrl(relativePath: string): string {
  return `${WORKSPACE_SCHEME}://files/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

/** Resultado de apagar uma imagem: apagada, mantida (outra nota usa) ou já não existia. */
export type RemoveImageResult = 'removed' | 'in-use' | 'missing'

/** Clique direito em texto (editor, campos): dados para montar o menu de copiar/colar e do corretor. */
export interface TextMenuRequest {
  /** Palavra com erro de ortografia sob o cursor ("" se não houver) e as sugestões do corretor. */
  misspelledWord: string
  suggestions: string[]
  isEditable: boolean
  canUndo: boolean
  canRedo: boolean
  canCut: boolean
  canCopy: boolean
  canPaste: boolean
  hasSelection: boolean
  /** Endereço web clicado (só http/https/mailto). */
  linkURL: string | null
}

export type TextMenuAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'replace' | 'learn'

export interface TitleBarColors {
  color: string
  symbolColor: string
}

export interface FourNotesApi {
  bootstrap: BootstrapInfo
  app: {
    /** Avisa o processo principal que a interface terminou de montar (mostra a janela). */
    ready(): void
    /** Registra a função chamada antes de a janela fechar (para salvar o que estiver pendente). */
    onBeforeClose(handler: () => Promise<void>): void
  }
  settings: {
    setTheme(theme: ThemePreference): Promise<void>
  }
  dataDir: {
    status(): Promise<DataDirStatus>
    /** Abre o seletor de pastas nativo do sistema (começa na pasta atual, se houver). */
    pick(options?: { title?: string; buttonLabel?: string }): Promise<string | null>
    inspect(path: string): Promise<FolderInspection>
    use(path: string, options?: UseDataDirOptions): Promise<DataDirStatus>
    /** Cria o workspace: a pasta `name` dentro de `parent`, já com a estrutura do 4notes. */
    create(parent: string, name: string): Promise<DataDirStatus>
    /** Abre a pasta de dados no Explorador de Arquivos. */
    reveal(): Promise<void>
  }
  files: {
    list(dir: string, options?: ListOptions): Promise<FileEntry[]>
    read(path: string): Promise<string | null>
    write(path: string, content: string): Promise<FileEntry>
    rename(from: string, to: string): Promise<void>
    exists(path: string): Promise<boolean>
    /** Move para a Lixeira do sistema (com fallback para .4notes/trash). */
    trash(path: string): Promise<void>
    /** Mostra o arquivo selecionado no Explorador de Arquivos. */
    reveal(path: string): Promise<void>
  }
  attachments: {
    /** Grava uma imagem em attachments/ e devolve o caminho dela (ex.: "attachments/imagem-20261002-141503.png"). */
    saveImage(data: Uint8Array, mime: string): Promise<string>
    /**
     * Apaga (Lixeira) uma imagem removida de uma nota, se nenhuma outra nota a usa.
     * @param exceptNote caminho da nota de onde ela saiu (ex.: "notes/Ideias.md")
     */
    removeImage(path: string, exceptNote: string | null): Promise<RemoveImageResult>
    /** Devolve uma imagem apagada nesta sessão (Desfazer). */
    restoreImage(path: string): Promise<boolean>
  }
  window: {
    setTitleBarColors(colors: TitleBarColors): void
  }
  shell: {
    openExternal(url: string): Promise<void>
  }
  menu: {
    /** Clique direito em texto: a interface desenha o menu (com o visual do 4notes). */
    onTextMenu(handler: (request: TextMenuRequest) => void): void
    /** Executa a ação escolhida no menu de texto ("replace" e "learn" recebem a palavra). */
    runTextAction(action: TextMenuAction, word?: string): Promise<void>
  }
}

/** Nomes dos canais IPC (iguais nos dois lados). */
export const IPC = {
  bootstrap: 'app:bootstrap',
  ready: 'app:ready',
  beforeClose: 'app:before-close',
  closeReady: 'app:close-ready',
  setTheme: 'settings:set-theme',
  dataDirStatus: 'data-dir:status',
  dataDirPick: 'data-dir:pick',
  dataDirInspect: 'data-dir:inspect',
  dataDirUse: 'data-dir:use',
  dataDirCreate: 'data-dir:create',
  dataDirReveal: 'data-dir:reveal',
  filesList: 'files:list',
  filesRead: 'files:read',
  filesWrite: 'files:write',
  filesRename: 'files:rename',
  filesExists: 'files:exists',
  filesTrash: 'files:trash',
  filesReveal: 'files:reveal',
  attachmentsSaveImage: 'attachments:save-image',
  attachmentsRemoveImage: 'attachments:remove-image',
  attachmentsRestoreImage: 'attachments:restore-image',
  titleBarColors: 'window:title-bar-colors',
  openExternal: 'shell:open-external',
  textMenu: 'menu:text',
  textMenuAction: 'menu:text-action',
} as const

/**
 * Erros que atravessam o IPC perdem propriedades extras; por isso o código
 * vai embutido na mensagem: "[EEXIST] Já existe um arquivo com esse nome".
 */
export function errorCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const match = /\[([A-Z_]+)\]/.exec(message)
  return match ? match[1]! : null
}

/** Mensagem amigável (sem o prefixo técnico do Electron e sem o código). */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'Erro desconhecido')
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
    .replace(/^\[[A-Z_]+\]\s*/, '')
}
