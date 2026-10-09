<script setup lang="ts">
/**
 * Módulo MAPA MENTAL: grafo do mapa aberto + painel de edição da nota do nó.
 *
 * No celular (layout compact) o painel ocupa a tela: tocar numa nota primeiro a
 * seleciona (com a alça de conexão e uma barrinha com "Abrir"); tocar de novo — ou em
 * "Abrir" — abre a nota.
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

function onNodeClick(node: GraphNodeInfo) {
  hover.value = null
  selectedEdge.value = null
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
    ...revealItem(),
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
    separator,
    { id: 'relayout', label: 'Reorganizar o mapa', enabled: hasNotes.value },
  ])
  if (choice === 'new') void newNote({ position: [Math.round(world.x), Math.round(world.y)] })
  if (choice === 'relayout') graph.value?.relayout()
}

/** Clique no vazio: tira a seleção (da conexão e da nota) e fecha o painel da nota. */
function onBackgroundClick() {
  selectedEdge.value = null
  picked.value = null
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
