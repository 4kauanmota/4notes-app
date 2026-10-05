/**
 * Menções dentro das notas (Notas e Mapa Mental): no arquivo, cada menção é um
 * link Markdown comum, relativo à pasta da nota, então ela também funciona no
 * Obsidian e no VS Code:
 *
 *   [Ideias de jogo](Ideias%20de%20jogo.md)       → nota das Notas (notes/Ideias de jogo.md)
 *   [Godot](../mindmap/Principal/Godot.md)         → nota do mapa "Principal"
 *   [Estudar Godot](../tasks/tasks.json#t_k3j9x0)  → tarefa (o id fica depois do "#")
 *
 * Aqui também ficam as regras que reescrevem esses links quando algo muda de
 * lugar: nota ou mapa renomeado, categoria renomeada, nota movida de pasta.
 */
import { nameKey } from '../files/filename'
import { relativeTo, resolveLink } from '../files/workspace-path'
import type { NoteChange } from '../note-events'
import { DATA_PATHS } from '../storage/paths'

export const escapeLinkText = (text: string) => text.replace(/[\\[\]]/g, '\\$&')
export const unescapeLinkText = (text: string) => text.replace(/\\([\\[\]])/g, '$1')

/** Prefixo do "caminho" de uma tarefa mencionada: "tasks/tasks.json#<id>". */
const TASK_PREFIX = `${DATA_PATHS.tasksFile}#`

export type MentionKind = 'note' | 'map' | 'task'

/** Caminho que representa a tarefa `id` numa menção. */
export const taskMentionPath = (id: string) => `${TASK_PREFIX}${id}`

/** Id da tarefa de um caminho de menção (null se não é uma tarefa). */
export function taskIdOf(path: string): string | null {
  return path.startsWith(TASK_PREFIX) && path.length > TASK_PREFIX.length ? path.slice(TASK_PREFIX.length) : null
}

export function mentionKind(path: string): MentionKind {
  if (taskIdOf(path)) return 'task'
  return path.startsWith(`${DATA_PATHS.mindmapDir}/`) ? 'map' : 'note'
}

/** Markdown da menção a `target` (nota ou tarefa) dentro de uma nota da pasta `noteDir`. */
export function mentionMarkdown(noteDir: string, target: string, title: string): string {
  return `[${escapeLinkText(title)}](${relativeTo(noteDir, target)})`
}

/**
 * O endereço do link aponta para uma nota (.md) ou para uma tarefa do workspace?
 * Devolve o caminho da menção ("notes/Ideias.md", "tasks/tasks.json#t_x1") ou null.
 */
export function mentionTarget(noteDir: string, href: string): string | null {
  const link = resolveLink(noteDir, href)
  if (!link) return null
  if (/\.md$/i.test(link.path)) return link.path
  if (nameKey(link.path) === nameKey(DATA_PATHS.tasksFile) && link.fragment) return taskMentionPath(link.fragment)
  return null
}

// ── Percorrer os links de um texto ──────────────────────────────────────────

/** Links [texto](endereço) e imagens ![texto](endereço) de uma linha. */
const LINK = /(!?)\[((?:\\.|[^\\\]\n])*)\]\((<[^>\n]*>|[^()\s]+)\)/g

/** Trechos de `código` de uma linha (links ali dentro não contam). */
function codeSpans(line: string): [number, number][] {
  const spans: [number, number][] = []
  for (const match of line.matchAll(/(`+)[^`]*?\1/g)) spans.push([match.index!, match.index! + match[0].length])
  return spans
}

interface FoundLink {
  image: boolean
  /** Texto do link, ainda com os escapes do Markdown. */
  text: string
  href: string
}

/**
 * Passa por todos os links (fora de blocos e trechos de código) e troca os que
 * `replace` devolver. Devolve null quando nada muda.
 */
function mapLinks(content: string, replace: (link: FoundLink) => string | null): string | null {
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
    return line.replace(LINK, (whole: string, bang: string, text: string, href: string, offset: number) => {
      if (code.some(([from, to]) => offset >= from && offset < to)) return whole
      const next = replace({ image: bang === '!', text, href })
      if (next === null || next === whole) return whole
      changed = true
      return next
    })
  })
  return changed ? lines.join('\n') : null
}

// ── Renomeações ──────────────────────────────────────────────────────────────

/** Novo caminho de `path` depois da mudança (null = a menção não é afetada). */
function retarget(path: string, change: NoteChange): string | null {
  const key = nameKey(path)
  if (change.type === 'note-renamed') return key === nameKey(change.from) ? change.to : null
  if (change.type === 'map-note-renamed') {
    const dir = `${DATA_PATHS.mindmapDir}/${change.map}`
    return key === nameKey(`${dir}/${change.from}`) ? `${dir}/${change.to}` : null
  }
  const prefix = change.type === 'map-renamed' ? `${DATA_PATHS.mindmapDir}/${change.from}/` : `${change.from}/`
  const to = change.type === 'map-renamed' ? `${DATA_PATHS.mindmapDir}/${change.to}/` : `${change.to}/`
  return key.startsWith(nameKey(prefix)) ? `${to}${path.slice(prefix.length)}` : null
}

/**
 * Atualiza as menções de `content` (nota da pasta `noteDir`) depois que uma nota,
 * um mapa ou uma categoria mudou de nome. `title` = novo título da nota renomeada
 * (o texto do link acompanha). Devolve null quando nada muda.
 */
export function renameMentionLinks(content: string, noteDir: string, change: NoteChange, title: string | null): string | null {
  return mapLinks(content, (link) => {
    if (link.image) return null
    const path = mentionTarget(noteDir, link.href)
    const target = path && !taskIdOf(path) && retarget(path, change)
    if (!target) return null
    const renamedNote = change.type === 'note-renamed' || change.type === 'map-note-renamed'
    return mentionMarkdown(noteDir, target, renamedNote && title ? title : unescapeLinkText(link.text))
  })
}

/** O texto das menções a tarefas acompanha o título atual delas (`titles`: id → título). */
export function retitleTaskLinks(content: string, noteDir: string, titles: ReadonlyMap<string, string>): string | null {
  return mapLinks(content, (link) => {
    if (link.image) return null
    const path = mentionTarget(noteDir, link.href)
    const id = path && taskIdOf(path)
    const title = id ? titles.get(id) : undefined
    if (!title || unescapeLinkText(link.text) === title) return null
    return `[${escapeLinkText(title)}](${link.href})`
  })
}

/**
 * A nota mudou de pasta (ex.: "notes" → "notes/Trabalho"): refaz os caminhos
 * relativos dos links e das imagens dela para continuarem apontando para os
 * mesmos arquivos. Endereços externos ficam como estão.
 */
export function rebaseLinks(content: string, fromDir: string, toDir: string): string | null {
  if (nameKey(fromDir) === nameKey(toDir)) return null
  return mapLinks(content, (link) => {
    const target = resolveLink(fromDir, link.href)
    if (!target) return null
    const full = target.fragment === null ? target.path : `${target.path}#${target.fragment}`
    const href = relativeTo(toDir, full)
    return `${link.image ? '!' : ''}[${link.text}](${href})`
  })
}
