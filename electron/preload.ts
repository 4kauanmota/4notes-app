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
let updateProgressHandler: ((percent: number) => void) | null = null

ipcRenderer.on(IPC.textMenu, (_event, request: TextMenuRequest) => textMenuHandler?.(request))
ipcRenderer.on(IPC.updatesProgress, (_event, percent: number) => updateProgressHandler?.(percent))

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
    mkdir: (dir) => ipcRenderer.invoke(IPC.filesMkdir, dir),
  },
  images: {
    copy: (from, to) => ipcRenderer.invoke(IPC.imagesCopy, from, to),
  },
  attachments: {
    saveImage: (data, mime) => ipcRenderer.invoke(IPC.attachmentsSaveImage, data, mime),
  },
  library: {
    list: () => ipcRenderer.invoke(IPC.libraryList),
    upload: () => ipcRenderer.invoke(IPC.libraryUpload),
    adopt: (path) => ipcRenderer.invoke(IPC.libraryAdopt, path),
    remove: (path) => ipcRenderer.invoke(IPC.libraryRemove, path),
  },
  exports: {
    saveText: (name, text) => ipcRenderer.invoke(IPC.exportText, name, text),
    savePdf: (name, html) => ipcRenderer.invoke(IPC.exportPdf, name, html),
    reveal: (path) => ipcRenderer.invoke(IPC.exportReveal, path),
  },
  system: {
    launchAtLogin: () => ipcRenderer.invoke(IPC.launchAtLogin),
    setLaunchAtLogin: (enabled) => ipcRenderer.invoke(IPC.setLaunchAtLogin, enabled),
  },
  links: {
    fetchMeta: (url, withIcon) => ipcRenderer.invoke(IPC.linksFetchMeta, url, withIcon),
    saveIcon: (host, dataUrl) => ipcRenderer.invoke(IPC.linksSaveIcon, host, dataUrl),
    browsers: () => ipcRenderer.invoke(IPC.linksBrowsers),
    readBrowser: (id) => ipcRenderer.invoke(IPC.linksReadBrowser, id),
    pickBookmarksFile: () => ipcRenderer.invoke(IPC.linksPickFile),
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
  bank: {
    status: () => ipcRenderer.invoke(IPC.bankStatus),
    configure: (credentials) => ipcRenderer.invoke(IPC.bankConfigure, credentials),
    forget: () => ipcRenderer.invoke(IPC.bankForget),
    item: (id) => ipcRenderer.invoke(IPC.bankItem, id),
    accounts: (itemId) => ipcRenderer.invoke(IPC.bankAccounts, itemId),
    transactions: (query) => ipcRenderer.invoke(IPC.bankTransactions, query),
  },
  updates: {
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    onProgress: (handler) => {
      updateProgressHandler = handler
    },
  },
}

contextBridge.exposeInMainWorld('fourNotes', api)
