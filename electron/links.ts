/**
 * Links (processo principal): buscar o título e o ícone de um site, e ler os
 * favoritos dos navegadores instalados (para importar): os baseados no Chromium
 * (arquivo Bookmarks) e o Firefox e o Zen (banco places.sqlite).
 *
 * - O ícone de cada site é guardado no workspace, em links/icons/<site>.<ext>:
 *   aparece mesmo sem internet e vai junto no backup.
 * - A interface nunca recebe acesso livre à rede nem ao disco: ela pede "o título e
 *   o ícone deste endereço" ou "os favoritos do navegador X" (da lista que este
 *   arquivo mesmo encontrou).
 */
import { app, dialog, net, type BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  countLinks,
  decodeMozLz4,
  geckoBookmarksFromRows,
  parseBookmarksHtml,
  parseChromiumBookmarks,
  parseGeckoBackup,
  parseProfilesIni,
  type BookmarkFolder,
  type BrowserSource,
  type PlacesRow,
} from '../shared/bookmarks'
import { decodeDataUrl } from '../shared/files'
import type { LinkMeta } from '../shared/ipc'
import { fetchLinkMetaWith, iconFileBase, sniffImage, validLinkUrl, type Fetched, type IconFormat } from '../shared/link-meta'
import { AppError, resolveInside } from './files'

export const LINK_ICONS_DIR = 'links/icons'

const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome ?? '140.0.0.0'} Safari/537.36`

/** Busca um endereço (com limite de tempo e de tamanho). */
async function fetchLimited(url: string, accept: string, limit: number, timeout: number): Promise<Fetched | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' },
    })
    if (!response.ok || !response.body) return null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (total < limit) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      total += value.byteLength
    }
    void reader.cancel().catch(() => undefined)
    const body = new Uint8Array(Math.min(total, limit))
    let offset = 0
    for (const chunk of chunks) {
      const part = chunk.subarray(0, Math.min(chunk.byteLength, body.byteLength - offset))
      body.set(part, offset)
      offset += part.byteLength
      if (offset >= body.byteLength) break
    }
    return { url: response.url || url, contentType: (response.headers.get('content-type') ?? '').toLowerCase(), body }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Grava o ícone do site em links/icons/ (troca o anterior, mesmo com outra extensão). */
export async function writeIcon(root: string, host: string, data: Uint8Array, format: IconFormat): Promise<string> {
  const base = iconFileBase(host)
  const dir = resolveInside(root, LINK_ICONS_DIR)
  await fs.mkdir(dir, { recursive: true })
  const name = `${base}.${format}`
  const tmp = path.join(dir, `.${name}.${process.pid}.tmp`)
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, path.join(dir, name))
  for (const entry of await fs.readdir(dir).catch(() => [] as string[])) {
    if (entry !== name && entry.toLowerCase().startsWith(`${base}.`) && /^[a-z]+$/.test(entry.slice(base.length + 1))) {
      await fs.rm(path.join(dir, entry), { force: true }).catch(() => undefined)
    }
  }
  return name
}

/**
 * Título e ícone de um endereço. O ícone é gravado em links/icons/ (se `withIcon`).
 * Sem internet (ou site fora do ar), devolve o que conseguiu — nunca lança erro por isso.
 * As regras ficam em shared/link-meta.ts (as mesmas no app Android).
 */
export async function fetchLinkMeta(root: string, rawUrl: unknown, withIcon: unknown): Promise<LinkMeta> {
  const url = validLinkUrl(rawUrl)
  if (!url) throw new AppError('EINVAL', 'Endereço inválido.')
  return fetchLinkMetaWith({ fetch: fetchLimited, writeIcon: (host, data, format) => writeIcon(root, host, data, format) }, url, withIcon !== false)
}

/** Ícone embutido num arquivo de favoritos (data:image/…): grava como o ícone do site. */
export async function saveDataIcon(root: string, host: unknown, dataUrl: unknown): Promise<string | null> {
  if (typeof host !== 'string' || !host.trim() || typeof dataUrl !== 'string' || dataUrl.length > 2_000_000) return null
  const data = decodeDataUrl(dataUrl)
  const format = data ? sniffImage(data) : null
  return data && format ? writeIcon(root, host, data, format) : null
}

// ── Favoritos dos navegadores ────────────────────────────────────────────────

interface BrowserDir {
  name: string
  /** Pasta "User Data" (com perfis) ou a pasta do perfil único (Opera). */
  dir: string
  profiles: boolean
}

function browserDirs(): BrowserDir[] {
  const home = app.getPath('home')
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    return [
      { name: 'Brave', dir: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'), profiles: true },
      { name: 'Opera GX', dir: path.join(roaming, 'Opera Software', 'Opera GX Stable'), profiles: false },
      { name: 'Opera', dir: path.join(roaming, 'Opera Software', 'Opera Stable'), profiles: false },
      { name: 'Google Chrome', dir: path.join(local, 'Google', 'Chrome', 'User Data'), profiles: true },
      { name: 'Microsoft Edge', dir: path.join(local, 'Microsoft', 'Edge', 'User Data'), profiles: true },
      { name: 'Vivaldi', dir: path.join(local, 'Vivaldi', 'User Data'), profiles: true },
      { name: 'Chromium', dir: path.join(local, 'Chromium', 'User Data'), profiles: true },
    ]
  }
  if (process.platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support')
    return [
      { name: 'Brave', dir: path.join(support, 'BraveSoftware', 'Brave-Browser'), profiles: true },
      { name: 'Opera GX', dir: path.join(support, 'com.operasoftware.OperaGX'), profiles: false },
      { name: 'Opera', dir: path.join(support, 'com.operasoftware.Opera'), profiles: false },
      { name: 'Google Chrome', dir: path.join(support, 'Google', 'Chrome'), profiles: true },
      { name: 'Microsoft Edge', dir: path.join(support, 'Microsoft Edge'), profiles: true },
      { name: 'Vivaldi', dir: path.join(support, 'Vivaldi'), profiles: true },
    ]
  }
  const config = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config')
  return [
    { name: 'Brave', dir: path.join(config, 'BraveSoftware', 'Brave-Browser'), profiles: true },
    { name: 'Opera', dir: path.join(config, 'opera'), profiles: false },
    { name: 'Google Chrome', dir: path.join(config, 'google-chrome'), profiles: true },
    { name: 'Microsoft Edge', dir: path.join(config, 'microsoft-edge'), profiles: true },
    { name: 'Vivaldi', dir: path.join(config, 'vivaldi'), profiles: true },
    { name: 'Chromium', dir: path.join(config, 'chromium'), profiles: true },
  ]
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Perfis de um navegador com perfis: [pasta, nome]. */
async function profilesOf(dir: string): Promise<[string, string | null][]> {
  const state = await readJson(path.join(dir, 'Local State'))
  const cache = isObject(state) && isObject(state.profile) && isObject(state.profile.info_cache) ? state.profile.info_cache : null
  if (cache) {
    return Object.entries(cache).map(([folder, info]) => [folder, isObject(info) && typeof info.name === 'string' && info.name.trim() ? info.name.trim() : folder])
  }
  const entries = await fs.readdir(dir).catch(() => [] as string[])
  return entries.filter((name) => name === 'Default' || /^Profile \d+$/.test(name)).map((name) => [name, null])
}

// ── Firefox e Zen (o Zen é feito a partir do Firefox: mesmo formato) ─────────

interface GeckoBrowser {
  name: string
  /** Pastas onde pode estar o profiles.ini (a primeira que existir vale). */
  dirs: string[]
}

function geckoBrowsers(): GeckoBrowser[] {
  const home = app.getPath('home')
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    return [
      { name: 'Firefox', dirs: [path.join(roaming, 'Mozilla', 'Firefox')] },
      { name: 'Zen', dirs: [path.join(roaming, 'zen')] },
    ]
  }
  if (process.platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support')
    return [
      { name: 'Firefox', dirs: [path.join(support, 'Firefox')] },
      { name: 'Zen', dirs: [path.join(support, 'zen')] },
    ]
  }
  const config = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config')
  return [
    {
      name: 'Firefox',
      dirs: [
        path.join(config, 'mozilla', 'firefox'),
        path.join(home, '.mozilla', 'firefox'),
        path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'),
        path.join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'),
      ],
    },
    { name: 'Zen', dirs: [path.join(config, 'zen'), path.join(home, '.zen'), path.join(home, '.var', 'app', 'app.zen_browser.zen', '.zen')] },
  ]
}

/** Perfis (pasta e nome) de um navegador da família do Firefox. */
async function geckoProfiles(browser: GeckoBrowser): Promise<{ dir: string; name: string }[]> {
  for (const base of browser.dirs) {
    const ini = await fs.readFile(path.join(base, 'profiles.ini'), 'utf8').catch(() => null)
    if (ini === null) continue
    return parseProfilesIni(ini).map((profile) => ({
      dir: profile.relative ? path.join(base, ...profile.path.split(/[\\/]/)) : profile.path,
      name: profile.name,
    }))
  }
  return []
}

/** Lê os favoritos do places.sqlite (de uma cópia: o navegador aberto trava o arquivo). */
async function readPlaces(profileDir: string): Promise<BookmarkFolder[] | null> {
  const source = path.join(profileDir, 'places.sqlite')
  if (!(await fs.stat(source).catch(() => null))?.isFile()) return null
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), '4notes-places-'))
  try {
    const copy = path.join(tmp, 'places.sqlite')
    await fs.copyFile(source, copy)
    // Mudanças recentes podem estar só no -wal (ainda não gravadas no banco)
    await fs.copyFile(`${source}-wal`, `${copy}-wal`).catch(() => undefined)
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(copy)
    try {
      const rows = db
        .prepare(
          'SELECT b.id AS id, b.parent AS parent, b.type AS type, b.title AS title, b.position AS position, b.guid AS guid, p.url AS url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk',
        )
        .all() as unknown as PlacesRow[]
      return geckoBookmarksFromRows(rows)
    } finally {
      db.close()
    }
  } catch (error) {
    console.warn('[4notes] Não foi possível ler o places.sqlite:', error)
    return null
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Plano B: a cópia automática mais recente (bookmarkbackups/*.jsonlz4). */
async function readBookmarkBackup(profileDir: string): Promise<BookmarkFolder[] | null> {
  const dir = path.join(profileDir, 'bookmarkbackups')
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => /\.(?:json|jsonlz4|mozlz4)$/i.test(name))
  const dated = await Promise.all(names.map(async (name) => ({ name, mtime: (await fs.stat(path.join(dir, name)).catch(() => null))?.mtimeMs ?? 0 })))
  for (const { name } of dated.sort((a, b) => b.mtime - a.mtime)) {
    try {
      const data = new Uint8Array(await fs.readFile(path.join(dir, name)))
      const text = new TextDecoder().decode(/\.json$/i.test(name) ? data : decodeMozLz4(data))
      const roots = parseGeckoBackup(JSON.parse(text))
      if (countLinks(roots)) return roots
    } catch (error) {
      console.warn('[4notes] Cópia de favoritos ilegível:', name, error)
    }
  }
  return null
}

async function readGeckoProfile(profileDir: string): Promise<BookmarkFolder[] | null> {
  const places = await readPlaces(profileDir)
  return places && countLinks(places) ? places : readBookmarkBackup(profileDir)
}

// ── Navegadores encontrados ──────────────────────────────────────────────────

type SourceLocation = { kind: 'chromium'; file: string } | { kind: 'gecko'; dir: string }

/** Favoritos encontrados na última busca (a interface só conhece os ids). */
const sourceFiles = new Map<string, SourceLocation>()

/** Navegadores (e perfis) com favoritos neste computador. */
export async function findBrowserSources(): Promise<BrowserSource[]> {
  sourceFiles.clear()
  const sources: BrowserSource[] = []
  const add = (location: SourceLocation, browser: string, profile: string | null, count: number) => {
    const id = `b${sourceFiles.size + 1}`
    sourceFiles.set(id, location)
    sources.push({ id, browser, profile, count })
  }
  for (const browser of browserDirs()) {
    const candidates: [string, string | null][] = browser.profiles
      ? (await profilesOf(browser.dir)).map(([folder, name]) => [path.join(browser.dir, folder, 'Bookmarks'), name])
      : [
          [path.join(browser.dir, 'Bookmarks'), null],
          [path.join(browser.dir, 'Default', 'Bookmarks'), null],
        ]
    for (const [file, profile] of candidates) {
      const roots = parseChromiumBookmarks(await readJson(file))
      const count = countLinks(roots)
      if (!count) continue
      add({ kind: 'chromium', file }, browser.name, profile, count)
      if (!browser.profiles) break // Opera: um arquivo só
    }
  }
  for (const browser of geckoBrowsers()) {
    const found: { dir: string; name: string; count: number }[] = []
    for (const profile of await geckoProfiles(browser)) {
      const count = countLinks((await readGeckoProfile(profile.dir)) ?? [])
      if (count) found.push({ ...profile, count })
    }
    // Com um perfil só, o nome dele ("default-release") não ajuda em nada
    for (const profile of found) add({ kind: 'gecko', dir: profile.dir }, browser.name, found.length > 1 ? profile.name : null, profile.count)
  }
  return sources
}

/** Favoritos de um dos navegadores encontrados por findBrowserSources. */
export async function readBrowserBookmarks(id: unknown): Promise<BookmarkFolder[]> {
  const location = typeof id === 'string' ? sourceFiles.get(id) : undefined
  if (!location) throw new AppError('ENOENT', 'Navegador não encontrado. Abra a importação de novo.')
  if (location.kind === 'gecko') {
    const roots = await readGeckoProfile(location.dir)
    if (!roots) throw new AppError('EIO', 'Não foi possível ler os favoritos desse navegador.')
    return roots
  }
  const raw = await readJson(location.file)
  if (raw === null) throw new AppError('EIO', 'Não foi possível ler os favoritos desse navegador.')
  return parseChromiumBookmarks(raw)
}

/** Escolhe um arquivo HTML de favoritos (exportado por qualquer navegador) e o lê. null = cancelado. */
export async function pickBookmarksFile(win: BrowserWindow | null): Promise<BookmarkFolder[] | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Arquivo de favoritos exportado pelo navegador',
    buttonLabel: 'Importar',
    properties: ['openFile'],
    filters: [{ name: 'Favoritos (HTML)', extensions: ['html', 'htm'] }],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const file = result.canceled ? undefined : result.filePaths[0]
  if (!file) return null
  const stat = await fs.stat(file)
  if (stat.size > 50 * 1024 * 1024) throw new AppError('EFBIG', 'O arquivo é grande demais (máximo de 50 MB).')
  const roots = parseBookmarksHtml(await fs.readFile(file, 'utf8'))
  if (!countLinks(roots)) throw new AppError('EINVAL', 'Nenhum link encontrado nesse arquivo. Escolha o arquivo HTML exportado pelo navegador.')
  return roots
}
