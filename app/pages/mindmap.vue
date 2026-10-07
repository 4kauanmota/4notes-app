<script setup lang="ts">
/** Módulo MAPA MENTAL: grafo do mapa aberto + painel de edição da nota do nó. */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import GraphCanvas from '~/components/mindmap/GraphCanvas.vue'
import GraphToolbar from '~/components/mindmap/GraphToolbar.vue'
import PermanentNotePanel from '~/components/mindmap/PermanentNotePanel.vue'
import { separator, showContextMenu, type MenuItemSpec } from '~/composables/useContextMenu'
import { confirmDialog, promptDialog } from '~/composables/useDialog'
import { useShortcuts } from '~/composables/useShortcuts'
import { PALETTE, PALETTE_LABELS, isPaletteColor, paletteVar } from '~/lib/colors'
import { noteIdOfNode, noteNodeId } from '~/lib/mindmap/graph'
import type { GraphNodeInfo } from '~/lib/mindmap/graph-view'
import { useMindmapStore } from '~/stores/mindmap'

const mindmap = useMindmapStore()
const graph = ref<InstanceType<typeof GraphCanvas>>()
const toolbar = ref<InstanceType<typeof GraphToolbar>>()
const panel = ref<InstanceType<typeof PermanentNotePanel>>()
const page = ref<HTMLElement>()
const hover = ref<{ node: GraphNodeInfo; x: number; y: number } | null>(null)
/** Conexão selecionada (clique na linha): mostra o "×" para remover. */
const selectedEdge = ref<string | null>(null)

const hasNotes = computed(() => mindmap.state.notes.length > 0)
const panelVisible = computed(() => mindmap.state.panelOpen && !!mindmap.selectedNote.value)
const panelWidth = computed(() => {
  if (!panelVisible.value) return 0
  const available = page.value?.clientWidth ?? 1200
  return Math.min(mindmap.state.panelExpanded ? 820 : 480, available)
})
const selectedNodeId = computed(() => (panelVisible.value && mindmap.state.selectedId ? noteNodeId(mindmap.state.selectedId) : null))
const graphSettings = computed(() => ({ nodeStyle: mindmap.state.settings.nodeStyle, labels: mindmap.state.settings.labels }))
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
  },
)

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

function onNodeClick(node: GraphNodeInfo) {
  hover.value = null
  selectedEdge.value = null
  mindmap.openNote(noteIdOfNode(node.id), { focus: false })
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
  const id = noteIdOfNode(node.id)
  const current = mindmap.noteColor(id)
  const colors: MenuItemSpec[] = [
    { id: 'color:', label: 'Padrão', type: 'radio', checked: !current },
    ...PALETTE.map((color) => ({
      id: `color:${color}`,
      label: PALETTE_LABELS[color],
      type: 'radio' as const,
      checked: current === color,
      swatch: paletteVar(color),
    })),
  ]
  const choice = await showContextMenu([
    { id: 'open', label: 'Abrir' },
    { id: 'rename', label: 'Renomear…' },
    { id: 'linked', label: 'Nova nota conectada…' },
    { label: 'Cor', submenu: colors },
    { id: 'reveal', label: 'Mostrar no Explorador' },
    separator,
    { id: 'delete', label: 'Excluir…', danger: true },
  ])
  if (!choice) return
  if (choice === 'open') mindmap.openNote(id, { focus: false })
  if (choice === 'linked') void newNote({ linkFrom: id })
  if (choice === 'reveal') mindmap.revealNote(id)
  if (choice.startsWith('color:')) {
    const color = choice.slice('color:'.length)
    mindmap.setColor(id, isPaletteColor(color) ? color : null)
  }
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
      message: 'O arquivo vai para a Lixeira e as conexões dela são removidas.',
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
    separator,
    { id: 'relayout', label: 'Reorganizar o mapa', enabled: hasNotes.value },
  ])
  if (choice === 'new') void newNote({ position: [Math.round(world.x), Math.round(world.y)] })
  if (choice === 'relayout') graph.value?.relayout()
}

/** Clique no vazio: tira a seleção (da conexão e da nota) e fecha o painel da nota. */
function onBackgroundClick() {
  selectedEdge.value = null
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
  if (selectedEdge.value) {
    removeEdge(selectedEdge.value)
    return
  }
  const id = selectedNodeId.value ? mindmap.state.selectedId : null
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
      if (selectedEdge.value) {
        selectedEdge.value = null
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
      :matches="mindmap.searchMatchNodeIds.value"
      :inset-right="panelWidth"
      :focus="mindmap.state.focus"
      :layout="mindmap.state.layout"
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
      @view-change="hover = null"
    />
    <MindmapEmpty v-else :map="mindmap.state.currentMap" @create="newNote()" @context-menu="onBackgroundContextMenu({ x: 0, y: 0 })" />

    <GraphToolbar ref="toolbar" class="map-toolbar" @new="newNote()" @relayout="graph?.relayout()" />

    <div v-if="hasNotes" class="map-footer" :style="{ right: `${panelWidth + 16}px` }">
      <div class="footer-info">
        <span class="map-stats">{{ stats }}</span>
        <Transition name="fade">
          <span v-if="selectedEdge" class="map-hint edge-hint">
            <AppIcon name="unlink" :size="13" /> Conexão selecionada — clique no × ou pressione Delete para remover
          </span>
        </Transition>
      </div>
      <div class="zoom-controls">
        <button class="icon-btn" data-tip="Aproximar" data-tip-pos="top" aria-label="Aproximar" @click="graph?.zoomBy(1.25)"><AppIcon name="zoom-in" :size="17" /></button>
        <button class="icon-btn" data-tip="Afastar" data-tip-pos="top" aria-label="Afastar" @click="graph?.zoomBy(0.8)"><AppIcon name="zoom-out" :size="17" /></button>
        <button class="icon-btn" data-tip="Enquadrar tudo" data-tip-pos="top" aria-label="Enquadrar tudo" @click="graph?.fit()"><AppIcon name="fit" :size="17" /></button>
      </div>
    </div>

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
