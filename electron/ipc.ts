/**
 * Handlers IPC: é aqui que os pedidos da interface (window.fourNotes.*) são atendidos.
 *
 * Cada canal de shared/ipc.ts tem um handler. Todos verificam se o pedido veio
 * da própria interface do 4notes antes de tocar no disco.
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  IPC,
  type BootstrapInfo,
  type DataDirStatus,
  type ListOptions,
  type ThemePreference,
  type UseDataDirOptions,
} from '../shared/ipc'
import { getConfig, updateConfig } from './config'
import { copyDataDir, createWorkspace, dataDirStatus, inspectFolder, prepareDataDir } from './data-dir'
import { exportPdf, exportText, revealExport } from './export'
import { AppError, copyImage, fileExists, listFiles, makeDir, readFile, renameFile, revealFile, saveImage, trashFile, writeFile } from './files'
import { bankAccounts, bankItem, bankStatus, bankTransactions, configureBank, forgetBank } from './bank'
import { adoptIntoLibrary, listLibrary, removeFromLibrary, uploadToLibrary } from './library'
import { fetchLinkMeta, findBrowserSources, pickBookmarksFile, readBrowserBookmarks, saveDataIcon } from './links'
import { APP_ORIGIN } from './protocol'
import { launchAtLogin, setLaunchAtLogin } from './system'
import { checkForUpdate, installUpdate } from './updates'
import { setTitleBarColors } from './window'

interface IpcContext {
  devServerUrl: string | null
  isDev: boolean
}

let cachedStatus: DataDirStatus = { path: null, ready: false, problem: 'not-configured' }

export async function refreshDataDirStatus(): Promise<DataDirStatus> {
  cachedStatus = await dataDirStatus(getConfig().dataDir)
  return cachedStatus
}

function assertString(value: unknown, what = 'valor'): string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError('EINVAL', `${what} inválido.`)
  return value
}

function requireDataDir(): string {
  const dir = getConfig().dataDir
  if (!dir || !cachedStatus.ready) throw new AppError('ENODATA', 'Nenhuma pasta de dados configurada.')
  return dir
}

export function registerIpc(context: IpcContext): void {
  const trusted = (frameUrl: string | undefined) =>
    !!frameUrl &&
    (frameUrl.startsWith(`${APP_ORIGIN}/`) || (!!context.devServerUrl && frameUrl.startsWith(context.devServerUrl)))

  /** Registra um handler `invoke` aceitando apenas chamadas da interface do app. */
  function handle(channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!trusted(event.senderFrame?.url)) throw new AppError('EACCES', 'Origem não autorizada.')
      return fn(event, ...args)
    })
  }

  // ── Inicialização (síncrona, usada pelo preload antes da página carregar) ──
  ipcMain.on(IPC.bootstrap, (event) => {
    const info: BootstrapInfo = {
      appVersion: app.getVersion(),
      platform: process.platform,
      isDev: context.isDev,
      settings: { theme: getConfig().theme },
      dataDir: cachedStatus,
      fakeToday: /^\d{4}-\d{2}-\d{2}$/.test(process.env.FOURNOTES_FAKE_TODAY ?? '') ? process.env.FOURNOTES_FAKE_TODAY! : null,
      testMode: process.env.FOURNOTES_TEST === '1',
    }
    event.returnValue = info
  })

  // ── Preferências ──
  handle(IPC.setTheme, (_event, theme: ThemePreference) => {
    if (!['system', 'light', 'dark'].includes(theme)) throw new AppError('EINVAL', 'Tema inválido.')
    nativeTheme.themeSource = theme
    updateConfig({ theme })
  })

  ipcMain.on(IPC.titleBarColors, (event, colors) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && trusted(event.senderFrame?.url)) setTitleBarColors(win, colors)
  })

  // ── Pasta de dados ──
  handle(IPC.dataDirStatus, () => refreshDataDirStatus())

  // Sem pasta sugerida: o seletor só começa na pasta atual quando já existe uma.
  handle(IPC.dataDirPick, async (event, labels?: { title?: unknown; buttonLabel?: unknown }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.slice(0, 120) : fallback)
    const options: Electron.OpenDialogOptions = {
      title: text(labels?.title, 'Escolha a pasta do workspace'),
      buttonLabel: text(labels?.buttonLabel, 'Selecionar pasta'),
      defaultPath: getConfig().dataDir ?? undefined,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })

  handle(IPC.dataDirInspect, (_event, target: string) => inspectFolder(assertString(target, 'Caminho')))

  handle(IPC.dataDirUse, async (_event, target: string, options: UseDataDirOptions = {}) => {
    const next = path.resolve(assertString(target, 'Caminho'))
    const current = getConfig().dataDir
    await fs.mkdir(next, { recursive: true })
    if (options.copyFromCurrent && current && path.resolve(current) !== next) {
      await copyDataDir(current, next)
    }
    await prepareDataDir(next)
    const status = await dataDirStatus(next)
    if (!status.ready) throw new AppError('EACCES', 'Não foi possível gravar nessa pasta.')
    updateConfig({ dataDir: next })
    cachedStatus = status
    return status
  })

  handle(IPC.dataDirCreate, async (_event, parent: string, name: string) => {
    const target = await createWorkspace(assertString(parent, 'Caminho'), assertString(name, 'Nome'))
    const status = await dataDirStatus(target)
    if (!status.ready) throw new AppError('EACCES', 'Não foi possível gravar nessa pasta.')
    updateConfig({ dataDir: target })
    cachedStatus = status
    return status
  })

  handle(IPC.dataDirReveal, async () => {
    const error = await shell.openPath(requireDataDir())
    if (error) throw new AppError('EIO', error)
  })

  // ── Arquivos (sempre relativos à pasta de dados) ──
  handle(IPC.filesList, (_event, dir: string, options?: ListOptions) => listFiles(requireDataDir(), dir, options ?? {}))
  handle(IPC.filesRead, (_event, file: string) => readFile(requireDataDir(), file))
  handle(IPC.filesWrite, (_event, file: string, content: string) => writeFile(requireDataDir(), file, content))
  handle(IPC.filesRename, (_event, from: string, to: string) => renameFile(requireDataDir(), from, to))
  handle(IPC.filesExists, (_event, file: string) => fileExists(requireDataDir(), file))
  handle(IPC.filesTrash, (_event, file: string) => trashFile(requireDataDir(), file))
  handle(IPC.filesReveal, (_event, file: string) => revealFile(requireDataDir(), file))
  handle(IPC.filesMkdir, (_event, dir: string) => makeDir(requireDataDir(), assertString(dir, 'Caminho')))

  // ── Imagens ──
  handle(IPC.imagesCopy, (_event, from: unknown, to: unknown) => copyImage(requireDataDir(), from, to))
  handle(IPC.attachmentsSaveImage, (_event, data: unknown, mime: unknown) => saveImage(requireDataDir(), data, mime))

  // ── Biblioteca de imagens ──
  handle(IPC.libraryList, () => listLibrary(requireDataDir()))
  handle(IPC.libraryUpload, (event) => uploadToLibrary(requireDataDir(), BrowserWindow.fromWebContents(event.sender)))
  handle(IPC.libraryAdopt, (_event, file: unknown) => adoptIntoLibrary(requireDataDir(), file))
  handle(IPC.libraryRemove, (_event, file: unknown) => removeFromLibrary(requireDataDir(), file))

  // ── Exportar notas (TXT / PDF) ──
  handle(IPC.exportText, (event, name: unknown, text: unknown) => exportText(BrowserWindow.fromWebContents(event.sender), name, text))
  handle(IPC.exportPdf, (event, name: unknown, html: unknown) =>
    exportPdf(BrowserWindow.fromWebContents(event.sender), cachedStatus.ready ? getConfig().dataDir : null, name, html),
  )
  handle(IPC.exportReveal, (_event, file: unknown) => revealExport(file))

  // ── Links: título e ícone dos sites, favoritos dos navegadores ──
  handle(IPC.linksFetchMeta, (_event, url: unknown, withIcon: unknown) => fetchLinkMeta(requireDataDir(), url, withIcon))
  handle(IPC.linksSaveIcon, (_event, host: unknown, dataUrl: unknown) => saveDataIcon(requireDataDir(), host, dataUrl))
  handle(IPC.linksBrowsers, () => findBrowserSources())
  handle(IPC.linksReadBrowser, (_event, id: unknown) => readBrowserBookmarks(id))
  handle(IPC.linksPickFile, (event) => pickBookmarksFile(BrowserWindow.fromWebContents(event.sender)))

  // ── Bancos (Meu Pluggy, 1.7.2): a mensagem do erro vai sem o nome técnico ──
  const bank =
    <T,>(fn: (...args: any[]) => Promise<T>) =>
    async (_event: Electron.IpcMainInvokeEvent, ...args: any[]): Promise<T> => {
      try {
        return await fn(...args)
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error))
      }
    }
  handle(IPC.bankStatus, bank(bankStatus))
  handle(IPC.bankConfigure, bank(configureBank))
  handle(IPC.bankForget, bank(forgetBank))
  handle(IPC.bankItem, bank(bankItem))
  handle(IPC.bankAccounts, bank(bankAccounts))
  handle(IPC.bankTransactions, bank(bankTransactions))

  // ── Sistema ──
  handle(IPC.launchAtLogin, () => launchAtLogin())
  handle(IPC.setLaunchAtLogin, (_event, enabled: unknown) => setLaunchAtLogin(enabled))

  // ── Atualizações (GitHub Releases) ──
  handle(IPC.updatesCheck, () => checkForUpdate())
  handle(IPC.updatesInstall, (event) =>
    installUpdate((percent) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.updatesProgress, percent)
    }),
  )

  handle(IPC.openExternal, async (_event, url: string) => {
    if (typeof url !== 'string' || !/^(https?:|mailto:)/i.test(url)) throw new AppError('EINVAL', 'Link não permitido.')
    await shell.openExternal(url)
  })

  // Ação escolhida no menu de texto (o menu é desenhado pela interface)
  handle(IPC.textMenuAction, (event, action: unknown, word: unknown) => {
    const contents = event.sender
    switch (action) {
      case 'undo':
        return contents.undo()
      case 'redo':
        return contents.redo()
      case 'cut':
        return contents.cut()
      case 'copy':
        return contents.copy()
      case 'paste':
        return contents.paste()
      case 'selectAll':
        return contents.selectAll()
      case 'replace':
        if (typeof word === 'string' && word) contents.replaceMisspelling(word)
        return
      case 'learn':
        if (typeof word === 'string' && word.trim()) contents.session.addWordToSpellCheckerDictionary(word)
        return
      default:
        throw new AppError('EINVAL', 'Ação inválida.')
    }
  })
}
