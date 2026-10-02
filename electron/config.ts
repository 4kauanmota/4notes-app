/**
 * Configuração do aplicativo (NÃO são os seus dados).
 *
 * Fica em um arquivo JSON na pasta de configuração do sistema:
 *   Windows: %APPDATA%\4notes\config.json
 *   macOS:   ~/Library/Application Support/4notes/config.json
 *   Linux:   ~/.config/4notes/config.json
 *
 * Guarda apenas preferências desta máquina: qual é a pasta de dados escolhida,
 * o tema e o tamanho/posição da janela. Suas notas e tarefas ficam na pasta de dados.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ThemePreference } from '../shared/ipc'

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export interface AppConfig {
  version: 1
  dataDir: string | null
  theme: ThemePreference
  zoomFactor: number
  window: WindowState
}

const DEFAULTS: AppConfig = {
  version: 1,
  dataDir: null,
  theme: 'system',
  zoomFactor: 1,
  window: { width: 1280, height: 820, maximized: false },
}

let current: AppConfig = structuredClone(DEFAULTS)

function configFile(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

function isTheme(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function normalize(raw: unknown): AppConfig {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppConfig>
  const win = (data.window && typeof data.window === 'object' ? data.window : {}) as Partial<WindowState>
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  return {
    version: 1,
    dataDir: typeof data.dataDir === 'string' && data.dataDir.trim() ? data.dataDir : null,
    theme: isTheme(data.theme) ? data.theme : DEFAULTS.theme,
    zoomFactor: Math.min(2, Math.max(0.5, num(data.zoomFactor, 1))),
    window: {
      x: typeof win.x === 'number' ? win.x : undefined,
      y: typeof win.y === 'number' ? win.y : undefined,
      width: Math.max(760, num(win.width, DEFAULTS.window.width)),
      height: Math.max(520, num(win.height, DEFAULTS.window.height)),
      maximized: win.maximized === true,
    },
  }
}

export function loadConfig(): AppConfig {
  try {
    current = normalize(JSON.parse(fs.readFileSync(configFile(), 'utf8')))
  } catch {
    current = structuredClone(DEFAULTS)
  }
  return current
}

export function getConfig(): AppConfig {
  return current
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  current = normalize({ ...current, ...patch })
  const file = configFile()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // Escrita atômica: grava num arquivo temporário e depois renomeia.
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  } catch (error) {
    console.error('[4notes] Não foi possível salvar a configuração:', error)
  }
  return current
}
