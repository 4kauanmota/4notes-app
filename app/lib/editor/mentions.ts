/**
 * Menções no editor — só onde o app liga o recurso (EditorHost.mentions: nas Notas,
 * nas notas do Mapa Mental e na descrição das tarefas — ali a escolhida vai para a
 * lista "Menções" da tarefa, MentionHost.choose).
 *
 * - Digitar "@" abre a lista com itens de todos os módulos (notas, notas dos mapas,
 *   mapas, tarefas, links salvos e registros do Timer); Enter ou clique insere.
 * - No arquivo, a menção é um link Markdown comum (lib/notes/mention-links.ts).
 * - Notas, mapas, tarefas e registros aparecem como um chip com o título atual (e, nas
 *   tarefas, se está concluída; riscado quando o item não existe mais). O chip é um
 *   bloco só (o cursor passa por cima e Backspace apaga a menção inteira); clicar abre
 *   o item no módulo dele.
 * - Um link salvo entra como um link comum ([título](endereço), texto editável) e
 *   aparece com o ícone do site na frente (formatting.ts).
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { basename, stripExtension } from '../files/filename'
import { iconSvg } from '../icons'
import { MENTION_KINDS } from '../mentions/catalog'
import { mentionKind, mentionMarkdown, mentionTarget, unescapeLinkText, type MentionKind } from '../notes/mention-links'
import { linkDestination, linkLabel } from './elements'
import { editorHost, type MentionTarget } from './host'

interface MentionLink {
  from: number
  to: number
  /** Caminho de menção ("notes/X.md", "tasks/tasks.json#id", "timer/timer.json#id"…). */
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

class MentionWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly title: string,
    readonly missing: boolean,
    readonly done: boolean,
    readonly detail: string,
  ) {
    super()
  }
  override eq(other: MentionWidget): boolean {
    return (
      other.path === this.path && other.title === this.title && other.missing === this.missing && other.done === this.done && other.detail === this.detail
    )
  }
  toDOM(): HTMLElement {
    const kind = mentionKind(this.path)
    const info = MENTION_KINDS[kind]
    const chip = document.createElement('span')
    chip.className = `cm-mention ${kind}${this.missing ? ' missing' : ''}${this.done ? ' done' : ''}`
    chip.dataset.path = this.path
    const tip = this.missing ? info.missing : this.done ? 'Tarefa concluída — abrir' : info.open
    chip.dataset.tip = this.detail && !this.missing ? `${tip} · ${this.detail}` : tip
    chip.innerHTML = iconSvg(kind === 'task' && this.done ? 'tasks' : info.icon, 13)
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
    return Decoration.replace({
      widget: new MentionWidget(link.path, label, current === null, current?.done === true, current?.detail ?? ''),
    }).range(link.from, link.to)
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
  const text = host.mentions?.choose
    ? host.mentions.choose(target)
    : target.url
      ? `[${linkLabel(target.title)}](${linkDestination(target.url)})`
      : mentionMarkdown(host.assetBase(), target.path, target.title)
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
        type: `mention-${target.url ? 'link' : mentionKind(target.path)}`,
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
        icon.innerHTML = iconSvg(MENTION_KINDS[kind]?.icon ?? 'notes', 14)
        return icon
      },
    },
  ],
})

/** Menções (@) e chips dos itens mencionados. */
export const noteMentions: Extension = [chipField, chipClicks, mentionPicker]
