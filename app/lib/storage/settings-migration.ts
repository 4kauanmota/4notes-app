/**
 * Passagem para o settings.json (4notes 1.5.0).
 *
 * Até a 1.4.3, as configurações ficavam misturadas com o estado da tela em
 * .4notes/notes.json, mindmap.json, links.json e app.json, e o tema ficava no
 * computador (fora do workspace). A partir da 1.5.0:
 *  - as configurações ficam em .4notes/settings.json — as mesmas em todos os
 *    aparelhos que abrirem a pasta (computador e celular);
 *  - o estado da tela (abas abertas, último módulo, mapa aberto…) fica em cada
 *    aparelho (lib/storage/device-state.ts);
 *  - as posições dos nós do mapa mental continuam em .4notes/mindmap.json.
 *
 * Os arquivos antigos vão para .4notes/backups/1.5.0/ (nada é apagado).
 */
import type { ThemePreference } from '#shared/ipc'
import { joinPath } from '../files/filename'
import { desktop } from '../platform'
import { readDeviceState, writeDeviceState } from './device-state'
import { readJsonFile } from './json-file'
import { DATA_PATHS } from './paths'

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)

async function readObject(path: string): Promise<{ exists: boolean; data: Json }> {
  const result = await readJsonFile(path).catch(() => ({ status: 'missing' }) as const)
  if (result.status === 'missing') return { exists: false, data: {} }
  return { exists: true, data: result.status === 'ok' && isObject(result.data) ? result.data : {} }
}

function pick(data: Json, keys: string[]): Json {
  return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]))
}

/** Guarda o estado da tela neste aparelho — só se ele ainda não tiver um. */
function seed(name: string, value: Json): void {
  if (Object.keys(value).length && !readDeviceState(name)) writeDeviceState(name, value)
}

export interface SettingsMigration {
  settings: Json
  /** Depois de gravar o settings.json: move os arquivos antigos para os backups. */
  retire(): Promise<void>
}

/** Monta o settings.json a partir dos arquivos da 1.4.3 (ou do zero, num workspace novo). */
export async function migrateLegacySettings(theme: ThemePreference): Promise<SettingsMigration> {
  const [notes, mindmap, links, app] = await Promise.all([
    readObject(DATA_PATHS.notesUiState),
    readObject(DATA_PATHS.mindmapUiState),
    readObject(DATA_PATHS.linksUiState),
    readObject(DATA_PATHS.appUiState),
  ])

  const settings: Json = { theme }
  if (isObject(app.data.modules)) settings.modules = app.data.modules
  if (isObject(notes.data.settings)) settings.notes = notes.data.settings
  if (isObject(mindmap.data.settings)) settings.mindmap = { settingsVersion: mindmap.data.settingsVersion, ...mindmap.data.settings }
  if (typeof links.data.sort === 'string') settings.links = { sort: links.data.sort }

  seed('notes', pick(notes.data, ['openTabs', 'activeTab', 'sidebarOpen', 'collapsedCategories', 'openFolders']))
  seed('app', pick(app.data, ['lastModule']))
  seed('mindmap', pick(mindmap.data, ['currentMap']))

  // O mindmap.json continua (com as posições); os outros saem de .4notes/
  const retired = [
    { path: DATA_PATHS.notesUiState, exists: notes.exists },
    { path: DATA_PATHS.linksUiState, exists: links.exists },
    { path: DATA_PATHS.appUiState, exists: app.exists },
  ].filter((file) => file.exists)

  return {
    settings,
    async retire() {
      const files = desktop().files
      const dir = joinPath(DATA_PATHS.backupsDir, '1.5.0')
      for (const { path } of retired) {
        const name = path.split('/').pop()!
        let target = joinPath(dir, name)
        for (let attempt = 2; (await files.exists(target).catch(() => false)) && attempt < 100; attempt++) {
          target = joinPath(dir, name.replace(/\.json$/, `-${attempt}.json`))
        }
        await files.rename(path, target).catch((error) => console.warn(`[4notes] Não foi possível mover ${path} para os backups:`, error))
      }
    },
  }
}
