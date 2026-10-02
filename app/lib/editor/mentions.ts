/**
 * Menções a outras notas no editor — só onde o app liga o recurso (EditorHost.mentions;
 * hoje, nas Notas).
 *
 * - Digitar "@" abre a lista de notas (Notas e Mapa Mental); Enter ou clique insere.
 * - No arquivo, a menção é um link Markdown para o .md da nota (lib/notes/mention-links.ts).
 * - No editor, aparece como um chip com o título atual da nota. O chip é um bloco
 *   só (o cursor passa por cima e Backspace apaga a menção inteira); clicar abre a nota.
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { basename, stripExtension } from '../files/filename'
import { iconSvg } from '../icons'
import { mentionMarkdown, mentionTarget, unescapeLinkText } from '../notes/mention-links'
import { editorHost, type MentionTarget } from './host'

interface MentionLink {
  from: number
  to: number
  /** Caminho da nota mencionada no workspace. */
  path: string
  text: string
}

const SKIP = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'Image'])
const isMapNote = (path: string) => path.startsWith('mindmap/')

/** O endereço de um link é uma menção a nota? (a prévia dos links comuns deixa estes para cá) */
export function isMentionUrl(state: EditorState, url: string): boolean {
  const host = state.facet(editorHost)
  return !!host?.mentions && mentionTarget(host.assetBase(), url) !== null
}

function findMentions(state: EditorState): MentionLink[] {
  const host = state.facet(editorHost)
  if (!host?.mentions) return []
  const base = host.assetBase()
  const links: MentionLink[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (SKIP.has(node.name)) return false
      if (node.name !== 'Link') return
      const url = node.node.getChild('URL')
      const marks = node.node.getChildren('LinkMark')
      if (!url || marks.length < 3) return false
      const path = mentionTarget(base, state.sliceDoc(url.from, url.to))
      if (path) links.push({ from: node.from, to: node.to, path, text: unescapeLinkText(state.sliceDoc(marks[0]!.to, marks[1]!.from)) })
      return false
    },
  })
  return links
}

// ── Chip ─────────────────────────────────────────────────────────────────────

class MentionWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly title: string,
    readonly missing: boolean,
  ) {
    super()
  }
  override eq(other: MentionWidget): boolean {
    return other.path === this.path && other.title === this.title && other.missing === this.missing
  }
  toDOM(): HTMLElement {
    const chip = document.createElement('span')
    chip.className = `cm-mention${this.missing ? ' missing' : ''}`
    chip.dataset.path = this.path
    chip.dataset.tip = this.missing ? 'Nota não encontrada' : isMapNote(this.path) ? 'Abrir a nota no Mapa Mental' : 'Abrir a nota'
    chip.innerHTML = iconSvg(isMapNote(this.path) ? 'graph' : 'notes', 13)
    const label = document.createElement('span')
    label.className = 'cm-mention-title'
    label.textContent = this.title
    chip.append(label)
    return chip
  }
  override ignoreEvent(): boolean {
    return false
  }
}

function buildChips(state: EditorState): DecorationSet {
  const mentions = state.facet(editorHost)?.mentions
  if (!mentions) return Decoration.none
  const ranges = findMentions(state).map((link) => {
    const title = mentions.titleOf(link.path)
    const label = title ?? (link.text || stripExtension(basename(link.path)))
    return Decoration.replace({ widget: new MentionWidget(link.path, label, title === null) }).range(link.from, link.to)
  })
  return Decoration.set(ranges, true)
}

const chipField = StateField.define<DecorationSet>({
  create: buildChips,
  update: (chips, tr) => (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? buildChips(tr.state) : chips),
  provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
})

const chipClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const chip = (event.target as HTMLElement).closest?.('.cm-mention') as HTMLElement | null
    if (!chip || event.button !== 0) return false
    event.preventDefault()
    if (chip.dataset.path) view.state.facet(editorHost)?.mentions?.open(chip.dataset.path)
    return true
  },
})

// ── "@" ──────────────────────────────────────────────────────────────────────

function insideCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock') return true
  }
  return false
}

function insertMention(view: EditorView, target: MentionTarget, from: number, to: number): void {
  const host = view.state.facet(editorHost)
  if (!host) return
  const text = mentionMarkdown(host.assetBase(), target.path, target.title)
  const next = view.state.sliceDoc(to, to + 1)
  const insert = next && /\s/.test(next) ? text : `${text} `
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.complete', scrollIntoView: true })
}

async function mentionCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  const mentions = context.state.facet(editorHost)?.mentions
  if (!mentions) return null
  // "@" no começo da linha ou depois de um espaço (e-mails não abrem a lista)
  const before = context.matchBefore(/(?:^|[\s([{"'])@[^@\n]{0,40}$/)
  if (!before) return null
  const at = before.from + before.text.indexOf('@')
  const query = context.state.sliceDoc(at + 1, context.pos)
  if (/^\s|\s{2}/.test(query) || insideCode(context.state, at)) return null
  const targets = await mentions.search(query)
  if (context.aborted || !targets.length) return null
  return {
    from: at,
    to: context.pos,
    filter: false,
    options: targets.map(
      (target): Completion => ({
        label: target.title,
        detail: target.where,
        type: isMapNote(target.path) ? 'mention-map' : 'mention-note',
        apply: (view, _completion, from, to) => insertMention(view, target, from, to),
      }),
    ),
  }
}

const mentionPicker = autocompletion({
  override: [mentionCompletions],
  icons: false,
  closeOnBlur: true,
  maxRenderedOptions: 40,
  tooltipClass: () => 'cm-mention-picker',
  addToOptions: [
    {
      position: 20,
      render: (completion) => {
        const icon = document.createElement('span')
        icon.className = 'cm-mention-option-icon'
        icon.innerHTML = iconSvg(completion.type === 'mention-map' ? 'graph' : 'notes', 14)
        return icon
      },
    },
  ],
})

/** Menções (@) e chips das notas mencionadas. */
export const noteMentions: Extension = [chipField, chipClicks, mentionPicker]
