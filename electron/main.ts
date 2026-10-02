/**
 * Processo principal do Electron — o "lado desktop" do 4notes.
 *
 * Roda com Node.js e é responsável por:
 *   1. Criar a janela nativa (window.ts)
 *   2. Servir a interface gerada pelo Nuxt via app://4notes (protocol.ts)
 *   3. Atender os pedidos da interface: arquivos, pasta de dados, menus (ipc.ts)
 *
 * Em desenvolvimento (`npm run dev`) a interface vem do servidor do Nuxt
 * (variável FOURNOTES_DEV_SERVER_URL, definida por scripts/dev.mjs).
 */
import { app, BrowserWindow, Menu, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getConfig, loadConfig } from './config'
import { refreshDataDirStatus, registerIpc } from './ipc'
import { APP_ORIGIN, registerAppProtocol, registerSchemePrivileges, registerWorkspaceProtocol } from './protocol'
import { createMainWindow } from './window'

const devServerUrl = process.env.FOURNOTES_DEV_SERVER_URL || null
const isDev = devServerUrl !== null

// Testes automatizados podem isolar a configuração em outra pasta.
if (process.env.FOURNOTES_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.FOURNOTES_USER_DATA_DIR))
}

registerSchemePrivileges()

// Interface 100% em português: força o idioma do Chromium (formato das datas
// em <input type="date">, corretor ortográfico, etc.), independente do sistema.
app.commandLine.appendSwitch('lang', 'pt-BR')

let mainWindow: BrowserWindow | null = null

function openMainWindow(): void {
  const devIcon = path.join(__dirname, '..', 'build', 'icon.png')
  mainWindow = createMainWindow({
    url: devServerUrl ?? `${APP_ORIGIN}/`,
    preload: path.join(__dirname, 'preload.cjs'),
    isDev,
    icon: process.platform !== 'darwin' && fs.existsSync(devIcon) ? devIcon : undefined,
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function setupApplicationMenu(): void {
  if (process.platform === 'darwin') {
    // No macOS o menu superior é obrigatório para atalhos como Cmd+C / Cmd+V.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
    )
  } else {
    // Windows/Linux: a barra de título é desenhada pela interface.
    Menu.setApplicationMenu(null)
  }
}

// Apenas uma instância do 4notes por vez (evita dois processos escrevendo nos mesmos arquivos).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.kauan.fournotes')

    const config = loadConfig()
    nativeTheme.themeSource = config.theme
    setupApplicationMenu()

    if (!isDev) registerAppProtocol(path.join(__dirname, '..', '.output', 'public'))
    registerWorkspaceProtocol(() => getConfig().dataDir)
    registerIpc({ devServerUrl, isDev })
    await refreshDataDirStatus()

    openMainWindow()

    app.on('activate', () => {
      if (!mainWindow) openMainWindow()
    })
  })
}
