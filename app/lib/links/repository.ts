/**
 * Persistência dos Links: <workspace>/links/links.json + ícones dos sites em
 * links/icons/ + cópia de segurança automática (uma por dia da semana) em .4notes/backups/.
 */
import type { BookmarkFolder, BrowserSource, LinkMeta } from '#shared/ipc'
import { joinPath } from '../files/filename'
import { desktop } from '../platform'
import { readJsonFile } from '../storage/json-file'
import { DATA_PATHS } from '../storage/paths'
import { defaultLinksData, normalizeLinksFile, serializeLinks, type LinkSort, type LinksData } from './model'

export type LinksLoadResult = { status: 'ok'; data: LinksData; raw: string | null } | { status: 'invalid'; error: string }

/** Ordem da lista, a partir da seção "links" do settings.json (tolerante). */
export function normalizeLinksSort(section: unknown): LinkSort {
  const sort = section && typeof section === 'object' ? (section as { sort?: unknown }).sort : undefined
  return sort === 'name' || sort === 'url' ? sort : 'recent'
}

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

export const linksRepository = {
  file: DATA_PATHS.linksFile,

  /** Lê o links.json (que só é criado quando o primeiro link é salvo). */
  async load(): Promise<LinksLoadResult> {
    const result = await readJsonFile(DATA_PATHS.linksFile)
    if (result.status === 'missing') return { status: 'ok', data: defaultLinksData(), raw: null }
    if (result.status === 'invalid') return { status: 'invalid', error: `JSON inválido: ${result.error}` }
    try {
      return { status: 'ok', data: normalizeLinksFile(result.data), raw: result.raw }
    } catch (error) {
      return { status: 'invalid', error: error instanceof Error ? error.message : String(error) }
    }
  },

  readRaw: () => desktop().files.read(DATA_PATHS.linksFile),
  save: (raw: string) => desktop().files.write(DATA_PATHS.linksFile, raw),
  serialize: serializeLinks,

  /** Guarda uma cópia por dia da semana (links-segunda.json…): 7 dias de histórico. */
  async backup(raw: string, now = new Date()): Promise<void> {
    const name = `links-${WEEKDAY_NAMES[now.getDay()]}.json`
    const existing = await desktop().files.list(DATA_PATHS.backupsDir)
    const current = existing.find((entry) => entry.name === name)
    if (current && new Date(current.mtimeMs).toDateString() === now.toDateString()) return
    await desktop().files.write(joinPath(DATA_PATHS.backupsDir, name), raw)
  },

  /** Caminho de um ícone no workspace (para o protocolo workspace://). */
  iconPath: (file: string) => joinPath(DATA_PATHS.linkIconsDir, file),
  /** Ícones que já existem em links/icons/. */
  async listIcons(): Promise<string[]> {
    return (await desktop().files.list(DATA_PATHS.linkIconsDir)).map((entry) => entry.name)
  },

  fetchMeta: (url: string, withIcon = true): Promise<LinkMeta> => desktop().links.fetchMeta(url, withIcon),
  saveIcon: (host: string, dataUrl: string) => desktop().links.saveIcon(host, dataUrl),
  browsers: (): Promise<BrowserSource[]> => desktop().links.browsers(),
  readBrowser: (id: string): Promise<BookmarkFolder[]> => desktop().links.readBrowser(id),
  pickBookmarksFile: (): Promise<BookmarkFolder[] | null> => desktop().links.pickBookmarksFile(),

  /** Caminho da imagem dentro da biblioteca (attachments/): copia para lá se ela estiver em outro lugar. */
  libraryImage: (path: string): Promise<string> => desktop().library.adopt(path),

  reveal: () => desktop().files.reveal(DATA_PATHS.linksFile),
  openExternal: (url: string) => desktop().shell.openExternal(url),
}
