/**
 * Documentos (1.7.3): o índice dos documentos guardados no workspace.
 *
 *   documents/
 *   ├── documents.json        ← o índice (este formato)
 *   ├── arquivos/             ← os arquivos importados, com o nome original ("contrato (2).pdf")
 *   └── anotacoes/<id>.json   ← as anotações de cada PDF (annotations.ts); o PDF nunca muda
 *
 *   {
 *     "app": "4notes", "version": 1,
 *     "categories": [{ "id": "casa", "name": "Casa", "color": "green", "createdAt": "…" }],
 *     "documents": [{
 *       "id": "d_k3j9x0a2qm", "name": "Contrato de aluguel", "file": "documents/arquivos/contrato.pdf",
 *       "kind": "pdf", "size": 182044, "categoryId": "casa",
 *       "addedAt": "…", "updatedAt": "…", "openedAt": "…"
 *     }]
 *   }
 *
 * As categorias são as do app (stores/categories.ts): a lista daqui diz quais aparecem
 * nos Documentos e em que ordem, com uma cópia do nome e da cor. Cada documento tem uma
 * categoria (ou nenhuma); "associar vários" é escolher vários e mudar a de todos.
 */
import { extensionOf } from '#shared/files'
import { isPaletteColor, type PaletteColor } from '../colors'
import { toJson } from '../storage/json-file'
import { createId } from '../utils/async'

export type DocumentKind = 'pdf' | 'image' | 'text' | 'other'

export interface DocumentCategory {
  id: string
  name: string
  color: PaletteColor
  createdAt: string
}

export interface StoredDocument {
  id: string
  /** Nome mostrado (começa com o nome do arquivo, sem a extensão; pode ser trocado). */
  name: string
  /** Caminho do arquivo no workspace ("documents/arquivos/contrato.pdf"). */
  file: string
  kind: DocumentKind
  /** Tamanho em bytes. */
  size: number
  categoryId: string | null
  addedAt: string
  updatedAt: string
  /** Última vez que foi aberto (para "Recentes"). */
  openedAt: string | null
}

export interface DocumentsData {
  categories: DocumentCategory[]
  documents: StoredDocument[]
}

export type DocumentSort = 'recent' | 'name' | 'kind'

/** Arrastar documentos da lista até uma categoria (os ids, separados por vírgula). */
export const DOCUMENT_DRAG_TYPE = 'application/x-4notes-document'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'])
const TEXT = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'log', 'xml', 'yml', 'yaml', 'ini', 'tsv'])

/** O tipo pelo nome do arquivo: PDF, imagem e texto abrem no app; o resto abre no programa do sistema. */
export function kindOf(fileName: string): DocumentKind {
  const extension = extensionOf(fileName)
  if (extension === 'pdf') return 'pdf'
  if (IMAGE.has(extension)) return 'image'
  if (TEXT.has(extension)) return 'text'
  return 'other'
}

export const KIND_LABELS: Record<DocumentKind, string> = { pdf: 'PDF', image: 'Imagem', text: 'Texto', other: 'Arquivo' }

/** Nome mostrado a partir do nome do arquivo ("contrato_aluguel.pdf" → "contrato_aluguel"). */
export function displayName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base).trim() || 'Documento'
}

export const MAX_NAME = 200

export function defaultDocumentsData(): DocumentsData {
  return { categories: [], documents: [] }
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
const date = (value: unknown, fallback: string) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback)

/** Lê o documents.json de forma tolerante (registros quebrados ficam de fora; id repetido entra uma vez). */
export function normalizeDocumentsFile(raw: unknown, now = new Date().toISOString()): DocumentsData {
  if (!isObject(raw)) throw new Error('O arquivo não tem o formato esperado.')
  const categories: DocumentCategory[] = []
  const seenCategories = new Set<string>()
  for (const item of Array.isArray(raw.categories) ? raw.categories : []) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id || seenCategories.has(item.id)) continue
    const name = text(item.name).trim()
    if (!name) continue
    seenCategories.add(item.id)
    categories.push({ id: item.id, name, color: isPaletteColor(item.color) ? item.color : 'purple', createdAt: date(item.createdAt, now) })
  }
  const documents: StoredDocument[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw.documents) ? raw.documents : []) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue
    const file = text(item.file).replace(/\\/g, '/')
    // O arquivo tem que estar na pasta dos Documentos (nada de caminhos para fora)
    if (!/^documents\/arquivos\/[^/]+$/.test(file) || file.includes('..')) continue
    seen.add(item.id)
    const kind = ['pdf', 'image', 'text', 'other'].includes(item.kind as string) ? (item.kind as DocumentKind) : kindOf(file)
    const categoryId = typeof item.categoryId === 'string' && seenCategories.has(item.categoryId) ? item.categoryId : null
    const addedAt = date(item.addedAt, now)
    documents.push({
      id: item.id,
      name: text(item.name).trim().slice(0, MAX_NAME) || displayName(file),
      file,
      kind,
      size: typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0 ? Math.round(item.size) : 0,
      categoryId,
      addedAt,
      updatedAt: date(item.updatedAt, addedAt),
      openedAt: typeof item.openedAt === 'string' && !Number.isNaN(Date.parse(item.openedAt)) ? item.openedAt : null,
    })
  }
  return { categories, documents }
}

export function serializeDocuments(data: DocumentsData): string {
  return toJson({
    app: '4notes',
    version: 1,
    categories: data.categories,
    documents: data.documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      file: doc.file,
      kind: doc.kind,
      size: doc.size,
      categoryId: doc.categoryId,
      addedAt: doc.addedAt,
      updatedAt: doc.updatedAt,
      openedAt: doc.openedAt,
    })),
  })
}

export function newDocument(file: { path: string; name: string; size: number }, categoryId: string | null, original: string, now = new Date().toISOString()): StoredDocument {
  return {
    id: createId('d'),
    name: displayName(original).slice(0, MAX_NAME),
    file: file.path,
    kind: kindOf(file.name),
    size: file.size,
    categoryId,
    addedAt: now,
    updatedAt: now,
    openedAt: null,
  }
}

/** Busca sem acentos e sem maiúsculas, palavra por palavra (no nome e no nome do arquivo). */
export function searchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function matchesSearch(doc: StoredDocument, query: string, categoryName = ''): boolean {
  const words = searchKey(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = searchKey(`${doc.name} ${doc.file.split('/').pop() ?? ''} ${KIND_LABELS[doc.kind]} ${categoryName}`)
  return words.every((word) => haystack.includes(word))
}

export function sortDocuments(list: StoredDocument[], sort: DocumentSort): StoredDocument[] {
  const byName = (a: StoredDocument, b: StoredDocument) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' })
  const recent = (doc: StoredDocument) => doc.openedAt && doc.openedAt > doc.addedAt ? doc.openedAt : doc.addedAt
  return [...list].sort((a, b) => {
    if (sort === 'name') return byName(a, b)
    if (sort === 'kind') return a.kind.localeCompare(b.kind) || byName(a, b)
    return recent(b).localeCompare(recent(a)) || byName(a, b)
  })
}

/** "182 KB", "3,4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`
}
