<script setup lang="ts">
/**
 * Módulo MAPA MENTAL: grafo do mapa aberto + painel de edição da nota do nó.
 *
 * No celular (layout compact) o painel ocupa a tela: tocar numa nota primeiro a
 * seleciona (com a alça de conexão e uma barrinha com "Abrir"); tocar de novo — ou em
 * "Abrir" — abre a nota.
 *
 * Seleção múltipla: Ctrl + arrastar desenha uma área (Ctrl + clique põe ou tira uma
 * nota); a barra embaixo mostra quantas estão selecionadas, com Cor e Excluir. No toque,
 * "Selecionar área" fica no menu do vazio (segurar o dedo).
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import GraphCanvas from '~/components/mindmap/GraphCanvas.vue'
import GraphToolbar from '~/components/mindmap/GraphToolbar.vue'
import PermanentNotePanel from '~/components/mindmap/PermanentNotePanel.vue'
import { revealItem, separator, showContextMenu, type MenuItemSpec } from '~/composables/useContextMenu'
import { onBackButton } from '~/composables/useBackButton'
import { confirmDialog, promptDialog } from '~/composables/useDialog'
import { useLayoutSize } from '~/composables/useLayoutSize'
import { useShortcuts } from '~/composables/useShortcuts'
import { PALETTE, PALETTE_LABELS, isPaletteColor, paletteVar } from '~/lib/colors'
import { noteIdOfNode, noteNodeId } from '~/lib/mindmap/graph'
import type { GraphNodeInfo } from '~/lib/mindmap/graph-view'
import { useMindmapStore } from '~/stores/mindmap'
import { trashPlace } from '~/lib/platform'

const mindmap = useMindmapStore()
const graph = ref<InstanceType<typeof GraphCanvas>>()
const toolbar = ref<InstanceType<typeof GraphToolbar>>()
const panel = ref<InstanceType<typeof PermanentNotePanel>>()
const page = ref<HTMLElement>()
const hover = ref<{ node: GraphNodeInfo; x: number; y: number } | null>(null)
/** Conexão selecionada (clique na linha): mostra o "×" para remover. */
const selectedEdge = ref<string | null>(null)
/** Seleção múltipla: ids dos nós ("note:Godot.md"). */
const multi = ref<string[]>([])
const multiNoteIds = computed(() => multi.value.map(noteIdOfNode))
/** "Selecionar área" escolhido no menu: o próximo arraste desenha a área. */
const areaSelecting = ref(false)

const { isCompact, isMedium, layout } = useLayoutSize()
/** Celular: nota selecionada no mapa, ainda sem abrir (o painel cobriria o mapa). */
const picked = ref<string | null>(null)
const pickedNote = computed(() => (picked.value ? (mindmap.findNote(picked.value) ?? null) : null))

const hasNotes = computed(() => mindmap.state.notes.length > 0)
const panelVisible = computed(() => mindmap.state.panelOpen && !!mindmap.selectedNote.value)
const panelWidth = computed(() => {
  // No celular o painel cobre o mapa inteiro: a câmera não precisa abrir espaço
  if (!panelVisible.value || isCompact.value) return 0
  const available = page.value?.clientWidth ?? 1200
  // Tela média (Fold aberto): o painel mais estreito deixa mais do mapa à vista
  return Math.min(mindmap.state.panelExpanded ? 820 : isMedium.value ? 380 : 480, available)
})
const selectedNodeId = computed(() => {
  if (panelVisible.value && mindmap.state.selectedId) return noteNodeId(mindmap.state.selectedId)
  return pickedNote.value ? noteNodeId(pickedNote.value.id) : null
})
const graphSettings = computed(() => ({ nodeStyle: mindmap.state.settings.nodeStyle, labels: mindmap.state.settings.labels, touch: layout.touch }))
const stats = computed(() => {
  const notes = mindmap.state.notes.length
  const links = mindmap.graph.value.edges.length
  return `${notes} ${notes === 1 ? 'nota' : 'notas'} · ${links} ${links === 1 ? 'conexão' : 'conexões'}`
})

// A conexão selecionada some se uma das notas for excluída
watch(
  () => mindmap.graph.value.edges,
  (edges) => {
    if (selectedEdge.value && !edges.some((edge) => edge.id === selectedEdge.value)) selectedEdge.value = null
  },
)
watch(
  () => mindmap.state.currentMap,
  () => {
    selectedEdge.value = null
    hover.value = null
    picked.value = null
    multi.value = []
    areaSelecting.value = false
  },
)
// Abriu uma nota (busca, menção, nota nova…) ou saiu do celular: a seleção do celular sai
watch(
  () => [mindmap.state.panelOpen, isCompact.value] as const,
  ([open, compact]) => {
    if (open || !compact) picked.value = null
  },
)

/** Celular: abre a nota selecionada (o painel ocupa a tela). */
function openPicked() {
  const id = picked.value
  if (!id) return
  picked.value = null
  mindmap.openNote(id, { focus: false })
}

// "Voltar" do Android: tira a seleção do mapa (o painel e a conexão fecham pelo Esc)
onBackButton(() => {
  if (!picked.value) return false
  picked.value = null
  return true
})

function validateTitle(value: string): string | null {
  if (!value.trim()) return 'Digite um nome para a nota.'
  return null
}

async function newNote(options: { linkFrom?: string; position?: [number, number] } = {}) {
  const source = options.linkFrom ? mindmap.findNote(options.linkFrom) : null
  const title = await promptDialog({
    title: source ? 'Nova nota conectada' : 'Nova nota',
    message: source ? `Ela será conectada a “${source.title}”.` : `Cada nota é um nó do mapa “${mindmap.state.currentMap}” e um arquivo .md.`,
    label: 'Nome da nota',
    placeholder: 'Ex.: Game Design',
    confirmLabel: 'Criar nota',
    icon: source ? 'node-plus' : 'file-plus',
    validate: validateTitle,
  })
  if (!title) return
  const note = await mindmap.createNote(title, options)
  if (note) {
    await nextTick()
    panel.value?.focusEditor()
  }
}

// ── Seleção múltipla ──────────────────────────────────────────────────────────

function onSelectionChange(ids: string[]) {
  multi.value = ids
  if (!ids.length) return
  // A seleção em grupo substitui a nota aberta, a conexão e a seleção do celular
  hover.value = null
  selectedEdge.value = null
  picked.value = null
  if (mindmap.state.panelOpen) mindmap.closePanel()
}

function clearSelection() {
  multi.value = []
  if (areaSelecting.value) graph.value?.cancelAreaSelection()
  areaSelecting.value = false
}

function startAreaSelection() {
  hover.value = null
  selectedEdge.value = null
  picked.value = null
  areaSelecting.value = true
  graph.value?.startAreaSelection()
}

function deleteMulti() {
  const ids = multiNoteIds.value
  multi.value = []
  if (ids.length) void mindmap.deleteNotes(ids)
}

function colorItems(ids: string[]): MenuItemSpec[] {
  const colors = ids.map((id) => mindmap.noteColor(id))
  const same = colors.every((color) => color === colors[0]) ? colors[0] : undefined
  return [
    { id: 'color:', label: 'Padrão', type: 'radio', checked: same === null },
    ...PALETTE.map((color) => ({
      id: `color:${color}`,
      label: PALETTE_LABELS[color],
      type: 'radio' as const,
      checked: same === color,
      swatch: paletteVar(color),
    })),
  ]
}

function applyColorChoice(ids: string[], choice: string | null) {
  if (!choice?.startsWith('color:')) return false
  const color = choice.slice('color:'.length)
  mindmap.setColors(ids, isPaletteColor(color) ? color : null)
  return true
}

async function chooseMultiColor(event: MouseEvent) {
  const ids = multiNoteIds.value
  applyColorChoice(ids, await showContextMenu(colorItems(ids), event.currentTarget as Element))
}

/** Menu de uma nota que faz parte da seleção: ações para o grupo todo. */
async function onGroupContextMenu() {
  const ids = multiNoteIds.value
  const choice = await showContextMenu([
    { label: 'Cor', submenu: colorItems(ids) },
    separator,
    { id: 'delete', label: `Excluir ${ids.length} notas…`, danger: true },
  ])
  if (applyColorChoice(ids, choice) || choice !== 'delete') return
  const ok = await confirmDialog({
    title: `Excluir ${ids.length} notas?`,
    message: `Os arquivos vão para ${trashPlace()} e as conexões delas são removidas.`,
    confirmLabel: 'Excluir notas',
    danger: true,
  })
  if (ok) {
    multi.value = []
    void mindmap.deleteNotes(ids)
  }
}

function onNodeClick(node: GraphNodeInfo) {
  hover.value = null
  selectedEdge.value = null
  multi.value = []
  const id = noteIdOfNode(node.id)
  // Celular: o primeiro toque seleciona (alça de conexão, "Abrir"); o segundo abre
  if (isCompact.value && picked.value !== id) {
    picked.value = id
    return
  }
  picked.value = null
  mindmap.openNote(id, { focus: false })
}

/** Separa o id da conexão ("note:A.md|note:B.md") nas duas notas. */
function edgeNotes(edgeId: string): [string, string] | null {
  const edge = mindmap.graph.value.edges.find((e) => e.id === edgeId)
  return edge ? [noteIdOfNode(edge.source), noteIdOfNode(edge.target)] : null
}

function removeEdge(edgeId: string) {
  const notes = edgeNotes(edgeId)
  if (notes) mindmap.disconnectNotes(notes[0], notes[1])
  selectedEdge.value = null
}

async function onEdgeContextMenu(edgeId: string) {
  hover.value = null
  selectedEdge.value = edgeId
  const choice = await showContextMenu([{ id: 'remove', label: 'Remover conexão', danger: true }])
  if (choice === 'remove') removeEdge(edgeId)
}

async function onNodeContextMenu(node: GraphNodeInfo) {
  hover.value = null
  if (multi.value.length > 1 && multi.value.includes(node.id)) return onGroupContextMenu()
  multi.value = []
  const id = noteIdOfNode(node.id)
  const colors = colorItems([id])
  const choice = await showContextMenu([
    { id: 'open', label: 'Abrir' },
    { id: 'rename', label: 'Renomear…' },
    { id: 'linked', label: 'Nova nota conectada…' },
    { label: 'Cor', submenu: colors },
    ...revealItem(),
    separator,
    { id: 'delete', label: 'Excluir…', danger: true },
  ])
  if (!choice) return
  if (choice === 'open') mindmap.openNote(id, { focus: false })
  if (choice === 'linked') void newNote({ linkFrom: id })
  if (choice === 'reveal') mindmap.revealNote(id)
  applyColorChoice([id], choice)
  if (choice === 'rename') {
    const note = mindmap.findNote(id)
    const title = await promptDialog({
      title: 'Renomear nota',
      message: 'O arquivo .md é renomeado; as conexões e a cor continuam.',
      label: 'Novo nome',
      value: note?.title,
      confirmLabel: 'Renomear',
      icon: 'edit',
      validate: validateTitle,
    })
    if (title) await mindmap.renameNote(id, title)
  }
  if (choice === 'delete') {
    const note = mindmap.findNote(id)
    const ok = await confirmDialog({
      title: `Excluir “${note?.title}”?`,
      message: `O arquivo vai para ${trashPlace()} e as conexões dela são removidas.`,
      confirmLabel: 'Excluir nota',
      danger: true,
    })
    if (ok) await mindmap.deleteNote(id)
  }
}

async function onBackgroundContextMenu(world: { x: number; y: number }) {
  hover.value = null
  const choice = await showContextMenu([
    { id: 'new', label: 'Nova nota' },
    { id: 'select-area', label: 'Selecionar área', hint: layout.touch ? undefined : 'Ctrl + arrastar', enabled: hasNotes.value },
    separator,
    { id: 'relayout', label: 'Reorganizar o mapa', enabled: hasNotes.value },
  ])
  if (choice === 'new') void newNote({ position: [Math.round(world.x), Math.round(world.y)] })
  if (choice === 'select-area') startAreaSelection()
  if (choice === 'relayout') graph.value?.relayout()
}

/** Clique no vazio: tira a seleção (da conexão e da nota) e fecha o painel da nota. */
function onBackgroundClick() {
  selectedEdge.value = null
  picked.value = null
  multi.value = []
  if (mindmap.state.panelOpen) mindmap.closePanel()
}

function onBackgroundDblclick(world: { x: number; y: number }) {
  void newNote({ position: [Math.round(world.x), Math.round(world.y)] })
}

/** Seta solta num lugar vazio: pede o nome e cria a nota ali, já conectada. */
function onConnectToNew(source: string, world: { x: number; y: number }) {
  hover.value = null
  void newNote({ linkFrom: noteIdOfNode(source), position: [Math.round(world.x), Math.round(world.y)] })
}

/** Delete: remove a conexão selecionada ou, se não houver, a nota selecionada (vai para a Lixeira, com Desfazer). */
function deleteSelection(): boolean | void {
  if (multi.value.length) {
    deleteMulti()
    return
  }
  if (selectedEdge.value) {
    removeEdge(selectedEdge.value)
    return
  }
  const id = selectedNodeId.value ? (mindmap.state.panelOpen ? mindmap.state.selectedId : picked.value) : null
  if (!id) return false
  void mindmap.deleteNote(id)
}

let disposeProvider: (() => void) | null = null
onMounted(() => {
  disposeProvider = mindmap.registerPositionProvider(() => graph.value?.positions() ?? {})
})
onUnmounted(() => disposeProvider?.())

useShortcuts({
  'mod+n': () => void newNote(),
  'mod+k': () => toolbar.value?.focusSearch(),
  'mod+f': () => {
    // Dentro do editor, Ctrl+F é a busca do texto; fora dele, busca no mapa.
    if ((document.activeElement as HTMLElement | null)?.closest('.cm-editor')) return false
    toolbar.value?.focusSearch()
  },
})
useShortcuts(
  {
    escape: () => {
      if (multi.value.length || areaSelecting.value) {
        clearSelection()
        return
      }
      if (selectedEdge.value) {
        selectedEdge.value = null
        return
      }
      if (picked.value) {
        picked.value = null
        return
      }
      if (!mindmap.state.panelOpen) return false
      mindmap.closePanel()
    },
    delete: deleteSelection,
    backspace: () => {
      if (!selectedEdge.value) return false
      removeEdge(selectedEdge.value)
    },
  },
  { allowInInputs: false },
)
</script>

<template>
  <div ref="page" class="mindmap-page">
    <GraphCanvas
      v-if="hasNotes"
      :key="mindmap.state.currentMap"
      ref="graph"
      :data="mindmap.graph.value"
      :settings="graphSettings"
      :selected-id="selectedNodeId"
      :selected-edge-id="selectedEdge"
      :multi-selected="multi"
      :matches="mindmap.searchMatchNodeIds.value"
      :inset-right="panelWidth"
      :focus="mindmap.state.focus"
      :layout="mindmap.state.layout"
      :layout-seq="mindmap.state.layoutSeq"
      @node-click="onNodeClick"
      @node-hover="(node, position) => (hover = node && position ? { node, x: position.x, y: position.y } : null)"
      @node-context-menu="onNodeContextMenu"
      @connect="(source, target) => mindmap.connectNotes(noteIdOfNode(source), noteIdOfNode(target))"
      @connect-new="onConnectToNew"
      @edge-click="(id) => (selectedEdge = id)"
      @edge-context-menu="onEdgeContextMenu"
      @edge-remove="removeEdge"
      @background-click="onBackgroundClick"
      @background-dblclick="onBackgroundDblclick"
      @background-context-menu="onBackgroundContextMenu"
      @settled="mindmap.updateLayout"
      @selection-change="onSelectionChange"
      @area-end="areaSelecting = false"
      @view-change="hover = null"
    />
    <MindmapEmpty v-else :map="mindmap.state.currentMap" @create="newNote()" @context-menu="onBackgroundContextMenu({ x: 0, y: 0 })" />

    <GraphToolbar ref="toolbar" class="map-toolbar" @new="newNote()" @relayout="graph?.relayout()" />

    <div v-if="hasNotes" class="map-footer" :style="{ right: `${panelWidth + 16}px` }">
      <div class="footer-info">
        <span v-if="!isCompact" class="map-stats">{{ stats }}</span>
        <Transition name="fade">
          <span v-if="selectedEdge" class="map-hint edge-hint">
            <AppIcon name="unlink" :size="13" />
            {{ layout.touch ? 'Toque no × da conexão para remover' : 'Conexão selecionada — clique no × ou pressione Delete para remover' }}
          </span>
        </Transition>
      </div>
      <div class="zoom-controls">
        <button class="icon-btn" data-tip="Aproximar" data-tip-pos="top" aria-label="Aproximar" @click="graph?.zoomBy(1.25)"><AppIcon name="zoom-in" :size="17" /></button>
        <button class="icon-btn" data-tip="Afastar" data-tip-pos="top" aria-label="Afastar" @click="graph?.zoomBy(0.8)"><AppIcon name="zoom-out" :size="17" /></button>
        <button class="icon-btn" data-tip="Enquadrar tudo" data-tip-pos="top" aria-label="Enquadrar tudo" @click="graph?.fit()"><AppIcon name="fit" :size="17" /></button>
      </div>
    </div>

    <!-- Celular: a nota selecionada (sem abrir) — abrir, opções, conectar pela alça -->
    <Transition name="pick">
      <div v-if="pickedNote && !panelVisible" class="pick-bar" role="toolbar" :aria-label="`Nota ${pickedNote.title}`">
        <span class="pick-dot" :style="mindmap.noteColor(pickedNote.id) ? { background: paletteVar(mindmap.noteColor(pickedNote.id)!) } : undefined" />
        <span class="pick-text">
          <span class="pick-title">{{ pickedNote.title }}</span>
          <span class="pick-hint">Arraste a seta → para conectar</span>
        </span>
        <button class="icon-btn" aria-label="Mais opções" data-action="pick-menu" @click="onNodeContextMenu({ id: noteNodeId(pickedNote.id), title: pickedNote.title, degree: 0 })">
          <AppIcon name="more" :size="18" />
        </button>
        <button class="btn btn-sm btn-primary" data-action="pick-open" @click="openPicked">Abrir</button>
      </div>
    </Transition>

    <!-- Seleção múltipla: quantas, Cor, Excluir (Delete) e limpar (Esc) -->
    <Transition name="pick">
      <div
        v-if="hasNotes && (multi.length || areaSelecting)"
        class="select-bar"
        role="toolbar"
        aria-label="Notas selecionadas"
        data-selection-bar
        :style="isCompact ? undefined : { left: `calc((100% - ${panelWidth}px) / 2)` }"
      >
        <template v-if="multi.length">
          <span class="select-count" data-selection-count
            ><b>{{ multi.length }}</b> {{ multi.length === 1 ? 'nota selecionada' : 'notas selecionadas' }}</span
          >
          <button class="icon-btn" aria-label="Cor das notas selecionadas" data-tip="Cor" data-tip-pos="top" data-action="selection-color" @click="chooseMultiColor">
            <AppIcon name="palette" :size="17" />
          </button>
          <button class="btn btn-sm btn-danger-ghost" data-action="selection-delete" :data-tip="layout.touch ? undefined : 'Excluir (Delete)'" data-tip-pos="top" @click="deleteMulti">
            <AppIcon name="trash" :size="15" /> Excluir
          </button>
        </template>
        <span v-else class="select-count">{{ layout.touch ? 'Arraste o dedo sobre as notas' : 'Arraste sobre as notas' }}</span>
        <button class="icon-btn" aria-label="Limpar a seleção" data-tip="Limpar (Esc)" data-tip-pos="top" data-action="selection-clear" @click="clearSelection">
          <AppIcon name="x" :size="16" />
        </button>
      </div>
    </Transition>

    <NodeHoverCard v-if="hover && !mindmap.state.search" :node="hover.node" :x="hover.x" :y="hover.y" />

    <Transition name="panel">
      <PermanentNotePanel v-if="panelVisible" ref="panel" @new-linked="newNote({ linkFrom: mindmap.state.selectedId! })" />
    </Transition>
  </div>
</template>

<style scoped>
.mindmap-page {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--graph-bg);
}
.map-toolbar {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 10;
}
.map-footer {
  position: absolute;
  left: 16px;
  bottom: 14px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  pointer-events: none;
  transition: right 320ms var(--ease-out);
}
.footer-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.map-stats,
.map-hint {
  padding: 4px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--elevated) 85%, transparent);
  border: 1px solid var(--border);
  color: var(--text-3);
  font-size: 12px;
  white-space: nowrap;
  backdrop-filter: blur(8px);
}
.map-hint {
  overflow: hidden;
  text-overflow: ellipsis;
}
.edge-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-color: color-mix(in srgb, var(--accent-strong) 50%, var(--border));
  color: var(--accent-text);
}
.zoom-controls {
  display: flex;
  gap: 2px;
  padding: 4px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--elevated) 88%, transparent);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(10px);
  pointer-events: auto;
}
/* ── Celular ── */
html[data-layout='compact'] .map-toolbar {
  top: 10px;
  left: 10px;
  right: 10px;
}
html[data-layout='compact'] .map-footer {
  left: 10px;
  bottom: 10px;
}
.pick-bar {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 66px;
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 14px;
  border-radius: 16px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--elevated) 94%, transparent);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(10px);
}
.pick-dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--graph-node);
}
.pick-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.pick-title {
  overflow: hidden;
  font-size: 15px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pick-hint {
  color: var(--text-3);
  font-size: 12px;
}
.select-bar {
  position: absolute;
  bottom: 62px;
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 5px 5px 14px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--graph-selected) 45%, var(--border));
  background: color-mix(in srgb, var(--elevated) 94%, transparent);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(10px);
  transform: translateX(-50%);
  white-space: nowrap;
}
.select-count {
  margin-right: 6px;
  color: var(--text-2);
  font-size: 13px;
}
.select-count b {
  color: var(--text);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
html[data-layout='compact'] .select-bar {
  left: 10px;
  right: 10px;
  bottom: 66px;
  transform: none;
}
html[data-layout='compact'] .select-count {
  flex: 1;
}
.select-bar.pick-enter-from,
.select-bar.pick-leave-to {
  transform: translate(-50%, 12px);
}
html[data-layout='compact'] .select-bar.pick-enter-from,
html[data-layout='compact'] .select-bar.pick-leave-to {
  transform: translateY(12px);
}
.pick-enter-active,
.pick-leave-active {
  transition:
    transform 220ms var(--ease-out),
    opacity 180ms var(--ease-out);
}
.pick-enter-from,
.pick-leave-to {
  transform: translateY(12px);
  opacity: 0;
}

.panel-enter-active {
  transition: transform 340ms var(--ease-out), opacity 220ms var(--ease-out);
}
.panel-leave-active {
  transition: transform 220ms ease, opacity 180ms ease;
}
.panel-enter-from,
.panel-leave-to {
  transform: translateX(48px);
  opacity: 0;
}
</style>
