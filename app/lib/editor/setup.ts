/**
 * Monta o editor de Markdown (CodeMirror 6) usado nas duas áreas de notas.
 * O arquivo .md salvo é texto Markdown comum; as marcações nunca aparecem
 * (ver formatting.ts, hidden-markup.ts, markdown-preview.ts e code-blocks.ts).
 */
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { indentOnInput, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  keymap,
  placeholder as placeholderExtension,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { codeBlockPreview } from './code-blocks'
import { contextMenuTracking, formattingKeymap, livePreview } from './formatting'
import { hiddenMarkupEditing } from './hidden-markup'
import { editorHost, type EditorHost } from './host'
import { imagePreview } from './images'
import { findLanguage, isTextBlockInfo } from './languages'
import { listEditing } from './lists'
import { markdownPreview } from './markdown-preview'
import { multipleSelections } from './multi-select'
import { noteMentions } from './mentions'
import { pasteHandling } from './paste'
import { codeHighlight, editorTheme, markdownHighlight } from './theme'
import { titleFirstLine } from './title-line'

export interface CursorInfo {
  line: number
  col: number
  selected: number
}

export interface EditorCallbacks {
  onChange(content: string): void
  onCursor?(info: CursorInfo): void
  /** Qualquer atualização (seleção, foco, rolagem…) — usada pela barra de formatação. */
  onUpdate?(update: ViewUpdate): void
  openUrl?(url: string): void
}

export interface EditorOptions {
  placeholder?: string
  /** Ligação com o app (imagens, código em tela cheia, avisos). */
  host?: EditorHost
}

/** Textos da busca (Ctrl+F) em português. */
const phrases = EditorState.phrases.of({
  'Go to line': 'Ir para a linha',
  go: 'ir',
  Find: 'Localizar',
  Replace: 'Substituir',
  next: 'próximo',
  previous: 'anterior',
  all: 'todos',
  'match case': 'diferenciar maiúsculas',
  'by word': 'palavra inteira',
  regexp: 'expressão regular',
  replace: 'substituir',
  'replace all': 'substituir todos',
  close: 'fechar',
  'current match': 'ocorrência atual',
  'replaced $ matches': '$ ocorrências substituídas',
  'replaced match on line $': 'ocorrência substituída na linha $',
  'on line': 'na linha',
})

/** Estilo por linha: blocos de código, citações e linhas horizontais. */
const markdownLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = this.build(update.view)
      }
    }
    build(view: EditorView): DecorationSet {
      const lineClasses = new Map<number, Set<string>>()
      const add = (pos: number, cls: string) => {
        if (!lineClasses.has(pos)) lineClasses.set(pos, new Set())
        lineClasses.get(pos)!.add(cls)
      }
      const { doc } = view.state
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (node.name !== 'FencedCode' && node.name !== 'Blockquote' && node.name !== 'HorizontalRule') return
            const first = doc.lineAt(node.from).number
            const last = doc.lineAt(node.to).number
            // Cerca ainda sem fechamento (enquanto você digita ```): não pinta o resto da nota como código
            if (node.name === 'FencedCode' && (node.node.getChildren('CodeMark').length < 2 || first === last)) return false
            const info = node.name === 'FencedCode' ? node.node.getChild('CodeInfo') : null
            const textBlock = !!info && isTextBlockInfo(view.state.sliceDoc(info.from, info.to))
            for (let n = first; n <= last; n++) {
              const pos = doc.line(n).from
              if (node.name === 'FencedCode') {
                add(pos, 'cm-md-codeblock')
                if (textBlock) add(pos, 'cm-md-textblock')
                if (n === first) add(pos, 'cm-md-codeblock-first')
                if (n === last) add(pos, 'cm-md-codeblock-last')
              } else if (node.name === 'Blockquote') {
                add(pos, 'cm-md-quote')
              } else {
                add(pos, 'cm-md-hr')
              }
            }
            return node.name === 'Blockquote' ? undefined : false
          },
        })
      }
      const builder = new RangeSetBuilder<Decoration>()
      for (const pos of [...lineClasses.keys()].sort((a, b) => a - b)) {
        builder.add(pos, pos, Decoration.line({ class: [...lineClasses.get(pos)!].join(' ') }))
      }
      return builder.finish()
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** Mostra o cursor de "mãozinha" nos links enquanto Ctrl/⌘ está pressionado. */
const modKeyTracker = ViewPlugin.fromClass(
  class {
    private readonly onKey: (event: KeyboardEvent) => void
    private readonly onBlur: () => void
    constructor(readonly view: EditorView) {
      this.onKey = (event) => view.dom.classList.toggle('cm-mod-held', event.ctrlKey || event.metaKey)
      this.onBlur = () => view.dom.classList.remove('cm-mod-held')
      window.addEventListener('keydown', this.onKey)
      window.addEventListener('keyup', this.onKey)
      window.addEventListener('blur', this.onBlur)
    }
    destroy() {
      window.removeEventListener('keydown', this.onKey)
      window.removeEventListener('keyup', this.onKey)
      window.removeEventListener('blur', this.onBlur)
    }
  },
)

/** Ctrl+clique em um endereço (https://…) abre no navegador padrão. */
function urlClicks(openUrl?: (url: string) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!openUrl || !(event.ctrlKey || event.metaKey) || event.button !== 0) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false
      for (let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
        const urlNode = node.name === 'URL' ? node : node.name === 'Link' || node.name === 'Autolink' ? node.getChild('URL') : null
        if (!urlNode) continue
        let url = view.state.sliceDoc(urlNode.from, urlNode.to).replace(/^<|>$/g, '')
        if (/^www\./i.test(url)) url = `https://${url}`
        if (!/^(https?:|mailto:)/i.test(url)) return false
        event.preventDefault()
        openUrl(url)
        return true
      }
      return false
    },
  })
}

/** Texto mostrado na nota vazia (com cara de título quando a primeira linha é o título). */
function placeholderFor(options: EditorOptions): Extension {
  const text = options.placeholder ?? ''
  if (!options.host?.titleFirstLine || !text) return placeholderExtension(text)
  const element = document.createElement('span')
  element.className = 'cm-title-placeholder'
  element.textContent = text
  return placeholderExtension(element)
}

export function buildExtensions(callbacks: EditorCallbacks, options: EditorOptions): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    closeBrackets(),
    EditorView.lineWrapping,
    // Sem títulos "sublinhados" (Texto + linha "---"): "---" é sempre uma linha horizontal.
    // As cores do código seguem findLanguage (bloco de texto, ```text, fica sem linguagem)
    markdown({ base: markdownLanguage, addKeymap: true, codeLanguages: (info) => findLanguage(info), extensions: [{ remove: ['SetextHeading'] }] }),
    syntaxHighlighting(markdownHighlight),
    syntaxHighlighting(codeHighlight),
    markdownLines,
    livePreview,
    // A prévia das linhas vem antes: as teclas dela (← no começo do texto, Backspace na
    // marcação) têm a vez, e o cursor é ajustado por último
    markdownPreview,
    hiddenMarkupEditing,
    listEditing,
    codeBlockPreview,
    imagePreview,
    pasteHandling,
    options.host ? editorHost.of(options.host) : [],
    options.host?.mentions ? noteMentions : [],
    options.host?.titleFirstLine ? titleFirstLine : [],
    highlightSelectionMatches({ minSelectionLength: 2 }),
    search({ top: true }),
    // Ctrl+D: seleciona a próxima ocorrência (várias seleções, editadas juntas)
    multipleSelections,
    placeholderFor(options),
    EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'sentences', 'aria-label': 'Editor de texto' }),
    keymap.of([...formattingKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    phrases,
    editorTheme,
    modKeyTracker,
    urlClicks(callbacks.openUrl),
    contextMenuTracking,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) callbacks.onChange(update.state.doc.toString())
      if ((update.selectionSet || update.docChanged) && callbacks.onCursor) {
        const { state } = update
        const head = state.selection.main.head
        const line = state.doc.lineAt(head)
        const selected = state.selection.ranges.reduce((sum, range) => sum + (range.to - range.from), 0)
        callbacks.onCursor({ line: line.number, col: head - line.from + 1, selected })
      }
      callbacks.onUpdate?.(update)
    }),
  ]
}

// A menor alteração entre dois textos (fica em diff.ts, usada também pelos blocos de código)
export { minimalChange } from './diff'
