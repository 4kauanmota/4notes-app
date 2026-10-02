<script setup lang="ts">
/**
 * Ponte entre o Vue e o renderizador do grafo (lib/mindmap/graph-view.ts).
 * Repassa dados/configurações para o GraphView e transforma os callbacks dele em eventos Vue.
 */
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useTheme } from '~/composables/useTheme'
import { PALETTE, type PaletteColor } from '~/lib/colors'
import type { GraphData } from '~/lib/mindmap/graph'
import { GraphView, type GraphNodeInfo, type GraphTheme, type GraphViewSettings } from '~/lib/mindmap/graph-view'

const props = defineProps<{
  data: GraphData
  settings: GraphViewSettings
  selectedId: string | null
  selectedEdgeId: string | null
  matches: Set<string> | null
  insetRight: number
  focus: { nodeId: string | null; seq: number }
  layout: Record<string, [number, number]>
}>()

const emit = defineEmits<{
  nodeClick: [node: GraphNodeInfo]
  nodeHover: [node: GraphNodeInfo | null, position: { x: number; y: number } | null]
  nodeContextMenu: [node: GraphNodeInfo, event: MouseEvent]
  connect: [sourceId: string, targetId: string]
  connectNew: [sourceId: string, world: { x: number; y: number }]
  edgeClick: [edgeId: string]
  edgeContextMenu: [edgeId: string, event: MouseEvent]
  edgeRemove: [edgeId: string]
  backgroundClick: []
  backgroundDblclick: [world: { x: number; y: number }]
  backgroundContextMenu: [world: { x: number; y: number }, event: MouseEvent]
  settled: [positions: Record<string, [number, number]>]
  viewChange: []
}>()

const canvas = ref<HTMLCanvasElement>()
const { theme } = useTheme()
let view: GraphView | null = null

function readTheme(): GraphTheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    background: v('--graph-bg'),
    grid: v('--graph-grid'),
    node: v('--graph-node'),
    edge: v('--graph-edge'),
    edgeActive: v('--graph-edge-active'),
    label: v('--graph-label'),
    selected: v('--graph-selected'),
    selectedHalo: v('--accent-soft'),
    onSelected: v('--on-accent'),
    cardBackground: v('--surface'),
    cardBorder: v('--border-strong'),
    cardText: v('--text'),
    fontFamily: v('--font-ui'),
    palette: Object.fromEntries(PALETTE.map((color) => [color, v(`--cat-${color}`)])) as Record<PaletteColor, string>,
  }
}

/** Só repassa dados novos quando algo visível muda (não a cada tecla digitada). */
function signature(data: GraphData): string {
  return `${data.nodes.map((n) => `${n.id}:${n.title}:${n.degree}:${n.color ?? ''}`).join('|')}#${data.edges.map((e) => `${e.source}>${e.target}`).join('|')}`
}
let lastSignature = ''

onMounted(() => {
  view = new GraphView(
    canvas.value!,
    readTheme(),
    { ...props.settings },
    {
      nodeClick: (node) => emit('nodeClick', node),
      nodeHover: (node, position) => emit('nodeHover', node, position),
      nodeContextMenu: (node, event) => emit('nodeContextMenu', node, event),
      connect: (source, target) => emit('connect', source, target),
      connectToNew: (source, world) => emit('connectNew', source, world),
      edgeClick: (id) => emit('edgeClick', id),
      edgeContextMenu: (id, event) => emit('edgeContextMenu', id, event),
      edgeRemove: (id) => emit('edgeRemove', id),
      backgroundClick: () => emit('backgroundClick'),
      backgroundDoubleClick: (world) => emit('backgroundDblclick', world),
      backgroundContextMenu: (world, event) => emit('backgroundContextMenu', world, event),
      layoutSettled: (positions) => emit('settled', positions),
      viewChange: () => emit('viewChange'),
    },
    (id) => props.layout[id] ?? null,
  )
  view.setInsetRight(props.insetRight, false)
  lastSignature = signature(props.data)
  view.setData(props.data)
  view.setSelected(props.selectedId)
  view.setSelectedEdge(props.selectedEdgeId)
  view.setMatches(props.matches)
  const testHooks = window.__fourNotesTest
  if (testHooks) testHooks.graph = view
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
onActivated(() => view?.resume())
onDeactivated(() => view?.pause())

watch(
  () => props.data,
  (data) => {
    const next = signature(data)
    if (next === lastSignature) return
    lastSignature = next
    view?.setData(data)
  },
)
watch(
  () => ({ ...props.settings }),
  (settings) => view?.setSettings(settings),
  { deep: true },
)
watch(
  () => props.selectedId,
  (id) => view?.setSelected(id),
)
watch(
  () => props.selectedEdgeId,
  (id) => view?.setSelectedEdge(id),
)
watch(
  () => props.matches,
  (matches) => view?.setMatches(matches),
)
watch(
  () => props.insetRight,
  (pixels) => view?.setInsetRight(pixels),
)
watch(
  () => props.focus.seq,
  () => {
    if (props.focus.nodeId) view?.focusNode(props.focus.nodeId)
  },
)
watch(
  () => theme.resolved,
  async () => {
    await nextTick()
    view?.setTheme(readTheme())
  },
)

defineExpose({
  fit: () => view?.fit(true),
  zoomBy: (factor: number) => view?.zoomBy(factor),
  relayout: () => view?.relayout(),
  positions: () => view?.positions() ?? {},
  screenPosition: (id: string) => view?.screenPosition(id) ?? null,
})
</script>

<template>
  <canvas ref="canvas" class="graph-canvas" :data-nodes="data.nodes.length" :data-edges="data.edges.length" />
</template>

<style scoped>
.graph-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}
</style>
