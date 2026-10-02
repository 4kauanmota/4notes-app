<script setup lang="ts">
/**
 * Editor de Markdown reutilizável (CodeMirror 6) — usado nas Notas e no Mapa Mental.
 *
 * - `docKey` identifica o documento: ao trocar de nota, o histórico de desfazer,
 *   a seleção e a rolagem de cada nota são guardados e restaurados.
 * - `assetBase` é a pasta da nota no workspace (base dos caminhos das imagens).
 * - Ao selecionar texto, aparece a barra de formatação (FormatToolbar).
 * - Colar uma imagem a salva no workspace (remover a imagem pelo botão apaga o
 *   arquivo); colar código cria um bloco de código, que pode ser aberto em tela
 *   cheia (CodeFullscreen).
 */
import { EditorState } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { errorMessage, workspaceFileUrl } from '#shared/ipc'
import { notifyError, showToast } from '~/composables/useToasts'
import type { PaletteColor } from '~/lib/colors'
import {
  activeFormats,
  clearColor,
  clearFormatting,
  insertLink,
  toggleFormat,
  toggleLineFormat,
  type InlineFormat,
  type LineFormat,
} from '~/lib/editor/formatting'
import type { CodeEditRequest, EditorHost, MentionHost } from '~/lib/editor/host'
import { buildExtensions, minimalChange, type CursorInfo } from '~/lib/editor/setup'
import { desktop, hasDesktopApi } from '~/lib/platform'

const props = defineProps<{
  modelValue: string
  docKey: string
  placeholder?: string
  autofocus?: boolean
  /** Pasta da nota no workspace ("notes", "mindmap/Principal"). */
  assetBase?: string
  /** Arquivo da nota no workspace ("notes/Ideias.md"); null enquanto ela não foi salva. */
  notePath?: string | null
  /** Liga as menções a outras notas (@). */
  mentions?: MentionHost
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  cursor: [info: CursorInfo]
}>()

const host = ref<HTMLDivElement>()
const editorParent = ref<HTMLDivElement>()
const cache = new Map<string, { state: EditorState; scroll: number }>()
let view: EditorView | null = null
let applyingExternal = false

// ── Barra de formatação ─────────────────────────────────────────────────────

/** Altura da barra com a fileira de cores aberta (ela cresce para longe do texto). */
const TOOLBAR_HEIGHT = 76
const TOOLBAR_HALF_WIDTH = 210
const toolbar = reactive({
  visible: false,
  x: 0,
  y: 0,
  below: false,
  active: { formats: new Set<InlineFormat>(), color: null as string | null },
})
let selectingWithMouse = false
let frame = 0

function placeToolbar(): void {
  frame = 0
  const selection = view?.state.selection.main
  if (!view || !host.value || !selection || selection.empty || !view.hasFocus || selectingWithMouse) {
    toolbar.visible = false
    return
  }
  const start = view.coordsAtPos(selection.from, 1)
  const end = view.coordsAtPos(selection.to, -1)
  if (!start || !end) {
    toolbar.visible = false
    return
  }
  const box = host.value.getBoundingClientRect()
  if (end.bottom < box.top || start.top > box.bottom) {
    toolbar.visible = false // seleção fora da área visível
    return
  }
  const sameLine = Math.abs(start.top - end.top) < 4
  const centerX = sameLine ? (start.left + end.right) / 2 : start.left + 120
  const half = Math.min(TOOLBAR_HALF_WIDTH, box.width / 2 - 4)
  toolbar.x = Math.round(Math.min(Math.max(centerX - box.left, half + 4), box.width - half - 4))
  const above = start.top - box.top - 8
  toolbar.below = above < TOOLBAR_HEIGHT + 4
  toolbar.y = Math.round(toolbar.below ? Math.min(end.bottom - box.top + 8, box.height - TOOLBAR_HEIGHT - 4) : above)
  toolbar.active = activeFormats(view.state)
  toolbar.visible = true
}

function scheduleToolbar(): void {
  if (!frame) frame = requestAnimationFrame(placeToolbar)
}

function onEditorUpdate(update: ViewUpdate): void {
  if (update.selectionSet || update.docChanged || update.focusChanged || update.geometryChanged) scheduleToolbar()
}

function onMouseDown(event: MouseEvent): void {
  if (event.button !== 0 || !(event.target as HTMLElement).closest('.cm-content')) return
  selectingWithMouse = true
  toolbar.visible = false
  window.addEventListener('mouseup', onMouseUp, { once: true })
}

function onMouseUp(): void {
  selectingWithMouse = false
  scheduleToolbar()
}

function run(command: (view: EditorView) => boolean): void {
  if (!view) return
  command(view)
  view.focus()
  scheduleToolbar()
}

const applyInline = (format: InlineFormat) => run((v) => toggleFormat(v, format))
const applyColor = (color: PaletteColor | null) => run((v) => (color ? toggleFormat(v, 'color', color) : clearColor(v)))
const applyLine = (format: LineFormat) => run((v) => toggleLineFormat(v, format))

// ── Ligação com o app (imagens, código em tela cheia, avisos) ─────────────────

const codeRequest = shallowRef<CodeEditRequest | null>(null)

const appHost: EditorHost = {
  docKey: () => props.docKey,
  assetBase: () => props.assetBase ?? 'notes',
  async saveImage(data, mime) {
    if (!hasDesktopApi()) return null
    try {
      return await desktop().attachments.saveImage(new Uint8Array(data), mime)
    } catch (error) {
      notifyError(`Não foi possível salvar a imagem: ${errorMessage(error)}`, error)
      return null
    }
  },
  imageUrl: (path) => workspaceFileUrl(path),
  removeImage(path, undoRemoval) {
    if (!hasDesktopApi()) return
    const api = desktop().attachments
    api
      .removeImage(path, props.notePath ?? null)
      .then((result) => {
        if (result === 'removed') {
          showToast({
            message: 'Imagem apagada',
            icon: 'trash',
            action: {
              label: 'Desfazer',
              run: async () => {
                await api.restoreImage(path).catch(() => false)
                undoRemoval()
              },
            },
          })
        } else if (result === 'in-use') {
          showToast({ message: 'Imagem removida da nota. O arquivo continua, porque outra nota usa essa imagem.', icon: 'info' })
        }
      })
      .catch((error) => notifyError(`Não foi possível apagar a imagem: ${errorMessage(error)}`, error))
  },
  restoreImage: (path) => (hasDesktopApi() ? desktop().attachments.restoreImage(path).catch(() => false) : Promise.resolve(false)),
  openCode: (request) => {
    toolbar.visible = false
    codeRequest.value = request
  },
  notify: (message, undo) => {
    showToast({ message, icon: 'check', action: undo ? { label: 'Desfazer', run: undo } : undefined })
  },
  mentions: props.mentions,
}

function closeCode(): void {
  codeRequest.value = null
  requestAnimationFrame(() => view?.focus())
}

// ── Ciclo de vida ───────────────────────────────────────────────────────────

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: buildExtensions(
      {
        onChange: (value) => {
          if (!applyingExternal) emit('update:modelValue', value)
        },
        onCursor: (info) => emit('cursor', info),
        onUpdate: onEditorUpdate,
        openUrl: (url) => {
          if (hasDesktopApi()) void desktop().shell.openExternal(url)
        },
      },
      { placeholder: props.placeholder, host: appHost },
    ),
  })
}

function emitCursor(): void {
  if (!view) return
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  emit('cursor', { line: line.number, col: head - line.from + 1, selected: 0 })
}

onMounted(() => {
  view = new EditorView({ state: createState(props.modelValue), parent: editorParent.value! })
  view.scrollDOM.addEventListener('scroll', scheduleToolbar, { passive: true })
  emitCursor()
  if (props.autofocus) requestAnimationFrame(() => view?.focus())
})

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  window.removeEventListener('mouseup', onMouseUp)
  view?.scrollDOM.removeEventListener('scroll', scheduleToolbar)
  view?.destroy()
  view = null
})

// Trocou de documento (outra aba / outra nota)
watch(
  () => props.docKey,
  (key, previousKey) => {
    if (!view) return
    cache.set(previousKey, { state: view.state, scroll: view.scrollDOM.scrollTop })
    const cached = cache.get(key)
    if (cached && cached.state.doc.toString() === props.modelValue) {
      view.setState(cached.state)
      requestAnimationFrame(() => view?.scrollDOM.scrollTo({ top: cached.scroll }))
    } else {
      view.setState(createState(props.modelValue))
      view.scrollDOM.scrollTop = 0
    }
    if (cache.size > 40) cache.delete(cache.keys().next().value!)
    emitCursor()
    toolbar.visible = false
    if (props.autofocus) view.focus()
  },
)

// O conteúdo mudou por fora (arquivo editado em outro programa…)
watch(
  () => props.modelValue,
  (value) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (value === current) return
    applyingExternal = true
    try {
      view.dispatch({ changes: minimalChange(current, value) })
    } finally {
      applyingExternal = false
    }
  },
)

defineExpose({
  focus: () => view?.focus(),
  /** Coloca o cursor no fim do texto. */
  focusEnd: () => {
    if (!view) return
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
  },
})
</script>

<template>
  <div
    ref="host"
    class="markdown-editor"
    @mousedown.capture="onMouseDown"
    @keydown.esc="toolbar.visible = false"
    @contextmenu="toolbar.visible = false"
  >
    <div ref="editorParent" class="editor-parent" />
    <FormatToolbar
      v-if="toolbar.visible"
      :x="toolbar.x"
      :y="toolbar.y"
      :below="toolbar.below"
      :active="toolbar.active"
      @inline="applyInline"
      @color="applyColor"
      @line="applyLine"
      @link="run(insertLink)"
      @clear="run(clearFormatting)"
    />
    <CodeFullscreen v-if="codeRequest" :request="codeRequest" @close="closeCode" />
  </div>
</template>

<style scoped>
.markdown-editor {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.editor-parent,
.markdown-editor :deep(.cm-editor) {
  height: 100%;
}
</style>
