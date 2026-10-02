/**
 * Preload — a ponte segura entre a interface (Nuxt) e o processo principal.
 *
 * Roda antes da página, num contexto isolado. Expõe SOMENTE as funções definidas
 * em `FourNotesApi` como `window.fourNotes`. A interface não tem acesso ao Node.js
 * nem ao `require`: tudo passa por aqui, via IPC (mensagens entre processos).
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type BootstrapInfo, type FourNotesApi, type TextMenuRequest } from '../shared/ipc'

const bootstrap = ipcRenderer.sendSync(IPC.bootstrap) as BootstrapInfo

let beforeCloseHandler: (() => Promise<void>) | null = null
let textMenuHandler: ((request: TextMenuRequest) => void) | null = null

ipcRenderer.on(IPC.textMenu, (_event, request: TextMenuRequest) => textMenuHandler?.(request))

ipcRenderer.on(IPC.beforeClose, async () => {
  try {
    await beforeCloseHandler?.()
  } catch (error) {
    console.error('[4notes] Erro ao salvar antes de fechar:', error)
  } finally {
    ipcRenderer.send(IPC.closeReady)
  }
})

const api: FourNotesApi = {
  bootstrap,
  app: {
    ready: () => ipcRenderer.send(IPC.ready),
    onBeforeClose: (handler) => {
      beforeCloseHandler = handler
    },
  },
  settings: {
    setTheme: (theme) => ipcRenderer.invoke(IPC.setTheme, theme),
  },
  dataDir: {
    status: () => ipcRenderer.invoke(IPC.dataDirStatus),
    pick: (options) => ipcRenderer.invoke(IPC.dataDirPick, options),
    inspect: (path) => ipcRenderer.invoke(IPC.dataDirInspect, path),
    use: (path, options) => ipcRenderer.invoke(IPC.dataDirUse, path, options),
    create: (parent, name) => ipcRenderer.invoke(IPC.dataDirCreate, parent, name),
    reveal: () => ipcRenderer.invoke(IPC.dataDirReveal),
  },
  files: {
    list: (dir, options) => ipcRenderer.invoke(IPC.filesList, dir, options),
    read: (path) => ipcRenderer.invoke(IPC.filesRead, path),
    write: (path, content) => ipcRenderer.invoke(IPC.filesWrite, path, content),
    rename: (from, to) => ipcRenderer.invoke(IPC.filesRename, from, to),
    exists: (path) => ipcRenderer.invoke(IPC.filesExists, path),
    trash: (path) => ipcRenderer.invoke(IPC.filesTrash, path),
    reveal: (path) => ipcRenderer.invoke(IPC.filesReveal, path),
  },
  attachments: {
    saveImage: (data, mime) => ipcRenderer.invoke(IPC.attachmentsSaveImage, data, mime),
    removeImage: (path, exceptNote) => ipcRenderer.invoke(IPC.attachmentsRemoveImage, path, exceptNote),
    restoreImage: (path) => ipcRenderer.invoke(IPC.attachmentsRestoreImage, path),
  },
  window: {
    setTitleBarColors: (colors) => ipcRenderer.send(IPC.titleBarColors, colors),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  },
  menu: {
    onTextMenu: (handler) => {
      textMenuHandler = handler
    },
    runTextAction: (action, word) => ipcRenderer.invoke(IPC.textMenuAction, action, word),
  },
}

contextBridge.exposeInMainWorld('fourNotes', api)
