/**
 * Leitura de links no estilo Obsidian, usados pelo 4notes 1.0.0 para conectar notas:
 *
 *   [[Godot]]                 → link para a nota "Godot"
 *   [[Godot|motor de jogos]]  → mesmo link, exibindo outro texto
 *   [[Godot#Sinais]]          → link para uma seção da nota
 *   ![[Godot]]                → "embed" (também conta como conexão)
 *
 * A partir da 1.0.1 as conexões ficam no mapa.json; este leitor só é usado para
 * converter as notas antigas (ver migration.ts).
 * Links dentro de blocos de código (``` … ``` ou `…`) são ignorados.
 */

export interface WikiLink {
  /** Nome da nota de destino, sem ".md" (ex.: "Godot" ou "Jogos/Godot"). */
  target: string
  heading: string | null
  alias: string | null
  embed: boolean
  /** Posição no texto. */
  from: number
  to: number
}

const WIKILINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g

/** Troca blocos de código por espaços, preservando as posições do texto. */
function maskCode(content: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ')
  return content
    .replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2[^\n]*|$)/g, (match) => blank(match))
    .replace(/`[^`\n]+`/g, (match) => blank(match))
}

export function normalizeTarget(target: string): string {
  return target
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Chave para comparar alvos ignorando maiúsculas/minúsculas. */
export function linkKey(target: string): string {
  return normalizeTarget(target).normalize('NFC').toLocaleLowerCase('pt-BR')
}

export function parseWikiLinks(content: string): WikiLink[] {
  const masked = maskCode(content)
  const links: WikiLink[] = []
  for (const match of masked.matchAll(WIKILINK_RE)) {
    const inner = match[2]!
    const pipe = inner.indexOf('|')
    const beforeAlias = pipe >= 0 ? inner.slice(0, pipe) : inner
    const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() || null : null
    const hash = beforeAlias.indexOf('#')
    const target = normalizeTarget(hash >= 0 ? beforeAlias.slice(0, hash) : beforeAlias)
    if (!target) continue // [[#Seção]] aponta para a própria nota
    links.push({
      target,
      heading: hash >= 0 ? beforeAlias.slice(hash + 1).trim() || null : null,
      alias,
      embed: match[1] === '!',
      from: match.index!,
      to: match.index! + match[0].length,
    })
  }
  return links
}
