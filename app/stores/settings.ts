/**
 * Configurações do workspace — .4notes/settings.json.
 *
 * As mesmas no computador e no celular: ficam na pasta do workspace, então quem
 * sincroniza a pasta (Google Drive…) leva as configurações junto. Cada parte do app
 * guarda a sua seção:
 *
 *   {
 *     "version": 1,
 *     "theme": "system",
 *     "modules": { "disabled": [], "order": ["notes", …], "navStyle": "icon-label" },
 *     "notes": { "autoCategory": false, "folderCase": "typed" },
 *     "mindmap": { "settingsVersion": 2, "showOrphans": true, "nodeStyle": "card", "labels": "selected" },
 *     "links": { "sort": "recent" },
 *     "timer": { "sound": true, "notify": true, "weekStart": 1, "countdown": 25, "pomodoro": { … } }
 *   }
 *
 * O que é de cada aparelho (abas abertas, último módulo, mapa aberto…) fica no
 * aparelho (lib/storage/device-state.ts). Chaves desconhecidas (de outra versão do
 * 4notes) continuam no arquivo.
 *
 * Mudou no outro aparelho? Ao voltar para o app, o arquivo é relido (refreshSettings)
 * e cada módulo aplica a sua seção (onSettingsChange).
 */
import { reactive } from 'vue'
import type { ThemePreference } from '#shared/ipc'
import { showToast } from '~/composables/useToasts'
import { joinPath } from '~/lib/files/filename'
import { desktop, hasDesktopApi } from '~/lib/platform'
import { readJsonFile, toJson } from '~/lib/storage/json-file'
import { DATA_PATHS } from '~/lib/storage/paths'
import { migrateLegacySettings } from '~/lib/storage/settings-migration'
import { debounce, SerialQueue } from '~/lib/utils/async'

export type SettingsSection = 'theme' | 'modules' | 'notes' | 'mindmap' | 'links' | 'timer'
export const SETTINGS_SECTIONS: readonly SettingsSection[] = ['theme', 'modules', 'notes', 'mindmap', 'links', 'timer']
export const SETTINGS_VERSION = 1

type Json = Record<string, unknown>
type Listener = (changed: ReadonlySet<SettingsSection>) => void

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)

const state = reactive({ loaded: false })

let data: Json = {}
/** Último settings.json lido ou gravado (para perceber mudanças feitas em outro aparelho). */
let lastRaw: string | null = null
const queue = new SerialQueue()
const listeners = new Set<Listener>()

function serialize(): string {
  const { version: _version, ...rest } = data
  return toJson({ version: SETTINGS_VERSION, ...rest })
}

async function write(): Promise<void> {
  const raw = serialize()
  if (raw === lastRaw) return
  await desktop().files.write(DATA_PATHS.settingsFile, raw)
  lastRaw = raw
}

function persist(): Promise<void> {
  return queue.run('settings', write).catch((error) => console.warn('[4notes] Falha ao salvar as configurações:', error))
}

const scheduleSave = debounce(() => void persist(), 250)

/** O tema guardado neste aparelho (usado para criar o settings.json de um workspace sem ele). */
function deviceTheme(): ThemePreference {
  return hasDesktopApi() ? (desktop().bootstrap?.settings?.theme ?? 'system') : 'system'
}

async function backupBroken(raw: string): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = joinPath(DATA_PATHS.backupsDir, `settings-${stamp}.json`)
  return desktop()
    .files.write(path, raw)
    .then(() => path)
    .catch(() => null)
}

/** Lê o settings.json (criando-o a partir dos arquivos antigos, se ainda não existir). */
export async function loadSettings(): Promise<void> {
  const result = await readJsonFile(DATA_PATHS.settingsFile)
  if (result.status === 'ok' && isObject(result.data)) {
    data = result.data
    lastRaw = result.raw
  } else if (result.status === 'missing') {
    const migration = await migrateLegacySettings(deviceTheme())
    data = migration.settings
    try {
      await queue.run('settings', write)
      await migration.retire()
    } catch (error) {
      console.warn('[4notes] Não foi possível criar o settings.json:', error)
    }
  } else {
    // Editado à mão com erro (ou não é um objeto): guarda uma cópia e volta ao padrão
    const backup = await backupBroken(result.raw)
    data = { theme: deviceTheme() }
    lastRaw = result.raw
    showToast({
      message: `O settings.json estava com erro; as configurações voltaram ao padrão${backup ? ` (cópia em ${backup})` : ''}.`,
      icon: 'alert',
      tone: 'error',
      duration: 9000,
    })
    void persist()
  }
  state.loaded = true
}

/** Relê o settings.json (mudanças feitas em outro aparelho) e avisa os módulos. */
export async function refreshSettings(): Promise<void> {
  if (!state.loaded || scheduleSave.pending() || queue.busy) return
  const result = await readJsonFile(DATA_PATHS.settingsFile).catch(() => null)
  if (!result) return
  if (result.status === 'missing') {
    // Apagado fora do app: grava de novo o que está valendo
    lastRaw = null
    void persist()
    return
  }
  if (result.status !== 'ok' || result.raw === lastRaw || !isObject(result.data)) return
  const before = data
  data = result.data
  lastRaw = result.raw
  const changed = new Set(SETTINGS_SECTIONS.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(data[key])))
  if (changed.size) for (const listener of listeners) listener(changed)
}

/** A seção de uma parte do app (cada módulo valida a sua). */
export function settingsSection(key: SettingsSection): unknown {
  return data[key]
}

/** Troca a seção e grava (sem workspace aberto, não faz nada). */
export function updateSettingsSection(key: SettingsSection, value: unknown): void {
  if (!state.loaded) return
  if (JSON.stringify(data[key]) === JSON.stringify(value)) return
  data = { ...data, [key]: value }
  scheduleSave()
}

/** Avisa quando seções mudaram por fora (outro aparelho). Devolve a função para parar. */
export function onSettingsChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function flushSettings(): Promise<void> {
  scheduleSave.flush()
  await queue.idle()
}

export function useSettingsStore() {
  return { state, load: loadSettings, refresh: refreshSettings, section: settingsSection, update: updateSettingsSection, onChange: onSettingsChange, flush: flushSettings }
}
