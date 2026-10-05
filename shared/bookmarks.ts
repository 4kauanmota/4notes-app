/**
 * Favoritos do navegador, para importar no módulo Links.
 *
 * Dois formatos:
 *  - o arquivo "Bookmarks" (JSON) dos navegadores baseados no Chromium — Chrome,
 *    Edge, Brave, Opera, Opera GX, Vivaldi —, lido direto da pasta do navegador;
 *  - o arquivo HTML de favoritos que qualquer navegador exporta (inclusive o Firefox):
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
