/**
 * Imagens nas notas: ![](../attachments/imagem-20261002-141503.png)
 *
 * - As imagens ficam em <workspace>/attachments/ (ver paste.ts) e o caminho na nota
 *   é relativo à pasta da nota, então o .md também funciona em outros editores.
 * - Fora da edição, a linha da imagem mostra a própria imagem; com o cursor na
 *   linha, aparece o texto Markdown (e a imagem continua logo abaixo).
 * - O botão Remover tira a imagem da nota e apaga o arquivo (vai para a Lixeira),
 *   a menos que outra nota use a mesma imagem. Desfazer (no aviso ou Ctrl+Z) devolve tudo.
 */
import { undo } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { iconSvg } from '../icons'
import { focusChanged, focusTracking, isFocused } from './focus'
import { resolveFromNote } from '../files/workspace-path'
import { editorHost } from './host'

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
  ) {
    super()
  }
  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.url === this.url && other.alt === this.alt
  }
  toDOM(view: EditorView): HTMLElement {
    // Espaçamento por padding no elemento de fora (margens atrapalham a medição do editor)
    const wrap = document.createElement('div')
    wrap.className = 'cm-image'
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

function buildDecorations(state: EditorState): DecorationSet {
  const focused = isFocused(state)
  const ranges: Range<Decoration>[] = []
  const host = state.facet(editorHost)
  for (const image of findImages(state)) {
    const path = imagePath(state, image.src)
    const widget = new ImageWidget(image.src, path, host && path ? host.imageUrl(path) : null, image.alt)
    const editing = focused && state.selection.ranges.some((range) => range.from <= image.lineTo && range.to >= image.lineFrom)
    if (image.alone && !editing) {
      ranges.push(Decoration.replace({ widget, block: true }).range(image.lineFrom, image.lineTo))
      continue
    }
    if (!editing) ranges.push(Decoration.replace({}).range(image.from, image.to))
    ranges.push(Decoration.widget({ widget, block: true, side: 1 }).range(image.lineTo))
  }
  return Decoration.set(ranges, true)
}

const imageField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update(decorations, tr) {
    const changed = tr.docChanged || tr.selection || focusChanged(tr.effects) || syntaxTree(tr.state) !== syntaxTree(tr.startState)
    return changed ? buildDecorations(tr.state) : decorations
  },
  provide: (field) => EditorView.decorations.from(field),
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
    // Clique na imagem: seleciona o texto dela (mostra o Markdown)
    view.dispatch({ selection: { anchor: image.to, head: image.from }, userEvent: 'select.pointer' })
    view.focus()
    return true
  },
})

export const imagePreview: Extension = [focusTracking, imageField, imageEvents]
