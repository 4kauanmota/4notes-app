/**
 * Bloco de texto: o trecho selecionado vira um bloco ```text (botão da barra de
 * formatação). É sempre manual — nada vira bloco de texto sozinho (colar continua
 * criando bloco só para código reconhecido, ver paste.ts).
 *
 * - O bloco guarda o texto como ele aparece na tela, sem nenhum tratamento: sem
 *   linguagem, sem cores, sem mexer na indentação. A formatação escondida (negrito,
 *   links…) não existe dentro de um bloco, então fica só o texto visível — as mesmas
 *   regras do "Exportar TXT" (listas com •, 1., ☐/☑).
 * - Um bloco ocupa linhas inteiras: o texto antes e depois da seleção (na mesma
 *   linha) continua onde estava, em linhas próprias, com a formatação fechada antes
 *   do bloco e reaberta depois dele.
 * - Uma seleção de várias linhas que começa no início do texto de uma linha leva a
 *   linha inteira (com o marcador da lista, se houver).
 * - O cartão (copiar, tela cheia, remover, altura máxima) é o dos blocos de código
 *   (code-blocks.ts).
 */
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type Line, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { noteToPlainText } from '../notes/export'
import { codeBlocks } from './code-blocks'
import { findElements, hasContent, hasHiddenMarkup, type FormatElement } from './elements'
import { balancedSlice } from './hidden-markup'
import { editorHost } from './host'
import { TEXT_BLOCK_INFO } from './languages'
import { lineMarkerAt } from './line-markers'

const isBlank = (char: string) => char === ' ' || char === '\t'

/** Cerca que não fecha antes da hora: mais crases do que qualquer cerca dentro do texto. */
function fenceFor(content: string): string {
  let longest = 0
  for (const match of content.matchAll(/^ {0,3}(`{3,})/gm)) longest = Math.max(longest, match[1]!.length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** Elementos com marcação escondida da linha. */
const lineElements = (state: EditorState, line: Line): FormatElement[] => findElements(state, line.from, line.to).filter(hasHiddenMarkup)

/** Onde começa o texto visível da linha (depois do marcador, dos espaços e das marcações de abertura). */
function visibleStart(state: EditorState, line: Line, elements: FormatElement[]): number {
  let pos = lineMarkerAt(state, line)?.to ?? line.from
  for (let moved = true; moved; ) {
    moved = false
    while (pos < line.to && isBlank(state.sliceDoc(pos, pos + 1))) {
      pos++
      moved = true
    }
    for (const el of elements) {
      if (el.from === pos && hasContent(el)) {
        pos = el.openTo
        moved = true
      }
    }
  }
  return pos
}

/** Onde termina o texto visível da linha (antes dos espaços e das marcações de fechamento). */
function visibleEnd(state: EditorState, line: Line, elements: FormatElement[]): number {
  let pos = line.to
  for (let moved = true; moved; ) {
    moved = false
    while (pos > line.from && isBlank(state.sliceDoc(pos - 1, pos))) {
      pos--
      moved = true
    }
    for (const el of elements) {
      if (el.to === pos && hasContent(el)) {
        pos = el.closeFrom
        moved = true
      }
    }
  }
  return pos
}

/**
 * Tira a posição de dentro de uma marcação: no começo do que sai, a marcação de
 * abertura sai junto e a de fechamento fica; no fim, o contrário.
 */
function outsideMarkup(pos: number, elements: FormatElement[], side: 'start' | 'end'): number {
  for (let moved = true; moved; ) {
    moved = false
    for (const el of elements) {
      let next = pos
      if (side === 'start') {
        if (el.from < pos && pos <= el.openTo) next = el.from
        else if (el.closeFrom <= pos && pos < el.to) next = el.to
      } else {
        if (el.closeFrom <= pos && pos < el.to) next = el.to
        else if (el.from < pos && pos <= el.openTo) next = el.from
      }
      if (next !== pos) {
        pos = next
        moved = true
      }
    }
  }
  return pos
}

/** O trecho selecionado não é (só) parte de um bloco de código ou de texto? */
export function canWrapInTextBlock(state: EditorState): boolean {
  const { main } = state.selection
  if (main.empty) return false
  return !codeBlocks(state).some((block) => main.from >= block.from && main.to <= block.to && !(main.from === block.from && main.to === block.to))
}

/**
 * A mudança que transforma a seleção principal num bloco de texto (null = não dá:
 * nada selecionado, seleção dentro de um bloco, ou sem texto).
 * `noteDir` é a pasta da nota (as menções viram o título, como na tela).
 */
export function textBlockChange(state: EditorState, noteDir: string): TransactionSpec | null {
  if (!canWrapInTextBlock(state)) return null
  const { doc } = state
  let { from: a, to: b } = state.selection.main
  ensureSyntaxTree(state, Math.min(doc.length, doc.lineAt(b).to + 1), 500)

  // Blocos de código cortados pela seleção entram inteiros
  for (const block of codeBlocks(state)) {
    if (block.to <= a || block.from >= b) continue
    a = Math.min(a, block.from)
    b = Math.max(b, block.to)
  }
  // Linha inteira selecionada (até o começo da seguinte): a quebra de linha fica de fora
  if (b > a && doc.lineAt(b).from === b) b -= 1
  if (b <= a) return null

  const firstLine = doc.lineAt(a)
  const lastLine = doc.lineAt(b)
  const firstElements = lineElements(state, firstLine)
  const lastElements = lastLine.number === firstLine.number ? firstElements : lineElements(state, lastLine)
  const multiline = lastLine.number > firstLine.number
  // Várias linhas desde o começo do texto: a primeira entra inteira (com o marcador da lista)
  if (multiline && a <= visibleStart(state, firstLine, firstElements)) a = firstLine.from

  const content = noteToPlainText(balancedSlice(state, a, b), noteDir).replace(/\n$/, '')
  if (!content.trim()) return null

  // ── O que fica antes e depois do bloco, nas mesmas linhas ──
  let start = outsideMarkup(a, firstElements, 'start')
  const keepBefore = start > visibleStart(state, firstLine, firstElements)
  if (!keepBefore) start = firstLine.from
  else {
    // Os espaços entre o texto de antes e o bloco saem (o texto acaba na linha de cima)
    for (let previous = -1; previous !== start; ) {
      previous = start
      while (start > firstLine.from && isBlank(state.sliceDoc(start - 1, start))) start--
      start = outsideMarkup(start, firstElements, 'start')
    }
  }
  let end = outsideMarkup(b, lastElements, 'end')
  const keepAfter = end < visibleEnd(state, lastLine, lastElements)
  if (!keepAfter) end = lastLine.to
  else {
    for (let previous = -1; previous !== end; ) {
      previous = end
      while (end < lastLine.to && isBlank(state.sliceDoc(end, end + 1))) end++
      end = outsideMarkup(end, lastElements, 'end')
    }
  }

  // Formatos cortados pelo bloco: fecham antes dele e reabrem depois
  const crossing = (elements: FormatElement[], pos: number) => elements.filter((el) => el.openTo < pos && pos < el.closeFrom)
  const closers = keepBefore
    ? crossing(firstElements, start)
        .reverse()
        .map((el) => state.sliceDoc(el.closeFrom, el.to))
        .join('')
    : ''
  const openers = keepAfter ? crossing(lastElements, end).map((el) => state.sliceDoc(el.from, el.openTo)).join('') : ''
  // Só uma parte da linha de um item de lista (ou título) virou bloco: o resto continua sendo o item
  const marker = !keepBefore && !multiline && keepAfter ? lineMarkerAt(state, firstLine) : null
  const markerText = marker ? state.sliceDoc(firstLine.from, marker.to) : ''

  const fence = fenceFor(content)
  const block = `${fence}${TEXT_BLOCK_INFO}\n${content}\n${fence}`
  const head = keepBefore ? `${closers}\n` : ''
  const atDocEnd = end === doc.length
  const tail = keepAfter ? `\n${markerText}${openers}` : atDocEnd ? '\n' : ''
  const afterBlock = start + head.length + block.length + 1
  return {
    changes: { from: start, to: end, insert: head + block + tail },
    // O cursor fica logo depois do bloco (no texto que sobrou da linha ou na linha seguinte)
    selection: EditorSelection.cursor(afterBlock + markerText.length),
    userEvent: 'input.format',
    scrollIntoView: true,
  }
}

/** Botão "Bloco de texto" da barra de formatação. */
export function wrapInTextBlock(view: EditorView): boolean {
  const host = view.state.facet(editorHost)
  const spec = textBlockChange(view.state, host?.assetBase() ?? 'notes')
  if (!spec) return false
  view.dispatch(spec)
  return true
}
