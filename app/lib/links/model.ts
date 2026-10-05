/**
 * Modelo de dados dos Links + regras puras (sem Vue, sem disco).
 *
 * Tudo fica em <workspace>/links/links.json:
 * {
 *   "app": "4notes", "version": 1,
 *   "folders": [{ "id": "dev", "name": "Dev", "color": "purple", "icon": "code", ... }],
 *   "links": [{ "id": "l_x1", "url": "https://nuxt.com", "title": "Nuxt", "folderId": "dev",
 *               "icon": "nuxt.com.png", ... }]
 * }
 * Os ícones dos sites ficam em links/icons/ (um arquivo por site, ex.: nuxt.com.png).
 */
import { isCategoryIcon } from '../category-icons'
import { isPaletteColor, PALETTE, type PaletteColor } from '../colors'
import { createId } from '../utils/async'

export interface LinkFolder {
  id: string
  name: string
  color: PaletteColor
  /** Ícone pronto (lib/category-icons.ts) ou null (a inicial do nome). */
  icon: string | null
  createdAt: string
}

export interface SavedLink {
  id: string
  url: string
  title: string
  /** Pasta do link (null = sem pasta). */
  folderId: string | null
  /** Arquivo do ícone do site em links/icons/ (null = ainda sem ícone). */
  icon: string | null
  createdAt: string
  updatedAt: string
}

export interface LinksData {
  folders: LinkFolder[]
  links: SavedLink[]
}

export type LinkSort = 'recent' | 'name'

export const MAX_FOLDER_NAME = 40

export function defaultLinksData(): LinksData {
  return { folders: [], links: [] }
}

// ── Endereços ────────────────────────────────────────────────────────────────

/**
 * Endereço digitado ou colado → endereço completo, ou null se não parece um link.
 *   "nuxt.com/docs" → "https://nuxt.com/docs"; "localhost:3000" → "http://localhost:3000"
 */
export function normalizeUrl(input: string): string | null {
  let text = input.trim().replace(/^<|>$/g, '')
  if (!text || /\s/.test(text)) return null
  if (/^\/\//.test(text)) text = `https:${text}`
  else if (!/^[a-z][a-z\d+.-]*:/i.test(text) || /^localhost:\d/i.test(text)) {
    const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(text)
    const domain = /^(?:[\p{L}\d-]+\.)+[\p{L}\d-]{2,}(?::\d+)?(?:[/?#]|$)/u.test(text) || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/.test(text)
    if (!local && !domain) return null
    text = `${local ? 'http' : 'https'}://${text}`
  }
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return url.href
  } catch {
    return null
  }
}

/** Chave para achar links repetidos (maiúsculas no domínio, "/" no fim e porta padrão não contam). */
export function urlKey(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}${parsed.hash}`
  } catch {
    return url.trim().toLowerCase()
  }
}

/** Domínio do link (para o ícone e para mostrar): "https://www.nuxt.com/x" → "www.nuxt.com". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Domínio para mostrar, sem "www." e com acentos ("xn--ao-siap.com.br" → "ação.com.br"). */
export function displayHost(url: string): string {
  return unicodeHost(hostOf(url)).replace(/^www\./, '')
}

/** Domínio com acentos: os trechos "xn--…" (punycode, RFC 3492) voltam a ser texto. */
export function unicodeHost(host: string): string {
  return host
    .split('.')
    .map((label) => {
      if (!/^xn--/i.test(label)) return label
      try {
        return decodePunycode(label.slice(4))
      } catch {
        return label
      }
    })
    .join('.')
}

function decodePunycode(input: string): string {
  const BASE = 36
  const T_MIN = 1
  const T_MAX = 26
  const adapt = (delta: number, points: number, first: boolean) => {
    delta = first ? Math.floor(delta / 700) : delta >> 1
    delta += Math.floor(delta / points)
    let k = 0
    for (; delta > ((BASE - T_MIN) * T_MAX) >> 1; k += BASE) delta = Math.floor(delta / (BASE - T_MIN))
    return Math.floor(k + ((BASE - T_MIN + 1) * delta) / (delta + 38))
  }
  const digit = (code: number) => {
    if (code >= 48 && code <= 57) return code - 22 // 0-9 → 26-35
    if (code >= 65 && code <= 90) return code - 65 // A-Z
    if (code >= 97 && code <= 122) return code - 97 // a-z
    throw new Error('punycode inválido')
  }
  const output: number[] = []
  const basic = input.lastIndexOf('-')
  for (let j = 0; j < basic; j++) output.push(input.charCodeAt(j))
  let n = 128
  let i = 0
  let bias = 72
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
    const previous = i
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) throw new Error('punycode inválido')
      const value = digit(input.charCodeAt(index++))
      i += value * w
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias
      if (value < t) break
      w *= BASE - t
    }
    const length = output.length + 1
    bias = adapt(i - previous, length, previous === 0)
    n += Math.floor(i / length)
    i %= length
    if (n > 0x10ffff) throw new Error('punycode inválido')
    output.splice(i++, 0, n)
  }
  return String.fromCodePoint(...output)
}

/** Título provisório (enquanto o título da página não chega): o domínio, ou o fim do caminho. */
export function placeholderTitle(url: string): string {
  return displayHost(url) || url
}

// ── Pastas ───────────────────────────────────────────────────────────────────

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim()

export function folderNameProblem(raw: string, others: string[]): string | null {
  const name = raw.trim()
  if (!name) return 'Dê um nome à pasta.'
  if (Array.from(name).length > MAX_FOLDER_NAME) return `Use um nome com até ${MAX_FOLDER_NAME} caracteres.`
  if (others.some((other) => fold(other) === fold(name))) return 'Já existe uma pasta com esse nome.'
  return null
}

/** Id legível e único para uma pasta nova ("Jogos e Godot" → "jogos-e-godot"). */
export function folderIdFor(name: string, taken: (id: string) => boolean): string {
  const base =
    fold(name)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'pasta'
  let id = base
  for (let n = 2; taken(id); n++) id = `${base}-${n}`
  return id
}

/** Cor para uma pasta nova: a primeira da paleta que ainda não está em uso. */
export function suggestFolderColor(used: PaletteColor[]): PaletteColor {
  return PALETTE.find((color) => !used.includes(color)) ?? PALETTE[used.length % PALETTE.length]!
}

// ── Busca e ordem ────────────────────────────────────────────────────────────

/** Texto onde a busca procura (guardado: a busca roda a cada tecla, em milhares de links). */
const haystacks = new Map<string, string>()
function haystackOf(link: SavedLink): string {
  const key = `${link.title}\u0000${link.url}`
  let haystack = haystacks.get(key)
  if (haystack === undefined) {
    if (haystacks.size > 50_000) haystacks.clear()
    haystack = `${fold(link.title)} ${fold(link.url)} ${fold(displayHost(link.url))}`
    haystacks.set(key, haystack)
  }
  return haystack
}

/** Links que combinam com a busca (título ou endereço, sem diferenciar acentos). */
export function searchLinks(links: SavedLink[], query: string): SavedLink[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return links
  return links.filter((link) => {
    const haystack = haystackOf(link)
    return words.every((word) => haystack.includes(word))
  })
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

export function sortLinks(links: SavedLink[], sort: LinkSort): SavedLink[] {
  const list = [...links]
  if (sort === 'name') return list.sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.url, b.url))
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

// ── Arquivo ──────────────────────────────────────────────────────────────────

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
const ICON_FILE = /^[^/\\]+\.(?:png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i

function normalizeFolder(raw: unknown): LinkFolder | null {
  if (!isObject(raw)) return null
  const name = str(raw.name).trim()
  const id = str(raw.id).trim()
  if (!name || !id) return null
  return {
    id,
    name: name.slice(0, MAX_FOLDER_NAME * 2),
    color: isPaletteColor(raw.color) ? raw.color : 'gray',
    icon: isCategoryIcon(raw.icon) ? raw.icon : null,
    createdAt: str(raw.createdAt, new Date().toISOString()),
  }
}

function normalizeLink(raw: unknown): SavedLink | null {
  if (!isObject(raw)) return null
  const url = normalizeUrl(str(raw.url))
  if (!url) return null
  const now = new Date().toISOString()
  const icon = str(raw.icon).trim()
  return {
    id: str(raw.id) || createId('l'),
    url,
    title: str(raw.title).trim() || placeholderTitle(url),
    folderId: typeof raw.folderId === 'string' && raw.folderId ? raw.folderId : null,
    icon: ICON_FILE.test(icon) ? icon : null,
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now),
  }
}

/** Lê o links.json de forma tolerante (arquivo editado à mão, campos faltando…). Lança erro se não for um objeto. */
export function normalizeLinksFile(raw: unknown): LinksData {
  if (!isObject(raw)) throw new Error('O arquivo links.json não contém um objeto JSON válido.')
  const folders: LinkFolder[] = []
  for (const item of Array.isArray(raw.folders) ? raw.folders : []) {
    const folder = normalizeFolder(item)
    if (folder && !folders.some((other) => other.id === folder.id)) folders.push(folder)
  }
  const ids = new Set(folders.map((folder) => folder.id))
  const seen = new Set<string>()
  const links: SavedLink[] = []
  for (const item of Array.isArray(raw.links) ? raw.links : []) {
    const link = normalizeLink(item)
    if (!link) continue
    if (link.folderId && !ids.has(link.folderId)) link.folderId = null
    if (seen.has(link.id)) link.id = createId('l')
    seen.add(link.id)
    links.push(link)
  }
  return { folders, links }
}

export function serializeLinks(data: LinksData): string {
  const file = {
    app: '4notes',
    version: 1,
    folders: data.folders.map(({ id, name, color, icon, createdAt }) => ({ id, name, color, icon, createdAt })),
    links: data.links.map(({ id, url, title, folderId, icon, createdAt, updatedAt }) => ({ id, url, title, folderId, icon, createdAt, updatedAt })),
  }
  return `${JSON.stringify(file, null, 2)}\n`
}
