/**
 * Monta o grafo de um mapa a partir das notas (nós) e das conexões do mapa.json.
 *
 *   notas:     Godot.md, Game Design.md
 *   conexões:  { from: "Godot", to: "Game Design" }   →   Godot ──▶ Game Design
 *
 * Conexões que apontam para notas que não existem mais (ex.: arquivo apagado fora
 * do app) são ignoradas no desenho, mas continuam no mapa.json.
 */
import type { PaletteColor } from '../colors'
import { nameKey } from '../files/filename'
import type { Connection } from './model'

export interface NoteSource {
  /** Nome do arquivo dentro da pasta do mapa (ex.: "Godot.md"). */
  id: string
  title: string
  color: PaletteColor | null
}

export interface GraphNode {
  /** "note:<id>" */
  id: string
  title: string
  noteId: string
  color: PaletteColor | null
  /** Quantidade de conexões. */
  degree: number
}

export interface GraphEdge {
  /** Mesmo id para A→B e B→A (há no máximo uma conexão entre duas notas). */
  id: string
  /** Nó de onde a seta sai. */
  source: string
  /** Nó para onde a seta aponta. */
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface GraphOptions {
  showOrphans: boolean
}

export const noteNodeId = (noteId: string) => `note:${noteId}`
export const noteIdOfNode = (nodeId: string) => nodeId.slice('note:'.length)

export function edgeId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function buildGraph(notes: NoteSource[], connections: Connection[], options: GraphOptions): GraphData {
  const byTitle = new Map(notes.map((note) => [nameKey(note.title), note]))
  const nodes = new Map<string, GraphNode>()
  for (const note of notes) {
    nodes.set(noteNodeId(note.id), { id: noteNodeId(note.id), title: note.title, noteId: note.id, color: note.color, degree: 0 })
  }

  const edges = new Map<string, GraphEdge>()
  for (const connection of connections) {
    const from = byTitle.get(nameKey(connection.from))
    const to = byTitle.get(nameKey(connection.to))
    if (!from || !to || from === to) continue
    const source = noteNodeId(from.id)
    const target = noteNodeId(to.id)
    const id = edgeId(source, target)
    if (edges.has(id)) continue
    edges.set(id, { id, source, target })
    nodes.get(source)!.degree++
    nodes.get(target)!.degree++
  }

  const nodeList = [...nodes.values()].filter((node) => options.showOrphans || node.degree > 0)
  const visible = new Set(nodeList.map((node) => node.id))
  return { nodes: nodeList, edges: [...edges.values()].filter((edge) => visible.has(edge.source) && visible.has(edge.target)) }
}
