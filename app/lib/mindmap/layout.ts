/**
 * "Reorganizar mapa": layout radial (no estilo de um mapa mental) que evita cruzar linhas.
 *
 * 1. Cada grupo de notas ligadas entre si é organizado separadamente.
 * 2. A nota mais conectada fica no centro e as outras em anéis ao redor, seguindo
 *    uma árvore (busca em largura). Cada ramo recebe uma fatia do círculo
 *    proporcional ao seu tamanho, então as ligações da árvore não se cruzam.
 * 3. Conexões extras (que fecham ciclos) podem cruzar: uma busca local troca a
 *    ordem dos ramos e fica com a ordem de menos cruzamentos (e de menos linhas
 *    passando por cima de outros nós), com limite de tempo.
 * 4. Compactação: o grupo é "encolhido" (na horizontal e na vertical) até o limite
 *    em que as notas não se encostam, toda linha continua visível e nenhuma linha
 *    passa a cruzar outra ou a passar por cima de uma nota. Assim as linhas ficam
 *    curtas e só ficam longas quando isso é necessário para organizar o mapa.
 * 5. Os grupos são arrumados em linhas, do maior para o menor.
 *
 * Funções puras (sem Vue, sem canvas): fáceis de testar.
 */

export interface LayoutNode {
  id: string
  /** Espaço ocupado pelo nó (com o nome), em unidades do mapa. */
  width: number
  height: number
}

export interface LayoutEdge {
  source: string
  target: string
}

export type Point = [number, number]
export type Positions = Record<string, Point>

export interface LayoutOptions {
  /** Distância mínima entre os anéis. */
  ringDistance?: number
  /** Espaço livre entre nós vizinhos. */
  gap?: number
  /** Tempo máximo (ms) da busca que reduz cruzamentos. */
  budgetMs?: number
  /** Pedaço mínimo de linha visível entre duas notas conectadas. */
  minEdge?: number
  /** Espaço mínimo entre as caixas de duas notas. */
  clearance?: number
}

// ── Cruzamentos ──────────────────────────────────────────────────────────────

const orient = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

/** Os segmentos p1–p2 e p3–p4 se cruzam (cruzamento "de verdade", não só encostam)? */
export function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = orient(p3, p4, p1)
  const d2 = orient(p3, p4, p2)
  const d3 = orient(p1, p2, p3)
  const d4 = orient(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

export function countCrossings(positions: Positions, edges: LayoutEdge[]): number {
  const segments = edges
    .map((edge) => ({ edge, a: positions[edge.source], b: positions[edge.target] }))
    .filter((s): s is { edge: LayoutEdge; a: Point; b: Point } => !!s.a && !!s.b)
  let count = 0
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!
    for (let j = i + 1; j < segments.length; j++) {
      const t = segments[j]!
      if (s.edge.source === t.edge.source || s.edge.source === t.edge.target || s.edge.target === t.edge.source || s.edge.target === t.edge.target) continue
      if (segmentsCross(s.a, s.b, t.a, t.b)) count++
    }
  }
  return count
}

/** Folga mínima entre uma linha e as notas que ela não liga. */
const LINE_CLEARANCE = 12

/** O segmento a–b passa por dentro do retângulo de centro `c` e meias medidas hw × hh? (Liang–Barsky) */
function segmentHitsBox(a: Point, b: Point, c: Point, hw: number, hh: number): boolean {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  return (
    clip(-dx, a[0] - (c[0] - hw)) && clip(dx, c[0] + hw - a[0]) && clip(-dy, a[1] - (c[1] - hh)) && clip(dy, c[1] + hh - a[1]) && t0 <= t1
  )
}

/** Quantas vezes uma linha passa por cima de um nó que não é uma das suas pontas. */
function countNodeHits(positions: Positions, edges: LayoutEdge[], sizes: Map<string, LayoutNode>): number {
  let hits = 0
  for (const edge of edges) {
    const a = positions[edge.source]
    const b = positions[edge.target]
    if (!a || !b) continue
    for (const [id, p] of Object.entries(positions)) {
      if (id === edge.source || id === edge.target) continue
      const size = sizes.get(id)
      if (segmentHitsBox(a, b, p, (size?.width ?? 0) / 2 + LINE_CLEARANCE, (size?.height ?? 0) / 2 + LINE_CLEARANCE)) hits++
    }
  }
  return hits
}

// ── Compactação ──────────────────────────────────────────────────────────────

/** Duas caixas de nós se encostam (com `clearance` de folga)? */
function anyOverlap(positions: Positions, ids: string[], sizes: Map<string, LayoutNode>, clearance: number): boolean {
  for (let i = 0; i < ids.length; i++) {
    const a = positions[ids[i]!]!
    const sa = sizes.get(ids[i]!)
    for (let j = i + 1; j < ids.length; j++) {
      const b = positions[ids[j]!]!
      const sb = sizes.get(ids[j]!)
      const fitsX = Math.abs(a[0] - b[0]) >= ((sa?.width ?? 0) + (sb?.width ?? 0)) / 2 + clearance
      const fitsY = Math.abs(a[1] - b[1]) >= ((sa?.height ?? 0) + (sb?.height ?? 0)) / 2 + clearance
      if (!fitsX && !fitsY) return true
    }
  }
  return false
}

/** Quanto da linha a–b fica à mostra entre as caixas das duas pontas. */
function visibleLength(a: Point, b: Point, sa: LayoutNode | undefined, sb: LayoutNode | undefined): number {
  const dx = Math.abs(b[0] - a[0])
  const dy = Math.abs(b[1] - a[1])
  const length = Math.hypot(dx, dy)
  if (!length) return 0
  // Distância do centro até a borda da caixa, na direção da linha
  const inside = (size: LayoutNode | undefined) =>
    Math.min(dx ? ((size?.width ?? 0) / 2) * (length / dx) : Infinity, dy ? ((size?.height ?? 0) / 2) * (length / dy) : Infinity)
  return length - inside(sa) - inside(sb)
}

const scaled = (positions: Positions, sx: number, sy: number): Positions =>
  Object.fromEntries(Object.entries(positions).map(([id, [x, y]]) => [id, [x * sx, y * sy] as Point]))

/**
 * Encolhe o grupo (escala horizontal e vertical a partir do centro) o máximo
 * possível sem encostar notas, sem esconder linhas e sem aumentar as linhas que
 * passam por cima de notas. Escalar não cria cruzamentos (retas continuam retas).
 */
function compactGroup(positions: Positions, edges: LayoutEdge[], sizes: Map<string, LayoutNode>, minEdge: number, clearance: number): Positions {
  const ids = Object.keys(positions)
  if (ids.length < 2) return positions
  const hits = countNodeHits(positions, edges, sizes)
  const valid = (sx: number, sy: number) => {
    const p = scaled(positions, sx, sy)
    return (
      !anyOverlap(p, ids, sizes, clearance) &&
      edges.every((edge) => visibleLength(p[edge.source]!, p[edge.target]!, sizes.get(edge.source), sizes.get(edge.target)) >= minEdge) &&
      countNodeHits(p, edges, sizes) <= hits
    )
  }
  let sx = 1
  let sy = 1
  // A menor escala igual nos dois eixos que ainda funciona…
  for (let s = 0.15; s < 1; s += 0.05) {
    if (valid(s, s)) {
      sx = sy = s
      break
    }
  }
  // …e depois aperta cada eixo sozinho (sem deixar o desenho achatado demais)
  for (const axis of ['y', 'x'] as const) {
    for (;;) {
      const nx = axis === 'x' ? sx - 0.05 : sx
      const ny = axis === 'y' ? sy - 0.05 : sy
      if (Math.min(nx, ny) < 0.05 || nx / ny > 2.2 || ny / nx > 2.2 || !valid(nx, ny)) break
      sx = nx
      sy = ny
    }
  }
  return scaled(positions, sx, sy)
}

/** Cruzamentos entre as linhas `changed` e todas as outras (sem contar as que dividem uma ponta). */
function crossingsWith(positions: Positions, changed: LayoutEdge[], edges: LayoutEdge[]): number {
  let count = 0
  for (const s of changed) {
    const a = positions[s.source]!
    const b = positions[s.target]!
    for (const t of edges) {
      if (t === s || s.source === t.source || s.source === t.target || s.target === t.source || s.target === t.target) continue
      if (segmentsCross(a, b, positions[t.source]!, positions[t.target]!)) count++
    }
  }
  return count
}

/**
 * Puxa cada ramo (uma nota e as que saem dela) para perto da nota de cima, ao
 * longo da linha que os liga, enquanto nada se encosta, nenhuma linha fica curta
 * demais e nenhuma linha passa a cruzar outra ou a passar por cima de uma nota.
 * Puxar ao longo da própria linha só a encurta; o resto do ramo vai junto, sem mudar.
 */
function tightenBranches(
  start: Positions,
  tree: Tree,
  edges: LayoutEdge[],
  sizes: Map<string, LayoutNode>,
  minEdge: number,
  clearance: number,
  deadline: number,
): Positions {
  const positions: Positions = { ...start }
  const ids = Object.keys(positions)
  const parent = new Map<string, string>()
  for (const [id, kids] of tree.children) for (const kid of kids) parent.set(kid, id)
  const branch = new Map<string, string[]>()
  for (const id of [...tree.order].reverse()) branch.set(id, [id, ...(tree.children.get(id) ?? []).flatMap((kid) => branch.get(kid)!)])
  const box = (id: string) => sizes.get(id)

  for (let pass = 0; pass < 2; pass++) {
    // De fora para dentro: os ramos pequenos se ajeitam antes de o ramo maior ser puxado
    for (const id of [...tree.order].reverse()) {
      if (now() > deadline) return positions
      const up = parent.get(id)
      if (!up) continue
      const members = branch.get(id)!
      const inside = new Set(members)
      const a = positions[up]!
      const b = positions[id]!
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      const slack = visibleLength(a, b, box(up), box(id)) - minEdge
      if (!length || slack < 4) continue
      const ux = (a[0] - b[0]) / length
      const uy = (a[1] - b[1]) / length
      const boundary = edges.filter((edge) => inside.has(edge.source) !== inside.has(edge.target))
      const touching = edges.filter((edge) => inside.has(edge.source) || inside.has(edge.target))
      const others = edges.filter((edge) => !inside.has(edge.source) && !inside.has(edge.target))
      const outsiders = ids.filter((other) => !inside.has(other))

      const moved = (t: number): Positions => {
        const p = { ...positions }
        for (const m of members) p[m] = [positions[m]![0] + ux * t, positions[m]![1] + uy * t]
        return p
      }
      // Problemas que dependem do ramo: cruzamentos das linhas que saem dele e linhas por cima de notas
      const problems = (p: Positions) => {
        let hits = 0
        for (const edge of touching) {
          for (const other of ids) {
            if (other === edge.source || other === edge.target) continue
            const size = box(other)
            if (segmentHitsBox(p[edge.source]!, p[edge.target]!, p[other]!, (size?.width ?? 0) / 2 + LINE_CLEARANCE, (size?.height ?? 0) / 2 + LINE_CLEARANCE)) hits++
          }
        }
        for (const edge of others) {
          for (const m of members) {
            const size = box(m)
            if (segmentHitsBox(p[edge.source]!, p[edge.target]!, p[m]!, (size?.width ?? 0) / 2 + LINE_CLEARANCE, (size?.height ?? 0) / 2 + LINE_CLEARANCE)) hits++
          }
        }
        return crossingsWith(p, boundary, edges) * 1000 + hits
      }
      const before = problems(positions)
      const fits = (t: number) => {
        const p = moved(t)
        for (const m of members) {
          const sm = box(m)
          for (const other of outsiders) {
            const so = box(other)
            const fitsX = Math.abs(p[m]![0] - p[other]![0]) >= ((sm?.width ?? 0) + (so?.width ?? 0)) / 2 + clearance
            const fitsY = Math.abs(p[m]![1] - p[other]![1]) >= ((sm?.height ?? 0) + (so?.height ?? 0)) / 2 + clearance
            if (!fitsX && !fitsY) return false
          }
        }
        if (boundary.some((edge) => visibleLength(p[edge.source]!, p[edge.target]!, box(edge.source), box(edge.target)) < minEdge)) return false
        return problems(p) <= before
      }
      // Busca binária do quanto dá para puxar
      let lo = 0
      let hi = slack
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2
        if (fits(mid)) lo = mid
        else hi = mid
      }
      if (lo >= 2) Object.assign(positions, moved(lo))
    }
  }
  return positions
}

// ── Layout de um grupo conectado ─────────────────────────────────────────────

interface Tree {
  root: string
  children: Map<string, string[]>
  /** Nós em ordem de busca em largura (raiz primeiro). */
  order: string[]
  depth: Map<string, number>
}

function buildTree(root: string, adjacency: Map<string, string[]>): Tree {
  const children = new Map<string, string[]>()
  const depth = new Map<string, number>([[root, 0]])
  const order = [root]
  for (let i = 0; i < order.length; i++) {
    const node = order[i]!
    const list: string[] = []
    for (const next of adjacency.get(node) ?? []) {
      if (depth.has(next)) continue
      depth.set(next, depth.get(node)! + 1)
      order.push(next)
      list.push(next)
    }
    children.set(node, list)
  }
  return { root, children, order, depth }
}

function radial(tree: Tree, sizes: Map<string, LayoutNode>, gap: number, ring: number): Positions {
  const own = (id: string) => (sizes.get(id)?.width ?? 0) + gap
  const weight = new Map<string, number>()
  for (let i = tree.order.length - 1; i >= 0; i--) {
    const id = tree.order[i]!
    const sum = (tree.children.get(id) ?? []).reduce((total, child) => total + weight.get(child)!, 0)
    weight.set(id, Math.max(own(id), sum))
  }

  // Fatias do círculo: cada filho recebe uma parte da fatia do pai, proporcional ao peso
  const angle = new Map<string, number>([[tree.root, 0]])
  const span = new Map<string, number>([[tree.root, Math.PI * 2]])
  for (const id of tree.order) {
    const kids = tree.children.get(id) ?? []
    if (!kids.length) continue
    const total = kids.reduce((sum, kid) => sum + weight.get(kid)!, 0)
    const parentSpan = span.get(id)!
    // Na raiz, o primeiro ramo fica à direita; nos outros nós, os filhos ocupam a fatia do pai
    let start = id === tree.root ? -((parentSpan * weight.get(kids[0]!)!) / total) / 2 : angle.get(id)! - parentSpan / 2
    for (const kid of kids) {
      const kidSpan = (parentSpan * weight.get(kid)!) / total
      angle.set(kid, start + kidSpan / 2)
      span.set(kid, kidSpan)
      start += kidSpan
    }
  }

  // Raio de cada anel: longe o bastante do anel anterior e com espaço para os nós da fatia
  const radius: number[] = [0]
  for (const id of tree.order) {
    const d = tree.depth.get(id)!
    if (d === 0) continue
    const needed = own(id) / Math.max(span.get(id)!, 1e-6)
    radius[d] = Math.max(radius[d] ?? 0, needed)
  }
  for (let d = 1; d < radius.length; d++) radius[d] = Math.max(radius[d]!, radius[d - 1]! + ring)

  const positions: Positions = {}
  for (const id of tree.order) {
    const r = radius[tree.depth.get(id)!]!
    const a = angle.get(id)!
    positions[id] = [Math.cos(a) * r, Math.sin(a) * r]
  }
  return positions
}

function eccentricity(start: string, adjacency: Map<string, string[]>): number {
  const dist = new Map<string, number>([[start, 0]])
  const queue = [start]
  let max = 0
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!
    for (const next of adjacency.get(node) ?? []) {
      if (dist.has(next)) continue
      const d = dist.get(node)! + 1
      dist.set(next, d)
      max = Math.max(max, d)
      queue.push(next)
    }
  }
  return max
}

interface Block {
  positions: Positions
  minX: number
  minY: number
  maxX: number
  maxY: number
  count: number
}

function toBlock(positions: Positions, sizes: Map<string, LayoutNode>): Block {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [id, [x, y]] of Object.entries(positions)) {
    const size = sizes.get(id)
    const hw = (size?.width ?? 0) / 2
    const hh = (size?.height ?? 0) / 2
    minX = Math.min(minX, x - hw)
    maxX = Math.max(maxX, x + hw)
    minY = Math.min(minY, y - hh)
    maxY = Math.max(maxY, y + hh)
  }
  return { positions, minX, minY, maxX, maxY, count: Object.keys(positions).length }
}

/** Arruma os grupos em linhas centralizadas, do maior para o menor. */
function pack(blocks: Block[], gap: number): Positions {
  const spacing = gap * 1.5
  const sorted = [...blocks].sort((a, b) => b.count - a.count)
  const widths = sorted.map((b) => b.maxX - b.minX)
  const area = sorted.reduce((sum, b) => sum + (b.maxX - b.minX + spacing) * (b.maxY - b.minY + spacing), 0)
  const rowLimit = Math.max(...widths, Math.sqrt(area) * 1.6)

  const rows: { blocks: Block[]; width: number; height: number }[] = []
  for (const block of sorted) {
    const width = block.maxX - block.minX
    let row = rows.at(-1)
    if (!row || (row.blocks.length && row.width + spacing + width > rowLimit)) {
      row = { blocks: [], width: 0, height: 0 }
      rows.push(row)
    }
    row.width += (row.blocks.length ? spacing : 0) + width
    row.height = Math.max(row.height, block.maxY - block.minY)
    row.blocks.push(block)
  }

  const totalHeight = rows.reduce((sum, row) => sum + row.height, 0) + spacing * (rows.length - 1)
  const result: Positions = {}
  let y = -totalHeight / 2
  for (const row of rows) {
    let x = -row.width / 2
    for (const block of row.blocks) {
      const dx = x - block.minX
      const dy = y + (row.height - (block.maxY - block.minY)) / 2 - block.minY
      for (const [id, [px, py]] of Object.entries(block.positions)) result[id] = [Math.round(px + dx), Math.round(py + dy)]
      x += block.maxX - block.minX + spacing
    }
    y += row.height + spacing
  }
  return result
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function computeLayout(nodes: LayoutNode[], edges: LayoutEdge[], options: LayoutOptions = {}): Positions {
  if (!nodes.length) return {}
  const gap = options.gap ?? 40
  const minEdge = options.minEdge ?? 44
  const clearance = options.clearance ?? 18
  const maxWidth = Math.max(...nodes.map((node) => node.width))
  const ring = options.ringDistance ?? Math.max(150, maxWidth + gap)
  const deadline = now() + (options.budgetMs ?? 250)
  const sizes = new Map(nodes.map((node) => [node.id, node]))

  // Vizinhança (sem laços nem conexões repetidas)
  const adjacency = new Map<string, string[]>(nodes.map((node) => [node.id, []]))
  const incoming = new Map<string, number>(nodes.map((node) => [node.id, 0]))
  const unique: LayoutEdge[] = []
  const seen = new Set<string>()
  for (const edge of edges) {
    if (edge.source === edge.target || !adjacency.has(edge.source) || !adjacency.has(edge.target)) continue
    const key = edge.source < edge.target ? `${edge.source}|${edge.target}` : `${edge.target}|${edge.source}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(edge)
    adjacency.get(edge.source)!.push(edge.target)
    adjacency.get(edge.target)!.push(edge.source)
    incoming.set(edge.target, incoming.get(edge.target)! + 1)
  }

  // Grupos conectados
  const visited = new Set<string>()
  const groups: string[][] = []
  for (const node of nodes) {
    if (visited.has(node.id)) continue
    const group = [node.id]
    visited.add(node.id)
    for (let i = 0; i < group.length; i++) {
      for (const next of adjacency.get(group[i]!)!) {
        if (!visited.has(next)) {
          visited.add(next)
          group.push(next)
        }
      }
    }
    groups.push(group)
  }

  const blocks = groups.map((group) => {
    if (group.length === 1) return toBlock({ [group[0]!]: [0, 0] }, sizes)
    const members = new Set(group)
    const groupEdges = unique.filter((edge) => members.has(edge.source))
    // Candidatas a centro: mais conexões; empate → sem setas chegando → mais "central"
    const candidates = [...group]
      .sort((a, b) => adjacency.get(b)!.length - adjacency.get(a)!.length || incoming.get(a)! - incoming.get(b)!)
      .slice(0, 5)
      .map((id) => ({ id, ecc: eccentricity(id, adjacency) }))
      .sort((a, b) => adjacency.get(b.id)!.length - adjacency.get(a.id)!.length || a.ecc - b.ecc)
      .slice(0, 3)

    // "Custo" de um layout: linhas que se cruzam + linhas que passam por cima de outros nós
    const cost = (positions: Positions) => countCrossings(positions, groupEdges) + countNodeHits(positions, groupEdges, sizes)
    let best: { positions: Positions; cost: number; tree: Tree } | null = null
    for (const { id } of candidates) {
      const tree = buildTree(id, adjacency)
      let positions = radial(tree, sizes, gap, ring)
      let current = cost(positions)
      // Busca local: troca dois ramos de lugar enquanto isso diminuir o custo
      for (let pass = 0; pass < 8 && current > 0 && now() < deadline; pass++) {
        let improved = false
        for (const parent of tree.order) {
          const kids = tree.children.get(parent)!
          for (let i = 0; i + 1 < kids.length && now() < deadline; i++) {
            for (let j = i + 1; j < kids.length && now() < deadline; j++) {
              ;[kids[i], kids[j]] = [kids[j]!, kids[i]!]
              const candidate = radial(tree, sizes, gap, ring)
              const value = cost(candidate)
              if (value < current) {
                positions = candidate
                current = value
                improved = true
              } else {
                ;[kids[i], kids[j]] = [kids[j]!, kids[i]!]
              }
            }
          }
        }
        if (!improved) break
      }
      if (!best || current < best.cost) best = { positions, cost: current, tree: { ...tree, children: new Map([...tree.children].map(([k, v]) => [k, [...v]])) } }
      if (best.cost === 0 || now() >= deadline) break
    }
    const compact = compactGroup(best!.positions, groupEdges, sizes, minEdge, clearance)
    return toBlock(tightenBranches(compact, best!.tree, groupEdges, sizes, minEdge, clearance, now() + 120), sizes)
  })

  return pack(blocks, gap)
}

/**
 * Lugar livre perto de `anchor` (para notas novas): tenta ângulos ao redor,
 * começando por `preferredAngle`, e se afasta até achar espaço.
 */
export function findFreeSpot(anchor: Point, occupied: Point[], distance: number, preferredAngle = 0): Point {
  const clearance = (p: Point) => occupied.reduce((min, o) => Math.min(min, Math.hypot(o[0] - p[0], o[1] - p[1])), Infinity)
  if (clearance(anchor) >= distance * 0.8) return [Math.round(anchor[0]), Math.round(anchor[1])]
  let best: Point = anchor
  let bestClearance = -1
  for (const scale of [1, 1.6, 2.3, 3.2]) {
    for (let i = 0; i < 16; i++) {
      const step = Math.ceil(i / 2) * (i % 2 ? 1 : -1)
      const angle = preferredAngle + (step * Math.PI) / 8
      const point: Point = [anchor[0] + Math.cos(angle) * distance * scale, anchor[1] + Math.sin(angle) * distance * scale]
      const free = clearance(point)
      if (free >= distance * 0.8) return [Math.round(point[0]), Math.round(point[1])]
      if (free > bestClearance) {
        best = point
        bestClearance = free
      }
    }
  }
  return [Math.round(best[0]), Math.round(best[1])]
}
