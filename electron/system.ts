/**
 * Iniciar o 4notes junto com o computador (Windows e macOS, no app instalado).
 *
 * Usa o recurso do próprio sistema (no Windows, a lista de programas que abrem ao
 * entrar na conta — a mesma do Gerenciador de Tarefas › Inicializar). Nos testes
 * automatizados (FOURNOTES_TEST=1) só simula, sem mexer no sistema.
 */
import { app } from 'electron'
import type { LaunchAtLogin } from '../shared/ipc'

const testMode = process.env.FOURNOTES_TEST === '1'
let simulated = false

function unsupported(): LaunchAtLogin['reason'] | null {
  if (testMode) return null
  if (process.platform !== 'win32' && process.platform !== 'darwin') return 'platform'
  if (!app.isPackaged) return 'dev' // em desenvolvimento abriria o Electron "puro", não o 4notes
  return null
}

export function launchAtLogin(): LaunchAtLogin {
  const reason = unsupported()
  if (reason) return { supported: false, enabled: false, reason }
  if (testMode) return { supported: true, enabled: simulated }
  const settings = app.getLoginItemSettings()
  // Windows: desligado no Gerenciador de Tarefas conta como desligado (ligar aqui religa lá também)
  return { supported: true, enabled: process.platform === 'win32' ? settings.executableWillLaunchAtLogin : settings.openAtLogin }
}

export function setLaunchAtLogin(enabled: unknown): LaunchAtLogin {
  if (typeof enabled !== 'boolean') return launchAtLogin()
  if (unsupported()) return launchAtLogin()
  if (testMode) simulated = enabled
  else app.setLoginItemSettings({ openAtLogin: enabled })
  return launchAtLogin()
}
