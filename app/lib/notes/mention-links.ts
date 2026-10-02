/**
 * Menções a outras notas dentro das Notas: no arquivo, cada menção é um link
 * Markdown comum para o .md da nota mencionada (relativo à pasta da nota), então
 * ela também funciona no Obsidian e no VS Code:
 *
 *   [Ideias de jogo](Ideias%20de%20jogo.md)     → nota rápida (notes/Ideias de jogo.md)
 *   [Godot](../mindmap/Principal/Godot.md)       → nota do mapa "Principal"
 */
import { nameKey } from '../files/filename'
import { relativeTo, resolveFromNote } from '../files/workspace-path'
import type { NoteChange } from '../note-events'
import { DATA_PATHS } from '../storage/paths'

export const escapeLinkText = (text: string) => text.replace(/[\\[\]]/g, '\\$&')
export const unescapeLinkText = (text: string) => text.replace(/\\([\\[\]])/g, '$1')

/** Markdown da menção à nota `target` (caminho no workspace) dentro de uma nota da pasta `noteDir`. */
export function mentionMarkdown(noteDir: string, target: string, title: string): string {
  return `[${escapeLinkText(title)}](${relativeTo(noteDir, target)})`
}

/** O endereço do link aponta para uma nota (.md) do workspace? Devolve o caminho dela. */
export function mentionTarget(noteDir: string, href: string): string | null {
  const raw = href.trim().replace(/^<|>$/g, '')
  return /\.md$/i.test(raw) ? resolveFromNote(noteDir, raw) : null
}

/** Links [texto](endereço) de uma linha (sem imagens). */
const LINK = /(?<!!)\[((?:\\.|[^\\\]\n])*)\]\((<[^>\n]*>|[^()\s]+)\)/g

/** Trechos de `código` de uma linha (links ali dentro não são menções). */
function codeSpans(line: string): [number, number][] {
  const spans: [number, number][] = []
  for (const match of line.matchAll(/(`+)[^`]*?\1/g)) spans.push([match.index!, match.index! + match[0].length])
  return spans
}

/** Novo caminho de `path` depois da mudança (null = a menção não é afetada). */
function retarget(path: string, change: NoteChange): string | null {
  const key = nameKey(path)
  if (change.type === 'note-renamed') return key === nameKey(change.from) ? change.to : null
  if (change.type === 'map-note-renamed') {
    const dir = `${DATA_PATHS.mindmapDir}/${change.map}`
    return key === nameKey(`${dir}/${change.from}`) ? `${dir}/${change.to}` : null
  }
  const prefix = `${DATA_PATHS.mindmapDir}/${change.from}/`
  return key.startsWith(nameKey(prefix)) ? `${DATA_PATHS.mindmapDir}/${change.to}/${path.slice(prefix.length)}` : null
}

/**
 * Atualiza as menções de `content` (nota da pasta `noteDir`) depois que uma nota
 * ou um mapa mudou de nome. `title` = novo título da nota renomeada (o texto do
 * link acompanha). Devolve null quando nada muda.
 */
export function renameMentionLinks(content: string, noteDir: string, change: NoteChange, title: string | null): string | null {
  let changed = false
  let fence: string | null = null
  const lines = content.split('\n').map((line) => {
    const fenceMark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (fenceMark && fenceMark[0] === fence[0] && fenceMark.length >= fence.length) fence = null
      return line
    }
    if (fenceMark) {
      fence = fenceMark
      return line
    }
    if (!line.includes('](')) return line
    const code = codeSpans(line)
    return line.replace(LINK, (whole: string, text: string, href: string, offset: number) => {
      if (code.some(([from, to]) => offset >= from && offset < to)) return whole
      const path = mentionTarget(noteDir, href)
      const target = path && retarget(path, change)
      if (!target) return whole
      changed = true
      return mentionMarkdown(noteDir, target, title ?? unescapeLinkText(text))
    })
  })
  return changed ? lines.join('\n') : null
}
