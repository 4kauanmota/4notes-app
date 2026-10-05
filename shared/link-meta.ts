/**
 * Título e ícone de uma página web, lidos do HTML dela (só o <head> interessa).
 * Funções puras (sem Node e sem Vue): usadas pelo processo principal ao salvar um
 * link e testadas em tests/links.test.ts.
 */

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
