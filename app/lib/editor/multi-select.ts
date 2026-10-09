/**
 * Ctrl+D (⌘D no macOS): seleciona a próxima ocorrência do texto selecionado e
 * mantém as anteriores, como nos editores de código. Digitar, colar ou apagar muda
 * todas as ocorrências selecionadas juntas.
 *
 * - Com texto selecionado: procura o mesmo texto, sem diferenciar maiúsculas
 *   (como o VS Code).
 * - Sem seleção: o primeiro Ctrl+D seleciona a palavra do cursor; os próximos só
 *   pegam a mesma palavra inteira, com as mesmas maiúsculas.
 * - Chegando ao fim da nota, continua do começo; ocorrências já selecionadas e as
 *   escondidas (endereço de um link, dentro de uma menção, marcações) ficam de fora.
 *   O código dos blocos também: cada bloco é um editor à parte (block-editor.ts),
 *   com o próprio Ctrl+D.
 * - Esc volta para um cursor só.
 *
 * Fora disso nada muda: Ctrl+clique continua abrindo links (não cria cursores), só o
 * Ctrl+D cria seleções extras e as outras teclas funcionam como antes.
 *
 * `plainMultipleSelections` é o mesmo Ctrl+D para editores de texto puro (o código
 * de um bloco, a tela cheia): ali não existe nada escondido.
 */
import { syntaxTree } from '@codemirror/language'
import { SearchCursor } from '@codemirror/search'
import { Annotation, EditorSelection, EditorState, Facet, Prec, StateEffect, StateField, type Extension, type SelectionRange } from '@codemirror/state'
import { EditorView, keymap, type Command } from '@codemirror/view'
import { hiddenElements, markupRanges } from './elements'
import { lineMarkerAt } from './line-markers'
import { isMentionUrl } from './mentions'

/** Seleção feita pelo Ctrl+D (a única forma de ganhar mais seleções). */
const fromCtrlD = Annotation.define<boolean>()

/**
 * Outros comandos do editor que criariam mais cursores (Ctrl+Shift+L, Ctrl+Alt+↑…)
 * continuam como antes de existir o Ctrl+D: só a seleção principal fica.
 */
const onlyCtrlDAddsRanges = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.annotation(fromCtrlD)) return tr
  if (tr.selection.ranges.length <= Math.max(1, tr.startState.selection.ranges.length)) return tr
  return [tr, { selection: EditorSelection.create([tr.selection.main]), sequential: true }]
})

/** A seleção começou pela palavra do cursor (Ctrl+D sem seleção): só palavras inteiras, maiúsculas iguais. */
const setWordMode = StateEffect.define<boolean>()

const wordModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setWordMode)) return effect.value
    // Qualquer outra mudança na seleção (clique, setas, digitar…) encerra o modo
    return tr.selection || tr.docChanged ? false : value
  },
})

const lower = (text: string) => text.toLowerCase()

/** Texto puro (sem nada escondido): toda ocorrência pode ser selecionada. */
const plainText = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) })

type Span = { from: number; to: number }

/** Pedaços atômicos do editor na tela (marcações, menções, imagens, cartões de código…). */
function atomicRanges(view: EditorView): Span[] {
  const result: Span[] = []
  for (const source of view.state.facet(EditorView.atomicRanges)) {
    const set = source(view)
    for (let iter = set.iter(); iter.value; iter.next()) result.push({ from: iter.from, to: iter.to })
  }
  return result
}

/**
 * O que fica escondido nas linhas de [from, to], lido do próprio texto (vale também
 * fora da parte visível da nota): marcações e endereços dos links, marcador da
 * linha (#, -, 1.), menções e imagens.
 */
function hiddenRanges(state: EditorState, from: number, to: number): Span[] {
  const result: Span[] = markupRanges(hiddenElements(state, from, to)).map(([a, b]) => ({ from: a, to: b }))
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(to)
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n)
    const marker = lineMarkerAt(state, line)
    if (marker && marker.to > line.from) result.push({ from: line.from, to: marker.to })
  }
  syntaxTree(state).iterate({
    from: first.from,
    to: last.to,
    enter: (node) => {
      if (node.name === 'Image') {
        result.push({ from: node.from, to: node.to })
        return false
      }
      if (node.name !== 'Link') return
      const url = node.node.getChild('URL')
      if (url && isMentionUrl(state, state.sliceDoc(url.from, url.to))) {
        result.push({ from: node.from, to: node.to })
        return false
      }
    },
  })
  return result
}

/**
 * A ocorrência pode ser selecionada? Não pode começar ou terminar dentro de algo
 * escondido (o endereço de um link, o título de uma menção…); algo escondido
 * inteiro dentro dela, pode. Dentro de um bloco de código, não: o bloco é um cartão
 * atômico na nota (o código dele é editado no editor do próprio bloco).
 */
function isSelectable(state: EditorState, from: number, to: number, atoms: Span[]): boolean {
  const cuts = (span: Span) => span.from < to && span.to > from && !(from <= span.from && span.to <= to)
  return !atoms.some(cuts) && !hiddenRanges(state, from, to).some(cuts)
}

function findNext(view: EditorView, query: string, wordMode: boolean): { from: number; to: number } | null {
  const { state } = view
  const { ranges, main } = state.selection
  const normalize = wordMode ? undefined : lower
  const taken = (from: number, to: number) => ranges.some((range) => range.from < to && range.to > from)
  const plain = state.facet(plainText)
  const atoms = plain ? [] : atomicRanges(view)
  // Depois da última ocorrência escolhida até o fim; depois, do começo da nota
  for (const cursor of [new SearchCursor(state.doc, query, main.to, state.doc.length, normalize), new SearchCursor(state.doc, query, 0, main.to, normalize)]) {
    for (cursor.next(); !cursor.done; cursor.next()) {
      const { from, to } = cursor.value
      if (taken(from, to)) continue
      if (wordMode) {
        const word = state.wordAt(from)
        if (!word || word.from !== from || word.to !== to) continue
      }
      if (!plain && !isSelectable(state, from, to, atoms)) continue
      return { from, to }
    }
  }
  return null
}

/** Ctrl+D: seleciona a palavra do cursor ou acrescenta a próxima ocorrência à seleção. */
export const selectNextOccurrence: Command = (view) => {
  const { state } = view
  const { ranges, main } = state.selection
  if (main.empty) {
    if (ranges.length > 1) return true
    const word = state.wordAt(main.head)
    if (word) {
      view.dispatch({
        selection: EditorSelection.single(word.from, word.to),
        effects: setWordMode.of(true),
        annotations: fromCtrlD.of(true),
        userEvent: 'select',
        scrollIntoView: true,
      })
    }
    return true
  }
  if (ranges.some((range) => range.empty)) return true
  const query = state.sliceDoc(main.from, main.to)
  const wordMode = state.field(wordModeField, false) ?? false
  const same = (range: SelectionRange) => {
    const text = state.sliceDoc(range.from, range.to)
    return wordMode ? text === query : lower(text) === lower(query)
  }
  if (!ranges.every(same)) return true
  const next = findNext(view, query, wordMode)
  if (!next) return true
  view.dispatch({
    // A ocorrência nova vira a principal (a próxima busca continua depois dela)
    selection: state.selection.addRange(EditorSelection.range(next.from, next.to), true),
    effects: [setWordMode.of(wordMode), EditorView.scrollIntoView(next.to, { y: 'nearest' })],
    annotations: fromCtrlD.of(true),
    userEvent: 'select',
  })
  return true
}

export const multipleSelections: Extension = [
  // Várias seleções ao mesmo tempo (só criadas pelo Ctrl+D)
  EditorState.allowMultipleSelections.of(true),
  // Ctrl+clique continua sendo "abrir link", não "criar mais um cursor"
  EditorView.clickAddsSelectionRange.of(() => false),
  wordModeField,
  onlyCtrlDAddsRanges,
  Prec.high(keymap.of([{ key: 'Mod-d', run: selectNextOccurrence, preventDefault: true }])),
]

/** O mesmo Ctrl+D para o código de um bloco e a tela cheia (texto puro). */
export const plainMultipleSelections: Extension = [multipleSelections, plainText.of(true)]
