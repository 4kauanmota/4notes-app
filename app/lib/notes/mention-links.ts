/**
 * Menções dentro das notas (Notas e Mapa Mental): no arquivo, cada menção é um
 * link Markdown comum, relativo à pasta da nota, então ela também funciona no
 * Obsidian e no VS Code:
 *
 *   [Ideias de jogo](Ideias%20de%20jogo.md)          → nota das Notas (notes/Ideias de jogo.md)
 *   [Godot](../mindmap/Principal/Godot.md)            → nota do mapa "Principal"
 *   [Principal](../mindmap/Principal/mapa.json)       → o mapa "Principal" inteiro
 *   [Estudar Godot](../tasks/tasks.json#t_k3j9x0)     → tarefa (o id fica depois do "#")
 *   [Estudando Godot](../timer/timer.json#s_k3j9x0)   → registro do histórico do Timer
 *   [Feira](../finance/finance.json#e_k3j9x0)         → gasto das Finanças (1.7.0)
 *   [Nuxt](https://nuxt.com)                          → link salvo (um link comum)
 *
 * Tarefas, registros do Timer e links salvos são achados pelo id (que não muda);
 * notas e mapas, pelo caminho — e as regras daqui reescrevem esses links quando
 * algo muda de lugar: nota ou mapa renomeado, categoria renomeada, nota movida de
 * pasta, endereço de um link salvo trocado.
 *
 * Dentro do app, cada coisa mencionável tem um "caminho de menção" (o mesmo das
 * notas; "tasks/tasks.json#<id>", "timer/timer.json#<id>", "links/links.json#<id>").
 */
import { nameKey } from '../files/filename'
import { relativeTo, resolveLink } from '../files/workspace-path'
import { MAP_FILE } from '../mindmap/model'
import type { NoteChange } from '../note-events'
import { DATA_PATHS } from '../storage/paths'

export const escapeLinkText = (text: string) => text.replace(/[\\[\]]/g, '\\$&')
export const unescapeLinkText = (text: string) => text.replace(/\\([\\[\]])/g, '$1')

/** Itens achados pelo id: o arquivo onde ficam (o id vai depois do "#"). */
const ID_FILES = { task: DATA_PATHS.tasksFile, timer: DATA_PATHS.timerFile, link: DATA_PATHS.linksFile, expense: DATA_PATHS.financeFile } as const
export type IdKind = keyof typeof ID_FILES

/**
 * O que uma menção pode ser: nota das Notas, nota de um mapa ("map"), um mapa mental
 * inteiro ("mindmap"), tarefa, registro do Timer, link salvo ou gasto das Finanças.
 */
export type MentionKind = 'note' | 'map' | 'mindmap' | IdKind

/** Caminho de menção de um item achado pelo id ("tasks/tasks.json#t_x1"). */
export const idMentionPath = (kind: IdKind, id: string) => `${ID_FILES[kind]}#${id}`

/** Tipo e id de um caminho de menção de tarefa, registro do Timer ou link (null se não é). */
export function idOf(path: string): { kind: IdKind; id: string } | null {
  for (const kind of Object.keys(ID_FILES) as IdKind[]) {
    const prefix = `${ID_FILES[kind]}#`
    if (path.startsWith(prefix) && path.length > prefix.length) return { kind, id: path.slice(prefix.length) }
  }
  return null
}

/** Caminho que representa a tarefa `id` numa menção. */
export const taskMentionPath = (id: string) => idMentionPath('task', id)

/** Id da tarefa de um caminho de menção (null se não é uma tarefa). */
export function taskIdOf(path: string): string | null {
  const found = idOf(path)
  return found?.kind === 'task' ? found.id : null
}

/** Caminho de menção de um mapa mental inteiro: "mindmap/Principal/mapa.json". */
export const mapMentionPath = (map: string) => `${DATA_PATHS.mindmapDir}/${map}/${MAP_FILE}`

/** Nome do mapa de um caminho "mindmap/<mapa>/mapa.json" (null se não é um mapa). */
export function mapOfMentionPath(path: string): string | null {
  const parts = path.split('/')
  return parts.length === 3 && parts[0] === DATA_PATHS.mindmapDir && parts[1] && nameKey(parts[2]!) === MAP_FILE ? parts[1] : null
}

export function mentionKind(path: string): MentionKind {
  const found = idOf(path)
  if (found) return found.kind
  if (mapOfMentionPath(path)) return 'mindmap'
  return path.startsWith(`${DATA_PATHS.mindmapDir}/`) ? 'map' : 'note'
}

/** Markdown da menção a `target` (caminho de menção) dentro de uma nota da pasta `noteDir`. */
export function mentionMarkdown(noteDir: string, target: string, title: string): string {
  return `[${escapeLinkText(title)}](${relativeTo(noteDir, target)})`
}

/**
 * O endereço do link aponta para algo do workspace que pode ser mencionado? Devolve o
 * caminho da menção ("notes/Ideias.md", "mindmap/Principal/mapa.json",
 * "tasks/tasks.json#t_x1", "timer/timer.json#s_x1", "finance/finance.json#e_x1") ou null. Links salvos são links
 * comuns (endereço do site) e não passam por aqui.
 */
export function mentionTarget(noteDir: string, href: string): string | null {
  const link = resolveLink(noteDir, href)
  if (!link) return null
  if (/\.md$/i.test(link.path)) return link.path
  if (link.fragment) {
    if (nameKey(link.path) === nameKey(ID_FILES.task)) return idMentionPath('task', link.fragment)
    if (nameKey(link.path) === nameKey(ID_FILES.timer)) return idMentionPath('timer', link.fragment)
    if (nameKey(link.path) === nameKey(ID_FILES.expense)) return idMentionPath('expense', link.fragment)
    return null
  }
  const map = mapOfMentionPath(link.path)
  return map ? mapMentionPath(map) : null
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
    const target = path && !idOf(path) && retarget(path, change)
    if (!target) return null
    const renamedNote = change.type === 'note-renamed' || change.type === 'map-note-renamed'
    // Menção ao mapa inteiro: o texto acompanha o nome novo do mapa
    const renamedMap = change.type === 'map-renamed' && mentionKind(target) === 'mindmap'
    const text = renamedNote && title ? title : renamedMap ? change.to : unescapeLinkText(link.text)
    return mentionMarkdown(noteDir, target, text)
  })
}

/**
 * O texto das menções achadas pelo id (tarefas, registros do Timer) acompanha o título
 * atual delas (`titles`: caminho de menção → título).
 */
export function retitleIdLinks(content: string, noteDir: string, titles: ReadonlyMap<string, string>): string | null {
  return mapLinks(content, (link) => {
    if (link.image) return null
    const path = mentionTarget(noteDir, link.href)
    const title = path && idOf(path) ? titles.get(path) : undefined
    if (!title || unescapeLinkText(link.text) === title) return null
    return `[${escapeLinkText(title)}](${link.href})`
  })
}

/** Endereço de um link como está no arquivo: sem os < > e com ( ) < > voltando ao normal. */
export function hrefUrl(href: string): string {
  return href
    .replace(/^<|>$/g, '')
    .trim()
    .replace(/%28/gi, '(')
    .replace(/%29/gi, ')')
    .replace(/%3C/gi, '<')
    .replace(/%3E/gi, '>')
}

/**
 * Um link salvo mudou de endereço: os links para o endereço antigo (`matches`) passam a
 * apontar para o novo (`href`, já pronto para o Markdown). O texto fica como está.
 */
export function relinkUrl(content: string, matches: (url: string) => boolean, href: string): string | null {
  return mapLinks(content, (link) => {
    if (link.image || !matches(hrefUrl(link.href))) return null
    return `[${link.text}](${href})`
  })
}

/** Os links de um texto (fora dos blocos de código): o caminho de menção (ou null) e o endereço. */
export function linksIn(content: string, noteDir: string): { path: string | null; url: string }[] {
  const found: { path: string | null; url: string }[] = []
  mapLinks(content, (link) => {
    if (!link.image) found.push({ path: mentionTarget(noteDir, link.href), url: hrefUrl(link.href) })
    return null
  })
  return found
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

/** O texto das menções a tarefas acompanha o título atual delas (`titles`: id → título). */
export function retitleTaskLinks(content: string, noteDir: string, titles: ReadonlyMap<string, string>): string | null {
  return retitleIdLinks(content, noteDir, new Map([...titles].map(([id, title]) => [taskMentionPath(id), title])))
}
