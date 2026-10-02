/**
 * Janela principal do 4notes.
 *
 * - Barra de título personalizada (desenhada pelo Vue), mantendo os botões nativos
 *   de minimizar/maximizar/fechar do sistema (inclusive o Snap Layouts do Windows 11).
 * - Lembra tamanho/posição.
 * - Antes de fechar, pede à interface para salvar tudo que estiver pendente.
 * - Links externos abrem no navegador padrão, nunca dentro do app.
 */
import { BrowserWindow, ipcMain, nativeTheme, screen, shell } from 'electron'
import { IPC, type TextMenuRequest } from '../shared/ipc'
import { getConfig, updateConfig, type WindowState } from './config'

export const TITLE_BAR_HEIGHT = 40

/** Mesmas cores do token --chrome em app/assets/css/tokens.css */
export const CHROME_COLORS = {
  light: { color: '#EFEDF5', symbolColor: '#3B3548' },
  dark: { color: '#121016', symbolColor: '#D9D4E4' },
}

interface CreateWindowOptions {
  url: string
  preload: string
  isDev: boolean
  icon?: string
}

/** Garante que a janela restaurada apareça em algum monitor conectado. */
function restoreBounds(state: WindowState): Electron.Rectangle | { width: number; height: number } {
  const { width, height, x, y } = state
  if (x === undefined || y === undefined) return { width, height }
  const visible = screen.getAllDisplays().some(({ workArea }) =>
    x + 80 > workArea.x && x < workArea.x + workArea.width - 80 && y >= workArea.y - 10 && y < workArea.y + workArea.height - 80,
  )
  return visible ? { x, y, width, height } : { width, height }
}

function isExternalUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url)
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const config = getConfig()
  const isMac = process.platform === 'darwin'
  const chrome = nativeTheme.shouldUseDarkColors ? CHROME_COLORS.dark : CHROME_COLORS.light

  const win = new BrowserWindow({
    ...restoreBounds(config.window),
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: '4notes',
    icon: options.icon,
    backgroundColor: chrome.color,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { ...chrome, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })

  // ── Exibição: só mostra a janela quando a interface avisar que está pronta ──
  let shown = false
  const show = () => {
    if (shown || win.isDestroyed()) return
    shown = true
    if (getConfig().window.maximized) win.maximize()
    win.show()
  }
  const onReady = (event: Electron.IpcMainEvent) => {
    if (event.sender === win.webContents) show()
  }
  ipcMain.on(IPC.ready, onReady)
  setTimeout(show, options.isDev ? 20000 : 5000) // plano B, caso algo dê errado no carregamento
  win.webContents.on('did-fail-load', show)
  win.webContents.on('render-process-gone', show)

  // ── Zoom salvo ──
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(getConfig().zoomFactor)
  })

  // ── Fechamento seguro: a interface salva o que estiver pendente antes ──
  let closeState: 'idle' | 'flushing' | 'done' = 'idle'
  const onCloseReady = (event: Electron.IpcMainEvent) => {
    if (event.sender === win.webContents) finishClose()
  }
  const finishClose = () => {
    if (closeState === 'done' || win.isDestroyed()) return
    closeState = 'done'
    win.close()
  }
  ipcMain.on(IPC.closeReady, onCloseReady)

  win.on('close', (event) => {
    saveWindowState(win)
    if (closeState === 'done') return
    event.preventDefault()
    if (closeState === 'flushing') return
    closeState = 'flushing'
    if (win.webContents.isDestroyed() || win.webContents.isCrashed()) return finishClose()
    setTimeout(finishClose, 4000)
    win.webContents.send(IPC.beforeClose)
  })

  win.on('closed', () => {
    ipcMain.removeListener(IPC.ready, onReady)
    ipcMain.removeListener(IPC.closeReady, onCloseReady)
  })

  // ── Segurança: nada de navegar para fora do app ──
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(options.url)) return
    event.preventDefault()
    if (isExternalUrl(url)) void shell.openExternal(url)
  })

  // ── Atalhos de zoom (Ctrl + / Ctrl - / Ctrl 0) e de desenvolvimento ──
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = isMac ? input.meta : input.control
    const key = input.key.toLowerCase()
    const setZoom = (factor: number) => {
      const zoomFactor = Math.round(Math.min(2, Math.max(0.5, factor)) * 10) / 10
      win.webContents.setZoomFactor(zoomFactor)
      updateConfig({ zoomFactor })
      event.preventDefault()
    }
    if (mod && !input.alt && (key === '=' || key === '+')) return setZoom(win.webContents.getZoomFactor() + 0.1)
    if (mod && !input.alt && key === '-') return setZoom(win.webContents.getZoomFactor() - 0.1)
    if (mod && !input.alt && key === '0') return setZoom(1)
    if (options.isDev && (key === 'f12' || (mod && input.shift && key === 'i'))) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
    if (options.isDev && mod && !input.shift && key === 'r') {
      win.webContents.reload()
      event.preventDefault()
    }
  })

  // ── Clique direito em texto (corretor, copiar/colar): a interface desenha o menu ──
  // (só acontece quando a interface não tratou o clique direito por conta própria)
  win.webContents.on('context-menu', (_event, params) => {
    const request: TextMenuRequest = {
      misspelledWord: params.misspelledWord,
      suggestions: params.dictionarySuggestions.slice(0, 6),
      isEditable: params.isEditable,
      canUndo: params.editFlags.canUndo,
      canRedo: params.editFlags.canRedo,
      canCut: params.editFlags.canCut,
      canCopy: params.editFlags.canCopy,
      canPaste: params.editFlags.canPaste,
      hasSelection: !!params.selectionText.trim(),
      linkURL: params.linkURL && isExternalUrl(params.linkURL) ? params.linkURL : null,
    }
    win.webContents.send(IPC.textMenu, request)
  })

  // Corretor ortográfico em português (quando o dicionário estiver disponível)
  const session = win.webContents.session
  const languages = ['pt-BR', 'en-US'].filter((lang) => session.availableSpellCheckerLanguages.includes(lang))
  if (!isMac && languages.length) session.setSpellCheckerLanguages(languages)

  void win.loadURL(options.url)
  return win
}

export function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const maximized = win.isMaximized()
  const bounds = win.getNormalBounds()
  updateConfig({ window: { ...bounds, maximized } })
}

export function setTitleBarColors(win: BrowserWindow, colors: { color: string; symbolColor: string }): void {
  const valid = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
  if (!valid(colors?.color) || !valid(colors?.symbolColor) || win.isDestroyed()) return
  win.setBackgroundColor(colors.color)
  if (process.platform !== 'darwin') {
    win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: TITLE_BAR_HEIGHT })
  }
}
