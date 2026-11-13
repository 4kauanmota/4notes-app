<script setup lang="ts">
/**
 * Leitor de PDF com anotações (1.7.3), como os leitores dos navegadores.
 *
 * - As páginas são desenhadas pelo pdf.js só quando chegam perto da tela (e de novo ao
 *   mudar o zoom). Por cima de cada página há a camada de texto (selecionar e copiar) e
 *   a camada das anotações (SVG + caixas de texto).
 * - Ferramentas: Selecionar (texto do PDF; com texto selecionado, "Marcar" destaca o
 *   trecho), Caneta, Marca-texto, Texto e Borracha. Desfazer/refazer na barra ou Ctrl+Z / Ctrl+Y.
 * - As anotações ficam em documents/anotacoes/<id>.json (lib/documents/annotations.ts),
 *   gravadas a cada mudança. O PDF não muda.
 */
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { errorMessage } from '#shared/ipc'
import {
  addPoint,
  cloneAnnotations,
  HIGHLIGHT_COLORS,
  HIGHLIGHTER_WIDTHS,
  hitTest,
  newStroke,
  PEN_COLORS,
  PEN_WIDTHS,
  TEXT_SIZE,
  type Annotation,
  type Stroke,
  type TextNote,
} from '~/lib/documents/annotations'
import type { StoredDocument } from '~/lib/documents/model'
import { loadPdfJs, openPdf } from '~/lib/documents/pdf'
import { createId } from '~/lib/utils/async'
import { useDocumentsStore } from '~/stores/documents'

const props = defineProps<{ doc: StoredDocument }>()
const documents = useDocumentsStore()

type Tool = 'select' | 'pen' | 'highlighter' | 'text' | 'eraser'
const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: 'hand', label: 'Selecionar texto', key: 'V' },
  { id: 'pen', icon: 'pen', label: 'Caneta', key: 'P' },
  { id: 'highlighter', icon: 'highlighter', label: 'Marca-texto', key: 'H' },
  { id: 'text', icon: 'text-color', label: 'Texto', key: 'T' },
  { id: 'eraser', icon: 'eraser', label: 'Borracha', key: 'E' },
]

const scroller = ref<HTMLElement>()
const status = ref<'loading' | 'ready' | 'error'>('loading')
const error = ref('')
const pdf = shallowRef<PDFDocumentProxy | null>(null)
/** Tamanho de cada página no zoom 1 (pontos do PDF). */
const sizes = shallowRef<{ width: number; height: number }[]>([])
const zoom = ref<number | 'fit'>('fit')
const containerWidth = ref(800)
const currentPage = ref(1)

const tool = ref<Tool>('select')
const penColor = ref<string>(PEN_COLORS[1])
const highlightColor = ref<string>(HIGHLIGHT_COLORS[0])
const widthIndex = ref(1)
const color = computed(() => (tool.value === 'highlighter' ? highlightColor.value : penColor.value))
const colors = computed(() => (tool.value === 'highlighter' ? HIGHLIGHT_COLORS : PEN_COLORS))
const showColors = computed(() => tool.value === 'pen' || tool.value === 'highlighter' || tool.value === 'text')
const showWidths = computed(() => tool.value === 'pen' || tool.value === 'highlighter')

const items = ref<Annotation[]>([])
const undoStack: Annotation[][] = []
const redoStack: Annotation[][] = []
const history = reactive({ undo: 0, redo: 0 })

const scale = computed(() => {
  if (zoom.value !== 'fit') return zoom.value
  const widest = Math.max(...sizes.value.map((size) => size.width), 1)
  return Math.max(0.25, Math.min(3, (containerWidth.value - 32) / widest))
})
const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`)

const byPage = computed(() => {
  const map = new Map<number, Annotation[]>()
  for (const item of items.value) {
    const list = map.get(item.page) ?? []
    list.push(item)
    map.set(item.page, list)
  }
  return map
})

// ── Abrir o PDF ─────────────────────────────────────────────────────────────

let loadToken = 0
let closePdf: (() => Promise<void>) | null = null
async function load() {
  const token = ++loadToken
  status.value = 'loading'
  try {
    const [bytes, notes] = await Promise.all([documents.readBytes(props.doc), documents.loadAnnotations(props.doc.id)])
    if (token !== loadToken) return
    if (!bytes) throw new Error('O arquivo não foi encontrado na pasta do workspace.')
    const opened = await openPdf(bytes)
    const proxy = opened.pdf
    if (token !== loadToken) return void opened.close()
    const list: { width: number; height: number }[] = []
    for (let n = 1; n <= proxy.numPages; n++) {
      const page = await proxy.getPage(n)
      const viewport = page.getViewport({ scale: 1 })
      list.push({ width: viewport.width, height: viewport.height })
    }
    if (token !== loadToken) return void opened.close()
    pdf.value = proxy
    closePdf = opened.close
    sizes.value = list
    items.value = cloneAnnotations(notes)
    undoStack.length = 0
    redoStack.length = 0
    syncHistory()
    status.value = 'ready'
    await nextTick()
    observePages()
  } catch (problem) {
    if (token !== loadToken) return
    error.value = /password|senha/i.test(String(problem)) ? 'Este PDF tem senha: abra no programa do sistema.' : errorMessage(problem)
    status.value = 'error'
  }
}

// ── Desenhar as páginas (só as que estão perto da tela) ─────────────────────

interface PageView {
  canvas: HTMLCanvasElement | null
  text: HTMLElement | null
  renderedScale: number
  task: RenderTask | null
  textLayer: { cancel(): void } | null
}
const views = new Map<number, PageView>()
let observer: IntersectionObserver | null = null
const visible = new Set<number>()

function viewOf(page: number): PageView {
  let view = views.get(page)
  if (!view) {
    view = { canvas: null, text: null, renderedScale: 0, task: null, textLayer: null }
    views.set(page, view)
  }
  return view
}

function observePages() {
  observer?.disconnect()
  if (!scroller.value) return
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.page)
        if (entry.isIntersecting) {
          visible.add(page)
          void renderPage(page)
        } else visible.delete(page)
      }
      updateCurrentPage()
    },
    { root: scroller.value, rootMargin: '600px 0px' },
  )
  for (const element of scroller.value.querySelectorAll<HTMLElement>('[data-page]')) observer.observe(element)
}

async function renderPage(number: number) {
  const proxy = pdf.value
  const element = scroller.value?.querySelector<HTMLElement>(`[data-page="${number}"]`)
  if (!proxy || !element) return
  const view = viewOf(number)
  const target = scale.value
  if (view.renderedScale === target) return
  view.task?.cancel()
  view.textLayer?.cancel()
  view.renderedScale = target
  let page: PDFPageProxy
  try {
    page = await proxy.getPage(number)
  } catch {
    return
  }
  if (view.renderedScale !== target) return
  const viewport = page.getViewport({ scale: target })
  // Nitidez da tela, sem passar de ~16 milhões de pixels por página
  const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (viewport.width * viewport.height)))
  const canvas = document.createElement('canvas')
  canvas.className = 'pdf-canvas'
  canvas.width = Math.floor(viewport.width * ratio)
  canvas.height = Math.floor(viewport.height * ratio)
  const task = page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
  view.task = task
  try {
    await task.promise
  } catch {
    return // cancelado (zoom de novo, fechou)
  }
  if (view.renderedScale !== target) return
  const slot = element.querySelector('.pdf-canvas-slot')
  slot?.replaceChildren(canvas)
  view.canvas = canvas
  // Camada de texto (selecionar e copiar; "Marcar")
  const textSlot = element.querySelector<HTMLElement>('.textLayer')
  if (textSlot) {
    textSlot.replaceChildren()
    const pdfjs = await loadPdfJs()
    const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textSlot, viewport })
    view.textLayer = layer
    await layer.render().catch(() => undefined)
  }
}

watch(scale, () => {
  for (const view of views.values()) view.renderedScale = 0
  for (const page of visible) void renderPage(page)
})

function updateCurrentPage() {
  const box = scroller.value
  if (!box) return
  const middle = box.scrollTop + box.clientHeight / 3
  let page = 1
  for (const element of box.querySelectorAll<HTMLElement>('[data-page]')) {
    if (element.offsetTop <= middle) page = Number(element.dataset.page)
    else break
  }
  currentPage.value = page
}

// ── Zoom ────────────────────────────────────────────────────────────────────

const STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
function zoomBy(direction: 1 | -1) {
  const current = scale.value
  const next = direction > 0 ? (STEPS.find((step) => step > current + 0.01) ?? 3) : ([...STEPS].reverse().find((step) => step < current - 0.01) ?? 0.5)
  setZoom(next)
}

/** Muda o zoom mantendo o mesmo trecho da página no meio da tela. */
function setZoom(next: number | 'fit') {
  const box = scroller.value
  const before = scale.value
  const anchor = box ? (box.scrollTop + box.clientHeight / 2) / Math.max(1, box.scrollHeight) : 0
  zoom.value = next
  void nextTick(() => {
    if (box && before !== scale.value) box.scrollTop = anchor * box.scrollHeight - box.clientHeight / 2
  })
}

function onWheel(event: WheelEvent) {
  if (!(event.ctrlKey || event.metaKey)) return
  event.preventDefault()
  zoomBy(event.deltaY < 0 ? 1 : -1)
}

// ── Anotações ───────────────────────────────────────────────────────────────

function syncHistory() {
  history.undo = undoStack.length
  history.redo = redoStack.length
}

/** Guarda o estado antes de uma mudança (para desfazer) e grava depois. */
function change(mutate: (list: Annotation[]) => Annotation[]) {
  undoStack.push(cloneAnnotations(items.value))
  if (undoStack.length > 100) undoStack.shift()
  redoStack.length = 0
  items.value = mutate(items.value)
  syncHistory()
  documents.saveAnnotations(props.doc.id, items.value)
}

function undo() {
  const previous = undoStack.pop()
  if (!previous) return
  redoStack.push(items.value)
  items.value = previous
  syncHistory()
  documents.saveAnnotations(props.doc.id, items.value)
}

function redo() {
  const next = redoStack.pop()
  if (!next) return
  undoStack.push(items.value)
  items.value = next
  syncHistory()
  documents.saveAnnotations(props.doc.id, items.value)
}

/** Ponto do ponteiro na página, em frações (0 a 1). */
function pointIn(event: PointerEvent | MouseEvent, element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
}

const drawing = shallowRef<Stroke | null>(null)
/** Muda a cada ponto (o traço em andamento é redesenhado). */
const drawTick = ref(0)
let erased: Set<string> | null = null

function aspectOf(page: number) {
  const size = sizes.value[page - 1]
  return size ? size.height / size.width : 1.414
}

function onPointerDown(event: PointerEvent, page: number) {
  if (tool.value === 'select' || event.button > 0) return
  const layer = event.currentTarget as HTMLElement
  if (tool.value === 'text') {
    if ((event.target as HTMLElement).closest('.pdf-note')) return
    event.preventDefault()
    const { x, y } = pointIn(event, layer)
    startNote(page, x, y)
    return
  }
  event.preventDefault()
  try {
    layer.setPointerCapture(event.pointerId)
  } catch {
    // (ponteiro que já acabou: segue sem a captura)
  }
  const { x, y } = pointIn(event, layer)
  if (tool.value === 'eraser') {
    erased = new Set()
    eraseAt(page, x, y)
    return
  }
  const width = (tool.value === 'highlighter' ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS)[widthIndex.value]!
  const stroke = newStroke(page, tool.value as 'pen' | 'highlighter', color.value, width)
  addPoint(stroke, x, y, 0)
  drawing.value = stroke
  drawTick.value++
}

function onPointerMove(event: PointerEvent, page: number) {
  const layer = event.currentTarget as HTMLElement
  if (erased) {
    const { x, y } = pointIn(event, layer)
    eraseAt(page, x, y)
    return
  }
  const stroke = drawing.value
  if (!stroke || stroke.page !== page) return
  // Os pontos que o navegador juntou entre dois eventos (traço mais suave)
  const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event]
  let moved = false
  for (const item of events.length ? events : [event]) {
    const { x, y } = pointIn(item, layer)
    moved = addPoint(stroke, x, y) || moved
  }
  if (moved) drawTick.value++
}

function onPointerUp() {
  if (erased) {
    erased = null
    return
  }
  const stroke = drawing.value
  drawing.value = null
  if (!stroke || !stroke.points.length) return
  change((list) => [...list, stroke])
}

function eraseAt(page: number, x: number, y: number) {
  const hits = items.value.filter((item) => item.page === page && !erased!.has(item.id) && hitTest(item, x, y, 0.012, aspectOf(page)))
  if (!hits.length) return
  // Uma passada da borracha = um passo do desfazer
  const first = erased!.size === 0
  for (const hit of hits) erased!.add(hit.id)
  if (first) change((list) => list.filter((item) => !erased!.has(item.id)))
  else {
    items.value = items.value.filter((item) => !erased!.has(item.id))
    documents.saveAnnotations(props.doc.id, items.value)
  }
}

const pathOf = (stroke: Stroke, aspect: number) =>
  stroke.points.length === 1
    ? `M${stroke.points[0]![0] * 1000} ${stroke.points[0]![1] * 1000 * aspect}l0.01 0`
    : `M${stroke.points.map(([x, y]) => `${(x * 1000).toFixed(1)} ${(y * 1000 * aspect).toFixed(1)}`).join('L')}`

// ── Caixas de texto ─────────────────────────────────────────────────────────

const editing = ref<{ id: string; page: number; x: number; y: number; text: string; color: string; size: number; isNew: boolean } | null>(null)

function startNote(page: number, x: number, y: number) {
  commitNote()
  editing.value = { id: createId('a'), page, x: Math.min(x, 0.95), y: Math.min(y, 0.97), text: '', color: penColor.value, size: TEXT_SIZE, isNew: true }
  void nextTick(() => document.querySelector<HTMLTextAreaElement>('.pdf-note-editor')?.focus())
}

function editNote(note: TextNote) {
  if (tool.value !== 'text' && tool.value !== 'select') return
  commitNote()
  editing.value = { ...note, isNew: false }
  void nextTick(() => document.querySelector<HTMLTextAreaElement>('.pdf-note-editor')?.focus())
}

function commitNote() {
  const note = editing.value
  if (!note) return
  editing.value = null
  const text = note.text.replace(/\s+$/, '')
  const existing = items.value.find((item) => item.id === note.id)
  if (!text) {
    if (existing) change((list) => list.filter((item) => item.id !== note.id))
    return
  }
  const item: TextNote = { id: note.id, page: note.page, tool: 'text', color: note.color, x: note.x, y: note.y, size: note.size, text }
  if (existing && existing.tool === 'text' && existing.text === text && existing.color === note.color) return
  change((list) => (existing ? list.map((entry) => (entry.id === note.id ? item : entry)) : [...list, item]))
}

function onNoteKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    commitNote()
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    commitNote()
  }
}

// ── Marcar o texto selecionado ──────────────────────────────────────────────

const markButton = ref<{ x: number; y: number } | null>(null)

function selectionInPages(): { page: number; rects: [number, number, number, number][] }[] {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !scroller.value) return []
  const result = new Map<number, [number, number, number, number][]>()
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i)
    for (const rect of range.getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue
      const pageElement = [...scroller.value.querySelectorAll<HTMLElement>('[data-page]')].find((element) => {
        const box = element.getBoundingClientRect()
        return rect.top + rect.height / 2 >= box.top && rect.top + rect.height / 2 <= box.bottom
      })
      if (!pageElement) continue
      const box = pageElement.getBoundingClientRect()
      const page = Number(pageElement.dataset.page)
      const list = result.get(page) ?? []
      list.push([(rect.left - box.left) / box.width, (rect.top - box.top) / box.height, rect.width / box.width, rect.height / box.height])
      result.set(page, list)
    }
  }
  return [...result.entries()].map(([page, rects]) => ({ page, rects: mergeRects(rects) }))
}

/** Junta os pedaços da mesma linha (o navegador devolve um retângulo por trecho de texto). */
function mergeRects(rects: [number, number, number, number][]): [number, number, number, number][] {
  const sorted = [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const out: [number, number, number, number][] = []
  for (const rect of sorted) {
    const last = out.at(-1)
    if (last && Math.abs(last[1] - rect[1]) < rect[3] * 0.5 && rect[0] <= last[0] + last[2] + 0.01) {
      const right = Math.max(last[0] + last[2], rect[0] + rect[2])
      const bottom = Math.max(last[1] + last[3], rect[1] + rect[3])
      last[0] = Math.min(last[0], rect[0])
      last[1] = Math.min(last[1], rect[1])
      last[2] = right - last[0]
      last[3] = bottom - last[1]
    } else out.push([...rect])
  }
  return out
}

function onSelectionChange() {
  const selection = window.getSelection()
  if (tool.value !== 'select' || !selection || selection.isCollapsed || !scroller.value?.contains(selection.anchorNode)) {
    markButton.value = null
    return
  }
  const rect = selection.getRangeAt(selection.rangeCount - 1).getBoundingClientRect()
  const box = scroller.value.getBoundingClientRect()
  markButton.value = {
    x: Math.min(Math.max(rect.left + rect.width / 2 - box.left, 60), box.width - 60) + scroller.value.scrollLeft,
    y: Math.max(rect.top - box.top - 44, 6) + scroller.value.scrollTop,
  }
}

function markSelection() {
  const parts = selectionInPages()
  markButton.value = null
  if (!parts.length) return
  change((list) => [...list, ...parts.map((part) => ({ id: createId('a'), page: part.page, tool: 'mark' as const, color: highlightColor.value, rects: part.rects }))])
  window.getSelection()?.removeAllRanges()
}

// ── Teclado ─────────────────────────────────────────────────────────────────

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, [contenteditable="true"]')) return
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (mod && key === 'z' && !event.shiftKey) {
    event.preventDefault()
    undo()
  } else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
    event.preventDefault()
    redo()
  } else if (mod && (key === '=' || key === '+')) {
    event.preventDefault()
    zoomBy(1)
  } else if (mod && key === '-') {
    event.preventDefault()
    zoomBy(-1)
  } else if (mod && key === '0') {
    event.preventDefault()
    setZoom('fit')
  } else if (!mod && !event.altKey) {
    const found = TOOLS.find((item) => item.key.toLowerCase() === key)
    if (found) {
      event.preventDefault()
      tool.value = found.id
    }
  }
}

watch(tool, () => {
  commitNote()
  markButton.value = null
  if (tool.value !== 'select') window.getSelection()?.removeAllRanges()
})

// ── Ciclo de vida ───────────────────────────────────────────────────────────

let resize: ResizeObserver | null = null
onMounted(() => {
  void load()
  document.addEventListener('selectionchange', onSelectionChange)
  if (scroller.value) {
    containerWidth.value = scroller.value.clientWidth
    resize = new ResizeObserver(() => {
      if (scroller.value) containerWidth.value = scroller.value.clientWidth
    })
    resize.observe(scroller.value)
  }
})

watch(
  () => props.doc.id,
  () => {
    commitNote()
    cleanup()
    void load()
  },
)

function cleanup() {
  observer?.disconnect()
  for (const view of views.values()) {
    view.task?.cancel()
    view.textLayer?.cancel()
  }
  views.clear()
  visible.clear()
  void closePdf?.()
  closePdf = null
  pdf.value = null
}

onBeforeUnmount(() => {
  commitNote()
  void documents.flushAnnotations()
  document.removeEventListener('selectionchange', onSelectionChange)
  resize?.disconnect()
  cleanup()
})

defineExpose({ focus: () => scroller.value?.focus() })
</script>

<template>
  <div class="pdf-viewer" :data-tool="tool">
    <div class="pdf-toolbar" role="toolbar" aria-label="Ferramentas do PDF">
      <div class="tool-group">
        <button
          v-for="item in TOOLS"
          :key="item.id"
          type="button"
          class="tool-btn"
          :class="{ on: tool === item.id }"
          :data-tool="item.id"
          :data-tip="`${item.label} (${item.key})`"
          data-tip-pos="bottom"
          :aria-label="item.label"
          :aria-pressed="tool === item.id"
          @click="tool = item.id"
        >
          <AppIcon :name="item.icon" :size="17" />
        </button>
      </div>
      <div v-if="showColors" class="tool-group colors" role="radiogroup" aria-label="Cor">
        <button
          v-for="value in colors"
          :key="value"
          type="button"
          class="swatch"
          :class="{ on: color === value || (tool === 'text' && penColor === value) }"
          :style="{ '--swatch': value }"
          role="radio"
          :aria-checked="color === value"
          :aria-label="`Cor ${value}`"
          :data-color="value"
          @click="tool === 'highlighter' ? (highlightColor = value) : (penColor = value)"
        />
      </div>
      <div v-if="showWidths" class="tool-group" role="radiogroup" aria-label="Espessura">
        <button
          v-for="(_, index) in PEN_WIDTHS"
          :key="index"
          type="button"
          class="tool-btn width"
          :class="{ on: widthIndex === index }"
          role="radio"
          :aria-checked="widthIndex === index"
          :aria-label="['Fina', 'Média', 'Grossa'][index]"
          :data-tip="['Fina', 'Média', 'Grossa'][index]"
          data-tip-pos="bottom"
          @click="widthIndex = index"
        >
          <span class="dot" :style="{ width: `${4 + index * 4}px`, height: `${4 + index * 4}px` }" />
        </button>
      </div>
      <div class="tool-group">
        <button type="button" class="tool-btn" data-action="undo" :disabled="!history.undo" data-tip="Desfazer (Ctrl+Z)" data-tip-pos="bottom" aria-label="Desfazer" @click="undo">
          <AppIcon name="undo" :size="16" />
        </button>
        <button type="button" class="tool-btn" data-action="redo" :disabled="!history.redo" data-tip="Refazer (Ctrl+Y)" data-tip-pos="bottom" aria-label="Refazer" @click="redo">
          <AppIcon name="undo" :size="16" class="flip" />
        </button>
      </div>
      <span class="spacer" />
      <div v-if="status === 'ready'" class="tool-group zoom">
        <span class="page-count" data-page-count>{{ currentPage }} / {{ sizes.length }}</span>
        <button type="button" class="tool-btn" data-action="zoom-out" aria-label="Afastar" data-tip="Afastar (Ctrl -)" data-tip-pos="bottom" @click="zoomBy(-1)">
          <AppIcon name="zoom-out" :size="16" />
        </button>
        <button type="button" class="zoom-label" data-action="zoom-fit" data-tip="Ajustar à largura (Ctrl 0)" data-tip-pos="bottom" @click="setZoom('fit')">{{ zoomLabel }}</button>
        <button type="button" class="tool-btn" data-action="zoom-in" aria-label="Aproximar" data-tip="Aproximar (Ctrl +)" data-tip-pos="bottom" @click="zoomBy(1)">
          <AppIcon name="zoom-in" :size="16" />
        </button>
      </div>
    </div>

    <div ref="scroller" class="pdf-scroll" tabindex="0" @keydown="onKeydown" @wheel="onWheel" @scroll.passive="updateCurrentPage">
      <div v-if="status === 'loading'" class="pdf-state">Abrindo o PDF…</div>
      <div v-else-if="status === 'error'" class="pdf-state error">
        <AppIcon name="alert" :size="28" />
        <p>Não foi possível abrir este PDF.</p>
        <p class="muted selectable">{{ error }}</p>
      </div>
      <div v-else class="pdf-pages">
        <div
          v-for="(size, index) in sizes"
          :key="index"
          class="pdf-page"
          :data-page="index + 1"
          :style="{ width: `${size.width * scale}px`, height: `${size.height * scale}px`, '--scale-factor': scale, '--total-scale-factor': scale }"
        >
          <div class="pdf-canvas-slot" />
          <div class="textLayer" />
          <div
            class="pdf-ink"
            @pointerdown="onPointerDown($event, index + 1)"
            @pointermove="onPointerMove($event, index + 1)"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <svg class="pdf-ink-svg" :viewBox="`0 0 1000 ${1000 * (size.height / size.width)}`" preserveAspectRatio="none" aria-hidden="true">
              <template v-for="item in byPage.get(index + 1) ?? []" :key="item.id">
                <path
                  v-if="item.tool === 'pen' || item.tool === 'highlighter'"
                  :d="pathOf(item, size.height / size.width)"
                  :class="item.tool"
                  :stroke="item.color"
                  :stroke-width="item.width * 1000"
                  :data-annotation="item.tool"
                />
                <template v-else-if="item.tool === 'mark'">
                  <rect
                    v-for="(rect, r) in item.rects"
                    :key="r"
                    class="mark"
                    :x="rect[0] * 1000"
                    :y="rect[1] * 1000 * (size.height / size.width)"
                    :width="rect[2] * 1000"
                    :height="rect[3] * 1000 * (size.height / size.width)"
                    :fill="item.color"
                    data-annotation="mark"
                  />
                </template>
              </template>
              <path
                v-if="drawing && drawing.page === index + 1"
                :key="drawTick"
                :d="pathOf(drawing, size.height / size.width)"
                :class="drawing.tool"
                :stroke="drawing.color"
                :stroke-width="drawing.width * 1000"
              />
            </svg>
            <template v-for="item in byPage.get(index + 1) ?? []" :key="`n-${item.id}`">
              <div
                v-if="item.tool === 'text' && editing?.id !== item.id"
                class="pdf-note"
                data-annotation="text"
                :style="{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, color: item.color, fontSize: `${item.size * size.width * scale}px` }"
                @dblclick.stop="editNote(item)"
                @pointerdown.stop="tool === 'text' && editNote(item)"
              >
                {{ item.text }}
              </div>
            </template>
            <textarea
              v-if="editing && editing.page === index + 1"
              v-model="editing.text"
              class="pdf-note-editor"
              :style="{ left: `${editing.x * 100}%`, top: `${editing.y * 100}%`, color: editing.color, fontSize: `${editing.size * size.width * scale}px` }"
              rows="1"
              placeholder="Texto…"
              aria-label="Texto da anotação"
              @pointerdown.stop
              @keydown="onNoteKeydown"
              @blur="commitNote"
            />
          </div>
        </div>
        <button
          v-if="markButton"
          type="button"
          class="mark-btn"
          data-action="mark"
          :style="{ left: `${markButton.x}px`, top: `${markButton.y}px`, '--swatch': highlightColor }"
          @pointerdown.prevent
          @click="markSelection"
        >
          <span class="mark-dot" /> Marcar
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-viewer {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.pdf-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.tool-group {
  display: flex;
  align-items: center;
  gap: 2px;
}
.tool-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
html[data-touch] .tool-btn {
  width: 40px;
  height: 40px;
}
.tool-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.tool-btn.on {
  background: var(--primary-soft);
  color: var(--primary-text);
}
.tool-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.flip {
  transform: scaleX(-1);
}
.dot {
  display: block;
  border-radius: 50%;
  background: currentColor;
}
.swatch {
  width: 22px;
  height: 22px;
  margin: 0 2px;
  border: 2px solid transparent;
  border-radius: 50%;
  background: var(--swatch);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  cursor: pointer;
}
html[data-touch] .swatch {
  width: 28px;
  height: 28px;
}
.swatch.on {
  border-color: var(--surface);
  box-shadow: 0 0 0 2px var(--primary);
}
.spacer {
  flex: 1;
}
.zoom {
  gap: 4px;
}
.page-count {
  margin-right: 6px;
  color: var(--text-3);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.zoom-label {
  min-width: 52px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--text-2);
  font: inherit;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.pdf-scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--surface-3);
  outline: none;
}
.pdf-pages {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: max-content;
  min-width: 100%;
  padding: 16px;
}
.pdf-page {
  position: relative;
  flex: none;
  background: #fff;
  box-shadow: var(--shadow-sm), 0 0 0 1px rgba(0, 0, 0, 0.06);
}
.pdf-canvas-slot,
.pdf-canvas-slot :deep(canvas) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.pdf-ink {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
.pdf-viewer:not([data-tool='select']) .pdf-ink {
  pointer-events: auto;
  touch-action: none;
  cursor: crosshair;
}
.pdf-viewer[data-tool='text'] .pdf-ink {
  cursor: text;
}
.pdf-viewer[data-tool='eraser'] .pdf-ink {
  cursor: cell;
}
.pdf-ink-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.pdf-ink-svg path {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pdf-ink-svg path.highlighter {
  stroke-opacity: 0.42;
  mix-blend-mode: multiply;
}
.pdf-ink-svg .mark {
  opacity: 0.42;
  mix-blend-mode: multiply;
}
.pdf-note,
.pdf-note-editor {
  position: absolute;
  font-family: var(--font-ui);
  line-height: 1.3;
  white-space: pre;
  pointer-events: auto;
}
.pdf-note {
  padding: 0 2px;
  user-select: none;
}
.pdf-viewer[data-tool='text'] .pdf-note:hover {
  outline: 1px dashed currentColor;
}
.pdf-note-editor {
  min-width: 120px;
  margin: 0;
  padding: 0 2px;
  border: 1px dashed currentColor;
  border-radius: 3px;
  outline: none;
  background: rgba(255, 255, 255, 0.85);
  resize: both;
  overflow: hidden;
  field-sizing: content;
}
.mark-btn {
  position: absolute;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--elevated);
  box-shadow: var(--shadow-md);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  transform: translateX(-50%);
  cursor: pointer;
}
.mark-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--swatch);
}
.pdf-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  padding: 32px;
  color: var(--text-2);
  text-align: center;
}
.pdf-state.error > :deep(.app-icon) {
  color: var(--danger);
}
.muted {
  color: var(--text-3);
  font-size: 13px;
}

/* Camada de texto do pdf.js (pdf_viewer.css, só o necessário) */
.textLayer {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  text-align: initial;
  transform-origin: 0 0;
  forced-color-adjust: none;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.textLayer :deep(span),
.textLayer :deep(br) {
  position: absolute;
  color: transparent;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
  -webkit-user-select: text;
}
.textLayer :deep(> :not(.markedContent)),
.textLayer :deep(.markedContent span:not(.markedContent)) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.textLayer :deep(.markedContent) {
  display: contents;
}
.textLayer :deep(::selection) {
  background: color-mix(in srgb, var(--primary) 30%, transparent);
  color: transparent;
}
.textLayer :deep(br::selection) {
  background: transparent;
}
.textLayer :deep(.endOfContent) {
  position: absolute;
  inset: 100% 0 0;
  display: block;
  z-index: 0;
  cursor: default;
  user-select: none;
}
</style>
