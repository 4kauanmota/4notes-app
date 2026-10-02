/**
 * Persistência do Mapa Mental:
 *   - cada mapa é uma pasta: <pasta de dados>/mindmap/<Nome do mapa>/
 *       com as notas (.md) e o mapa.json (conexões e cores) — ver model.ts
 *   - preferências do grafo, último mapa aberto e posições dos nós: .4notes/mindmap.json
 */
import type { FileEntry } from '#shared/ipc'
import { basename, joinPath, nameKey, stripExtension } from '../files/filename'
import { desktop } from '../platform'
import { readJsonFile } from '../storage/json-file'
import { DATA_PATHS } from '../storage/paths'
import { migrateLegacyNotes } from './migration'
import { DEFAULT_MAP_NAME, MAP_FILE, emptyMapFile, findConnection, normalizeMapFile, serializeMapFile, type MapFile } from './model'

export interface GraphSettings {
  showOrphans: boolean
  nodeStyle: 'circle' | 'card'
  /** Nomes embaixo dos círculos: só da nota selecionada, conforme o zoom, ou sempre. */
  labels: 'selected' | 'auto' | 'always'
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  showOrphans: true,
  nodeStyle: 'card',
  labels: 'selected',
}

/**
 * Versão das preferências gravadas. Na 1.1.0 os cards viraram o padrão e os nomes
 * dos círculos passaram a aparecer só na nota selecionada: preferências gravadas
 * por versões anteriores (que sempre gravavam os padrões antigos) voltam aos novos padrões.
 */
export const GRAPH_SETTINGS_VERSION = 2

export type Layout = Record<string, [number, number]>

export interface MapInfo {
  name: string
  /** Quantidade de notas (arquivos .md) do mapa. */
  notes: number
}

export interface MindmapUiState {
  settings: GraphSettings
  currentMap: string | null
  /** Posições dos nós por mapa: nome do mapa → (id do nó → [x, y]). */
  layouts: Record<string, Layout>
  /** Posições no formato da 1.0.0 (um mapa só) — usadas uma vez, na migração. */
  legacyLayout: Layout | null
}

export type MapFileResult = { status: 'ok' | 'missing'; data: MapFile } | { status: 'invalid'; raw: string; error: string }

export interface LegacyMigration {
  map: string
  /** id antigo (caminho em mindmap/) → id novo (nome do arquivo no mapa). */
  renames: Map<string, string>
  backupDir: string
  notes: number
  connections: number
}

const ROOT = DATA_PATHS.mindmapDir
const mapDir = (map: string) => joinPath(ROOT, map)
const notePath = (map: string, noteId: string) => joinPath(ROOT, map, noteId)
const mapFilePath = (map: string) => joinPath(ROOT, map, MAP_FILE)
const relative = (path: string) => path.slice(ROOT.length + 1)
const isNote = (name: string) => name.toLowerCase().endsWith('.md')

function readLayout(value: unknown): Layout {
  const layout: Layout = {}
  if (!value || typeof value !== 'object') return layout
  for (const [id, point] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(point) && point.length === 2 && point.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      layout[id] = [point[0] as number, point[1] as number]
    }
  }
  return layout
}

export const mindmapRepository = {
  /** Mapas = subpastas de mindmap/ com notas ou com mapa.json. */
  async listMaps(): Promise<MapInfo[]> {
    const files = await desktop().files.list(ROOT, { recursive: true, extensions: ['.md', '.json'] })
    const maps = new Map<string, MapInfo>()
    for (const file of files) {
      const parts = relative(file.path).split('/')
      if (parts.length !== 2) continue
      const [map, name] = parts as [string, string]
      if (!isNote(name) && name !== MAP_FILE) continue
      const info = maps.get(nameKey(map)) ?? { name: map, notes: 0 }
      if (isNote(name)) info.notes++
      maps.set(nameKey(map), info)
    }
    return [...maps.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  },

  listNotes: (map: string): Promise<FileEntry[]> => desktop().files.list(mapDir(map), { extensions: ['.md'], withContent: true }),
  /** Só os nomes das notas do mapa (sem ler o conteúdo). */
  listNoteNames: async (map: string): Promise<string[]> =>
    (await desktop().files.list(mapDir(map), { extensions: ['.md'] })).map((file) => file.name),

  /** "mindmap/Principal/Godot.md" → "Godot.md" */
  noteIdFromPath: (path: string) => basename(path),

  write: (map: string, noteId: string, content: string) => desktop().files.write(notePath(map, noteId), content),
  rename: (map: string, fromId: string, toId: string) => desktop().files.rename(notePath(map, fromId), notePath(map, toId)),
  exists: (map: string, noteId: string) => desktop().files.exists(notePath(map, noteId)),
  trash: (map: string, noteId: string) => desktop().files.trash(notePath(map, noteId)),
  reveal: (map: string, noteId: string) => desktop().files.reveal(notePath(map, noteId)),

  async readMap(map: string): Promise<MapFileResult> {
    const result = await readJsonFile(mapFilePath(map))
    if (result.status === 'missing') return { status: 'missing', data: emptyMapFile() }
    if (result.status === 'invalid') return { status: 'invalid', raw: result.raw, error: result.error }
    return { status: 'ok', data: normalizeMapFile(result.data) }
  },
  readMapRaw: (map: string) => desktop().files.read(mapFilePath(map)),
  writeMap: (map: string, data: MapFile) => desktop().files.write(mapFilePath(map), serializeMapFile(data)),

  /** Guarda uma cópia de um mapa.json com erro antes de ele ser substituído. */
  async backupBrokenMap(map: string, raw: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const path = joinPath(DATA_PATHS.backupsDir, `mapa-${map}-${stamp}.json`)
    await desktop().files.write(path, raw)
    return path
  },

  createMap: (name: string) => desktop().files.write(mapFilePath(name), serializeMapFile(emptyMapFile())),
  mapExists: (name: string) => desktop().files.exists(mapDir(name)),
  renameMap: (from: string, to: string) => desktop().files.rename(mapDir(from), mapDir(to)),
  trashMap: (name: string) => desktop().files.trash(mapDir(name)),
  revealMap: (name: string) => desktop().files.reveal(mapFilePath(name)),

  async readUiState(): Promise<MindmapUiState> {
    const result = await readJsonFile(DATA_PATHS.mindmapUiState)
    const data = (result.status === 'ok' && result.data && typeof result.data === 'object' ? result.data : {}) as Record<string, unknown>
    const raw = (data.settings ?? {}) as Partial<GraphSettings>
    const layouts: Record<string, Layout> = {}
    if (data.layouts && typeof data.layouts === 'object') {
      for (const [map, layout] of Object.entries(data.layouts as Record<string, unknown>)) layouts[map] = readLayout(layout)
    }
    const current = data.settingsVersion === GRAPH_SETTINGS_VERSION
    return {
      settings: {
        showOrphans: raw.showOrphans !== false,
        nodeStyle: current && raw.nodeStyle === 'circle' ? 'circle' : 'card',
        labels: current && (raw.labels === 'auto' || raw.labels === 'always') ? raw.labels : 'selected',
      },
      currentMap: typeof data.currentMap === 'string' ? data.currentMap : null,
      layouts,
      legacyLayout: data.layout ? readLayout(data.layout) : null,
    }
  },

  /**
   * Converte o Mapa Mental da 1.0.0 (notas soltas em mindmap/, ligadas por [[links]])
   * para o mapa "Principal". Antes de mexer em qualquer arquivo, copia as notas
   * originais para .4notes/backups/. Devolve null se não houver nada a converter.
   */
  async migrateLegacy(): Promise<LegacyMigration | null> {
    const files = desktop().files
    const all = await files.list(ROOT, { recursive: true, extensions: ['.md', '.json'], withContent: true })
    const rootNotes = all.filter((file) => isNote(file.name) && !relative(file.path).includes('/'))
    if (!rootNotes.length) return null

    // Na primeira conversão (ainda sem nenhum mapa.json), subpastas da 1.0.0 também entram.
    const hasMaps = all.some((file) => file.name === MAP_FILE && relative(file.path).split('/').length === 2)
    const legacy = hasMaps ? rootNotes : all.filter((file) => isNote(file.name))

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupDir = joinPath(DATA_PATHS.backupsDir, `mindmap-1.0.0-${stamp}`)
    for (const file of legacy) await files.write(joinPath(backupDir, relative(file.path)), file.content ?? '')

    const map = DEFAULT_MAP_NAME
    const inTarget = all.filter((file) => isNote(file.name) && !legacy.includes(file) && nameKey(relative(file.path).split('/')[0]!) === nameKey(map))
    const result = migrateLegacyNotes(
      legacy.map((file) => ({ id: relative(file.path), content: file.content ?? '' })),
      inTarget.map((file) => stripExtension(file.name)),
    )

    // Primeiro as conexões (se algo falhar no meio, o mapa.json já está certo)
    const current = await this.readMap(map)
    const data = current.status === 'invalid' ? emptyMapFile() : current.data
    if (current.status === 'invalid') await this.backupBrokenMap(map, current.raw)
    for (const connection of result.connections) {
      if (!findConnection(data.connections, connection.from, connection.to)) data.connections.push(connection)
    }
    await this.writeMap(map, data)

    const original = new Map(legacy.map((file) => [relative(file.path), file.content ?? '']))
    const renames = new Map<string, string>()
    for (const note of result.notes) {
      const fileName = `${note.title}.md`
      const from = joinPath(ROOT, note.legacyId)
      const to = notePath(map, fileName)
      if (nameKey(from) !== nameKey(to)) await files.rename(from, to)
      if (note.content !== original.get(note.legacyId)) await files.write(to, note.content)
      renames.set(note.legacyId, fileName)
    }
    return { map, renames, backupDir, notes: result.notes.length, connections: result.connections.length }
  },
}
