/**
 * Imagens nas notas: ![](../attachments/imagem-20261002-141503.png)
 *
 * - As imagens ficam em <workspace>/attachments/ (ver paste.ts) e o caminho na nota
 *   é relativo à pasta da nota, então o .md também funciona em outros editores.
 * - No editor aparece só a imagem — o texto Markdown dela nunca aparece. Clicar na
 *   imagem a seleciona (Backspace/Delete tira da nota, Ctrl+C copia); o que for
 *   digitado logo antes ou depois de uma imagem sozinha na linha vai para uma linha própria.
 * - O botão Remover tira a imagem da nota e apaga o arquivo (vai para a Lixeira),
 *   a menos que outra nota use a mesma imagem. Desfazer (no aviso ou Ctrl+Z) devolve tudo.
 */
import { undo } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { iconSvg } from '../icons'
import { resolveFromNote } from '../files/workspace-path'
import { editorHost } from './host'
import { singleInsertion } from './markdown-preview'

interface ImageRef {
  from: number
  to: number
  src: string
  alt: string
  lineFrom: number
  lineTo: number
  /** A imagem é a única coisa na linha. */
  alone: boolean
}

const SKIP = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'])

function findImages(state: EditorState): ImageRef[] {
  const images: ImageRef[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (SKIP.has(node.name)) return false
      if (node.name !== 'Image') return
      const url = node.node.getChild('URL')
      const marks = node.node.getChildren('LinkMark')
      if (!url || marks.length < 2) return false
      const line = state.doc.lineAt(node.from)
      images.push({
        from: node.from,
        to: node.to,
        src: state.sliceDoc(url.from, url.to),
        alt: state.sliceDoc(marks[0]!.to, marks[1]!.from),
        lineFrom: line.from,
        lineTo: line.to,
        alone: line.text.trim() === state.sliceDoc(node.from, node.to),
      })
      return false
    },
  })
  return images
}

function safeDecode(text: string): string {
  try {
    return decodeURI(text)
  } catch {
    return text
  }
}

/** Imagens apagadas pelo botão Remover nesta sessão: se o texto delas voltar (Ctrl+Z), o arquivo volta junto. */
const removedPaths = new Set<string>()

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    /** Caminho da imagem no workspace (null = endereço externo ou inválido). */
    readonly path: string | null,
    readonly url: string | null,
    readonly alt: string,
    /** A imagem está selecionada (contorno em volta). */
    readonly selected: boolean,
  ) {
    super()
  }
  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.url === this.url && other.alt === this.alt && other.selected === this.selected
  }
  /** Só a seleção mudou: atualiza o contorno sem recarregar a imagem. */
  override updateDOM(dom: HTMLElement, _view: EditorView, from: WidgetType): boolean {
    if (!(from instanceof ImageWidget) || from.src !== this.src || from.url !== this.url || from.alt !== this.alt) return false
    dom.classList.toggle('selected', this.selected)
    return true
  }
  toDOM(view: EditorView): HTMLElement {
    // Espaçamento por padding no elemento de fora (margens atrapalham a medição do editor)
    const wrap = document.createElement('div')
    wrap.className = this.selected ? 'cm-image selected' : 'cm-image'
    wrap.dataset.src = this.src
    const frame = document.createElement('div')
    frame.className = 'cm-image-frame'
    wrap.append(frame)
    const broken = () => {
      frame.classList.add('broken')
      frame.textContent = `Imagem não encontrada: ${safeDecode(this.src)}`
    }
    if (!this.url) {
      broken()
      return wrap
    }
    const img = document.createElement('img')
    img.src = this.url
    img.alt = this.alt
    img.draggable = false
    // Imagem apagada nesta sessão voltou para o texto (Desfazer): devolve o arquivo
    const { path, url } = this
    const host = view.state.facet(editorHost)
    const restore = () => {
      if (!host || !path) return broken()
      void host.restoreImage(path).then((restored) => {
        if (!restored) return broken()
        removedPaths.delete(path)
        img.addEventListener('error', broken, { once: true })
        img.src = `${url}?v=${Date.now()}`
      })
    }
    if (path && removedPaths.has(path)) restore()
    else img.addEventListener('error', restore, { once: true })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'cm-image-remove'
    remove.dataset.action = 'remove-image'
    remove.dataset.tip = 'Remover imagem'
    remove.setAttribute('aria-label', 'Remover imagem')
    remove.innerHTML = iconSvg('trash', 15)
    frame.append(img, remove)
    return wrap
  }
  override get estimatedHeight(): number {
    return 240
  }
  override ignoreEvent(): boolean {
    return false
  }
}

/** Caminho da imagem no workspace (null = endereço externo ou caminho fora do workspace). */
function imagePath(state: EditorState, src: string): string | null {
  const host = state.facet(editorHost)
  return host ? resolveFromNote(host.assetBase(), src) : null
}

const hidden = Decoration.replace({})

function buildDecorations(state: EditorState): { decorations: DecorationSet; atoms: DecorationSet } {
  const ranges: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  const host = state.facet(editorHost)
  for (const image of findImages(state)) {
    const path = imagePath(state, image.src)
    const selected = state.selection.ranges.some((range) => !range.empty && range.from <= image.from && range.to >= image.to)
    const widget = new ImageWidget(image.src, path, host && path ? host.imageUrl(path) : null, image.alt, selected)
    if (image.alone) {
      ranges.push(Decoration.replace({ widget, block: true }).range(image.lineFrom, image.lineTo))
      atoms.push(hidden.range(image.lineFrom, image.lineTo))
      continue
    }
    // Imagem no meio do texto: o Markdown dela some e a imagem aparece logo abaixo da linha
    ranges.push(hidden.range(image.from, image.to))
    atoms.push(hidden.range(image.from, image.to))
    ranges.push(Decoration.widget({ widget, block: true, side: 1 }).range(image.lineTo))
  }
  return { decorations: Decoration.set(ranges, true), atoms: Decoration.set(atoms, true) }
}

const imageField = StateField.define<{ decorations: DecorationSet; atoms: DecorationSet }>({
  create: (state) => buildDecorations(state),
  update(value, tr) {
    const changed = tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)
    return changed ? buildDecorations(tr.state) : value
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atoms),
  ],
})

/** Texto digitado encostado numa imagem sozinha na linha vai para uma linha própria (antes ou depois dela). */
const textBesideImage = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.isUserEvent('input.type.compose') || !(tr.isUserEvent('input.type') || tr.isUserEvent('input.paste'))) return tr
  const insertion = singleInsertion(tr)
  if (!insertion) return tr
  const line = tr.startState.doc.lineAt(insertion.pos)
  if (insertion.pos !== line.from && insertion.pos !== line.to) return tr
  const image = findImages(tr.startState).find((item) => item.lineFrom === line.from && item.alone)
  if (!image) return tr
  const atEnd = insertion.pos === line.to
  const insert = atEnd ? `\n${insertion.text}` : `${insertion.text}\n`
  return {
    changes: { from: insertion.pos, insert },
    selection: EditorSelection.cursor(insertion.pos + (atEnd ? insert.length : insertion.text.length)),
    userEvent: 'input.type',
    scrollIntoView: true,
  }
})

/** Imagem do widget (pela linha em que ele está e pelo endereço). */
function imageOf(state: EditorState, pos: number, src: string | undefined): ImageRef | null {
  const line = state.doc.lineAt(pos)
  const onLine = findImages(state).filter((image) => image.lineFrom === line.from)
  return onLine.find((image) => image.src === src) ?? onLine[0] ?? null
}

const imageEvents = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement
    const widget = target.closest?.('.cm-image') as HTMLElement | null
    if (!widget || event.button !== 0) return false
    event.preventDefault()
    const image = imageOf(view.state, view.posAtDOM(widget), widget.dataset.src)
    if (!image) return true
    if (target.closest('[data-action=remove-image]')) {
      // Apaga a imagem; se a linha ficar vazia, apaga a linha também
      const line = view.state.doc.lineAt(image.from)
      const rest = (line.text.slice(0, image.from - line.from) + line.text.slice(image.to - line.from)).trim()
      const { doc } = view.state
      const changes = rest
        ? { from: image.from, to: image.to }
        : line.to < doc.length
          ? { from: line.from, to: line.to + 1 }
          : { from: Math.max(0, line.from - 1), to: line.to }
      view.dispatch({ changes, userEvent: 'delete.image' })
      // Apaga o arquivo, a não ser que a mesma imagem continue em outro lugar desta nota
      const host = view.state.facet(editorHost)
      const path = imagePath(view.state, image.src)
      const stillHere = findImages(view.state).some((other) => imagePath(view.state, other.src) === path)
      if (host && path && !stillHere) {
        removedPaths.add(path)
        host.removeImage(path, () => undo(view))
      }
      return true
    }
    // Clique na imagem: seleciona a imagem (Backspace/Delete tira da nota, Ctrl+C copia)
    view.dispatch({ selection: EditorSelection.range(image.alone ? image.lineTo : image.to, image.alone ? image.lineFrom : image.from), userEvent: 'select' })
    view.focus()
    return true
  },
})

export const imagePreview: Extension = [imageField, textBesideImage, imageEvents]
