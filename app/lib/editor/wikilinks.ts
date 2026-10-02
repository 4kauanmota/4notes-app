/**
 * Suporte a [[links]] no editor das notas permanentes:
 *   - destaque visual (roxo = nota existe, tracejado = ainda não existe)
 *   - Ctrl+clique abre a nota (ou cria, se não existir)
 *   - autocompletar ao digitar [[
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { normalizeTarget } from '../mindmap/wikilinks'

export interface WikilinkConfig {
  /** Títulos das notas existentes (para o autocompletar). */
  targets(): string[]
  isResolved(target: string): boolean
  open(target: string): void
}

function targetOf(inner: string): string {
  const beforeAlias = inner.split('|')[0] ?? ''
  return normalizeTarget(beforeAlias.split('#')[0] ?? '')
}

function decorations(config: WikilinkConfig): Extension {
  const matcher = new MatchDecorator({
    regexp: /!?\[\[([^[\]\n]+?)\]\]/g,
    decoration: (match) => {
      const target = targetOf(match[1]!)
      if (!target) return null
      const resolved = config.isResolved(target)
      return Decoration.mark({
        class: resolved ? 'cm-wikilink' : 'cm-wikilink cm-wikilink-missing',
        attributes: {
          'data-target': target,
          title: resolved ? `Ctrl+clique para abrir “${target}”` : `“${target}” ainda não existe — Ctrl+clique para criar`,
        },
      })
    },
  })
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view)
      }
      update(update: ViewUpdate) {
        this.decorations = matcher.updateDeco(update, this.decorations)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}

function completionSource(config: WikilinkConfig) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[[^[\]\n|#]*$/)
    if (!match) return null
    const from = match.from + 2
    const options: Completion[] = config.targets().map((title) => ({
      label: title,
      apply: (view, _completion, applyFrom, applyTo) => {
        const closed = view.state.doc.sliceString(applyTo, applyTo + 2) === ']]'
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert: closed ? title : `${title}]]` },
          selection: { anchor: applyFrom + title.length + 2 },
        })
      },
    }))
    return { from, options, validFor: /^[^[\]\n|#]*$/ }
  }
}

export function wikilinkExtension(config: WikilinkConfig): Extension {
  return [
    decorations(config),
    autocompletion({ override: [completionSource(config)], icons: false, closeOnBlur: true }),
    EditorView.domEventHandlers({
      mousedown(event) {
        if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false
        const link = (event.target as HTMLElement).closest('[data-target]')
        if (!link) return false
        event.preventDefault()
        config.open(link.getAttribute('data-target')!)
        return true
      },
    }),
  ]
}
