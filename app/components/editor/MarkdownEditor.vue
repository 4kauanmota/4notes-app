<script setup lang="ts">
/**
 * Editor de Markdown reutilizável (CodeMirror 6) — usado nas Notas e no Mapa Mental.
 *
 * - `docKey` identifica o documento: ao trocar de nota, o histórico de desfazer,
 *   a seleção e a rolagem de cada nota são guardados e restaurados.
 * - `assetBase` é a pasta da nota no workspace (base dos caminhos das imagens).
 * - Ao selecionar texto, aparece a barra de formatação (FormatToolbar).
 * - Colar uma imagem a salva na biblioteca de imagens do workspace (attachments/);
 *   "Inserir imagem…" no clique direito escolhe uma que já está lá. Remover a imagem
 *   pelo botão tira só da nota. Colar código cria um bloco de código, que pode ser
 *   aberto em tela cheia (CodeFullscreen). "Bloco de texto" (na barra) transforma a
 *   seleção num bloco de texto, com o mesmo cartão e a mesma tela cheia.
 */
import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { errorMessage, workspaceFileUrl } from '#shared/ipc'
import { showContextMenu, separator, type MenuItemSpec } from '~/composables/useContextMenu'
import { promptDialog } from '~/composables/useDialog'
import { pickLibraryImage } from '~/composables/useImageLibrary'
import { useLayoutSize } from '~/composables/useLayoutSize'
import { notifyError, showToast } from '~/composables/useToasts'
import type { PaletteColor } from '~/lib/colors'
import {
  activeFormats,
  clearColor,
  clearFormatting,
  normalizeLinkUrl,
  removeLink,
  setLink,
  toggleFormat,
  toggleLineFormat,
  type ActiveFormats,
  type InlineFormat,
  type LineFormat,
} from '~/lib/editor/formatting'
import { isTextBlockInfo, languageLabel, TEXT_BLOCK_INFO } from '~/lib/editor/languages'
import { insertImageFromLibrary } from '~/lib/editor/paste'
import { stripImages } from '~/lib/editor/markup'
import type { CodeEditRequest, EditorHost, MentionHost } from '~/lib/editor/host'
import { refreshMentions } from '~/lib/editor/mentions'
import { buildExtensions, minimalChange, type CursorInfo } from '~/lib/editor/setup'
import { canWrapInTextBlock, wrapInCodeBlock, wrapInTextBlock } from '~/lib/editor/text-blocks'
import { desktop, hasDesktopApi } from '~/lib/platform'

const props = defineProps<{
  modelValue: string
  docKey: string
  placeholder?: string
  autofocus?: boolean
  /** Pasta da nota no workspace ("notes", "mindmap/Principal"). */
  assetBase?: string
  /** Liga as menções a notas e tarefas (@). */
  mentions?: MentionHost
  /** A primeira linha de uma nota vazia já começa como título (Notas). */
  titleFirstLine?: boolean
  /**
   * A barra de formatação pode passar dos limites do editor (campos que crescem com o
   * texto, num painel estreito: a descrição das tarefas).
   */
  toolbarOverflow?: boolean
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
const TOOLBAR_HALF_WIDTH = 226
/** Editor mais estreito que a barra: os botões quebram em duas fileiras (mais alta). */
const TOOLBAR_HEIGHT_WRAPPED = 112
const toolbar = reactive({
  visible: false,
  x: 0,
  y: 0,
  below: false,
  /** Largura máxima (editor estreito: os botões quebram em duas fileiras); null = uma fileira. */
  maxWidth: null as number | null,
  active: { formats: new Set<InlineFormat>(), color: null, link: null } as ActiveFormats,
  /** A seleção pode virar bloco de texto (fora de blocos de código/texto). */
  textBlock: false,
  /** Editando o endereço de um link: a barra fica aberta mesmo com o foco no campo. */
  linkMode: false,
  linkInitial: '',
})
let selectingWithMouse = false
let frame = 0

/**
 * Toque (celular): a barra fica fixa embaixo da nota — acima do teclado — enquanto você
 * escreve, e não flutuando sobre a seleção (ali ficam as alças e o menu do Android).
 */
const { layout } = useLayoutSize()
const docked = computed(() => layout.touch)

function placeDockedToolbar(): void {
  const focused = !!view && (view.hasFocus || toolbar.linkMode)
  toolbar.visible = focused
  if (!focused || !view) {
    toolbar.linkMode = false
    return
  }
  toolbar.active = activeFormats(view.state)
  toolbar.textBlock = canWrapInTextBlock(view.state)
}

function placeToolbar(): void {
  frame = 0
  if (docked.value) return placeDockedToolbar()
  const selection = view?.state.selection.main
  if (!view || !host.value || !selection || selection.empty || (!view.hasFocus && !toolbar.linkMode) || selectingWithMouse) {
    toolbar.visible = false
    toolbar.linkMode = false
    return
  }
  // Só imagens selecionadas (clique numa imagem) ou várias ocorrências (Ctrl+D): sem barra
  // de formatação (ela cobriria as outras seleções; os atalhos continuam valendo)
  if (view.state.selection.ranges.length > 1 || !stripImages(view.state.sliceDoc(selection.from, selection.to)).trim()) {
    toolbar.visible = false
    toolbar.linkMode = false
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
  const wrapped = box.width < TOOLBAR_HALF_WIDTH * 2 + 8
  const height = wrapped ? TOOLBAR_HEIGHT_WRAPPED : TOOLBAR_HEIGHT
  toolbar.maxWidth = wrapped ? Math.floor(box.width - 8) : null
  toolbar.x = Math.round(Math.min(Math.max(centerX - box.left, half + 4), box.width - half - 4))
  const above = start.top - box.top - 8
  toolbar.below = above < height + 4
  // Presa dentro do editor — a não ser que ela possa sair dele (toolbarOverflow)
  const lowest = props.toolbarOverflow ? Number.POSITIVE_INFINITY : box.height - height - 4
  toolbar.y = Math.round(toolbar.below ? Math.min(end.bottom - box.top + 8, lowest) : above)
  toolbar.active = activeFormats(view.state)
  toolbar.textBlock = canWrapInTextBlock(view.state)
  toolbar.visible = true
}

function scheduleToolbar(): void {
  if (!frame) frame = requestAnimationFrame(placeToolbar)
}

function onEditorUpdate(update: ViewUpdate): void {
  if (update.selectionSet || update.docChanged || update.focusChanged || update.geometryChanged) scheduleToolbar()
}

function onMouseDown(event: MouseEvent): void {
  if (docked.value || event.button !== 0 || !(event.target as HTMLElement).closest('.cm-content')) return
  selectingWithMouse = true
  toolbar.visible = false
  toolbar.linkMode = false
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
/** "Bloco de texto": a seleção vira um bloco (só por aqui — nada vira bloco de texto sozinho). */
const applyTextBlock = () => run(wrapInTextBlock)
const applyCodeBlock = () => run(wrapInCodeBlock)

// ── Links (o endereço é editado na própria barra) ───────────────────────────

/** Abre o campo do endereço: com o link atual ou, se houver, um endereço copiado. */
async function openLink(): Promise<void> {
  if (!view || view.state.selection.main.empty) return
  const current = activeFormats(view.state).link
  let initial = current ?? ''
  if (!current) {
    const copied = await navigator.clipboard?.readText?.().catch(() => '')
    if (copied && /^\s*(?:https?:\/\/|mailto:|www\.)\S+\s*$/i.test(copied)) initial = copied.trim()
  }
  toolbar.linkInitial = initial
  toolbar.linkMode = true
  scheduleToolbar()
}

function closeLink(): void {
  toolbar.linkMode = false
  view?.focus()
  scheduleToolbar()
}

function applyLink(url: string): void {
  toolbar.linkMode = false
  run((v) => setLink(v, normalizeLinkUrl(url) ?? url.trim()))
}

function unlink(): void {
  toolbar.linkMode = false
  run(removeLink)
}

/** Toque: abrir o link do cursor (no desktop é Ctrl + clique). */
function openActiveLink(url: string): void {
  toolbar.linkMode = false
  if (hasDesktopApi()) void desktop().shell.openExternal(url).catch((error) => notifyError(`Não foi possível abrir o link: ${errorMessage(error)}`, error))
}

/** Toque: imagem da biblioteca (no desktop fica no botão direito do texto). */
function insertImage(): void {
  if (!view) return
  insertImageFromLibrary(view)
}

function onEditorContextMenu(): void {
  // No toque a barra fixa continua (o toque prolongado é do Android: selecionar, colar)
  if (!docked.value) toolbar.visible = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !toolbar.linkMode) toolbar.visible = false
  // Ctrl+K: link na seleção
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.code === 'KeyK' && view?.hasFocus) {
    event.preventDefault()
    void openLink()
  }
}

// ── Tipo e linguagem dos blocos (nome no cabeçalho do bloco) ────────────────

const LANGUAGES = [
  ['', 'Sem linguagem'],
  ['js', 'JavaScript'],
  ['ts', 'TypeScript'],
  ['vue', 'Vue'],
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['json', 'JSON'],
  ['gdscript', 'GDScript'],
  ['python', 'Python'],
  ['csharp', 'C#'],
  ['cpp', 'C++'],
  ['java', 'Java'],
  ['bash', 'Shell'],
  ['sql', 'SQL'],
  ['yaml', 'YAML'],
  ['markdown', 'Markdown'],
] as const

/**
 * Menu do nome do bloco: "Bloco de texto" (```text) ou código numa linguagem — o mesmo
 * menu nos dois tipos, então dá para trocar texto ↔ código (1.6.3).
 */
async function chooseLanguage(current: string): Promise<string | null> {
  const text = isTextBlockInfo(current)
  const label = languageLabel(current)
  const known = text || LANGUAGES.some(([, name]) => name === label)
  const custom = !known && !!current.trim()
  const items: MenuItemSpec[] = [
    { id: `lang:${TEXT_BLOCK_INFO}`, label: 'Bloco de texto', type: 'radio', checked: text },
    separator,
    ...LANGUAGES.map(([id, name]) => ({
      id: `lang:${id}`,
      label: name,
      type: 'radio' as const,
      checked: !text && (id === '' ? !current.trim() : name === label),
    })),
    separator,
    { id: 'other', label: custom ? `Outra (${label})…` : 'Outra…', type: 'radio', checked: custom },
  ]
  const choice = await showContextMenu(items)
  if (!choice) return null
  if (choice.startsWith('lang:')) return choice.slice(5)
  const typed = await promptDialog({
    title: 'Linguagem do bloco',
    label: 'Nome ou extensão (ex.: rust, go, php)',
    value: text ? '' : current.trim(),
    confirmLabel: 'Usar',
    icon: 'code',
  })
  return typed === null ? null : typed
}

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
  async pickImage() {
    if (!hasDesktopApi()) return null
    const picked = await pickLibraryImage({ title: 'Inserir imagem', confirmLabel: 'Inserir' })
    if (!picked) return null
    try {
      // A nota sempre aponta para a cópia da biblioteca (attachments/): a foto antiga de
      // uma categoria pode ser trocada ou apagada junto com ela
      return await desktop().library.adopt(picked)
    } catch (error) {
      notifyError(`Não foi possível usar a imagem: ${errorMessage(error)}`, error)
      return null
    }
  },
  openCode: (request) => {
    toolbar.visible = false
    codeRequest.value = request
  },
  chooseLanguage,
  notify: (message, undo) => {
    showToast({ message, icon: 'check', action: undo ? { label: 'Desfazer', run: undo } : undefined })
  },
  mentions: props.mentions,
  // Getter: a configuração "Título na primeira linha" pode mudar com a nota aberta
  get titleFirstLine() {
    return props.titleFirstLine
  },
}

function closeCode(): void {
  codeRequest.value = null
  requestAnimationFrame(() => view?.focus())
}

// ── Ciclo de vida ───────────────────────────────────────────────────────────

/**
 * Ao abrir uma nota, o cursor fica depois da marcação da primeira linha ("# " de um
 * título), que continua escondida — ou dentro do código, se a nota começa com um bloco.
 */
function initialCursor(doc: string): number {
  const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*\n/.exec(doc)
  if (fence && doc.includes(`\n${fence[1]}`, fence[0].length - 1)) return fence[0].length
  return /^(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/.exec(doc)?.[0].length ?? 0
}

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(initialCursor(doc)),
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

/** "Editar link…" no menu do clique direito (ContextMenuHost): abre o campo do endereço. */
const onEditLinkRequest = () => void openLink()

onMounted(() => {
  view = new EditorView({ state: createState(props.modelValue), parent: editorParent.value! })
  view.scrollDOM.addEventListener('scroll', scheduleToolbar, { passive: true })
  view.dom.addEventListener('fournotes:edit-link', onEditLinkRequest)
  emitCursor()
  if (props.autofocus) requestAnimationFrame(() => view?.focus())
})

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  window.removeEventListener('mouseup', onMouseUp)
  view?.scrollDOM.removeEventListener('scroll', scheduleToolbar)
  view?.dom.removeEventListener('fournotes:edit-link', onEditLinkRequest)
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
    toolbar.linkMode = false
    if (props.autofocus) view.focus()
  },
)

// O conteúdo mudou por fora (arquivo editado em outro programa, menção corrigida…):
// essa mudança não entra no Desfazer
watch(
  () => props.modelValue,
  (value) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (value === current) return
    applyingExternal = true
    try {
      view.dispatch({ changes: minimalChange(current, value), annotations: Transaction.addToHistory.of(false) })
    } finally {
      applyingExternal = false
    }
  },
)

// "Título na primeira linha" (configuração das Notas) mudou: a nota vazia aberta passa a
// mostrar o texto de espera certo (o "# " automático já pergunta ao app a cada nota vazia)
watch(
  () => [props.titleFirstLine, props.placeholder] as const,
  () => {
    for (const [key, entry] of cache) if (!entry.state.doc.length) cache.delete(key)
    if (!view || view.state.doc.length) return
    const focused = view.hasFocus
    view.setState(createState(''))
    if (focused) view.focus()
  },
)

// Um título ou estado mencionado mudou (tarefa concluída, nota renomeada…): redesenha os chips
const mentionsRevision = computed(() => props.mentions?.revision() ?? '')
watch(mentionsRevision, () => view?.dispatch({ effects: refreshMentions.of(null) }))

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
    :class="{ docked, 'toolbar-overflow': toolbarOverflow }"
    @mousedown.capture="onMouseDown"
    @keydown="onKeydown"
    @contextmenu="onEditorContextMenu"
  >
    <div ref="editorParent" class="editor-parent" />
    <FormatToolbar
      v-if="toolbar.visible"
      :x="toolbar.x"
      :y="toolbar.y"
      :below="toolbar.below"
      :max-width="toolbar.maxWidth"
      :active="toolbar.active"
      :link-mode="toolbar.linkMode"
      :link-initial="toolbar.linkInitial"
      :text-block="toolbar.textBlock"
      :docked="docked"
      @inline="applyInline"
      @color="applyColor"
      @line="applyLine"
      @open-link="openLink"
      @link="applyLink"
      @unlink="unlink"
      @close-link="closeLink"
      @clear="run(clearFormatting)"
      @text-block="applyTextBlock"
      @code-block="applyCodeBlock"
      @image="insertImage"
      @open-url="openActiveLink"
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
/* A barra de formatação pode sair do editor (ver toolbarOverflow) */
.markdown-editor.toolbar-overflow {
  overflow: visible;
}
/* Toque: a barra de formatação fica embaixo da nota (acima do teclado) */
.markdown-editor.docked {
  display: flex;
  flex-direction: column;
}
.markdown-editor.docked .editor-parent {
  flex: 1;
  min-height: 0;
}
</style>
