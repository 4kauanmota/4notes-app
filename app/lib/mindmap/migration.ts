/**
 * Conversão do Mapa Mental da versão 1.0.0 (mindmap/*.md ligados por [[links]])
 * para o formato da 1.0.1 (uma pasta por mapa + mapa.json). Regras puras, sem disco.
 *
 *  - Todas as notas antigas vão para o mapa "Principal" (subpastas são achatadas;
 *    nomes repetidos ganham "(2)").
 *  - Cada [[link]] para uma nota existente vira uma conexão no mapa.json.
 *  - O texto fica sem a marcação: "Veja [[Godot]]" → "Veja Godot". Linhas que eram
 *    só links (como as criadas por "Nova nota conectada") saem do texto.
 *  - Links para notas que não existem viram texto comum (sem conexão).
 * Antes de converter, o repositório faz um backup das notas originais.
 */
import { basename, nameKey, stripExtension, uniqueName } from '../files/filename'
import { connectionKey, type Connection } from './model'
import { linkKey, parseWikiLinks, type WikiLink } from './wikilinks'

export interface LegacyNote {
  /** Caminho relativo à pasta mindmap/ (ex.: "Godot.md" ou "Jogos/Godot.md"). */
  id: string
  content: string
}

export interface MigratedNote {
  legacyId: string
  title: string
  content: string
}

export interface MigrationResult {
  notes: MigratedNote[]
  connections: Connection[]
}

/**
 * Resolve links como o Obsidian (e o 4notes 1.0.0): primeiro pelo caminho completo
 * ("Jogos/Godot"), depois só pelo nome ("Godot"). Em nomes repetidos, vence o caminho mais curto.
 */
export function createResolver(ids: string[]): (target: string) => string | null {
  const byPath = new Map<string, string>()
  const byName = new Map<string, string>()
  const sorted = [...ids].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
  for (const id of sorted) {
    const pathKey = linkKey(stripExtension(id))
    const name = linkKey(stripExtension(basename(id)))
    if (!byPath.has(pathKey)) byPath.set(pathKey, id)
    if (!byName.has(name)) byName.set(name, id)
  }
  return (target) => {
    const key = linkKey(target)
    return byPath.get(key) ?? byName.get(key) ?? null
  }
}

const LINK_ONLY_LINE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?[\s,;·|]*$/

const displayText = (link: WikiLink) => link.alias ?? basename(link.target)

/** Tira a marcação [[ ]] do texto, mantendo as palavras. */
function rewriteContent(content: string, links: WikiLink[], isResolved: (link: WikiLink) => boolean): string {
  if (!links.length) return content
  const out: string[] = []
  let offset = 0
  let dropped = false
  for (const line of content.split('\n')) {
    const start = offset
    offset += line.length + 1
    const inLine = links.filter((link) => link.from >= start && link.to <= start + line.length)
    const cut = (replacer: (link: WikiLink) => string) => {
      let text = line
      for (let i = inLine.length - 1; i >= 0; i--) {
        const link = inLine[i]!
        text = text.slice(0, link.from - start) + replacer(link) + text.slice(link.to - start)
      }
      return text
    }
    if (inLine.length && inLine.every(isResolved) && LINK_ONLY_LINE.test(cut(() => ''))) {
      dropped = true // a linha era só para ligar notas: agora isso é a conexão no mapa
      continue
    }
    out.push(cut(displayText))
  }
  let result = out.join('\n')
  if (dropped) {
    result = result.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
    if (result) result += '\n'
  }
  return result
}

/**
 * @param legacy notas no formato antigo
 * @param taken títulos que já existem no mapa de destino (para não sobrescrever)
 */
export function migrateLegacyNotes(legacy: LegacyNote[], taken: string[] = []): MigrationResult {
  const used = new Set(taken.map(nameKey))
  const titles = new Map<string, string>()
  // Notas da raiz primeiro: elas mantêm o nome; as de subpastas ganham "(2)" se repetirem.
  const ordered = [...legacy].sort((a, b) => a.id.split('/').length - b.id.split('/').length || a.id.localeCompare(b.id))
  for (const note of ordered) {
    const title = uniqueName(stripExtension(basename(note.id)), (candidate) => used.has(nameKey(candidate)))
    used.add(nameKey(title))
    titles.set(note.id, title)
  }

  const resolve = createResolver(legacy.map((note) => note.id))
  const connections: Connection[] = []
  const seen = new Set<string>()
  const notes = legacy.map((note): MigratedNote => {
    const source = titles.get(note.id)!
    const links = parseWikiLinks(note.content)
    for (const link of links) {
      const targetId = resolve(link.target)
      if (!targetId || targetId === note.id) continue
      const target = titles.get(targetId)!
      const key = connectionKey(source, target)
      if (seen.has(key)) continue
      seen.add(key)
      connections.push({ from: source, to: target })
    }
    const isResolved = (link: WikiLink) => !!resolve(link.target)
    return { legacyId: note.id, title: source, content: rewriteContent(note.content, links, isResolved) }
  })
  return { notes, connections }
}
