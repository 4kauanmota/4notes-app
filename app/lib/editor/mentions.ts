/**
 * Menções a notas e tarefas no editor — só onde o app liga o recurso
 * (EditorHost.mentions: nas Notas e nas notas do Mapa Mental).
 *
 * - Digitar "@" abre a lista (notas das Notas e dos mapas, e tarefas); Enter ou clique insere.
 * - No arquivo, a menção é um link Markdown comum (lib/notes/mention-links.ts).
 * - No editor, aparece como um chip com o título atual (e, nas tarefas, se está
 *   concluída). O chip é um bloco só (o cursor passa por cima e Backspace apaga a
 *   menção inteira); clicar abre a nota ou a tarefa.
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { basename, stripExtension } from '../files/filename'
import { iconSvg } from '../icons'
import { mentionKind, mentionMarkdown, mentionTarget, unescapeLinkText, type MentionKind } from '../notes/mention-links'
import { editorHost, type MentionTarget } from './host'

interface MentionLink {
  from: number
  to: number
  /** Caminho da nota mencionada no workspace (ou "tasks/tasks.json#id"). */
  path: string
  text: string
}

const SKIP = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'Image'])

/** Pedido para redesenhar os chips (um título ou estado mudou fora do editor). */
export const refreshMentions = StateEffect.define<null>()

/** O endereço de um link é uma menção? (a prévia dos links comuns deixa estes para cá) */
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

const ICON: Record<MentionKind, string> = { note: 'notes', map: 'graph', task: 'task-open' }
const TIP: Record<MentionKind, string> = { note: 'Abrir a nota', map: 'Abrir a nota no Mapa Mental', task: 'Abrir a tarefa' }

class MentionWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly title: string,
    readonly missing: boolean,
    readonly done: boolean,
  ) {
    super()
  }
  override eq(other: MentionWidget): boolean {
    return other.path === this.path && other.title === this.title && other.missing === this.missing && other.done === this.done
  }
  toDOM(): HTMLElement {
    const kind = mentionKind(this.path)
    const chip = document.createElement('span')
    chip.className = `cm-mention ${kind}${this.missing ? ' missing' : ''}${this.done ? ' done' : ''}`
    chip.dataset.path = this.path
    chip.dataset.tip = this.missing ? (kind === 'task' ? 'Tarefa não encontrada' : 'Nota não encontrada') : this.done ? 'Tarefa concluída — abrir' : TIP[kind]
    chip.innerHTML = iconSvg(kind === 'task' && this.done ? 'tasks' : ICON[kind], 13)
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
    const current = mentions.describe(link.path)
    const label = current?.title ?? (link.text || stripExtension(basename(link.path)))
    return Decoration.replace({ widget: new MentionWidget(link.path, label, current === null, current?.done === true) }).range(link.from, link.to)
  })
  return Decoration.set(ranges, true)
}

const chipField = StateField.define<DecorationSet>({
  create: buildChips,
  update: (chips, tr) =>
    tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) || tr.effects.some((effect) => effect.is(refreshMentions))
      ? buildChips(tr.state)
      : chips,
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
        type: `mention-${mentionKind(target.path)}`,
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
        const kind = (completion.type?.replace('mention-', '') ?? 'note') as MentionKind
        icon.innerHTML = iconSvg(ICON[kind] ?? 'notes', 14)
        return icon
      },
    },
  ],
})

/** Menções (@) e chips das notas e tarefas mencionadas. */
export const noteMentions: Extension = [chipField, chipClicks, mentionPicker]
