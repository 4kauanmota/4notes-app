import { describe, expect, it } from 'vitest'
import { buildGraph } from '~/lib/mindmap/graph'
import { computeLayout, countCrossings, findFreeSpot, type LayoutEdge, type LayoutNode } from '~/lib/mindmap/layout'
import { migrateLegacyNotes } from '~/lib/mindmap/migration'
import { connectionsOf, findConnection, normalizeMapFile, removeFromMap, renameInMap, serializeMapFile } from '~/lib/mindmap/model'

describe('mapa.json', () => {
  it('lê de forma tolerante e sem conexões repetidas', () => {
    const data = normalizeMapFile({
      connections: [
        { from: 'Godot', to: 'Game Design' },
        { from: 'game design', to: 'godot' }, // mesma conexão no outro sentido
        { from: 'Godot', to: 'Godot' }, // laço
        { from: 'Godot' },
        'lixo',
      ],
      colors: { Godot: 'blue', Arte: 'cor-invalida' },
    })
    expect(data.connections).toEqual([{ from: 'Godot', to: 'Game Design' }])
    expect(data.colors).toEqual({ Godot: 'blue' })
    expect(normalizeMapFile(JSON.parse(serializeMapFile(data)))).toEqual(data)
    expect(normalizeMapFile(null)).toEqual({ connections: [], colors: {} })
  })

  it('renomeia e remove notas mantendo o resto', () => {
    const data = normalizeMapFile({
      connections: [
        { from: 'Godot', to: 'Arte' },
        { from: 'Arte', to: 'Música' },
      ],
      colors: { Godot: 'red' },
    })
    const renamed = renameInMap(data, 'godot', 'Godot Engine')
    expect(renamed.connections[0]).toEqual({ from: 'Godot Engine', to: 'Arte' })
    expect(renamed.colors).toEqual({ 'Godot Engine': 'red' })
    expect(findConnection(renamed.connections, 'arte', 'GODOT ENGINE')).toBeTruthy()

    const removed = removeFromMap(renamed, 'Arte')
    expect(removed.data.connections).toEqual([])
    expect(removed.connections).toHaveLength(2)
    expect(connectionsOf(renamed.connections, 'Arte')).toHaveLength(2)
  })
})

describe('conversão do mapa da versão 1.0.0', () => {
  it('transforma [[links]] em conexões e tira a marcação do texto', () => {
    const result = migrateLegacyNotes([
      { id: 'Godot.md', content: 'Motor de jogos.\n\nVeja [[Game Design]] e [[Programação|código]].\n[[Game Design]]\n' },
      { id: 'Game Design.md', content: 'Mecânicas e [[Godot]].\n[[Aseprite]] ainda não existe' },
      { id: 'Programação.md', content: 'Sem links. `[[Godot]]` em código fica igual.' },
      { id: 'Jogos/Godot.md', content: 'Outra nota com o mesmo nome' },
    ])
    expect(result.notes.map((n) => n.title).sort()).toEqual(['Game Design', 'Godot', 'Godot (2)', 'Programação'])
    const godot = result.notes.find((n) => n.legacyId === 'Godot.md')!
    expect(godot.content).toBe('Motor de jogos.\n\nVeja Game Design e código.\n')
    const design = result.notes.find((n) => n.legacyId === 'Game Design.md')!
    expect(design.content).toBe('Mecânicas e Godot.\nAseprite ainda não existe')
    expect(result.notes.find((n) => n.legacyId === 'Programação.md')!.content).toContain('`[[Godot]]`')
    // Godot–Game Design (uma só, mesmo com links nos dois sentidos) e Godot–Programação
    expect(result.connections).toEqual([
      { from: 'Godot', to: 'Game Design' },
      { from: 'Godot', to: 'Programação' },
    ])
  })

  it('não usa nomes que já existem no mapa de destino', () => {
    const result = migrateLegacyNotes([{ id: 'Ideias.md', content: '' }], ['ideias'])
    expect(result.notes[0]!.title).toBe('Ideias (2)')
  })
})

describe('grafo do mapa', () => {
  it('monta nós e setas a partir das conexões', () => {
    const notes = [
      { id: 'Godot.md', title: 'Godot', color: 'blue' as const },
      { id: 'Arte.md', title: 'Arte', color: null },
      { id: 'Solta.md', title: 'Solta', color: null },
    ]
    const connections = [
      { from: 'godot', to: 'Arte' },
      { from: 'Arte', to: 'Apagada' }, // nota que não existe: ignorada no desenho
    ]
    const graph = buildGraph(notes, connections, { showOrphans: true })
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toEqual([{ id: 'note:Arte.md|note:Godot.md', source: 'note:Godot.md', target: 'note:Arte.md' }])
    expect(graph.nodes.find((n) => n.title === 'Godot')).toMatchObject({ degree: 1, color: 'blue' })
    expect(buildGraph(notes, connections, { showOrphans: false }).nodes.map((n) => n.title)).toEqual(['Godot', 'Arte'])
  })
})

describe('reorganizar o mapa', () => {
  const node = (id: string): LayoutNode => ({ id, width: 60, height: 40 })

  it('árvores ficam sem nenhum cruzamento e sem nós sobrepostos', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `n${i}`)
    const edges: LayoutEdge[] = ids.slice(1).map((id, i) => ({ source: `n${Math.floor(i / 3)}`, target: id }))
    const positions = computeLayout(ids.map(node), edges)
    expect(Object.keys(positions)).toHaveLength(40)
    expect(countCrossings(positions, edges)).toBe(0)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = [positions[ids[i]!]!, positions[ids[j]!]!]
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(50)
      }
    }
  })

  it('reduz os cruzamentos de conexões extras (ciclos)', () => {
    // Centro com 6 ramos; conexões ligando ramos não vizinhos na ordem original
    const ids = ['c', 'a', 'b', 'd', 'e', 'f', 'g']
    const edges: LayoutEdge[] = [
      ...ids.slice(1).map((id) => ({ source: 'c', target: id })),
      { source: 'a', target: 'e' },
      { source: 'b', target: 'f' },
      { source: 'd', target: 'g' },
    ]
    const positions = computeLayout(ids.map(node), edges)
    expect(countCrossings(positions, edges)).toBe(0)
  })

  it('separa grupos sem ligação entre si', () => {
    const positions = computeLayout([node('a'), node('b'), node('x'), node('solta')], [
      { source: 'a', target: 'b' },
      { source: 'x', target: 'x' },
    ])
    const [a, b, solta] = [positions.a!, positions.b!, positions.solta!]
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(100)
    expect(Math.hypot(a[0] - solta[0], a[1] - solta[1])).toBeGreaterThan(60)
  })

  it('deixa as linhas curtas: notas sem se encostar e toda linha visível', () => {
    // Centro com 5 ramos de 3 folhas, em cards largos (como no mapa)
    const nodes: LayoutNode[] = [{ id: 'c', width: 140, height: 36 }]
    const edges: LayoutEdge[] = []
    for (let i = 0; i < 5; i++) {
      nodes.push({ id: `r${i}`, width: 100 + i * 15, height: 36 })
      edges.push({ source: 'c', target: `r${i}` })
      for (let j = 0; j < 3; j++) {
        nodes.push({ id: `r${i}l${j}`, width: 90 + j * 25, height: 36 })
        edges.push({ source: `r${i}`, target: `r${i}l${j}` })
      }
    }
    const meanLength = (p: Record<string, [number, number]>) =>
      edges.reduce((sum, e) => sum + Math.hypot(p[e.source]![0] - p[e.target]![0], p[e.source]![1] - p[e.target]![1]), 0) / edges.length
    const positions = computeLayout(nodes, edges)
    const loose = computeLayout(nodes, edges, { minEdge: 1e6 }) // sem compactar (como antes)
    expect(countCrossings(positions, edges)).toBe(0)
    expect(meanLength(positions)).toBeLessThan(meanLength(loose) * 0.75)

    const size = new Map(nodes.map((n) => [n.id, n]))
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const [a, b] = [nodes[i]!, nodes[j]!]
        const [pa, pb] = [positions[a.id]!, positions[b.id]!]
        const apartX = Math.abs(pa[0] - pb[0]) >= (a.width + b.width) / 2 + 17
        const apartY = Math.abs(pa[1] - pb[1]) >= (a.height + b.height) / 2 + 17
        expect(apartX || apartY, `${a.id} encosta em ${b.id}`).toBe(true)
      }
    }
    // Pedaço visível de cada linha (fora das caixas das pontas)
    for (const e of edges) {
      const [a, b] = [positions[e.source]!, positions[e.target]!]
      const [dx, dy] = [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])]
      const length = Math.hypot(dx, dy)
      const inside = (n: LayoutNode) => Math.min(dx ? (n.width / 2) * (length / dx) : Infinity, dy ? (n.height / 2) * (length / dy) : Infinity)
      expect(length - inside(size.get(e.source)!) - inside(size.get(e.target)!)).toBeGreaterThanOrEqual(43)
    }
  })

  it('acha um lugar livre para notas novas', () => {
    const spot = findFreeSpot([0, 0], [[0, 0], [150, 0]], 150)
    expect(Math.hypot(spot[0], spot[1])).toBeGreaterThanOrEqual(149)
    expect(Math.hypot(spot[0] - 150, spot[1])).toBeGreaterThan(110)
  })
})
