/**
 * Exportar uma nota (menu da nota › Exportar):
 *
 * - TXT: só o texto. Sai toda a formatação e toda a sintaxe do Markdown (#, **, ==,
 *   <u>, [texto](endereço), imagens, cercas ``` dos blocos de código). Cada linha da
 *   nota continua uma linha; itens de lista ficam com o marcador que aparece na
 *   tela (•, 1., ☐ / ☑).
 * - PDF: um HTML com a mesma aparência da nota no editor (no tema claro, para o
 *   papel), impresso pelo processo principal (electron/export.ts).
 *
 * O Markdown é lido pelas mesmas regras do editor (elements.ts, line-markers.ts,
 * code-blocks.ts), então o que sai é o que você vê na nota.
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorState, type Line } from '@codemirror/state'
import { highlightCode, tagHighlighter, tags as t } from '@lezer/highlight'
import { workspaceFileUrl } from '#shared/ipc'
import { codeBlocks, type CodeBlock } from '../editor/code-blocks'
import { cssColor, findElements, hasHiddenMarkup, type FormatElement } from '../editor/elements'
import { findLanguage, isTextBlockInfo, languageLabel } from '../editor/languages'
import { lineMarkerAt } from '../editor/line-markers'
import { resolveFromNote } from '../files/workspace-path'
import { mentionKind, mentionTarget, unescapeLinkText } from './mention-links'

// ── Leitura do Markdown (igual ao editor) ───────────────────────────────────

const language = markdown({ base: markdownLanguage, extensions: [{ remove: ['SetextHeading'] }] })

/** Estado com a árvore do Markdown completa (notas grandes inclusive). */
export function parseNote(content: string): EditorState {
  const state = EditorState.create({ doc: content, extensions: [language] })
  ensureSyntaxTree(state, state.doc.length, 10_000)
  // Uma transação vazia faz o estado adotar a árvore que acabou de ser completada
  return state.update({}).state
}

interface NoteLayout {
  state: EditorState
  /** Blocos de código fechados (as linhas deles saem juntas). */
  blocks: CodeBlock[]
  quoteLines: Set<number>
  ruleLines: Set<number>
}

function layoutOf(content: string): NoteLayout {
  const state = parseNote(content)
  const quoteLines = new Set<number>()
  const ruleLines = new Set<number>()
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false
      if (node.name !== 'Blockquote' && node.name !== 'HorizontalRule') return
      const first = state.doc.lineAt(node.from).number
      const last = state.doc.lineAt(node.to).number
      for (let n = first; n <= last; n++) (node.name === 'Blockquote' ? quoteLines : ruleLines).add(n)
      return node.name === 'Blockquote' ? undefined : false
    },
  })
  return { state, blocks: codeBlocks(state), quoteLines, ruleLines }
}

// ── Trechos de uma linha ─────────────────────────────────────────────────────

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

interface Replacement {
  from: number
  to: number
  html: string
  text: string
}

interface InlineParts {
  formats: FormatElement[]
  hidden: [number, number][]
  replaced: Replacement[]
}

const SPAN_CLASSES: Partial<Record<FormatElement['format'], string>> = { bold: 'b', italic: 'i', underline: 'u', strike: 's', highlight: 'hl' }

/** Endereço que pode abrir fora do app (no PDF); links para arquivos do workspace ficam só como texto. */
function externalUrl(url: string | undefined): string | null {
  if (!url) return null
  const clean = url.trim().replace(/^<|>$/g, '')
  if (/^www\./i.test(clean)) return `https://${clean}`
  return /^(https?:|mailto:)/i.test(clean) ? clean : null
}

function imageHtml(noteDir: string, src: string, alt: string, inline: boolean): string {
  const path = resolveFromNote(noteDir, src)
  // Endereço externo ou fora do workspace: no editor também não aparece
  if (!path) return ''
  return `<img class="${inline ? 'img-inline' : 'img'}" src="${escapeHtml(workspaceFileUrl(path))}" alt="${escapeHtml(alt)}">`
}

function partsOf(state: EditorState, line: Line, from: number, to: number, noteDir: string): InlineParts {
  const elements = findElements(state, line.from, line.to).filter((el) => el.from >= from && el.to <= to)
  const replaced: Replacement[] = []
  // Imagens e quebras com "\" no fim da linha
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      // A quebra com "\" inclui a quebra de linha: só o "\" fica nesta linha
      if (node.name === 'HardBreak' && node.from >= from && node.from < to && state.sliceDoc(node.from, node.from + 1) === '\\') {
        replaced.push({ from: node.from, to: Math.min(node.to, to), html: '', text: '' })
        return
      }
      if (node.from < from || node.to > to) return
      if (node.name === 'Image') {
        const url = node.node.getChild('URL')
        const marks = node.node.getChildren('LinkMark')
        if (url && marks.length >= 2) {
          const alt = state.sliceDoc(marks[0]!.to, marks[1]!.from)
          replaced.push({ from: node.from, to: node.to, html: imageHtml(noteDir, state.sliceDoc(url.from, url.to), alt, true), text: '' })
        }
        return false
      }
      if (node.name === 'Escape') replaced.push({ from: node.from, to: node.to, html: escapeHtml(state.sliceDoc(node.from + 1, node.to)), text: state.sliceDoc(node.from + 1, node.to) })
    },
  })
  // Menções (notas, mapas, tarefas, registros do Timer): um chip com o título
  for (const el of elements) {
    if (el.format !== 'link' || !el.url) continue
    const target = mentionTarget(noteDir, el.url)
    if (!target) continue
    const title = unescapeLinkText(state.sliceDoc(el.openTo, el.closeFrom))
    replaced.push({ from: el.from, to: el.to, html: `<span class="mention ${mentionKind(target)}">${escapeHtml(title)}</span>`, text: title })
  }
  replaced.sort((a, b) => a.from - b.from)
  const inside = (el: { from: number; to: number }) => replaced.some((r) => el.from >= r.from && el.to <= r.to)
  const formats = elements.filter((el) => !inside(el))
  const hidden: [number, number][] = []
  for (const el of formats) {
    if (!hasHiddenMarkup(el)) continue
    if (el.openTo > el.from) hidden.push([el.from, el.openTo])
    if (el.to > el.closeFrom) hidden.push([el.closeFrom, el.to])
  }
  return { formats, hidden, replaced }
}

/** Percorre os pedaços visíveis do trecho [from, to): texto com os formatos ativos, ou uma troca (imagem, menção). */
function walkInline(
  state: EditorState,
  line: Line,
  from: number,
  to: number,
  noteDir: string,
  visit: (piece: { text: string; active: FormatElement[] } | { replacement: Replacement }) => void,
): void {
  if (to <= from) return
  const { formats, hidden, replaced } = partsOf(state, line, from, to, noteDir)
  const cuts = new Set<number>([from, to])
  for (const el of formats) for (const pos of [el.from, el.openTo, el.closeFrom, el.to]) cuts.add(pos)
  for (const [a, b] of hidden) cuts.add(a).add(b)
  for (const r of replaced) cuts.add(r.from).add(r.to)
  const points = [...cuts].filter((pos) => pos >= from && pos <= to).sort((a, b) => a - b)
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const replacement = replaced.find((r) => a >= r.from && a < r.to)
    if (replacement) {
      if (a === replacement.from) visit({ replacement })
      continue
    }
    if (hidden.some(([x, y]) => a >= x && b <= y)) continue
    visit({ text: state.sliceDoc(a, b), active: formats.filter((el) => el.openTo <= a && b <= el.closeFrom) })
  }
}

function inlineText(state: EditorState, line: Line, from: number, to: number, noteDir: string): string {
  let out = ''
  walkInline(state, line, from, to, noteDir, (piece) => (out += 'replacement' in piece ? piece.replacement.text : piece.text))
  return out
}

function inlineHtml(state: EditorState, line: Line, from: number, to: number, noteDir: string): string {
  let out = ''
  let pending = ''
  let pendingKey: string | null = null
  let pendingActive: FormatElement[] = []
  const flush = () => {
    if (pendingKey !== null && pending) out += wrap(pending, pendingActive)
    pending = ''
    pendingKey = null
  }
  walkInline(state, line, from, to, noteDir, (piece) => {
    if ('replacement' in piece) {
      flush()
      out += piece.replacement.html
      return
    }
    // Pedaços seguidos com os mesmos formatos saem juntos
    const key = piece.active.map((el) => `${el.format}${el.from}`).join('|')
    if (key !== pendingKey) {
      flush()
      pendingKey = key
      pendingActive = piece.active
    }
    pending += piece.text
  })
  flush()
  return out
}

function wrap(text: string, active: FormatElement[]): string {
  let html = escapeHtml(text)
  if (active.some((el) => el.format === 'code')) html = `<code>${html}</code>`
  const classes = [...new Set(active.map((el) => SPAN_CLASSES[el.format]).filter(Boolean))]
  const color = cssColor(active.filter((el) => el.format === 'color').at(-1)?.color)
  if (classes.length || color) html = `<span${classes.length ? ` class="${classes.join(' ')}"` : ''}${color ? ` style="color: ${color}"` : ''}>${html}</span>`
  const link = active.filter((el) => el.format === 'link').at(-1)
  if (link) {
    const href = externalUrl(link.url)
    html = href ? `<a href="${escapeHtml(href)}">${html}</a>` : `<span class="link">${html}</span>`
  }
  return html
}

/** Imagem sozinha na linha (aparece como um bloco). */
function aloneImage(state: EditorState, line: Line): { src: string; alt: string } | null {
  const trimmed = line.text.trim()
  if (!trimmed.startsWith('![')) return null
  let found: { src: string; alt: string } | null = null
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name !== 'Image' || state.sliceDoc(node.from, node.to) !== trimmed) return
      const url = node.node.getChild('URL')
      const marks = node.node.getChildren('LinkMark')
      if (url && marks.length >= 2) found = { src: state.sliceDoc(url.from, url.to), alt: state.sliceDoc(marks[0]!.to, marks[1]!.from) }
      return false
    },
  })
  return found
}

// ── TXT ─────────────────────────────────────────────────────────────────────

/** A nota em texto puro: sem formatação e sem a sintaxe do Markdown. */
export function noteToPlainText(content: string, noteDir: string): string {
  const { state, blocks, ruleLines } = layoutOf(content)
  const { doc } = state
  const out: string[] = []
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const block = blocks.find((item) => item.from === line.from)
    if (block) {
      if (!block.empty) out.push(state.sliceDoc(block.codeFrom, block.codeTo))
      n = doc.lineAt(block.to).number
      continue
    }
    if (ruleLines.has(n)) {
      out.push('')
      continue
    }
    if (aloneImage(state, line)) continue
    const marker = lineMarkerAt(state, line)
    let prefix = ''
    if (marker?.kind === 'bullet' || marker?.kind === 'ordered' || marker?.kind === 'task') {
      const indent = '  '.repeat(marker.level)
      prefix = indent + (marker.kind === 'bullet' ? '• ' : marker.kind === 'ordered' ? `${marker.label} ` : marker.checked ? '☑ ' : '☐ ')
    }
    const text = inlineText(state, line, marker ? marker.to : line.from, line.to, noteDir)
    out.push(`${prefix}${text}`.replace(/[ \t]+$/, ''))
  }
  // Sem linhas vazias sobrando no começo e no fim
  while (out.length && !out[0]!.trim()) out.shift()
  while (out.length && !out.at(-1)!.trim()) out.pop()
  return out.length ? `${out.join('\n')}\n` : ''
}

// ── PDF (HTML) ──────────────────────────────────────────────────────────────

/** Classes das cores do código (mesmos grupos de lib/editor/theme.ts › codeHighlight). */
const codeClasses = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], class: 'tk' },
  { tag: [t.string, t.special(t.string), t.character, t.regexp], class: 'ts' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], class: 'tn' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'tc' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: 'tf' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], class: 'tt' },
  { tag: [t.propertyName, t.attributeName], class: 'tp' },
  { tag: [t.tagName, t.angleBracket], class: 'tg' },
  { tag: [t.meta, t.annotation, t.processingInstruction], class: 'tm' },
  { tag: [t.special(t.variableName), t.self, t.constant(t.variableName)], class: 'tx' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], class: 'td' },
  { tag: [t.operator, t.punctuation, t.bracket], class: 'to' },
  { tag: t.invalid, class: 'ti' },
])

/** Código colorido (carrega a linguagem do bloco, se preciso). */
async function highlightedCode(code: string, info: string): Promise<string> {
  const description = findLanguage(info)
  const support = description ? (description.support ?? (await description.load().catch(() => null))) : null
  if (!support) return escapeHtml(code)
  let html = ''
  highlightCode(
    code,
    support.language.parser.parse(code),
    codeClasses,
    (text, classes) => (html += classes ? `<span class="${classes}">${escapeHtml(text)}</span>` : escapeHtml(text)),
    () => (html += '\n'),
  )
  return html
}

/** O corpo do HTML da nota: uma linha da nota por linha do documento, como no editor. */
export async function noteToHtml(content: string, noteDir: string): Promise<string> {
  const { state, blocks, quoteLines, ruleLines } = layoutOf(content)
  const { doc } = state
  const out: string[] = []
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const block = blocks.find((item) => item.from === line.from)
    if (block) {
      const code = block.empty ? '' : state.sliceDoc(block.codeFrom, block.codeTo)
      // Bloco de texto (```text): mesmo cartão, com a fonte do texto
      const kind = isTextBlockInfo(block.info) ? 'code text' : 'code'
      out.push(`<div class="${kind}"><div class="code-head">${escapeHtml(languageLabel(block.info))}</div><pre>${await highlightedCode(code, block.info)}</pre></div>`)
      n = doc.lineAt(block.to).number
      continue
    }
    if (ruleLines.has(n)) {
      out.push('<hr>')
      continue
    }
    const quote = quoteLines.has(n) ? ' quote' : ''
    const image = aloneImage(state, line)
    if (image) {
      out.push(`<div class="image${quote}">${imageHtml(noteDir, image.src, image.alt, false)}</div>`)
      continue
    }
    const marker = lineMarkerAt(state, line)
    const body = inlineHtml(state, line, marker ? marker.to : line.from, line.to, noteDir)
    if (marker?.kind === 'heading') {
      const level = Math.min(6, /^#{1,6}/.exec(state.sliceDoc(marker.markFrom, line.to))?.[0].length ?? 1)
      out.push(`<h${level} class="line${quote}">${body || '&nbsp;'}</h${level}>`)
    } else if (marker && marker.kind !== 'quote') {
      const mark =
        marker.kind === 'task'
          ? `<span class="marker"><span class="checkbox${marker.checked ? ' checked' : ''}"></span></span>`
          : `<span class="marker ${marker.kind}">${marker.kind === 'bullet' ? '•' : escapeHtml(marker.label ?? '')}</span>`
      const text = marker.kind === 'task' && marker.checked ? `<span class="task-done">${body}</span>` : body
      out.push(`<div class="line li${quote}" style="--level: ${marker.level}">${mark}${text}</div>`)
    } else {
      out.push(`<div class="line${quote}">${body || '&nbsp;'}</div>`)
    }
  }
  return out.join('\n')
}

/** Cores do tema claro (assets/css/tokens.css): o PDF é para o papel. */
const STYLE = `
:root {
  --text: #1f1a2b; --text-2: #5b5468; --text-3: #8d869b;
  --surface-3: #f1eff7; --border: #e5e2ee; --border-strong: #d3cedf;
  --primary: #6842ee; --primary-text: #5634cc; --primary-soft: rgba(124, 92, 252, 0.12);
  --accent: #ffcb2b; --accent-soft: rgba(255, 203, 43, 0.24); --accent-text: #7a5600;
  --mark: rgba(52, 211, 113, 0.32);
  --cat-purple: #7c5cfc; --cat-yellow: #e0a800; --cat-blue: #3b7ef0; --cat-green: #22a06b; --cat-red: #e5484d;
  --cat-orange: #ee7a2c; --cat-teal: #0f9f9f; --cat-pink: #db4f95; --cat-gray: #8d869b;
  --font-ui: 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Roboto, Arial, sans-serif;
  --font-display: 'Segoe UI Variable Display', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
  --font-mono: 'Cascadia Code', 'Cascadia Mono', Consolas, 'SF Mono', Menlo, 'DejaVu Sans Mono', monospace;
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #fff; color: var(--text); font-family: var(--font-ui); font-size: 11pt; line-height: 1.72; }
.line { min-height: 1.72em; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { margin: 0; font-weight: 650; break-after: avoid; }
h1 { font-family: var(--font-display); font-size: 1.75em; font-weight: 700; line-height: 1.35; letter-spacing: -0.01em; }
h2 { font-family: var(--font-display); font-size: 1.42em; font-weight: 700; line-height: 1.4; }
h3 { font-size: 1.2em; }
h4, h5, h6 { font-size: 1em; }
.quote { border-left: 3px solid var(--accent); padding-left: 14px; color: var(--text-2); }
.li { padding-left: calc(var(--level, 0) * 1.6em + 1.6em); text-indent: -1.6em; }
.quote.li { padding-left: calc(var(--level, 0) * 1.6em + 1.6em + 14px); }
.marker { display: inline-block; width: 1.6em; text-indent: 0; color: var(--text-3); }
.marker.bullet { padding-left: 0.35em; color: var(--primary); font-weight: 700; }
.marker.ordered { color: var(--text-2); font-variant-numeric: tabular-nums; }
.checkbox { position: relative; display: inline-block; width: 13px; height: 13px; vertical-align: -2px; border: 1.5px solid var(--border-strong); border-radius: 4px; }
.checkbox.checked { background: var(--primary); border-color: var(--primary); }
.checkbox.checked::after { content: ''; position: absolute; left: 3.4px; top: 0.6px; width: 3.2px; height: 6.6px; border: solid #fff; border-width: 0 1.8px 1.8px 0; transform: rotate(45deg); }
.task-done { color: var(--text-3); text-decoration: line-through; }
hr { margin: 0.8em 0; border: none; border-top: 1.5px solid var(--border-strong); }
.b { font-weight: 700; }
.i { font-style: italic; }
.u { text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }
.s { text-decoration: line-through; color: var(--text-3); }
.u.s { text-decoration-line: underline line-through; }
.hl { background: var(--mark); border-radius: 3px; -webkit-box-decoration-break: clone; box-decoration-break: clone; padding: 1px 0; }
code { font-family: var(--font-mono); font-size: 0.88em; background: var(--surface-3); border-radius: 4px; padding: 0.05em 0.25em; }
a, .link { color: var(--primary-text); text-decoration: underline; text-decoration-color: rgba(124, 92, 252, 0.35); text-underline-offset: 3px; }
.mention { padding: 0 6px; border-radius: 6px; background: var(--primary-soft); color: var(--primary-text); font-weight: 600; }
.mention.task, .mention.timer { background: var(--accent-soft); color: var(--accent-text); }
.image { padding: 6px 0; line-height: 0; break-inside: avoid; }
.img { display: block; max-width: 100%; max-height: 230mm; border: 1px solid var(--border); border-radius: 8px; }
.img-inline { max-width: 100%; max-height: 120mm; vertical-align: middle; border-radius: 6px; }
img[data-missing] { display: none; }
.code { margin: 6px 0; overflow: hidden; border-radius: 10px; background: var(--surface-3); }
.code-head { padding: 3px 14px; border-bottom: 1px solid var(--border); color: var(--text-3); font-size: 8.5pt; font-weight: 600; letter-spacing: 0.01em; }
.code pre { margin: 0; padding: 6px 14px 8px; font-family: var(--font-mono); font-size: 0.86em; line-height: 1.62; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }
.code.text pre { font-family: inherit; font-size: 1em; }
.tk { color: #7c3aed; } .ts { color: #15803d; } .tn { color: #c2410c; } .tc { color: #8d869b; font-style: italic; }
.tf { color: #2563eb; } .tt { color: #b45309; } .tp { color: #0f766e; } .tg { color: #be185d; } .tm { color: #9333ea; }
.tx { color: #db2777; } .td { color: #1f1a2b; } .to { color: #5b5468; } .ti { color: #e5484d; }
`

/** O documento HTML completo do PDF (as imagens são embutidas pelo processo principal). */
export async function noteToPdfHtml(content: string, noteDir: string, title: string): Promise<string> {
  const body = await noteToHtml(content, noteDir)
  return [
    '<!doctype html>',
    '<html lang="pt-BR"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>`,
    `<body><main class="note">${body}</main></body></html>`,
  ].join('')
}
