/**
 * Favoritos do navegador, para importar no módulo Links.
 *
 * Três formatos:
 *  - o arquivo "Bookmarks" (JSON) dos navegadores baseados no Chromium — Chrome,
 *    Edge, Brave, Opera, Opera GX, Vivaldi —, lido direto da pasta do navegador;
 *  - o banco places.sqlite do Firefox e dos navegadores feitos a partir dele (Zen):
 *    o processo principal lê as linhas e geckoBookmarksFromRows monta as pastas; se
 *    não der para ler o banco, vale a cópia automática mais recente
 *    (bookmarkbackups/*.jsonlz4, ver decodeMozLz4 e parseGeckoBackup);
 *  - o arquivo HTML de favoritos que qualquer navegador exporta:
 *    Favoritos → Exportar favoritos.
 *
 * Funções puras (sem Node e sem Vue): usadas pelo processo principal e pelos testes.
 */

export interface BookmarkLink {
  kind: 'link'
  title: string
  url: string
  /** Ícone embutido no arquivo HTML (data:image/…), se houver. */
  icon?: string
}

export interface BookmarkFolder {
  kind: 'folder'
  title: string
  children: BookmarkNode[]
  /** Pasta-raiz do navegador (barra de favoritos, outros favoritos…). */
  root?: boolean
}

export type BookmarkNode = BookmarkLink | BookmarkFolder

/** Um navegador (e perfil) encontrado neste computador. */
export interface BrowserSource {
  /** Identificador para pedir os favoritos (o caminho do arquivo fica no processo principal). */
  id: string
  browser: string
  /** Nome do perfil ("Pessoa 1", "Trabalho"), quando o navegador tem perfis. */
  profile: string | null
  /** Quantidade de links nos favoritos. */
  count: number
}

/** Só endereços que fazem sentido abrir no navegador. */
export function isImportableUrl(url: string): boolean {
  return /^(https?:\/\/|ftp:\/\/)/i.test(url.trim())
}

export function countLinks(nodes: BookmarkNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.kind === 'link' ? 1 : countLinks(node.children)), 0)
}

// ── Chromium (Chrome, Edge, Brave, Opera, Vivaldi) ───────────────────────────

const ROOT_NAMES: Record<string, string> = {
  bookmark_bar: 'Barra de favoritos',
  other: 'Outros favoritos',
  synced: 'Favoritos do celular',
  // Opera / Opera GX
  speedDial: 'Discagem rápida',
  userRoot: 'Favoritos',
  unsorted: 'Favoritos não organizados',
}
/** Raízes que não são favoritos de verdade (lixeira do Opera…). */
const SKIPPED_ROOTS = new Set(['trash', 'workspaces_v2'])

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

function chromiumNode(raw: unknown, depth: number): BookmarkNode | null {
  if (!isObject(raw) || depth > 40) return null
  const title = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (raw.type === 'url') {
    const url = typeof raw.url === 'string' ? raw.url.trim() : ''
    return isImportableUrl(url) ? { kind: 'link', title: title || url, url } : null
  }
  if (raw.type !== 'folder' || !Array.isArray(raw.children)) return null
  const children = raw.children.map((child) => chromiumNode(child, depth + 1)).filter((node): node is BookmarkNode => !!node)
  return { kind: 'folder', title: title || 'Pasta', children }
}

/** Lê o "Bookmarks" (JSON) de um navegador baseado no Chromium. */
export function parseChromiumBookmarks(raw: unknown): BookmarkFolder[] {
  if (!isObject(raw) || !isObject(raw.roots)) return []
  const roots: BookmarkFolder[] = []
  const visit = (key: string, value: unknown) => {
    if (SKIPPED_ROOTS.has(key) || !isObject(value)) return
    if (value.type === 'folder' || Array.isArray(value.children)) {
      const node = chromiumNode({ ...value, type: 'folder' }, 0)
      if (node?.kind === 'folder' && node.children.length) roots.push({ ...node, title: ROOT_NAMES[key] ?? node.title, root: true })
      return
    }
    // Opera: "custom_root" guarda outras raízes dentro dele
    for (const [innerKey, inner] of Object.entries(value)) visit(innerKey, inner)
  }
  for (const [key, value] of Object.entries(raw.roots)) visit(key, value)
  return roots
}

// ── Arquivo HTML de favoritos (formato "Netscape", exportado por todos) ─────

const decode = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .trim()

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match ? decode(match[2] ?? match[3] ?? match[4] ?? '') : null
}

/** Lê um arquivo HTML de favoritos (Chrome, Edge, Firefox, Safari… exportam nesse formato). */
export function parseBookmarksHtml(html: string): BookmarkFolder[] {
  const top: BookmarkFolder = { kind: 'folder', title: 'Favoritos', children: [] }
  const stack: BookmarkFolder[] = [top]
  let pending: BookmarkFolder | null = null
  const re = /<(h3|a)\b([^>]*)>([\s\S]*?)<\/\1>|<(\/?)dl\b[^>]*>/gi
  for (let match = re.exec(html); match; match = re.exec(html)) {
    const current = stack.at(-1)!
    if (match[4] !== undefined) {
      if (match[4] === '/') {
        if (stack.length > 1) stack.pop()
      } else if (pending) {
        stack.push(pending)
        pending = null
      }
      continue
    }
    const tag = match[1]!.toLowerCase()
    const title = decode(match[3]!.replace(/<[^>]+>/g, ''))
    if (tag === 'h3') {
      const folder: BookmarkFolder = { kind: 'folder', title: title || 'Pasta', children: [] }
      if (/PERSONAL_TOOLBAR_FOLDER\s*=\s*"?true/i.test(match[2]!)) folder.title = title || 'Barra de favoritos'
      current.children.push(folder)
      pending = folder
      continue
    }
    const url = attribute(match[2]!, 'href') ?? ''
    if (!isImportableUrl(url)) continue
    const icon = attribute(match[2]!, 'icon')
    current.children.push({ kind: 'link', title: title || url, url, ...(icon && /^data:image\//i.test(icon) ? { icon } : {}) })
  }
  // Pastas de primeiro nível viram as "raízes"; links soltos no topo ficam numa raiz própria
  const loose = top.children.filter((node): node is BookmarkLink => node.kind === 'link')
  const folders = top.children.filter((node): node is BookmarkFolder => node.kind === 'folder' && countLinks(node.children) > 0)
  const roots: BookmarkFolder[] = folders.map((folder) => ({ ...folder, root: true }))
  if (loose.length) roots.unshift({ kind: 'folder', title: 'Favoritos', children: loose, root: true })
  return roots
}

// ── Firefox e derivados (Zen) ───────────────────────────────────────────────

/** Um perfil listado no profiles.ini do Firefox/Zen. */
export interface GeckoProfile {
  name: string
  /** Pasta do perfil, como está no profiles.ini. */
  path: string
  /** `path` é relativo à pasta do profiles.ini. */
  relative: boolean
  /** Perfil padrão (o que o navegador abre). */
  isDefault: boolean
}

/** Lê o profiles.ini: os perfis, com o padrão primeiro. */
export function parseProfilesIni(text: string): GeckoProfile[] {
  const sections: { name: string; values: Record<string, string> }[] = []
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      sections.push({ name: header[1]!.trim(), values: {} })
      continue
    }
    const eq = line.indexOf('=')
    if (eq > 0 && sections.length) sections.at(-1)!.values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  // [Install…] Default=… é o perfil que o navegador instalado usa (versões novas)
  const installDefaults = new Set(sections.filter((section) => /^Install/i.test(section.name) && section.values.Default).map((section) => section.values.Default!))
  const profiles = sections
    .filter((section) => /^Profile\d*$/i.test(section.name) && section.values.Path)
    .map((section) => ({
      name: section.values.Name?.trim() || section.values.Path!,
      path: section.values.Path!,
      relative: section.values.IsRelative !== '0',
      isDefault: installDefaults.size ? installDefaults.has(section.values.Path!) : section.values.Default === '1',
    }))
  return profiles.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
}

/** Uma linha de moz_bookmarks (com o endereço de moz_places). type: 1 = favorito, 2 = pasta, 3 = separador. */
export interface PlacesRow {
  id: number
  parent: number
  type: number
  title: string | null
  url: string | null
  position: number
  guid: string
}

/** Pastas-raiz do Firefox (pelo guid), na ordem em que aparecem. A de marcadores (tags) fica de fora. */
const GECKO_ROOTS: [string, string, string][] = [
  ['toolbar_____', 'toolbarFolder', 'Barra de favoritos'],
  ['menu________', 'bookmarksMenuFolder', 'Menu de favoritos'],
  ['unfiled_____', 'unfiledBookmarksFolder', 'Outros favoritos'],
  ['mobile______', 'mobileFolder', 'Favoritos do celular'],
]

/** Monta as pastas a partir das linhas do places.sqlite. */
export function geckoBookmarksFromRows(rows: PlacesRow[]): BookmarkFolder[] {
  const children = new Map<number, PlacesRow[]>()
  for (const row of rows) {
    const list = children.get(row.parent)
    if (list) list.push(row)
    else children.set(row.parent, [row])
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position)
  const build = (row: PlacesRow, depth: number): BookmarkNode | null => {
    const title = (row.title ?? '').trim()
    if (row.type === 1) {
      const url = (row.url ?? '').trim()
      return isImportableUrl(url) ? { kind: 'link', title: title || url, url } : null
    }
    if (row.type !== 2 || depth > 40) return null
    const nodes = (children.get(row.id) ?? []).map((child) => build(child, depth + 1)).filter((node): node is BookmarkNode => !!node)
    return { kind: 'folder', title: title || 'Pasta', children: nodes }
  }
  const roots: BookmarkFolder[] = []
  for (const [guid, , label] of GECKO_ROOTS) {
    const row = rows.find((item) => item.guid === guid)
    const node = row ? build(row, 0) : null
    if (node?.kind === 'folder' && node.children.length) roots.push({ ...node, title: label, root: true })
  }
  return roots
}

function geckoBackupNode(raw: unknown, depth: number): BookmarkNode | null {
  if (!isObject(raw) || depth > 40) return null
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (raw.type === 'text/x-moz-place') {
    const url = typeof raw.uri === 'string' ? raw.uri.trim() : ''
    return isImportableUrl(url) ? { kind: 'link', title: title || url, url } : null
  }
  if (raw.type !== 'text/x-moz-place-container') return null
  const children = (Array.isArray(raw.children) ? raw.children : []).map((child) => geckoBackupNode(child, depth + 1)).filter((node): node is BookmarkNode => !!node)
  return { kind: 'folder', title: title || 'Pasta', children }
}

/** Lê a cópia automática dos favoritos do Firefox/Zen (o JSON de dentro do .jsonlz4). */
export function parseGeckoBackup(raw: unknown): BookmarkFolder[] {
  if (!isObject(raw) || !Array.isArray(raw.children)) return []
  const roots: BookmarkFolder[] = []
  for (const [guid, rootName, label] of GECKO_ROOTS) {
    const item = raw.children.find((child) => isObject(child) && (child.guid === guid || child.root === rootName))
    const node = geckoBackupNode(item, 0)
    if (node?.kind === 'folder' && node.children.length) roots.push({ ...node, title: label, root: true })
  }
  return roots
}

const MOZ_LZ4_MAGIC = 'mozLz40\0'
const MAX_DECODED = 256 * 1024 * 1024

/** Arquivo .jsonlz4 / .mozlz4 do Firefox ("mozLz40\0" + tamanho + um bloco LZ4) → os bytes de dentro. */
export function decodeMozLz4(data: Uint8Array): Uint8Array {
  for (let i = 0; i < MOZ_LZ4_MAGIC.length; i++) {
    if (data[i] !== MOZ_LZ4_MAGIC.charCodeAt(i)) throw new Error('Não é um arquivo mozLz4.')
  }
  if (data.length < 12) throw new Error('Arquivo mozLz4 incompleto.')
  const size = (data[8]! | (data[9]! << 8) | (data[10]! << 16) | (data[11]! << 24)) >>> 0
  if (size > MAX_DECODED) throw new Error('Arquivo mozLz4 grande demais.')
  return decodeLz4Block(data.subarray(12), size)
}

/** Descompacta um bloco LZ4 (formato "block", sem moldura). */
export function decodeLz4Block(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  const fail = () => {
    throw new Error('Bloco LZ4 inválido.')
  }
  let s = 0
  let d = 0
  const length = (initial: number) => {
    let total = initial
    if (initial !== 15) return total
    for (;;) {
      if (s >= src.length) fail()
      const byte = src[s++]!
      total += byte
      if (byte !== 255) return total
    }
  }
  while (s < src.length) {
    const token = src[s++]!
    const literals = length(token >> 4)
    if (s + literals > src.length || d + literals > size) fail()
    out.set(src.subarray(s, s + literals), d)
    s += literals
    d += literals
    if (s >= src.length) break // a última sequência só tem texto, sem cópia
    if (s + 2 > src.length) fail()
    const offset = src[s]! | (src[s + 1]! << 8)
    s += 2
    if (!offset || offset > d) fail()
    const match = length(token & 15) + 4
    if (d + match > size) fail()
    for (let i = 0; i < match; i++) out[d + i] = out[d - offset + i]!
    d += match
  }
  return d === size ? out : out.subarray(0, d)
}
