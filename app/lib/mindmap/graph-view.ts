/**
 * Renderizador do Mapa Mental (<canvas>, desenhado a cada quadro de animação).
 *
 * - Os nós ficam onde você os deixa: novas notas aparecem num espaço livre perto
 *   da nota ligada a elas, e "Reorganizar" calcula um layout limpo (layout.ts).
 * - Arrastar uma nota a move. Shift + arrastar a partir de uma nota desenha uma
 *   seta: soltar sobre outra nota cria a conexão; soltar no vazio pede uma nota
 *   nova ali, já conectada. Arrastar o fundo move a câmera.
 * - Clicar numa conexão seleciona; o "×" no meio dela (ou Delete) remove.
 * - Com o mouse sobre uma nota, as setas que saem dela ficam com a cor dela.
 * - Toque (celular): um dedo arrasta a nota ou move o mapa; dois dedos (pinça)
 *   aproximam, afastam e movem; tocar seleciona; dois toques no vazio criam uma nota;
 *   segurar abre o menu (o "clique direito"). A nota selecionada ganha uma alça (→):
 *   arrastar a alça puxa a seta de conexão — o Shift + arrastar do toque.
 *
 * Esta classe não conhece Vue nem arquivos: recebe dados (GraphData) e cores
 * (GraphTheme) e avisa o que aconteceu por callbacks (GraphViewEvents).
 */
import type { PaletteColor } from '../colors'
import type { GraphData } from './graph'
import { computeLayout, findFreeSpot, type Point } from './layout'

export interface GraphTheme {
  background: string
  grid: string
  node: string
  edge: string
  edgeActive: string
  label: string
  selected: string
  selectedHalo: string
  onSelected: string
  cardBackground: string
  cardBorder: string
  cardText: string
  fontFamily: string
  palette: Record<PaletteColor, string>
}

export interface GraphViewSettings {
  nodeStyle: 'circle' | 'card'
  labels: 'selected' | 'auto' | 'always'
  /** Tela de toque: mostra a alça de conexão na nota selecionada. */
  touch?: boolean
}

export interface GraphNodeInfo {
  id: string
  title: string
  degree: number
}

export interface GraphViewEvents {
  nodeClick?(node: GraphNodeInfo): void
  nodeHover?(node: GraphNodeInfo | null, screen: { x: number; y: number } | null): void
  nodeContextMenu?(node: GraphNodeInfo, event: MouseEvent): void
  /** Uma seta foi arrastada (Shift + arrastar) de `sourceId` e solta sobre `targetId`. */
  connect?(sourceId: string, targetId: string): void
  /** A seta foi solta num lugar vazio: criar uma nota ali, conectada a `sourceId`. */
  connectToNew?(sourceId: string, world: { x: number; y: number }): void
  edgeClick?(edgeId: string): void
  edgeContextMenu?(edgeId: string, event: MouseEvent): void
  /** Clique no "×" da conexão selecionada. */
  edgeRemove?(edgeId: string): void
  backgroundClick?(): void
  backgroundDoubleClick?(world: { x: number; y: number }): void
  backgroundContextMenu?(world: { x: number; y: number }, event: MouseEvent): void
  /** As posições mudaram (nota movida, nova nota posicionada, mapa reorganizado). */
  layoutSettled?(positions: Record<string, [number, number]>): void
  /** A câmera mudou (zoom/arraste): útil para esconder elementos sobrepostos. */
  viewChange?(): void
}

interface Node {
  id: string
  title: string
  degree: number
  color: PaletteColor | null
  label: string
  radius: number
  width: number
  height: number
  /** Posição atual e posição de destino (as duas são iguais quando o nó está parado). */
  x: number
  y: number
  tx: number
  ty: number
  /** Animação de entrada (0 → 1). */
  appear: number
  /** Opacidade atual (para destacar/esmaecer suavemente). */
  alpha: number
  /** Destaque do nó sob o mouse (0 → 1). */
  emphasis: number
}

interface Edge {
  id: string
  source: Node
  target: Node
  appear: number
  alpha: number
  active: number
  /** Cor do destaque: a da nota sob o mouse, quando a seta sai dela (null = cor padrão do destaque). */
  tint: string | null
}

interface Camera {
  x: number
  y: number
  k: number
}

type PointerKind = 'node' | 'edge' | 'badge' | 'background' | 'handle'

interface PointerState {
  id: number
  x: number
  y: number
  startX: number
  startY: number
  kind: PointerKind
  node: Node | null
  edgeId: string | null
  shift: boolean
  moved: boolean
  action: 'none' | 'link' | 'move' | 'pan'
  /** Dedo (toque): precisa mexer mais para virar arraste. */
  touch: boolean
}

/** Pinça com dois dedos: o ponto do mapa que estava entre os dedos continua entre eles. */
interface PinchState {
  distance: number
  k: number
  world: { x: number; y: number }
}

const MIN_ZOOM = 0.08
const MAX_ZOOM = 4
const TAU = Math.PI * 2
const DRAG_THRESHOLD = 4
const TOUCH_DRAG_THRESHOLD = 9
/** Dois toques no mesmo lugar, nesse intervalo, contam como toque duplo. */
const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_DISTANCE = 30
const NEW_NODE_DISTANCE = 150

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOutBack = (t: number) => {
  const c1 = 1.4
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export class GraphView {
  private readonly ctx: CanvasRenderingContext2D
  private width = 0
  private height = 0
  private dpr = 1
  private nodes: Node[] = []
  private edges: Edge[] = []
  private nodeMap = new Map<string, Node>()
  private adjacency = new Map<string, Set<string>>()
  private camera: Camera = { x: 0, y: 0, k: 1 }
  private tween: {
    from: { cx: number; cy: number; k: number }
    to: { cx: number; cy: number; k: number }
    start: number
    duration: number
    /** "inset" = ajuste por causa do painel (abrir/fechar); "view" = enquadrar, focar etc. */
    kind: 'inset' | 'view'
  } | null = null
  private hovered: Node | null = null
  private hoveredEdge: Edge | null = null
  private badgeHovered = false
  private selectedId: string | null = null
  private selectedEdgeId: string | null = null
  private matches: Set<string> | null = null
  private insetRight = 0
  private pointer: PointerState | null = null
  /** Dedos na tela agora (toque), pelo id do ponteiro. */
  private touches = new Map<number, { x: number; y: number }>()
  private pinch: PinchState | null = null
  private lastTap: { time: number; x: number; y: number } | null = null
  private lastPointerType = 'mouse'
  /** Destino da seta sendo arrastada (nó sob o mouse) e ponta livre da seta. */
  private linkTarget: Node | null = null
  private linkEnd: { x: number; y: number } | null = null
  private frameHandle = 0
  private running = false
  private paused = false
  private destroyed = false
  private lastTime = 0
  private fitted = false
  /** Alguma posição mudou e ainda não foi avisada via layoutSettled. */
  private positionsDirty = false
  private readonly resizeObserver: ResizeObserver

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private theme: GraphTheme,
    private settings: GraphViewSettings,
    private readonly events: GraphViewEvents,
    private readonly initialPosition: (id: string) => [number, number] | null,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D indisponível')
    this.ctx = ctx

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('dblclick', this.onDoubleClick)
    canvas.addEventListener('contextmenu', this.onContextMenu)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
  }

  // ── API pública ───────────────────────────────────────────────────────────

  setData(data: GraphData): void {
    const previous = this.nodeMap
    const nextMap = new Map<string, Node>()
    const created: Node[] = []

    const nodes = data.nodes.map((info) => {
      let node = previous.get(info.id)
      if (node) {
        node.title = info.title
        node.degree = info.degree
        node.color = info.color
      } else {
        node = {
          id: info.id,
          title: info.title,
          degree: info.degree,
          color: info.color,
          label: '',
          radius: 0,
          width: 0,
          height: 0,
          x: Number.NaN,
          y: Number.NaN,
          tx: Number.NaN,
          ty: Number.NaN,
          appear: 0,
          alpha: 1,
          emphasis: 0,
        }
        created.push(node)
      }
      this.measure(node)
      nextMap.set(info.id, node)
      return node
    })

    this.adjacency = new Map()
    for (const edge of data.edges) {
      if (!this.adjacency.has(edge.source)) this.adjacency.set(edge.source, new Set())
      if (!this.adjacency.has(edge.target)) this.adjacency.set(edge.target, new Set())
      this.adjacency.get(edge.source)!.add(edge.target)
      this.adjacency.get(edge.target)!.add(edge.source)
    }

    this.nodes = nodes
    this.nodeMap = nextMap
    const previousEdges = new Map(this.edges.map((edge) => [edge.id, edge]))
    this.edges = data.edges.map((edge) => {
      const old = previousEdges.get(edge.id)
      return {
        id: edge.id,
        source: nextMap.get(edge.source)!,
        target: nextMap.get(edge.target)!,
        appear: old ? old.appear : created.length === nodes.length ? 1 : 0,
        alpha: old?.alpha ?? 1,
        active: old?.active ?? 0,
        tint: old?.tint ?? null,
      }
    })
    this.placeNewNodes(created)

    if (this.hovered && !nextMap.has(this.hovered.id)) this.hovered = null
    if (this.hoveredEdge && !this.edges.some((edge) => edge.id === this.hoveredEdge!.id)) this.hoveredEdge = null
    if (this.pointer?.node && !nextMap.has(this.pointer.node.id)) this.pointer = null
    if (!this.fitted && this.width > 10 && this.nodes.length) this.fit(false)
    this.wake()
  }

  setTheme(theme: GraphTheme): void {
    this.theme = theme
    for (const node of this.nodes) this.measure(node)
    this.wake()
  }

  setSettings(settings: GraphViewSettings): void {
    this.settings = settings
    for (const node of this.nodes) this.measure(node)
    this.wake()
  }

  setSelected(id: string | null): void {
    this.selectedId = id
    this.wake()
  }

  setSelectedEdge(id: string | null): void {
    this.selectedEdgeId = id
    this.badgeHovered = false
    this.wake()
  }

  setMatches(ids: Set<string> | null): void {
    this.matches = ids && ids.size ? ids : ids ? new Set() : null
    this.wake()
  }

  /**
   * Área à direita coberta por um painel. Ao abrir/fechar o painel, a câmera
   * desliza para manter no centro do espaço visível o que já estava lá.
   */
  setInsetRight(pixels: number, animate = true): void {
    const next = Math.max(0, pixels)
    if (next === this.insetRight) return
    // Se a câmera ainda está indo para algum lugar, o centro que vale é o de destino
    // (abrir e fechar o painel rápido não pode deixar o mapa deslocado)
    const target = this.tween ? this.tween.to : { ...this.viewCenter(), k: this.camera.k }
    this.insetRight = next
    if (this.width > 10 && this.fitted) this.moveCamera({ cx: target.cx, cy: target.cy, k: target.k }, animate, 'inset')
  }

  /** Enquadra todos os nós na tela (usa as posições de destino, se estiverem animando). */
  fit(animate = true, padding = Math.min(90, Math.max(28, (this.width || 800) * 0.1))): void {
    if (!this.nodes.length || this.width < 10) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of this.nodes) {
      const halfW = this.cardMode ? node.width / 2 : node.radius
      const halfH = this.cardMode ? node.height / 2 : node.radius
      minX = Math.min(minX, node.tx - halfW)
      maxX = Math.max(maxX, node.tx + halfW)
      minY = Math.min(minY, node.ty - halfH)
      maxY = Math.max(maxY, node.ty + halfH + 18)
    }
    const availableWidth = Math.max(80, this.width - this.insetRight - padding * 2)
    const availableHeight = Math.max(80, this.height - padding * 2)
    const k = clamp(Math.min(availableWidth / Math.max(maxX - minX, 1), availableHeight / Math.max(maxY - minY, 1)), 0.15, 1.6)
    this.moveCamera({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, k }, animate)
    this.fitted = true
  }

  /** Centraliza um nó (usado ao abrir uma nota pela busca). */
  focusNode(id: string, animate = true): void {
    const node = this.nodeMap.get(id)
    if (!node) return
    const k = clamp(this.camera.k < 0.8 ? 1.05 : this.camera.k, 0.8, 1.8)
    this.moveCamera({ cx: node.tx, cy: node.ty, k }, animate)
  }

  zoomBy(factor: number): void {
    this.zoomAt({ x: (this.width - this.insetRight) / 2, y: this.height / 2 }, this.camera.k * factor)
  }

  /** Posições que chegaram de fora (o mesmo mapa arrumado em outro aparelho): as notas deslizam até elas. */
  setPositions(layout: Record<string, [number, number]>): void {
    if (this.pointer?.action === 'move') return
    let changed = false
    for (const node of this.nodes) {
      const position = layout[node.id]
      if (!position || (Math.round(node.tx) === position[0] && Math.round(node.ty) === position[1])) continue
      node.tx = position[0]
      node.ty = position[1]
      if (!Number.isFinite(node.x)) {
        node.x = node.tx
        node.y = node.ty
      }
      changed = true
    }
    if (changed) this.wake()
  }

  positions(): Record<string, [number, number]> {
    const result: Record<string, [number, number]> = {}
    for (const node of this.nodes) result[node.id] = [Math.round(node.tx), Math.round(node.ty)]
    return result
  }

  /** Posição de um nó na tela (relativa ao canvas). */
  screenPosition(id: string): { x: number; y: number } | null {
    const node = this.nodeMap.get(id)
    return node ? this.toScreen(node) : null
  }

  /** Meio de uma conexão na tela (relativo ao canvas). */
  edgeScreenMidpoint(id: string): { x: number; y: number } | null {
    const edge = this.edges.find((e) => e.id === id)
    if (!edge) return null
    return this.toScreen({ x: (edge.source.x + edge.target.x) / 2, y: (edge.source.y + edge.target.y) / 2 })
  }

  /** "Reorganizar mapa": calcula um layout limpo (layout.ts) e anima os nós até ele. */
  relayout(): void {
    if (!this.nodes.length) return
    const positions = computeLayout(
      this.nodes.map((node) => ({ id: node.id, ...this.footprint(node) })),
      this.edges.map((edge) => ({ source: edge.source.id, target: edge.target.id })),
    )
    for (const node of this.nodes) {
      const target = positions[node.id]
      if (!target) continue
      node.tx = target[0]
      node.ty = target[1]
    }
    this.positionsDirty = true
    this.fit(true)
    this.wake()
  }

  pause(): void {
    this.paused = true
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle)
    this.frameHandle = 0
    this.running = false
  }

  resume(): void {
    this.paused = false
    this.resize()
    this.wake()
  }

  destroy(): void {
    this.destroyed = true
    this.pause()
    this.resizeObserver.disconnect()
    const canvas = this.canvas
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointercancel', this.onPointerUp)
    canvas.removeEventListener('pointerleave', this.onPointerLeave)
    canvas.removeEventListener('wheel', this.onWheel)
    canvas.removeEventListener('dblclick', this.onDoubleClick)
    canvas.removeEventListener('contextmenu', this.onContextMenu)
  }

  // ── Posições e medidas ────────────────────────────────────────────────────

  private get cardMode(): boolean {
    return this.settings.nodeStyle === 'card'
  }

  /** Espaço que o nó ocupa (com o nome embaixo, no modo círculo) — usado pelo layout. */
  private footprint(node: Node): { width: number; height: number } {
    if (this.cardMode) return { width: node.width, height: node.height }
    this.ctx.font = `500 12px ${this.theme.fontFamily}`
    const label = Math.min(130, this.ctx.measureText(node.label).width)
    return { width: Math.max(node.radius * 2, label), height: node.radius * 2 + 22 }
  }

  /** Posição dos nós novos: salva → perto de um vizinho → num espaço livre perto do centro da tela. */
  private placeNewNodes(created: Node[]): void {
    if (!created.length) return
    const pending: Node[] = []
    for (const node of created) {
      const saved = this.initialPosition(node.id)
      if (saved) {
        node.x = node.tx = saved[0]
        node.y = node.ty = saved[1]
      } else {
        pending.push(node)
      }
    }
    if (!pending.length) return
    this.positionsDirty = true

    const placed = this.nodes.filter((node) => !Number.isNaN(node.tx))
    if (!placed.length) {
      // Mapa sem nenhuma posição salva (ex.: notas criadas fora do app): layout completo
      const positions = computeLayout(
        this.nodes.map((node) => ({ id: node.id, ...this.footprint(node) })),
        this.edges.map((edge) => ({ source: edge.source.id, target: edge.target.id })),
      )
      for (const node of this.nodes) {
        const [x, y] = positions[node.id] ?? [0, 0]
        node.x = node.tx = x
        node.y = node.ty = y
      }
      return
    }

    const occupied: Point[] = placed.map((node) => [node.tx, node.ty])
    for (const node of pending) {
      const neighbor = [...(this.adjacency.get(node.id) ?? [])]
        .map((id) => this.nodeMap.get(id))
        .find((other): other is Node => !!other && !Number.isNaN(other.tx))
      let spot: Point
      if (neighbor) {
        // Afasta-se dos outros vizinhos da nota de origem (abre um "galho" novo)
        let dx = 0
        let dy = 0
        for (const id of this.adjacency.get(neighbor.id) ?? []) {
          const other = this.nodeMap.get(id)
          if (!other || other === node || Number.isNaN(other.tx)) continue
          dx += other.tx - neighbor.tx
          dy += other.ty - neighbor.ty
        }
        const angle = dx || dy ? Math.atan2(-dy, -dx) : 0
        spot = findFreeSpot([neighbor.tx, neighbor.ty], occupied, NEW_NODE_DISTANCE, angle)
      } else {
        const center = this.viewCenter()
        spot = findFreeSpot([center.cx, center.cy], occupied, NEW_NODE_DISTANCE * 0.8)
      }
      node.x = node.tx = spot[0]
      node.y = node.ty = spot[1]
      occupied.push(spot)
    }
  }

  private measure(node: Node): void {
    node.radius = 6.5 + Math.min(13, Math.sqrt(node.degree) * 3)
    const maxChars = this.cardMode ? 30 : 34
    node.label = node.title.length > maxChars ? `${node.title.slice(0, maxChars - 1).trimEnd()}…` : node.title
    if (this.cardMode) {
      this.ctx.font = `600 13px ${this.theme.fontFamily}`
      node.width = Math.min(240, this.ctx.measureText(node.label).width) + 38
      node.height = 32
    } else {
      node.width = node.radius * 2
      node.height = node.radius * 2
    }
  }

  private colorOf(node: Node): string {
    return node.color ? this.theme.palette[node.color] : this.theme.node
  }

  // ── Câmera ────────────────────────────────────────────────────────────────

  private toScreen(point: { x: number; y: number }): { x: number; y: number } {
    return { x: point.x * this.camera.k + this.camera.x, y: point.y * this.camera.k + this.camera.y }
  }

  private toWorld(point: { x: number; y: number }): { x: number; y: number } {
    return { x: (point.x - this.camera.x) / this.camera.k, y: (point.y - this.camera.y) / this.camera.k }
  }

  private viewCenter(): { cx: number; cy: number } {
    const visibleWidth = (this.width || 800) - this.insetRight
    return { cx: (visibleWidth / 2 - this.camera.x) / this.camera.k, cy: ((this.height || 600) / 2 - this.camera.y) / this.camera.k }
  }

  private setCenter(cx: number, cy: number, k: number): void {
    this.camera.k = k
    this.camera.x = (this.width - this.insetRight) / 2 - cx * k
    this.camera.y = this.height / 2 - cy * k
  }

  private moveCamera(to: { cx: number; cy: number; k: number }, animate: boolean, kind: 'inset' | 'view' = 'view'): void {
    if (!animate) {
      this.tween = null
      this.setCenter(to.cx, to.cy, to.k)
      this.wake()
      return
    }
    const { cx, cy } = this.viewCenter()
    this.tween = { from: { cx, cy, k: this.camera.k }, to, start: performance.now(), duration: 560, kind }
    this.events.viewChange?.()
    this.wake()
  }

  private zoomAt(point: { x: number; y: number }, nextK: number): void {
    const k = clamp(nextK, MIN_ZOOM, MAX_ZOOM)
    this.camera.x = point.x - (point.x - this.camera.x) * (k / this.camera.k)
    this.camera.y = point.y - (point.y - this.camera.y) * (k / this.camera.k)
    this.camera.k = k
    this.tween = null
    this.wake()
  }

  private stepCamera(time: number): boolean {
    const tween = this.tween
    if (!tween) return false
    const t = clamp((time - tween.start) / tween.duration, 0, 1)
    const e = easeInOutCubic(t)
    const k = tween.from.k * Math.pow(tween.to.k / tween.from.k, e)
    this.setCenter(tween.from.cx + (tween.to.cx - tween.from.cx) * e, tween.from.cy + (tween.to.cy - tween.from.cy) * e, k)
    if (t >= 1) {
      this.tween = null
      return false
    }
    return true
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    if (width === this.width && height === this.height && dpr === this.dpr) return
    const hadSize = this.width > 1 && this.height > 1
    const center = hadSize ? this.viewCenter() : null
    this.width = width
    this.height = height
    this.dpr = dpr
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    if (center) this.setCenter(center.cx, center.cy, this.camera.k)
    else this.setCenter(0, 0, this.camera.k)
    if (!this.fitted && this.nodes.length && width > 10) this.fit(false)
    this.wake()
  }

  // ── Laço de animação ──────────────────────────────────────────────────────

  private wake(): void {
    if (this.running || this.paused || this.destroyed) return
    this.running = true
    this.lastTime = 0
    this.frameHandle = requestAnimationFrame(this.frame)
  }

  private frame = (time: number): void => {
    this.frameHandle = 0
    if (this.paused || this.destroyed) {
      this.running = false
      return
    }
    const dt = this.lastTime ? Math.min(50, time - this.lastTime) : 16
    this.lastTime = time
    let busy = false
    if (this.stepPositions(dt)) busy = true
    if (this.stepCamera(time)) busy = true
    if (this.stepVisuals(dt)) busy = true
    this.draw()

    if (!busy && this.positionsDirty && !this.pointer) {
      this.positionsDirty = false
      this.events.layoutSettled?.(this.positions())
    }
    if (busy) this.frameHandle = requestAnimationFrame(this.frame)
    else this.running = false
  }

  /** Move os nós suavemente até a posição de destino. */
  private stepPositions(dt: number): boolean {
    const smoothing = 1 - Math.exp(-dt / 85)
    let busy = false
    for (const node of this.nodes) {
      const dx = node.tx - node.x
      const dy = node.ty - node.y
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
        node.x = node.tx
        node.y = node.ty
        continue
      }
      node.x += dx * smoothing
      node.y += dy * smoothing
      busy = true
    }
    return busy
  }

  private focusNodeNow(): Node | null {
    if (this.pointer?.action === 'link') return this.pointer.node
    if (this.pointer?.node && this.pointer.moved) return this.pointer.node
    return this.hovered
  }

  /** Interpola opacidades/destaques — é isso que deixa as transições suaves. */
  private stepVisuals(dt: number): boolean {
    const focus = this.focusNodeNow()
    const related = focus ? new Set([focus.id, ...(this.adjacency.get(focus.id) ?? [])]) : null
    const smoothing = 1 - Math.exp(-dt / 70)
    let busy = false

    for (const node of this.nodes) {
      let target = 1
      if (this.pointer?.action === 'link') target = 1
      else if (related) target = related.has(node.id) || node.id === this.selectedId ? 1 : 0.18
      else if (this.matches) target = this.matches.has(node.id) || node.id === this.selectedId ? 1 : 0.16
      const emphasisTarget = node === focus || node === this.linkTarget ? 1 : 0
      node.alpha += (target - node.alpha) * smoothing
      node.emphasis += (emphasisTarget - node.emphasis) * smoothing
      if (node.appear < 1) {
        node.appear = Math.min(1, node.appear + dt / 420)
        busy = true
      }
      if (Math.abs(target - node.alpha) > 0.004 || Math.abs(emphasisTarget - node.emphasis) > 0.004) busy = true
    }

    for (const edge of this.edges) {
      const activeTarget = (focus && (edge.source === focus || edge.target === focus)) || edge === this.hoveredEdge ? 1 : 0
      // A seta que sai da nota sob o mouse fica com a cor dela (a cor continua enquanto o destaque some)
      if (activeTarget) edge.tint = focus && edge.source === focus ? this.colorOf(focus) : null
      let alphaTarget = 1
      if (this.pointer?.action === 'link') alphaTarget = 1
      else if (focus) alphaTarget = activeTarget ? 1 : 0.08
      else if (this.matches) alphaTarget = this.matches.has(edge.source.id) && this.matches.has(edge.target.id) ? 1 : 0.1
      edge.active += (activeTarget - edge.active) * smoothing
      edge.alpha += (alphaTarget - edge.alpha) * smoothing
      if (edge.appear < 1) {
        edge.appear = Math.min(1, edge.appear + dt / 360)
        busy = true
      }
      if (Math.abs(activeTarget - edge.active) > 0.004 || Math.abs(alphaTarget - edge.alpha) > 0.004) busy = true
    }
    return busy
  }

  // ── Desenho ───────────────────────────────────────────────────────────────

  private draw(): void {
    const { ctx, dpr, camera, theme } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = theme.background
    ctx.fillRect(0, 0, this.width, this.height)
    this.drawGrid()
    if (!this.nodes.length) return

    // Mundo (aplica zoom e deslocamento da câmera)
    ctx.setTransform(dpr * camera.k, 0, 0, dpr * camera.k, dpr * camera.x, dpr * camera.y)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const edge of this.edges) this.drawEdge(edge)
    this.drawLinkPreview()

    for (const node of this.nodes) {
      ctx.globalAlpha = node.alpha * Math.min(1, node.appear * 1.6)
      if (this.cardMode) this.drawCard(node)
      else this.drawCircle(node)
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    this.drawRemoveBadge()
    this.drawConnectHandle()

    if (!this.cardMode) this.drawLabels()
  }

  private drawGrid(): void {
    const { ctx, camera } = this
    let spacing = 36 * camera.k
    while (spacing < 22) spacing *= 2
    const offsetX = ((camera.x % spacing) + spacing) % spacing
    const offsetY = ((camera.y % spacing) + spacing) % spacing
    ctx.fillStyle = this.theme.grid
    const size = 1.6
    for (let x = offsetX; x < this.width; x += spacing) {
      for (let y = offsetY; y < this.height; y += spacing) ctx.fillRect(x - size / 2, y - size / 2, size, size)
    }
  }

  /** Ponto na borda do nó, na direção de (towardX, towardY) — a seta encosta no nó. */
  private boundaryPoint(node: Node, towardX: number, towardY: number, extra = 0): { x: number; y: number } {
    const dx = towardX - node.x
    const dy = towardY - node.y
    const length = Math.hypot(dx, dy) || 1
    if (!this.cardMode) {
      const r = node.radius * (1 + node.emphasis * 0.2) + extra
      return { x: node.x + (dx / length) * r, y: node.y + (dy / length) * r }
    }
    const hw = node.width / 2 + extra
    const hh = node.height / 2 + extra
    const scale = Math.min(hw / Math.max(Math.abs(dx), 1e-6), hh / Math.max(Math.abs(dy), 1e-6))
    return { x: node.x + dx * scale, y: node.y + dy * scale }
  }

  private drawArrowLine(from: { x: number; y: number }, to: { x: number; y: number }, color: string, width: number, arrow: number): void {
    const { ctx } = this
    const angle = Math.atan2(to.y - from.y, to.x - from.x)
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (length < 1) return
    const back = Math.min(arrow * 0.85, length)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x - Math.cos(angle) * back, to.y - Math.sin(angle) * back)
    ctx.stroke()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(to.x, to.y)
    ctx.lineTo(to.x - Math.cos(angle - 0.42) * arrow, to.y - Math.sin(angle - 0.42) * arrow)
    ctx.lineTo(to.x - Math.cos(angle + 0.42) * arrow, to.y - Math.sin(angle + 0.42) * arrow)
    ctx.closePath()
    ctx.fill()
  }

  private drawEdge(edge: Edge): void {
    const { ctx, theme, camera } = this
    const { source, target } = edge
    const selected = edge.id === this.selectedEdgeId
    const from = this.boundaryPoint(source, target.x, target.y, 1 / camera.k)
    const to = this.boundaryPoint(target, source.x, source.y, 2.5 / camera.k)
    ctx.globalAlpha = edge.alpha * Math.min(source.appear, target.appear) * edge.appear
    if (selected) {
      ctx.globalAlpha = Math.max(ctx.globalAlpha, 0.9)
      this.drawArrowLine(from, to, theme.selectedHalo, 7 / camera.k, 13 / camera.k)
    }
    const color = selected ? theme.selected : edge.active > 0.5 ? (edge.tint ?? theme.edgeActive) : theme.edge
    this.drawArrowLine(from, to, color, (selected ? 2.4 : 1.2 + edge.active * 0.8) / camera.k, (selected ? 10 : 8) / camera.k)
  }

  /** A seta está solta num lugar vazio, longe da nota de origem (soltar ali cria uma nota nova)? */
  private isEmptyDrop(source: Node): boolean {
    const end = this.linkEnd
    if (!end || this.linkTarget) return false
    const screen = this.toScreen(end)
    if (this.hitTest(screen)) return false
    const reach = (this.cardMode ? Math.max(source.width, source.height) / 2 : source.radius) * this.camera.k + 28
    return Math.hypot(end.x - source.x, end.y - source.y) * this.camera.k > reach
  }

  /** Seta temporária enquanto você arrasta de uma nota até outra (ou até um lugar vazio). */
  private drawLinkPreview(): void {
    const pointer = this.pointer
    if (pointer?.action !== 'link' || !pointer.node || !this.linkEnd) return
    const { ctx, theme, camera } = this
    const source = pointer.node
    const target = this.linkTarget
    const end = target ? this.boundaryPoint(target, source.x, source.y, 3 / camera.k) : this.linkEnd
    const start = this.boundaryPoint(source, end.x, end.y, 1 / camera.k)
    ctx.globalAlpha = 1
    ctx.setLineDash([7 / camera.k, 5 / camera.k])
    this.drawArrowLine(start, end, theme.edgeActive, 2 / camera.k, 11 / camera.k)
    ctx.setLineDash([])
    if (target) {
      ctx.beginPath()
      ctx.strokeStyle = theme.selected
      ctx.lineWidth = 2.5 / camera.k
      if (this.cardMode) {
        ctx.roundRect(target.x - target.width / 2 - 5 / camera.k, target.y - target.height / 2 - 5 / camera.k, target.width + 10 / camera.k, target.height + 10 / camera.k, 13)
      } else {
        ctx.arc(target.x, target.y, target.radius * 1.2 + 6 / camera.k, 0, TAU)
      }
      ctx.stroke()
    } else if (this.isEmptyDrop(source)) {
      // Lugar vazio: mostra onde a nota nova vai aparecer
      const r = 14 / camera.k
      ctx.beginPath()
      ctx.setLineDash([4 / camera.k, 3 / camera.k])
      ctx.arc(end.x, end.y, r, 0, TAU)
      ctx.fillStyle = theme.background
      ctx.fill()
      ctx.strokeStyle = theme.edgeActive
      ctx.lineWidth = 1.6 / camera.k
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(end.x - r / 2.2, end.y)
      ctx.lineTo(end.x + r / 2.2, end.y)
      ctx.moveTo(end.x, end.y - r / 2.2)
      ctx.lineTo(end.x, end.y + r / 2.2)
      ctx.stroke()
    }
  }

  /** "×" no meio da conexão selecionada. */
  private badgeCenter(): { x: number; y: number; r: number } | null {
    if (!this.selectedEdgeId) return null
    const edge = this.edges.find((e) => e.id === this.selectedEdgeId)
    if (!edge) return null
    return { x: (edge.source.x + edge.target.x) / 2, y: (edge.source.y + edge.target.y) / 2, r: 11 / this.camera.k }
  }

  private drawRemoveBadge(): void {
    const badge = this.badgeCenter()
    if (!badge) return
    const { ctx, theme, camera } = this
    const r = badge.r * (this.badgeHovered ? 1.15 : 1)
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(badge.x, badge.y, r + 2.5 / camera.k, 0, TAU)
    ctx.fillStyle = theme.background
    ctx.fill()
    ctx.beginPath()
    ctx.arc(badge.x, badge.y, r, 0, TAU)
    ctx.fillStyle = theme.selected
    ctx.fill()
    const s = r * 0.38
    ctx.strokeStyle = theme.onSelected
    ctx.lineWidth = 2.2 / camera.k
    ctx.beginPath()
    ctx.moveTo(badge.x - s, badge.y - s)
    ctx.lineTo(badge.x + s, badge.y + s)
    ctx.moveTo(badge.x + s, badge.y - s)
    ctx.lineTo(badge.x - s, badge.y + s)
    ctx.stroke()
  }

  /** Toque: a alça (→) ao lado da nota selecionada — arrastar puxa a seta de conexão. */
  private handleCenter(): { x: number; y: number; r: number; node: Node } | null {
    if (!this.settings.touch || !this.selectedId || this.pointer?.action === 'link') return null
    const node = this.nodeMap.get(this.selectedId)
    if (!node || node.appear < 0.6) return null
    const k = this.camera.k
    const r = 13 / k
    const half = this.cardMode ? node.width / 2 : node.radius * (1 + node.emphasis * 0.2)
    return { x: node.x + half + 8 / k + r, y: node.y, r, node }
  }

  private drawConnectHandle(): void {
    const handle = this.handleCenter()
    if (!handle) return
    const { ctx, theme, camera } = this
    const { x, y, r } = handle
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(x, y, r + 3 / camera.k, 0, TAU)
    ctx.fillStyle = theme.background
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fillStyle = theme.selected
    ctx.fill()
    // Seta →
    const s = r * 0.42
    ctx.strokeStyle = theme.onSelected
    ctx.lineWidth = 2 / camera.k
    ctx.beginPath()
    ctx.moveTo(x - s, y)
    ctx.lineTo(x + s, y)
    ctx.moveTo(x + s * 0.2, y - s * 0.75)
    ctx.lineTo(x + s, y)
    ctx.lineTo(x + s * 0.2, y + s * 0.75)
    ctx.stroke()
  }

  private hitHandle(point: { x: number; y: number }): Node | null {
    const handle = this.handleCenter()
    if (!handle) return null
    const world = this.toWorld(point)
    // Alvo maior que o desenho (dedo)
    return Math.hypot(world.x - handle.x, world.y - handle.y) <= handle.r + 12 / this.camera.k ? handle.node : null
  }

  private drawCircle(node: Node): void {
    const { ctx, theme, camera } = this
    const selected = node.id === this.selectedId
    const scale = easeOutBack(node.appear) * (1 + node.emphasis * 0.2)
    const radius = Math.max(0.1, node.radius * scale)
    const fill = this.colorOf(node)

    if (selected) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, radius + 7 / camera.k, 0, TAU)
      ctx.fillStyle = theme.selectedHalo
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(node.x, node.y, radius, 0, TAU)
    ctx.fillStyle = fill
    ctx.fill()
    if (selected || this.matches?.has(node.id)) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, radius + 3 / camera.k, 0, TAU)
      ctx.strokeStyle = theme.selected
      ctx.lineWidth = 2.2 / camera.k
      ctx.stroke()
    }
  }

  private drawCard(node: Node): void {
    const { ctx, theme, camera } = this
    const selected = node.id === this.selectedId
    const scale = easeOutBack(node.appear) * (1 + node.emphasis * 0.06)
    const width = node.width * scale
    const height = node.height * scale
    const x = node.x - width / 2
    const y = node.y - height / 2
    const color = this.colorOf(node)

    if (selected) {
      ctx.beginPath()
      ctx.roundRect(x - 6 / camera.k, y - 6 / camera.k, width + 12 / camera.k, height + 12 / camera.k, 14)
      ctx.fillStyle = theme.selectedHalo
      ctx.fill()
    }
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, 10)
    ctx.fillStyle = theme.cardBackground
    ctx.fill()
    ctx.strokeStyle = selected || this.matches?.has(node.id) ? theme.selected : node.emphasis > 0.5 ? color : theme.cardBorder
    ctx.lineWidth = (selected ? 2.2 : node.emphasis > 0.5 ? 1.8 : 1.1) / camera.k
    ctx.stroke()

    if (scale < 0.55) return
    // Bolinha à esquerda com a cor da nota
    ctx.beginPath()
    ctx.arc(x + 15, node.y, 4.5, 0, TAU)
    ctx.fillStyle = color
    ctx.fill()

    ctx.font = `600 13px ${theme.fontFamily}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = theme.cardText
    ctx.fillText(node.label, x + 26, node.y + 0.5)
  }

  private drawLabels(): void {
    const { ctx, dpr, camera, theme } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    const mode = this.settings.labels
    const zoomFade = mode === 'always' ? 1 : mode === 'auto' ? smoothstep(0.42, 0.85, camera.k) : 0
    const focus = this.focusNodeNow()
    const neighbors = focus ? this.adjacency.get(focus.id) : null

    for (const node of this.nodes) {
      // "Ao selecionar": só a nota selecionada (e o alvo da seta / resultados da busca)
      const important =
        mode === 'selected'
          ? node === this.linkTarget || node.id === this.selectedId || !!this.matches?.has(node.id)
          : node === focus || node === this.linkTarget || node.id === this.selectedId || !!neighbors?.has(node.id) || !!this.matches?.has(node.id)
      const alpha = (important ? 1 : zoomFade) * node.alpha * node.appear
      if (alpha < 0.03) continue
      const { x, y } = this.toScreen(node)
      const offset = node.radius * (1 + node.emphasis * 0.2) * camera.k + 6
      if (x < -150 || x > this.width + 150 || y < -40 || y > this.height + 40) continue
      ctx.font = `${important && (node === focus || node.id === this.selectedId) ? 650 : 500} 12px ${theme.fontFamily}`
      ctx.globalAlpha = alpha
      ctx.lineWidth = 4
      ctx.strokeStyle = theme.background
      ctx.strokeText(node.label, x, y + offset)
      ctx.fillStyle = theme.label
      ctx.fillText(node.label, x, y + offset)
    }
    ctx.globalAlpha = 1
  }

  // ── Interação ─────────────────────────────────────────────────────────────

  private info(node: Node): GraphNodeInfo {
    return { id: node.id, title: node.title, degree: node.degree }
  }

  private localPoint(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  private hitTest(point: { x: number; y: number }, except?: Node | null): Node | null {
    const world = this.toWorld(point)
    const k = this.camera.k
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i]!
      if (node === except) continue
      if (this.cardMode) {
        if (Math.abs(world.x - node.x) <= node.width / 2 + 3 / k && Math.abs(world.y - node.y) <= node.height / 2 + 3 / k) return node
      } else {
        const radius = Math.max(node.radius * (1 + node.emphasis * 0.2), 9 / k) + 3 / k
        if ((world.x - node.x) ** 2 + (world.y - node.y) ** 2 <= radius * radius) return node
      }
    }
    return null
  }

  /** Conexão sob o mouse (até 6 px de distância da linha). */
  private hitEdge(point: { x: number; y: number }): Edge | null {
    const world = this.toWorld(point)
    const tolerance = 6 / this.camera.k
    let best: Edge | null = null
    let bestDistance = tolerance
    for (const edge of this.edges) {
      const { source: a, target: b } = edge
      const dx = b.x - a.x
      const dy = b.y - a.y
      const lengthSq = dx * dx + dy * dy || 1
      const t = clamp(((world.x - a.x) * dx + (world.y - a.y) * dy) / lengthSq, 0, 1)
      const distance = Math.hypot(world.x - (a.x + t * dx), world.y - (a.y + t * dy))
      if (distance <= bestDistance) {
        best = edge
        bestDistance = distance
      }
    }
    return best
  }

  private hitBadge(point: { x: number; y: number }): boolean {
    const badge = this.badgeCenter()
    if (!badge) return false
    const world = this.toWorld(point)
    return Math.hypot(world.x - badge.x, world.y - badge.y) <= badge.r + 3 / this.camera.k
  }

  private updateCursor(): void {
    const action = this.pointer?.action
    let cursor = 'default'
    if (action === 'pan' || action === 'move') cursor = 'grabbing'
    else if (action === 'link') cursor = this.linkTarget ? 'copy' : 'crosshair'
    else if (this.badgeHovered || this.hovered || this.hoveredEdge) cursor = 'pointer'
    this.canvas.style.cursor = cursor
  }

  private setHovered(node: Node | null, edge: Edge | null, badge: boolean): void {
    const nodeChanged = node !== this.hovered
    if (!nodeChanged && edge === this.hoveredEdge && badge === this.badgeHovered) return
    this.hovered = node
    this.hoveredEdge = node ? null : edge
    this.badgeHovered = badge
    if (nodeChanged) this.events.nodeHover?.(node ? this.info(node) : null, node ? this.toScreen(node) : null)
    this.updateCursor()
    this.wake()
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return
    const point = this.localPoint(event)
    this.lastPointerType = event.pointerType
    if (event.pointerType === 'touch') {
      // Sem os eventos de mouse "de mentira" que o navegador manda depois do toque: um
      // toque que abre uma janela (toque duplo → "Nova nota") não pode fechá-la em seguida
      event.preventDefault()
      // Primeiro dedo de um gesto novo: nenhum dedo antigo continua contando
      if (event.isPrimary) {
        this.touches.clear()
        this.pinch = null
      }
      this.touches.set(event.pointerId, point)
      this.canvas.setPointerCapture(event.pointerId)
      // Segundo dedo: vira pinça (o que o primeiro estava fazendo para onde está)
      if (this.touches.size === 2) return this.startPinch()
      if (this.touches.size > 2 || this.pinch) return
    }
    let kind: PointerKind = 'background'
    let node: Node | null = null
    let edge: Edge | null = null
    if (event.button === 0) {
      if (this.hitBadge(point)) kind = 'badge'
      else if ((node = this.hitHandle(point))) kind = 'handle'
      else if ((node = this.hitTest(point))) kind = 'node'
      else if ((edge = this.hitEdge(point))) kind = 'edge'
    }
    this.pointer = {
      id: event.pointerId,
      x: point.x,
      y: point.y,
      startX: point.x,
      startY: point.y,
      kind,
      node,
      edgeId: edge?.id ?? null,
      shift: event.shiftKey,
      moved: false,
      action: 'none',
      touch: event.pointerType === 'touch',
    }
    this.canvas.setPointerCapture(event.pointerId)
    // Pegar o mapa interrompe a animação da câmera. Se ela só estava se ajustando ao
    // painel (abrir/fechar), termina o ajuste na hora — senão o mapa ficaria deslocado.
    if (this.tween?.kind === 'inset') this.setCenter(this.tween.to.cx, this.tween.to.cy, this.tween.to.k)
    this.tween = null
  }

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.localPoint(event)
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, point)
      if (this.pinch) return this.updatePinch()
    }
    const pointer = this.pointer
    if (!pointer || pointer.id !== event.pointerId) {
      // Passar o mouse destaca (o dedo não "passa" por cima de nada)
      if (event.pointerType === 'touch') return
      const badge = this.hitBadge(point)
      const node = badge ? null : this.hitTest(point)
      this.setHovered(node, node || badge ? null : this.hitEdge(point), badge)
      return
    }

    const dx = point.x - pointer.x
    const dy = point.y - pointer.y
    pointer.x = point.x
    pointer.y = point.y
    const threshold = pointer.touch ? TOUCH_DRAG_THRESHOLD : DRAG_THRESHOLD
    if (!pointer.moved && Math.hypot(point.x - pointer.startX, point.y - pointer.startY) > threshold) {
      pointer.moved = true
      // Arrastar move a nota; Shift + arrastar (ou a alça, no toque) puxa uma seta para conectar
      if (pointer.kind === 'handle') pointer.action = 'link'
      else if (pointer.kind === 'node') pointer.action = pointer.shift || event.shiftKey ? 'link' : 'move'
      else if (pointer.kind !== 'badge') pointer.action = 'pan'
      this.events.viewChange?.()
      this.events.nodeHover?.(null, null)
      this.updateCursor()
    }
    if (!pointer.moved) return

    if (pointer.action === 'move' && pointer.node) {
      const world = this.toWorld(point)
      pointer.node.x = pointer.node.tx = world.x
      pointer.node.y = pointer.node.ty = world.y
      this.positionsDirty = true
    } else if (pointer.action === 'link' && pointer.node) {
      this.linkEnd = this.toWorld(point)
      const target = this.hitTest(point, pointer.node)
      if (target !== this.linkTarget) {
        this.linkTarget = target
        this.updateCursor()
      }
    } else if (pointer.action === 'pan') {
      this.camera.x += dx
      this.camera.y += dy
    }
    this.wake()
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      this.touches.delete(event.pointerId)
      if (this.pinch) {
        // Tirou um dos dedos: a pinça acaba (o outro dedo não vira arraste nem toque)
        if (this.touches.size < 2) this.pinch = null
        if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
        return
      }
    }
    const pointer = this.pointer
    if (!pointer || pointer.id !== event.pointerId) return
    this.pointer = null
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    const completed = event.type === 'pointerup'

    // Toque duplo no vazio: nota nova ali (como o duplo clique)
    if (pointer.touch && completed && !pointer.moved && pointer.kind === 'background') {
      const now = performance.now()
      const last = this.lastTap
      if (last && now - last.time < DOUBLE_TAP_MS && Math.hypot(pointer.x - last.x, pointer.y - last.y) < DOUBLE_TAP_DISTANCE) {
        this.lastTap = null
        this.events.backgroundDoubleClick?.(this.toWorld({ x: pointer.x, y: pointer.y }))
        return
      }
      this.lastTap = { time: now, x: pointer.x, y: pointer.y }
    } else if (completed) {
      this.lastTap = null
    }

    if (pointer.action === 'link' && pointer.node && this.linkTarget && completed) {
      this.events.connect?.(pointer.node.id, this.linkTarget.id)
    } else if (pointer.action === 'link' && pointer.node && completed && this.isEmptyDrop(pointer.node)) {
      this.events.connectToNew?.(pointer.node.id, this.linkEnd!)
    } else if (!pointer.moved && completed) {
      if (pointer.kind === 'badge' && this.selectedEdgeId) this.events.edgeRemove?.(this.selectedEdgeId)
      else if (pointer.kind === 'node' && pointer.node) this.events.nodeClick?.(this.info(pointer.node))
      else if (pointer.kind === 'edge' && pointer.edgeId) this.events.edgeClick?.(pointer.edgeId)
      else if (pointer.kind === 'background') this.events.backgroundClick?.()
    }
    this.linkTarget = null
    this.linkEnd = null
    this.updateCursor()
    this.wake()
  }

  private onPointerLeave = (): void => {
    if (!this.pointer) this.setHovered(null, null, false)
  }

  private startPinch(): void {
    const [a, b] = [...this.touches.values()]
    if (!a || !b) return
    // O que o primeiro dedo estava fazendo para por aqui (a nota arrastada fica onde está)
    this.pointer = null
    this.linkTarget = null
    this.linkEnd = null
    this.lastTap = null
    this.tween = null
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    this.pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), k: this.camera.k, world: this.toWorld(mid) }
    this.events.viewChange?.()
    this.events.nodeHover?.(null, null)
    this.updateCursor()
    this.wake()
  }

  private updatePinch(): void {
    const pinch = this.pinch
    const [a, b] = [...this.touches.values()]
    if (!pinch || !a || !b) return
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    const k = clamp((pinch.k * distance) / pinch.distance, MIN_ZOOM, MAX_ZOOM)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    this.camera.k = k
    this.camera.x = mid.x - pinch.world.x * k
    this.camera.y = mid.y - pinch.world.y * k
    this.events.viewChange?.()
    this.wake()
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY
    const factor = Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0017))
    this.zoomAt(this.localPoint(event), this.camera.k * factor)
    this.events.viewChange?.()
  }

  private onDoubleClick = (event: MouseEvent): void => {
    // No toque, o toque duplo já foi tratado (onPointerUp)
    if (this.lastPointerType === 'touch') return
    const point = this.localPoint(event)
    if (this.hitTest(point) || this.hitEdge(point) || this.hitBadge(point)) return
    this.events.backgroundDoubleClick?.(this.toWorld(point))
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    // Toque prolongado (vira "clique direito"): só com o dedo parado — arrastando ou na
    // pinça, não abre menu. O toque que abriu o menu não vira um toque na nota.
    if (this.pinch || this.pointer?.moved) return
    if (this.pointer) {
      // (a captura continua: o fim do toque volta para cá e não vira um toque na nota)
      this.pointer = null
      this.updateCursor()
    }
    const point = this.localPoint(event)
    const node = this.hitTest(point)
    if (node) {
      this.events.nodeContextMenu?.(this.info(node), event)
      return
    }
    const edge = this.hitEdge(point)
    if (edge) {
      this.events.edgeContextMenu?.(edge.id, event)
      return
    }
    this.events.backgroundContextMenu?.(this.toWorld(point), event)
  }
}
