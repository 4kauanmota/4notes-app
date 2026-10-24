/**
 * Trechos com marcação no texto: negrito, itálico, sublinhado, tachado,
 * marca-texto, código, cor e links. O arquivo continua sendo Markdown comum:
 *
 *   **negrito**   *itálico*   ~~tachado~~   ==marca-texto==   `código`   [texto](endereço)
 *   <u>sublinhado</u>   <span style="color: red">colorido</span>
 *   <mark style="background-color: #fef08a">marca-texto colorido</mark>   (1.7.1)
 *
 * No editor, as marcações desses trechos ficam sempre escondidas (ver
 * formatting.ts e hidden-markup.ts). Este arquivo só LÊ os trechos: sem DOM e sem
 * comandos, para poder ser usado (e testado) em qualquer lugar.
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { isPaletteColor, PALETTE, paletteVar, type PaletteColor } from '../colors'
import { isMentionUrl } from './mentions'

export type InlineFormat = 'bold' | 'italic' | 'underline' | 'strike' | 'highlight' | 'code' | 'color'
/** Tudo que tem marcação escondida: os formatos e os links. */
export type ElementKind = InlineFormat | 'link'

/** Um trecho marcado: [from, openTo) = marcação de abertura, [closeFrom, to) = de fechamento. */
export interface FormatElement {
  format: ElementKind
  from: number
  openTo: number
  closeFrom: number
  to: number
  /** format = 'color': a cor do texto. format = 'highlight': a cor do marca-texto (sem = o padrão, "==…=="). */
  color?: string
  /** Só para format = 'link'. */
  url?: string
}

const MARKERS: Record<Exclude<InlineFormat, 'color'>, readonly [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['<u>', '</u>'],
  strike: ['~~', '~~'],
  highlight: ['==', '=='],
  code: ['`', '`'],
}

const colorMarkers = (color: string) => [`<span style="color: ${color}">`, '</span>'] as const

/**
 * Cores do marca-texto (1.7.1). No arquivo vai um tom claro (fica legível em qualquer
 * programa que abra o Markdown); no app, a cor da paleta no tema atual (claro ou escuro).
 */
export const HIGHLIGHT_HEX: Record<PaletteColor, string> = {
  purple: '#e9d5ff',
  yellow: '#fef08a',
  blue: '#bfdbfe',
  green: '#bbf7d0',
  red: '#fecaca',
  orange: '#fed7aa',
  teal: '#99f6e4',
  pink: '#fbcfe8',
  gray: '#e5e7eb',
}

/** "default" (ou nada) = o marca-texto padrão, "==…==". */
export const DEFAULT_HIGHLIGHT = 'default'

/** Cor do marca-texto lida do arquivo: o nome da paleta quando é um dos tons dela. */
export function highlightColorOf(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (isPaletteColor(value)) return value
  return PALETTE.find((color) => HIGHLIGHT_HEX[color] === value) ?? value
}

const highlightMarkers = (color: string) => [`<mark style="background-color: ${isPaletteColor(color) ? HIGHLIGHT_HEX[color] : color}">`, '</mark>'] as const

/** Cor do marca-texto que vale no elemento (undefined = o padrão). */
export const highlightKey = (color?: string | null) => (!color || color === DEFAULT_HIGHLIGHT ? undefined : color)

export function markersFor(format: InlineFormat, color?: string): readonly [string, string] {
  if (format === 'color') return colorMarkers(color ?? 'purple')
  if (format === 'highlight' && highlightKey(color)) return highlightMarkers(highlightKey(color)!)
  return MARKERS[format]
}

/** Formatos com cor (texto e marca-texto): "a mesma cor" importa ao juntar, trocar e tirar. */
export const COLORED: ReadonlySet<ElementKind> = new Set<ElementKind>(['color', 'highlight'])

/** Fundo do marca-texto colorido no app (segue o tema); null = cor inválida. */
export function highlightCss(color: string | undefined): string | null {
  if (!color) return null
  if (isPaletteColor(color)) return `color-mix(in srgb, ${paletteVar(color)} 34%, transparent)`
  return cssColor(color)
}

/** Fundo do marca-texto colorido num PDF (sempre o tom claro). */
export function highlightPrintColor(color: string | undefined): string | null {
  if (!color) return null
  return isPaletteColor(color) ? HIGHLIGHT_HEX[color] : cssColor(color)
}

/**
 * Formatos cujas marcações do Markdown deixam de valer com espaço encostado por
 * dentro ("**olá **" não é negrito): editar perto delas pede cuidado extra.
 */
export const FLANKING: ReadonlySet<ElementKind> = new Set<ElementKind>(['bold', 'italic', 'strike', 'highlight'])

/**
 * Formatos que "continuam" quando você digita logo depois deles (como no Word):
 * clicar no fim de um texto em negrito e digitar continua em negrito. Código e
 * links não continuam.
 */
export const INCLUSIVE: ReadonlySet<ElementKind> = new Set<ElementKind>(['bold', 'italic', 'underline', 'strike', 'highlight', 'color'])

/** Sublinhado e cor usam tags HTML (o Markdown não tem esses formatos). */
export const HTML_FORMATS: ReadonlySet<ElementKind> = new Set<ElementKind>(['underline', 'color'])

// ── Leitura ──────────────────────────────────────────────────────────────────

/** Nós do Markdown (árvore do CodeMirror) que viram formatação. */
const TREE_FORMATS: Record<string, { format: InlineFormat; mark: string }> = {
  StrongEmphasis: { format: 'bold', mark: 'EmphasisMark' },
  Emphasis: { format: 'italic', mark: 'EmphasisMark' },
  Strikethrough: { format: 'strike', mark: 'StrikethroughMark' },
  InlineCode: { format: 'code', mark: 'CodeMark' },
}
const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'CodeInfo'])

const UNDERLINE_RE = /<u>(.*?)<\/u>/g
const COLOR_RE = /<span\s+style\s*=\s*(["'])\s*color\s*:\s*([#\w(),.%\s-]+?)\s*;?\s*\1\s*>(.*?)<\/span>/gi
const HIGHLIGHT_RE = /==([^\s=](?:[^=\n]*?[^\s=])?)==/g
const MARK_RE = /<mark\s+style\s*=\s*(["'])\s*background(?:-color)?\s*:\s*([#\w(),.%\s-]+?)\s*;?\s*\1\s*>(.*?)<\/mark>/gi

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

export function isInCode(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (CODE_NODES.has(node.name)) return true
  }
  return false
}

/** Trechos marcados inteiramente dentro de [from, to] (use limites de linha). */
export function findElements(state: EditorState, from: number, to: number): FormatElement[] {
  const elements: FormatElement[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      if (ref.name === 'Image') return false
      if (ref.name === 'Link' || ref.name === 'Autolink') {
        if (ref.from < from || ref.to > to) return
        const url = ref.node.getChild('URL')
        const marks = ref.node.getChildren('LinkMark')
        if (!url) return false
        const address = state.sliceDoc(url.from, url.to)
        // Menções a notas e tarefas viram chips (mentions.ts)
        if (isMentionUrl(state, address)) return false
        if (ref.name === 'Autolink') {
          if (marks.length >= 2) elements.push({ format: 'link', from: ref.from, openTo: marks[0]!.to, closeFrom: marks.at(-1)!.from, to: ref.to, url: address })
          return false
        }
        // [texto](endereço) — links de referência ([texto][ref]) ficam como estão
        if (marks.length < 3 || marks[1]!.from < marks[0]!.to || state.sliceDoc(marks[2]!.from, marks[2]!.to) !== '(') return false
        elements.push({ format: 'link', from: ref.from, openTo: marks[0]!.to, closeFrom: marks[1]!.from, to: ref.to, url: address })
        return // o texto do link pode ter negrito, itálico…
      }
      const spec = TREE_FORMATS[ref.name]
      if (!spec || ref.from < from || ref.to > to) return
      const first = ref.node.firstChild
      const last = ref.node.lastChild
      if (!first || !last || first.from === last.from || first.name !== spec.mark || last.name !== spec.mark) return
      elements.push({ format: spec.format, from: ref.from, openTo: first.to, closeFrom: last.from, to: ref.to })
    },
  })

  const scan = (re: RegExp, build: (match: RegExpExecArray, start: number) => FormatElement) => {
    for (let line = state.doc.lineAt(from); ; line = state.doc.line(line.number + 1)) {
      re.lastIndex = 0
      for (let match = re.exec(line.text); match; match = re.exec(line.text)) {
        const start = line.from + match.index
        if (!isInCode(state, start)) elements.push(build(match, start))
      }
      if (line.to >= to || line.number >= state.doc.lines) break
    }
  }
  scan(UNDERLINE_RE, (m, start) => ({ format: 'underline', from: start, openTo: start + 3, closeFrom: start + m[0].length - 4, to: start + m[0].length }))
  scan(HIGHLIGHT_RE, (m, start) => ({ format: 'highlight', from: start, openTo: start + 2, closeFrom: start + m[0].length - 2, to: start + m[0].length }))
  scan(MARK_RE, (m, start) => {
    const closeFrom = start + m[0].length - '</mark>'.length
    return { format: 'highlight', from: start, openTo: closeFrom - m[3]!.length, closeFrom, to: start + m[0].length, color: highlightColorOf(m[2]!) }
  })
  scan(COLOR_RE, (m, start) => {
    const closeFrom = start + m[0].length - '</span>'.length
    return { format: 'color', from: start, openTo: closeFrom - m[3]!.length, closeFrom, to: start + m[0].length, color: m[2]!.trim().toLowerCase() }
  })
  return elements.sort((a, b) => a.from - b.from || b.to - a.to)
}

/** O trecho tem texto (o que fica visível entre as marcações)? */
export const hasContent = (el: FormatElement) => el.closeFrom > el.openTo

/**
 * As marcações deste trecho ficam escondidas? Todo trecho com texto; as tags HTML
 * (sublinhado, cor) mesmo sem texto, porque são compridas demais para aparecer.
 */
export const hasHiddenMarkup = (el: FormatElement) => hasContent(el) || HTML_FORMATS.has(el.format) || (el.format === 'highlight' && !!el.color)

/** Trechos com marcação escondida nas linhas de `from` até `to`. */
export function hiddenElements(state: EditorState, from: number, to: number): FormatElement[] {
  return findElements(state, state.doc.lineAt(from).from, state.doc.lineAt(to).to).filter(hasHiddenMarkup)
}

/** Marcações (abertura e fechamento) dos trechos, em ordem: [[from, to], …]. */
export function markupRanges(elements: FormatElement[]): [number, number][] {
  return elements
    .flatMap((el): [number, number][] => [
      [el.from, el.openTo],
      [el.closeFrom, el.to],
    ])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0])
}

export const sameColor = (a?: string, b?: string) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

/** Valor CSS seguro para uma cor lida do arquivo (cores da paleta seguem o tema). */
export function cssColor(color: string | undefined): string | null {
  if (!color) return null
  if (isPaletteColor(color)) return paletteVar(color)
  if (/^#[0-9a-f]{3,8}$/i.test(color) || /^[a-z]{3,20}$/i.test(color) || /^(rgb|hsl)a?\([\d\s.,%-]+\)$/i.test(color)) return color
  return null
}

/** Link (não menção) em `pos` — com o cursor em qualquer lugar do texto dele. */
export function linkAt(state: EditorState, pos: number): FormatElement | null {
  const line = state.doc.lineAt(pos)
  return findElements(state, line.from, line.to).find((el) => el.format === 'link' && el.openTo <= pos && pos <= el.closeFrom) ?? null
}

/**
 * Endereço pronto para ir dentro de (…) no Markdown: espaços e parênteses
 * codificados (senão o link termina antes da hora).
 */
export function linkDestination(url: string): string {
  const codes: Record<string, string> = { '(': '%28', ')': '%29', '<': '%3C', '>': '%3E' }
  return url.trim().replace(/[\s()<>]/g, (char) => codes[char] ?? encodeURIComponent(char))
}

/** Texto de um link: colchetes desemparelhados (que fechariam o link antes da hora) ganham "\\". */
export function linkLabel(text: string): string {
  let depth = 0
  for (const char of text) {
    if (char === '[') depth++
    else if (char === ']' && --depth < 0) break
  }
  return depth === 0 ? text : text.replace(/(?<!\\)[[\]]/g, (char) => `\\${char}`)
}
