/**
 * Quebra de linhas da tela cheia dos blocos (1.6.4).
 *
 * Só muda como as linhas aparecem: o texto do bloco não ganha nenhuma quebra de verdade
 * (o que se copia ou se salva é o mesmo). Ligada, uma linha longa continua embaixo, na
 * largura da janela, em vez de passar da borda e pedir rolagem para o lado.
 *
 * No código, a continuação de uma linha quebrada começa no recuo dela (como no VS Code),
 * para a estrutura do código continuar legível:
 *
 *       if (pronto) {
 *         executar(primeiroArgumento, segundoArgumento,
 *         terceiroArgumento)                     ← continuação no recuo da linha
 *
 * Isso é feito com um recuo à esquerda do tamanho do recuo da linha (em ch, a largura de
 * um caractere da fonte monoespaçada) e um text-indent negativo do mesmo tamanho: a
 * primeira linha visual fica onde sempre esteve e as seguintes começam no recuo.
 */
import { countColumn, RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/** Recuo (em colunas) do começo de uma linha: espaços e tabs. */
export function leadingColumns(text: string, tabSize: number): number {
  const indent = /^[ \t]*/.exec(text)![0]
  // Linha só com espaços: sem recuo de continuação (não há o que alinhar)
  if (indent.length === text.length) return 0
  return countColumn(indent, tabSize)
}

/** Até onde o recuo de continuação vai (uma linha muito recuada ainda tem espaço para o texto). */
const MAX_INDENT = 40

function indentDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const tabSize = view.state.tabSize
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos)
      const columns = Math.min(MAX_INDENT, leadingColumns(line.text, tabSize))
      if (columns > 0) {
        builder.add(line.from, line.from, Decoration.line({ class: 'cm-wrapIndent', attributes: { style: `--wrap-indent: ${columns}ch` } }))
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const hangingIndent = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = indentDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = indentDecorations(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/**
 * Extensão da quebra de linhas. `code`: com o recuo de continuação (o tema da tela cheia
 * de código usa `--wrap-indent`); texto: só a quebra, como num parágrafo.
 */
export function lineWrap(enabled: boolean, code: boolean): Extension {
  if (!enabled) return []
  return code ? [EditorView.lineWrapping, hangingIndent] : EditorView.lineWrapping
}
