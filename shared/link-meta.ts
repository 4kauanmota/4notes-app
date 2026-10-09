/**
 * Título e ícone de uma página web, lidos do HTML dela (só o <head> interessa).
 * Sem Node e sem Vue: usadas pelo processo principal (electron/links.ts) e pelo app
 * Android (app/lib/mobile) ao salvar um link — cada um só diz como buscar um endereço
 * e onde gravar o ícone (LinkMetaIo). Testadas em tests/links-module.test.ts.
 */
import { decodeDataUrl } from './files'
import type { LinkMeta } from './ipc'

export interface IconCandidate {
  href: string
  rel: string
  sizes: string | null
  type: string | null
}

export interface PageHead {
  title: string | null
  icons: IconCandidate[]
  base: string | null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** Decodifica as entidades HTML mais comuns (&amp; &#233; &#x1F600;…). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match
    }
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

/** Atributos de uma tag: <link rel="icon" href="/a.png"> → { rel: 'icon', href: '/a.png' }. */
export function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const re = /([\w:-]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g
  const body = tag.replace(/^<\s*[\w-]+/, '').replace(/\/?>$/, '')
  for (let match = re.exec(body); match; match = re.exec(body)) {
    const value = match[2] ?? ''
    attributes[match[1]!.toLowerCase()] = decodeEntities(value.replace(/^["']|["']$/g, ''))
  }
  return attributes
}

/** Texto limpo para um título (espaços juntados, sem quebras). */
export function cleanTitle(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** Lê título, ícones e <base href> do começo de um HTML. */
export function parseHead(html: string): PageHead {
  // O que interessa fica no <head>; corta antes do <body> (páginas enormes)
  const end = html.search(/<body[\s>]/i)
  const head = end > 0 ? html.slice(0, end) : html.slice(0, 400_000)
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)
  let title = titleMatch ? cleanTitle(titleMatch[1]!) : ''
  const icons: IconCandidate[] = []
  let base: string | null = null
  for (const match of head.matchAll(/<(link|meta|base)\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0])
    const tag = match[1]!.toLowerCase()
    if (tag === 'base' && attributes.href && base === null) base = attributes.href
    if (tag === 'meta' && !title) {
      const key = (attributes.property ?? attributes.name ?? '').toLowerCase()
      if ((key === 'og:title' || key === 'twitter:title') && attributes.content) title = cleanTitle(attributes.content)
    }
    if (tag === 'link' && attributes.href) {
      const rel = (attributes.rel ?? '').toLowerCase()
      const words = rel.split(/\s+/)
      // "mask-icon" é um desenho de uma cor só (Safari): não serve como favicon
      if (words.includes('mask-icon') || !words.some((word) => word === 'icon' || word.startsWith('apple-touch-icon'))) continue
      icons.push({ href: attributes.href.trim(), rel, sizes: attributes.sizes?.trim() || null, type: attributes.type?.trim().toLowerCase() || null })
    }
  }
  return { title: title || null, icons, base }
}

/** Maior lado declarado em "sizes" ("16x16 32x32" → 32; "any" → Infinity). */
function declaredSize(sizes: string | null): number | null {
  if (!sizes) return null
  if (/\bany\b/i.test(sizes)) return Infinity
  const values = [...sizes.matchAll(/(\d+)\s*x\s*(\d+)/gi)].map((match) => Math.max(Number(match[1]), Number(match[2])))
  return values.length ? Math.max(...values) : null
}

/** Nota de um ícone: quanto maior, melhor para mostrar pequeno (20–32 px) e nítido. */
function iconScore(icon: IconCandidate): number {
  const isSvg = icon.type === 'image/svg+xml' || /\.svg(?:[?#]|$)/i.test(icon.href)
  if (isSvg) return 100
  const size = declaredSize(icon.sizes)
  if (size === Infinity) return 95
  if (icon.rel.includes('apple-touch-icon')) return size && size < 120 ? 70 : 80
  if (size === null) return 50 // sem tamanho declarado: em geral 16 ou 32
  if (size >= 32 && size <= 256) return 90 - Math.abs(64 - size) / 10
  if (size > 256) return 60
  return 40 + size / 4 // 16x16
}

/** Endereços dos ícones em ordem de preferência (o /favicon.ico do site por último). */
export function iconUrls(head: PageHead, pageUrl: string): string[] {
  let base: URL
  try {
    base = new URL(head.base ?? pageUrl, pageUrl)
  } catch {
    return []
  }
  const ranked = [...head.icons].sort((a, b) => iconScore(b) - iconScore(a))
  const urls: string[] = []
  for (const icon of ranked) {
    try {
      const url = icon.href.startsWith('data:') ? icon.href : new URL(icon.href, base).href
      if (!urls.includes(url) && /^(https?:|data:image\/)/i.test(url)) urls.push(url)
    } catch {
      // endereço inválido: ignora
    }
  }
  try {
    const fallback = new URL('/favicon.ico', pageUrl).href
    if (!urls.includes(fallback)) urls.push(fallback)
  } catch {
    // sem fallback
  }
  return urls.slice(0, 6)
}

/** Charset declarado no HTML (<meta charset> ou http-equiv), se houver. */
export function declaredCharset(html: string): string | null {
  const direct = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(html)
  return direct ? direct[1]!.toLowerCase() : null
}

export type IconFormat = 'png' | 'jpg' | 'gif' | 'ico' | 'svg' | 'webp' | 'bmp' | 'avif'

/** Formato de imagem pelos primeiros bytes (null = não é uma imagem conhecida). */
export function sniffImage(bytes: Uint8Array, contentType = ''): IconFormat | null {
  const at = (i: number) => bytes[i] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'gif'
  if (at(0) === 0x00 && at(1) === 0x00 && (at(2) === 0x01 || at(2) === 0x02) && at(3) === 0x00) return 'ico'
  if (at(0) === 0x42 && at(1) === 0x4d) return 'bmp'
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'webp'
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70 && /avif/i.test(String.fromCharCode(...bytes.slice(8, 12)))) return 'avif'
  const start = new TextDecoder().decode(bytes.slice(0, 600)).trimStart().toLowerCase()
  if ((start.startsWith('<svg') || (start.startsWith('<?xml') && start.includes('<svg')) || contentType.includes('svg')) && start.includes('<svg')) return 'svg'
  return null
}

/** Nome do arquivo do ícone de um site: "www.nuxt.com" → "www.nuxt.com" (só caracteres seguros). */
export function iconFileBase(host: string): string {
  return (
    host
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/[^a-z0-9.-]+/g, '_')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 100) || 'site'
  )
}

// ── Buscar o título e o ícone ───────────────────────────────────────────────

export const PAGE_LIMIT = 768 * 1024
export const ICON_LIMIT = 1024 * 1024

/** Resposta de um endereço (corpo cortado no limite pedido). */
export interface Fetched {
  url: string
  contentType: string
  body: Uint8Array
}

/** O que a busca precisa da plataforma. */
export interface LinkMetaIo {
  /** Busca um endereço (com limite de tempo e de tamanho); null = falhou. */
  fetch(url: string, accept: string, limit: number, timeout: number): Promise<Fetched | null>
  /** Grava o ícone do site em links/icons/ e devolve o nome do arquivo. */
  writeIcon(host: string, data: Uint8Array, format: IconFormat): Promise<string>
}

/** Texto da página no charset certo (cabeçalho HTTP, <meta charset> ou UTF-8). */
export function decodePage(page: Fetched): string {
  const fromHeader = /charset=([\w-]+)/i.exec(page.contentType)?.[1]
  const sample = new TextDecoder('latin1').decode(page.body.subarray(0, 4096))
  const charset = fromHeader ?? declaredCharset(sample) ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(page.body)
  } catch {
    return new TextDecoder('utf-8').decode(page.body)
  }
}

/** Baixa o primeiro ícone que for mesmo uma imagem. */
export async function downloadIcon(io: LinkMetaIo, urls: string[]): Promise<{ data: Uint8Array; format: IconFormat } | null> {
  for (const url of urls) {
    if (url.startsWith('data:')) {
      const data = decodeDataUrl(url)
      const format = data && data.byteLength <= ICON_LIMIT ? sniffImage(data) : null
      if (data && format) return { data, format }
      continue
    }
    const icon = await io.fetch(url, 'image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8', ICON_LIMIT + 1, 6000)
    if (!icon || !icon.body.byteLength || icon.body.byteLength > ICON_LIMIT) continue
    const format = sniffImage(icon.body, icon.contentType)
    if (format) return { data: icon.body, format }
  }
  return null
}

/**
 * Título e ícone de um endereço http(s) já validado. O ícone é gravado (se `withIcon`).
 * Sem internet (ou site fora do ar), devolve o que conseguiu — nunca lança erro por isso.
 */
export async function fetchLinkMetaWith(io: LinkMetaIo, url: string, withIcon: boolean): Promise<LinkMeta> {
  const host = new URL(url).hostname
  const page = await io.fetch(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', PAGE_LIMIT, 9000)
  let title: string | null = null
  let candidates: string[] = []
  if (page && /html|xml/.test(page.contentType || 'text/html')) {
    const head = parseHead(decodePage(page))
    title = head.title
    candidates = iconUrls(head, page.url)
  } else {
    candidates = iconUrls({ title: null, icons: [], base: null }, page?.url ?? url)
  }
  let icon: string | null = null
  if (withIcon) {
    const found = await downloadIcon(io, candidates)
    if (found) icon = await io.writeIcon(host, found.data, found.format).catch(() => null)
  }
  return { title, icon, reachable: !!page }
}

/** Endereço aceito para buscar título e ícone (null = inválido). */
export function validLinkUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string' || !/^https?:\/\//i.test(rawUrl.trim()) || rawUrl.length > 4096) return null
  try {
    new URL(rawUrl.trim())
    return rawUrl.trim()
  } catch {
    return null
  }
}
