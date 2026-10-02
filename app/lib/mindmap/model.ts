/**
 * Modelo do Mapa Mental (regras puras: sem Vue e sem disco).
 *
 *   mindmap/
 *   ├── Principal/           ← cada mapa é uma pasta
 *   │   ├── mapa.json        ← conexões e cores das notas deste mapa
 *   │   ├── Godot.md         ← cada nó é uma nota .md (só o texto)
 *   │   └── Game Design.md
 *   └── Estudos/
 *       └── …
 *
 * mapa.json:
 * {
 *   "app": "4notes", "version": 1,
 *   "connections": [{ "from": "Godot", "to": "Game Design" }],
 *   "colors": { "Godot": "blue" }
 * }
 * As notas são referenciadas pelo título (= nome do arquivo sem ".md").
 * A conexão guarda o sentido em que foi criada (a seta vai de "from" para "to"),
 * mas duas notas têm no máximo uma conexão entre si.
 */
import { isPaletteColor, type PaletteColor } from '../colors'
import { nameKey } from '../files/filename'

export const MAP_FILE = 'mapa.json'
export const DEFAULT_MAP_NAME = 'Principal'

export interface Connection {
  from: string
  to: string
}

export interface MapFile {
  connections: Connection[]
  colors: Record<string, PaletteColor>
}

export const emptyMapFile = (): MapFile => ({ connections: [], colors: {} })

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Chave de uma conexão sem sentido (A–B = B–A), ignorando maiúsculas/minúsculas. */
export function connectionKey(a: string, b: string): string {
  const [x, y] = [nameKey(a), nameKey(b)].sort()
  return `${x}\u0000${y}`
}

/** Lê o mapa.json de forma tolerante (arquivo editado à mão não quebra o app). */
export function normalizeMapFile(raw: unknown): MapFile {
  const data = isObject(raw) ? raw : {}
  const connections: Connection[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(data.connections) ? data.connections : []) {
    if (!isObject(item) || typeof item.from !== 'string' || typeof item.to !== 'string') continue
    const from = item.from.trim()
    const to = item.to.trim()
    if (!from || !to || nameKey(from) === nameKey(to)) continue
    const key = connectionKey(from, to)
    if (seen.has(key)) continue
    seen.add(key)
    connections.push({ from, to })
  }
  const colors: Record<string, PaletteColor> = {}
  if (isObject(data.colors)) {
    for (const [title, color] of Object.entries(data.colors)) if (title.trim() && isPaletteColor(color)) colors[title.trim()] = color
  }
  return { connections, colors }
}

export function serializeMapFile(data: MapFile): string {
  return `${JSON.stringify({ app: '4notes', version: 1, connections: data.connections, colors: data.colors }, null, 2)}\n`
}

export function findConnection(connections: Connection[], a: string, b: string): Connection | undefined {
  const key = connectionKey(a, b)
  return connections.find((connection) => connectionKey(connection.from, connection.to) === key)
}

/** Conexões de uma nota (nos dois sentidos). */
export function connectionsOf(connections: Connection[], title: string): Connection[] {
  const key = nameKey(title)
  return connections.filter((connection) => nameKey(connection.from) === key || nameKey(connection.to) === key)
}

/** Atualiza conexões e cores quando uma nota é renomeada. */
export function renameInMap(data: MapFile, oldTitle: string, newTitle: string): MapFile {
  const key = nameKey(oldTitle)
  const rename = (title: string) => (nameKey(title) === key ? newTitle : title)
  const colors: Record<string, PaletteColor> = {}
  for (const [title, color] of Object.entries(data.colors)) colors[rename(title)] = color
  return {
    connections: data.connections.map((connection) => ({ from: rename(connection.from), to: rename(connection.to) })),
    colors,
  }
}

/** Remove uma nota do mapa e devolve o que foi removido (para poder desfazer). */
export function removeFromMap(data: MapFile, title: string): { data: MapFile; connections: Connection[]; color: PaletteColor | null } {
  const key = nameKey(title)
  const removed = connectionsOf(data.connections, title)
  const colors: Record<string, PaletteColor> = {}
  let color: PaletteColor | null = null
  for (const [name, value] of Object.entries(data.colors)) {
    if (nameKey(name) === key) color = value
    else colors[name] = value
  }
  return { data: { connections: data.connections.filter((c) => !removed.includes(c)), colors }, connections: removed, color }
}

export function colorOf(data: MapFile, title: string): PaletteColor | null {
  const key = nameKey(title)
  for (const [name, color] of Object.entries(data.colors)) if (nameKey(name) === key) return color
  return null
}
