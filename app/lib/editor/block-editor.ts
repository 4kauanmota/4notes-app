/**
 * O editor de dentro de um bloco de código ou de texto (o cartão na nota).
 *
 * O cartão do bloco tem o próprio editor (CodeMirror), do mesmo tamanho do cartão:
 * altura máxima e rolagem interna. Clicar no código edita ali mesmo — o cartão não
 * cresce nem "abre"; só a tela cheia mostra o bloco inteiro.
 *
 * - Texto puro: as cores da linguagem, Tab, fechar parênteses (no código); a fonte do
 *   texto e linhas que quebram (no bloco de texto). Ctrl+D e o duplo clique funcionam
 *   como num editor de código, com a seleção bem visível.
 * - Uma fonte de verdade só: cada mudança vai para o texto da nota (code-blocks.ts
 *   faz a ponte), e Ctrl+Z/Ctrl+Y usam o histórico da nota. Mudanças vindas da nota
 *   (desfazer, a tela cheia, o arquivo mudado por fora) voltam para cá.
 * - ↑/← no começo e ↓/→ no fim saem do bloco para a nota; Esc também (para depois do
 *   bloco). Backspace num bloco vazio remove o bloco. Ctrl+F abre a busca da nota.
 * - Código (1.7.2): setas para recolher e expandir e guias de indentação (code-structure.ts).
 */
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches } from '@codemirror/search'
import { Annotation, Compartment, EditorSelection, EditorState, Prec, type Extension, type Transaction } from '@codemirror/state'
import { drawSelection, EditorView, keymap, type Command } from '@codemirror/view'
import { codeFoldingSupport, indentGuides } from './code-structure'
import { minimalChange } from './diff'
import { findLanguage, isTextBlockInfo } from './languages'
import { plainMultipleSelections } from './multi-select'
import { blockEditorTheme, codeHighlight } from './theme'

/** O que o editor do bloco pede para a nota (implementado em code-blocks.ts). */
export interface BlockEditorHost {
  /** O texto do bloco mudou (a transação do editor do bloco). */
  changed(tr: Transaction): void
  /** Só a seleção mudou. */
  selected(selection: EditorSelection): void
  undo(): boolean
  redo(): boolean
  /** Sair do bloco, para a nota: antes ou depois dele. */
  exit(side: 'before' | 'after'): void
  /** Backspace no começo de um bloco vazio. */
  removeEmpty(): void
  openSearch(): boolean
  /** Shift+Alt+F: formatar o código (1.7.2). */
  format?(): boolean
}

/** Mudança que veio da nota (não volta para ela). */
const fromNote = Annotation.define<boolean>()

/** Classe dos editores de bloco (a nota ignora os eventos de dentro deles). */
export const BLOCK_EDITOR_CLASS = 'cm-block-editor'

/**
 * O editor que guarda o histórico (desfazer/refazer) de `view`: para o editor de um
 * bloco, o da nota em que ele está; para os outros, ele mesmo.
 */
export function historyViewOf(view: EditorView): EditorView {
  if (!view.dom.classList.contains(BLOCK_EDITOR_CLASS)) return view
  const note = view.dom.parentElement?.closest<HTMLElement>('.cm-editor')
  return (note && EditorView.findFromDOM(note)) || view
}

/** A posição está na primeira (ou última) linha da tela do editor? */
function onEdgeLine(view: EditorView, pos: number, forward: boolean): boolean {
  const { doc } = view.state
  const line = doc.lineAt(pos)
  if (line.number !== (forward ? doc.lines : 1)) return false
  const here = view.coordsAtPos(pos)
  const edge = view.coordsAtPos(forward ? doc.length : 0)
  // Sem medida (fora da tela): vale a linha do texto
  if (!here || !edge) return true
  return Math.abs(here.top - edge.top) < 2
}

export class BlockEditor {
  readonly view: EditorView
  private readonly language = new Compartment()
  private destroyed = false

  constructor(
    parent: HTMLElement,
    public info: string,
    code: string,
    private readonly host: BlockEditorHost,
  ) {
    const text = isTextBlockInfo(info)
    this.view = new EditorView({
      parent,
      state: EditorState.create({ doc: code, extensions: this.extensions(text) }),
    })
    this.loadLanguage(info)
    // Criado antes de entrar na página: mede de novo quando já estiver nela
    requestAnimationFrame(() => {
      if (!this.destroyed) this.view.requestMeasure()
    })
  }

  private extensions(text: boolean): Extension[] {
    const single = (state: EditorState) => state.selection.ranges.length === 1 && state.selection.main.empty
    const exitAt = (side: 'before' | 'after'): Command => (view) => {
      const { state } = view
      if (!single(state) || state.selection.main.head !== (side === 'before' ? 0 : state.doc.length)) return false
      this.host.exit(side)
      return true
    }
    const exitVertical = (forward: boolean): Command => (view) => {
      const { state } = view
      if (!single(state) || !onEdgeLine(view, state.selection.main.head, forward)) return false
      this.host.exit(forward ? 'after' : 'before')
      return true
    }
    const keys = Prec.highest(
      keymap.of([
        { key: 'ArrowUp', run: exitVertical(false) },
        { key: 'ArrowDown', run: exitVertical(true) },
        { key: 'ArrowLeft', run: exitAt('before') },
        { key: 'ArrowRight', run: exitAt('after') },
        {
          // Esc: primeiro desfaz as várias seleções (o padrão do editor); depois sai do bloco
          key: 'Escape',
          run: (view) => {
            if (!single(view.state)) return false
            this.host.exit('after')
            return true
          },
        },
        {
          key: 'Backspace',
          run: (view) => {
            const { state } = view
            if (!single(state) || state.selection.main.head !== 0 || state.doc.toString().trim()) return false
            this.host.removeEmpty()
            return true
          },
        },
        // O histórico é o da nota (uma fonte de verdade só)
        { key: 'Mod-z', run: () => this.host.undo(), preventDefault: true },
        { key: 'Mod-y', run: () => this.host.redo(), preventDefault: true },
        { key: 'Mod-Shift-z', run: () => this.host.redo(), preventDefault: true },
        { key: 'Mod-f', run: () => this.host.openSearch(), preventDefault: true },
        { key: 'Shift-Alt-f', run: () => this.host.format?.() ?? false, preventDefault: true },
      ]),
    )
    const sync = EditorView.updateListener.of((update) => {
      for (const tr of update.transactions) {
        if (tr.annotation(fromNote)) continue
        if (tr.docChanged) this.host.changed(tr)
        else if (tr.selection) this.host.selected(tr.state.selection)
      }
    })
    const common: Extension[] = [
      keys,
      drawSelection(),
      plainMultipleSelections,
      highlightSelectionMatches(),
      blockEditorTheme,
      EditorView.editorAttributes.of({ class: text ? `${BLOCK_EDITOR_CLASS} cm-block-text` : BLOCK_EDITOR_CLASS }),
      sync,
    ]
    if (text) {
      return [
        ...common,
        keymap.of([...defaultKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Bloco de texto', spellcheck: 'true' }),
      ]
    }
    return [
      ...common,
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, indentWithTab]),
      this.language.of([]),
      syntaxHighlighting(codeHighlight),
      // 1.7.2: setas para recolher/expandir e guias de indentação
      codeFoldingSupport(),
      indentGuides(),
      EditorView.contentAttributes.of({ 'aria-label': 'Código', spellcheck: 'false' }),
    ]
  }

  /** Cores da linguagem (carregada só quando aparece numa nota). */
  private loadLanguage(info: string): void {
    if (isTextBlockInfo(info)) return
    const description = findLanguage(info)
    if (!description) {
      this.view.dispatch({ effects: this.language.reconfigure([]), annotations: fromNote.of(true) })
      return
    }
    if (description.support) {
      this.view.dispatch({ effects: this.language.reconfigure(description.support), annotations: fromNote.of(true) })
      return
    }
    void description.load().then((support) => {
      if (!this.destroyed && this.info === info) this.view.dispatch({ effects: this.language.reconfigure(support), annotations: fromNote.of(true) })
    })
  }

  /** O código mudou na nota (desfazer, tela cheia, arquivo mudado por fora). */
  setCode(code: string): void {
    const current = this.view.state.doc.toString()
    if (current === code) return
    this.view.dispatch({ changes: minimalChange(current, code), annotations: fromNote.of(true) })
  }

  /** A linguagem mudou (menu do cabeçalho). */
  setInfo(info: string): void {
    if (info === this.info) return
    this.info = info
    this.loadLanguage(info)
  }

  /** Mostra uma seleção da nota dentro do bloco (desfazer, busca, setas…). */
  select(ranges: { anchor: number; head: number }[], mainIndex: number, focus: boolean): void {
    if (!ranges.length) return
    const length = this.view.state.doc.length
    const clamp = (pos: number) => Math.max(0, Math.min(length, pos))
    const selection = EditorSelection.create(
      ranges.map((range) => EditorSelection.range(clamp(range.anchor), clamp(range.head))),
      Math.max(0, Math.min(ranges.length - 1, mainIndex)),
    )
    this.view.dispatch({ selection, scrollIntoView: true, annotations: fromNote.of(true) })
    if (focus) this.view.focus()
  }

  destroy(): void {
    this.destroyed = true
    this.view.destroy()
  }
}
