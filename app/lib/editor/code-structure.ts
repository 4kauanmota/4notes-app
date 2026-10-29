/**
 * Estrutura do código nos blocos (1.7.2): recolher/expandir e guias de indentação, no
 * editor do cartão do bloco (block-editor.ts) e na tela cheia (CodeFullscreen.vue).
 *
 * Recolher e expandir
 * - Setas na margem esquerda, como nos editores de código: ▾ aberto, ▸ recolhido.
 *   Recolher só esconde as linhas na tela; o texto da nota (o arquivo) não muda.
 * - O que dá para recolher vem da linguagem (objetos e listas do JSON, funções, classes,
 *   blocos `{}` do JavaScript/TypeScript, CSS…). Linguagens sem essa informação (GDScript,
 *   Python antigo, YAML, texto colado sem linguagem) recolhem pela indentação: uma linha
 *   seguida de linhas mais recuadas.
 * - Atalhos (os do CodeMirror): Ctrl+Shift+[ recolhe, Ctrl+Shift+] expande; Ctrl+Alt+[ e
 *   Ctrl+Alt+] fazem o mesmo com tudo.
 *
 * Guias de indentação
 * - Uma linha vertical discreta em cada nível de recuo, do começo ao fim do trecho (linhas
 *   vazias no meio continuam a guia). O tamanho do nível é descoberto pelo próprio código
 *   (2, 4, 3 ou 8 espaços; tabs contam como 4).
 */
import { codeFolding, foldGutter, foldKeymap, foldNodeProp, foldService, syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { iconSvg } from '../icons'

const TAB_SIZE = 4

/** Largura (em colunas) do recuo do começo da linha; null = linha vazia. */
export function indentWidth(text: string, tabSize = TAB_SIZE): number | null {
  let width = 0
  for (const char of text) {
    if (char === ' ') width++
    else if (char === '\t') width += tabSize - (width % tabSize)
    else return width
  }
  return null
}

/**
 * O tamanho de um nível de recuo: o que divide quase todos os recuos (85%), preferindo os
 * maiores (4 antes de 2). Sem recuos: 4.
 */
export function detectIndentUnit(lines: Iterable<string>, tabSize = TAB_SIZE): number {
  const widths: number[] = []
  for (const line of lines) {
    const width = indentWidth(line, tabSize)
    if (width) widths.push(width)
    if (widths.length >= 2000) break
  }
  if (!widths.length) return 4
  for (const unit of [4, 2, 3, 8]) {
    const fits = widths.filter((width) => width % unit === 0).length
    if (fits / widths.length >= 0.85) return unit
  }
  return Math.max(1, Math.min(...widths))
}

/** Recolher pela indentação: a linha e as seguintes mais recuadas (sem as linhas vazias do fim). */
export function indentFoldRange(state: EditorState, lineStart: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart)
  const base = indentWidth(line.text)
  if (base === null) return null
  let last = line.number
  for (let number = line.number + 1; number <= state.doc.lines; number++) {
    const width = indentWidth(state.doc.line(number).text)
    if (width === null) continue
    if (width <= base) break
    last = number
  }
  if (last === line.number) return null
  return { from: line.to, to: state.doc.line(last).to }
}

/**
 * O que a linguagem diz que dá para recolher a partir desta linha (a mesma regra do
 * CodeMirror para a árvore de sintaxe), ou null.
 */
function syntaxFoldRange(state: EditorState, start: number, end: number): { from: number; to: number } | null {
  const tree = syntaxTree(state)
  let found: { from: number; to: number } | null = null
  for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(end, 1); node; node = node.parent) {
    if (node.to <= end || node.from > end) continue
    if (found && node.from < start) break
    const prop = node.type.prop(foldNodeProp)
    if (prop) {
      const value = prop(node, state)
      if (value && value.from <= end && value.from >= start && value.to > end) found = value
    }
  }
  return found
}

/** A linguagem do bloco sabe recolher? (alguma regra de recolher na árvore; guardado por árvore). */
const foldsCache = new WeakMap<object, boolean>()
function languageFolds(state: EditorState): boolean {
  const tree = syntaxTree(state)
  const cached = foldsCache.get(tree)
  if (cached !== undefined) return cached
  let any = false
  tree.iterate({
    enter(node) {
      if (any) return false
      if (node.type.prop(foldNodeProp)) any = true
      return undefined
    },
  })
  foldsCache.set(tree, any)
  return any
}

/** Pela linguagem quando ela sabe; senão, pela indentação. */
const structureFold = foldService.of((state, start, end) => {
  const bySyntax = syntaxFoldRange(state, start, end)
  if (bySyntax) return bySyntax
  if (languageFolds(state)) return null
  return indentFoldRange(state, start)
})

function marker(open: boolean): HTMLElement {
  const element = document.createElement('span')
  element.className = `cm-fold-marker ${open ? 'open' : 'folded'}`
  element.title = open ? 'Recolher' : 'Expandir'
  element.innerHTML = iconSvg(open ? 'chevron-down' : 'chevron-right', 12, 2.2)
  return element
}

const foldTheme = EditorView.baseTheme({
  '.cm-foldGutter .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0', cursor: 'pointer' },
  '.cm-fold-marker': { display: 'inline-grid', placeItems: 'center', width: '14px', height: '14px', borderRadius: '4px', color: 'var(--text-3)', transition: 'opacity 120ms, background 120ms' },
  '.cm-fold-marker.open': { opacity: '0' },
  '&.cm-focused .cm-fold-marker.open, &:hover .cm-fold-marker.open': { opacity: '0.75' },
  '.cm-fold-marker:hover': { backgroundColor: 'var(--hover)', color: 'var(--text)', opacity: '1 !important' },
  '.cm-fold-marker.folded': { color: 'var(--primary-text)', opacity: '1' },
  '.cm-foldPlaceholder': {
    margin: '0 3px',
    padding: '0 6px',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    backgroundColor: 'var(--surface-2)',
    color: 'var(--text-3)',
    fontFamily: 'var(--font-ui)',
    fontSize: '0.86em',
    cursor: 'pointer',
  },
  '.cm-foldPlaceholder:hover': { color: 'var(--text)', borderColor: 'var(--border-strong)' },
})

/** Recolher e expandir (setas na margem, atalhos do CodeMirror). */
export function codeFoldingSupport(): Extension {
  return [
    structureFold,
    codeFolding({ placeholderText: '⋯' }),
    foldGutter({ markerDOM: marker }),
    keymap.of(foldKeymap),
    foldTheme,
  ]
}

// ── Guias de indentação ─────────────────────────────────────────────────────

/** Quantas guias cada linha (de `from` a `to`, números de linha) tem. Linhas vazias seguem as vizinhas. */
export function guideLevels(lineText: (number: number) => string, lineCount: number, from: number, to: number, unit: number): number[] {
  const levelOf = (number: number): number | null => {
    const width = indentWidth(lineText(number))
    return width === null ? null : Math.floor(width / unit)
  }
  const levels: number[] = []
  // A linha não vazia anterior ao trecho (para as vazias do começo)
  let previous = 0
  for (let number = from - 1, seen = 0; number >= 1 && seen < 200; number--, seen++) {
    const level = levelOf(number)
    if (level !== null) {
      previous = level
      break
    }
  }
  for (let number = from; number <= to; number++) {
    const level = levelOf(number)
    if (level !== null) {
      levels.push(level)
      previous = level
      continue
    }
    // Vazia: a guia continua se a próxima linha com texto também estiver recuada
    let next = 0
    for (let ahead = number + 1, seen = 0; ahead <= lineCount && seen < 200; ahead++, seen++) {
      const level = levelOf(ahead)
      if (level !== null) {
        next = level
        break
      }
    }
    levels.push(Math.min(previous, next))
  }
  return levels
}

const guideMarks = new Map<string, Decoration>()
function guideMark(levels: number, unit: number): Decoration {
  const key = `${levels}:${unit}`
  let mark = guideMarks.get(key)
  if (!mark) {
    mark = Decoration.line({ class: 'cm-indent-guides', attributes: { style: `--indent-guides: ${levels}; --indent-unit: ${unit}` } })
    guideMarks.set(key, mark)
  }
  return mark
}

const guidesPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    unit: number

    constructor(view: EditorView) {
      this.unit = this.measureUnit(view.state)
      this.decorations = this.build(view)
    }

    measureUnit(state: EditorState): number {
      return detectIndentUnit(state.doc.iterLines())
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.unit = this.measureUnit(update.state)
      if (update.docChanged || update.viewportChanged || update.geometryChanged) this.decorations = this.build(update.view)
    }

    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>()
      const { doc } = view.state
      for (const { from, to } of view.visibleRanges) {
        const first = doc.lineAt(from).number
        const last = doc.lineAt(to).number
        const levels = guideLevels((number) => doc.line(number).text, doc.lines, first, last, this.unit)
        levels.forEach((level, index) => {
          if (level > 0) {
            const line = doc.line(first + index)
            builder.add(line.from, line.from, guideMark(level, this.unit))
          }
        })
      }
      return builder.finish()
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const guidesTheme = EditorView.baseTheme({
  '.cm-line.cm-indent-guides': { position: 'relative' },
  '.cm-line.cm-indent-guides::before': {
    content: '""',
    position: 'absolute',
    top: '0',
    bottom: '0',
    left: 'var(--guides-left, 0px)',
    width: 'calc(var(--indent-guides) * var(--indent-unit) * 1ch)',
    backgroundImage: 'repeating-linear-gradient(to right, var(--indent-guide, rgba(127, 120, 150, 0.22)) 0 1px, transparent 1px calc(var(--indent-unit) * 1ch))',
    pointerEvents: 'none',
  },
})

/** Linhas verticais discretas em cada nível de recuo. */
export function indentGuides(): Extension {
  return [guidesPlugin, guidesTheme]
}
