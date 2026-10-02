/**
 * Marcação do começo da linha no Markdown: título (#), citação (>), item de lista
 * (-, 1.) e item de tarefa (- [ ]). Usado pela prévia (markdown-preview.ts) e
 * pela edição de listas (lists.ts).
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Line } from '@codemirror/state'

export type LineMarkerKind = 'heading' | 'quote' | 'bullet' | 'ordered' | 'task'

export interface LineMarker {
  kind: LineMarkerKind
  /** Início da linha. */
  from: number
  /** Onde o texto começa (depois da marcação e do espaço que vem depois dela). */
  to: number
  /** Início do marcador principal (o "#" do título ou o "-"/"1." da lista). */
  markFrom: number
  /** Nível de aninhamento da lista (0 = primeiro nível). */
  level: number
  /** Indentação (espaços/tabs) antes do marcador da lista, a partir de `indentFrom`. */
  indent: number
  indentFrom: number
  /** Tarefa: posição do "[" e se está marcada. */
  taskFrom?: number
  checked?: boolean
  /** Lista numerada: o número ("1."). */
  label?: string
}

const MARK_NODES = new Set(['HeaderMark', 'QuoteMark', 'ListMark', 'TaskMarker'])

/**
 * Marcação no começo da linha, se houver. Só conta marcação seguida de espaço
 * (digitar "-" ou "#" sozinho ainda não vira lista/título na tela).
 */
export function lineMarkerAt(state: EditorState, line: Line): LineMarker | null {
  const marks: { name: string; from: number; to: number; level: number }[] = []
  syntaxTree(state).iterate({
    from: line.from,
    to: Math.min(line.to, line.from + 60),
    enter: (node) => {
      if (!MARK_NODES.has(node.name) || node.from < line.from || node.to > line.to) return
      let level = 0
      if (node.name === 'ListMark') {
        for (let parent = node.node.parent?.parent; parent; parent = parent.parent) if (parent.name === 'ListItem') level++
      }
      marks.push({ name: node.name, from: node.from, to: node.to, level })
    },
  })
  marks.sort((a, b) => a.from - b.from)

  const text = line.text
  let pos = line.from
  let result: Omit<LineMarker, 'to'> | null = null
  for (const mark of marks) {
    // Só marcações no começo da linha (antes delas, só espaços ou outras marcações)
    const before = text.slice(pos - line.from, mark.from - line.from)
    if (before.trim()) break
    const space = /^[ \t]+/.exec(text.slice(mark.to - line.from))?.[0]
    if (!space) break
    const base: Omit<LineMarker, 'to'> = result ?? { kind: 'quote', from: line.from, markFrom: line.from, level: 0, indent: 0, indentFrom: line.from }
    if (mark.name === 'HeaderMark') {
      result = { ...base, kind: 'heading', markFrom: mark.from }
    } else if (mark.name === 'QuoteMark') {
      result = { ...base, kind: base.kind }
    } else if (mark.name === 'ListMark') {
      const ordered = /\d/.test(text.charAt(mark.from - line.from))
      result = {
        ...base,
        kind: ordered ? 'ordered' : 'bullet',
        markFrom: mark.from,
        level: mark.level,
        indent: before.length,
        indentFrom: pos,
        label: ordered ? text.slice(mark.from - line.from, mark.to - line.from) : undefined,
      }
    } else if (result !== null && (base.kind === 'bullet' || base.kind === 'ordered')) {
      result = { ...base, kind: 'task', taskFrom: mark.from, checked: /x/i.test(text.charAt(mark.from - line.from + 1)) }
    } else {
      break
    }
    pos = mark.to + space.length
  }
  return result ? { ...result, to: pos } : null
}
