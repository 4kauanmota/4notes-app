/**
 * Anotações nos PDFs (1.7.3): o que você desenha, marca e escreve por cima de um PDF.
 * Ficam num arquivo próprio por documento, documents/anotacoes/<id>.json; o PDF nunca é
 * alterado.
 *
 *   {
 *     "app": "4notes", "version": 1, "document": "d_k3j9x0a2qm",
 *     "items": [
 *       { "id": "a_…", "page": 1, "tool": "pen", "color": "#e5484d", "width": 0.004,
 *         "points": [[0.1021, 0.2203], [0.1064, 0.2215]] },
 *       { "id": "a_…", "page": 1, "tool": "highlighter", "color": "#ffd43b", "width": 0.018, "points": [...] },
 *       { "id": "a_…", "page": 2, "tool": "mark", "color": "#ffd43b", "rects": [[0.1, 0.3, 0.42, 0.016]] },
 *       { "id": "a_…", "page": 2, "tool": "text", "color": "#3b7ef0", "x": 0.6, "y": 0.1, "size": 0.022, "text": "Conferir" }
 *     ]
 *   }
 *
 * Posições e tamanhos são frações da página (0 a 1, largura e altura da página sem
 * rotação; espessuras e letras em frações da largura): o desenho acompanha o zoom e
 * fica no lugar em qualquer tela.
 */
import { createId } from '../utils/async'
import { toJson } from '../storage/json-file'

export type DrawTool = 'pen' | 'highlighter'
export type AnnotationTool = DrawTool | 'mark' | 'text'

export interface Stroke {
  id: string
  page: number
  tool: DrawTool
  color: string
  width: number
  points: [number, number][]
}

/** Trecho de texto marcado (selecionar o texto do PDF e "Marcar"). */
export interface TextMark {
  id: string
  page: number
  tool: 'mark'
  color: string
  /** Retângulos [x, y, largura, altura] das linhas marcadas. */
  rects: [number, number, number, number][]
}

export interface TextNote {
  id: string
  page: number
  tool: 'text'
  color: string
  x: number
  y: number
  /** Tamanho da letra (fração da largura da página). */
  size: number
  text: string
}

export type Annotation = Stroke | TextMark | TextNote

export const ANNOTATIONS_DIR = 'documents/anotacoes'
export const annotationsPath = (documentId: string) => `${ANNOTATIONS_DIR}/${documentId}.json`

/** Cores da caneta e do texto (fixas: o papel é sempre branco). */
export const PEN_COLORS = ['#1f1a2b', '#e5484d', '#3b7ef0', '#22a06b', '#7c5cfc'] as const
/** Cores do marca-texto. */
export const HIGHLIGHT_COLORS = ['#ffd43b', '#69db7c', '#f783ac', '#74c0fc', '#ffa94d'] as const

/** Espessuras (fração da largura da página): fina, média, grossa. */
export const PEN_WIDTHS = [0.0022, 0.004, 0.007] as const
export const HIGHLIGHTER_WIDTHS = [0.012, 0.018, 0.028] as const
export const TEXT_SIZE = 0.022

const MAX_POINTS = 5000
const round = (value: number) => Math.round(value * 10_000) / 10_000
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

export function newStroke(page: number, tool: DrawTool, color: string, width: number): Stroke {
  return { id: createId('a'), page, tool, color, width, points: [] }
}

/** Acrescenta um ponto ao traço (só se ele andou o bastante, para o arquivo não crescer à toa). */
export function addPoint(stroke: Stroke, x: number, y: number, minDistance = 0.0015): boolean {
  const point: [number, number] = [round(clamp01(x)), round(clamp01(y))]
  const last = stroke.points.at(-1)
  if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < minDistance) return false
  if (stroke.points.length >= MAX_POINTS) return false
  stroke.points.push(point)
  return true
}

/** Distância de um ponto a um segmento (para a borracha). */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number, aspect: number): number {
  // Em unidades da largura (a altura da página é `aspect` vezes a largura)
  const [x, y, x1, y1, x2, y2] = [px, py * aspect, ax, ay * aspect, bx, by * aspect]
  const dx = x2 - x1
  const dy = y2 - y1
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length)) : 0
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
}

/**
 * A anotação está sob a borracha (em `x`, `y`, com raio `radius` em frações da largura)?
 * `aspect` = altura ÷ largura da página.
 */
export function hitTest(item: Annotation, x: number, y: number, radius: number, aspect: number): boolean {
  if (item.tool === 'pen' || item.tool === 'highlighter') {
    const reach = radius + item.width / 2
    const points = item.points
    if (points.length === 1) return segmentDistance(x, y, points[0]![0], points[0]![1], points[0]![0], points[0]![1], aspect) <= reach
    for (let i = 1; i < points.length; i++) {
      if (segmentDistance(x, y, points[i - 1]![0], points[i - 1]![1], points[i]![0], points[i]![1], aspect) <= reach) return true
    }
    return false
  }
  if (item.tool === 'mark') {
    return item.rects.some(([rx, ry, rw, rh]) => x >= rx - radius && x <= rx + rw + radius && y >= ry - radius / aspect && y <= ry + rh + radius / aspect)
  }
  // Texto: a caixa aproximada (uma linha por quebra; ~0,55 da altura da letra por caractere)
  const note = item as TextNote
  const lines = note.text.split('\n')
  const width = Math.max(...lines.map((line) => line.length), 1) * note.size * 0.55
  const height = (lines.length * note.size * 1.3) / aspect
  return x >= note.x - radius && x <= note.x + width + radius && y >= note.y - radius / aspect && y <= note.y + height + radius / aspect
}

/** Lê o arquivo de anotações de forma tolerante (o que estiver quebrado fica de fora). */
export function normalizeAnnotations(raw: unknown): Annotation[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const items = (raw as { items?: unknown }).items
  const out: Annotation[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(items) ? items : []) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const id = typeof item.id === 'string' && item.id && !seen.has(item.id) ? item.id : createId('a')
    const page = isNumber(item.page) && item.page >= 1 ? Math.floor(item.page) : null
    if (!page || !isColor(item.color)) continue
    if ((item.tool === 'pen' || item.tool === 'highlighter') && Array.isArray(item.points) && isNumber(item.width)) {
      const points = item.points
        .filter((point): point is [number, number] => Array.isArray(point) && isNumber(point[0]) && isNumber(point[1]))
        .slice(0, MAX_POINTS)
        .map(([x, y]) => [round(clamp01(x)), round(clamp01(y))] as [number, number])
      if (!points.length) continue
      out.push({ id, page, tool: item.tool, color: item.color, width: Math.min(0.1, Math.max(0.0005, item.width)), points })
    } else if (item.tool === 'mark' && Array.isArray(item.rects)) {
      const rects = item.rects
        .filter((rect): rect is [number, number, number, number] => Array.isArray(rect) && rect.length === 4 && rect.every(isNumber))
        .map((rect) => rect.map((value) => round(clamp01(value))) as [number, number, number, number])
      if (!rects.length) continue
      out.push({ id, page, tool: 'mark', color: item.color, rects })
    } else if (item.tool === 'text' && typeof item.text === 'string' && isNumber(item.x) && isNumber(item.y)) {
      if (!item.text.trim()) continue
      const size = isNumber(item.size) ? Math.min(0.1, Math.max(0.008, item.size)) : TEXT_SIZE
      out.push({ id, page, tool: 'text', color: item.color, x: round(clamp01(item.x)), y: round(clamp01(item.y)), size, text: item.text.slice(0, 5000) })
    } else continue
    seen.add(id)
  }
  return out
}

/** Cópia simples (as listas da tela são reativas, e o structuredClone não aceita isso). */
export function cloneAnnotations(items: readonly Annotation[]): Annotation[] {
  return JSON.parse(JSON.stringify(items)) as Annotation[]
}

export function serializeAnnotations(documentId: string, items: Annotation[]): string {
  return toJson({ app: '4notes', version: 1, document: documentId, items })
}
