/**
 * Menção guardada fora do texto — a lista "Menções" de cada tarefa (tasks.json).
 *
 * Cada menção guarda como achar o item (o caminho ou o id, que não muda) e o último
 * título conhecido (para mostrar algo mesmo se o item sumir):
 *   { "kind": "note", "path": "notes/Ideias.md", "title": "Ideias" }
 *   { "kind": "map", "map": "Principal", "note": "Godot.md", "title": "Godot" }      ← nota de um mapa
 *   { "kind": "mindmap", "map": "Principal", "title": "Principal" }                 ← o mapa inteiro
 *   { "kind": "task", "id": "t_k3j9x0", "title": "Estudar Godot" }
 *   { "kind": "timer", "id": "s_k3j9x0", "title": "Estudando Godot" }                ← registro do Timer
 *   { "kind": "link", "id": "l_x1", "url": "https://nuxt.com", "title": "Nuxt" }
 *
 * Até a 1.6.0 só existiam "note" e "map" — continuam iguais.
 * Dentro do app, toda menção também tem um "caminho de menção" (refPath), o mesmo
 * usado nos links das notas (lib/notes/mention-links.ts).
 */
import { nameKey, stripExtension } from '../files/filename'
import type { NoteChange } from '../note-events'
import { idMentionPath, idOf, mapMentionPath, mapOfMentionPath } from '../notes/mention-links'
import { DATA_PATHS } from '../storage/paths'

export type MentionRef =
  | { kind: 'note'; path: string; title: string }
  | { kind: 'map'; map: string; note: string; title: string }
  | { kind: 'mindmap'; map: string; title: string }
  | { kind: 'task'; id: string; title: string }
  | { kind: 'timer'; id: string; title: string }
  | { kind: 'link'; id: string; url: string; title: string }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function normalizeRef(raw: unknown): MentionRef | null {
  if (!isObject(raw)) return null
  if (raw.kind === 'note') {
    const path = text(raw.path)
    if (!path.endsWith('.md')) return null
    return { kind: 'note', path, title: text(raw.title) || stripExtension(path.split('/').pop() ?? path) }
  }
  if (raw.kind === 'map') {
    const map = text(raw.map)
    const note = text(raw.note)
    if (!map || !note.endsWith('.md')) return null
    return { kind: 'map', map, note, title: text(raw.title) || stripExtension(note) }
  }
  if (raw.kind === 'mindmap') {
    const map = text(raw.map)
    return map ? { kind: 'mindmap', map, title: text(raw.title) || map } : null
  }
  if (raw.kind === 'task' || raw.kind === 'timer') {
    const id = text(raw.id)
    return id ? { kind: raw.kind, id, title: text(raw.title) } : null
  }
  if (raw.kind === 'link') {
    const id = text(raw.id)
    const url = text(raw.url)
    return id ? { kind: 'link', id, url, title: text(raw.title) || url } : null
  }
  return null
}

/** Identidade da menção (caminhos sem diferenciar maiúsculas, como o Windows; ids como estão). */
export function refKey(ref: MentionRef): string {
  switch (ref.kind) {
    case 'note':
      return `note:${nameKey(ref.path)}`
    case 'map':
      return `map:${nameKey(ref.map)}/${nameKey(ref.note)}`
    case 'mindmap':
      return `mindmap:${nameKey(ref.map)}`
    default:
      return `${ref.kind}:${ref.id}`
  }
}

export function normalizeRefs(raw: unknown): MentionRef[] {
  const refs: MentionRef[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const ref = normalizeRef(item)
    if (!ref || seen.has(refKey(ref))) continue
    seen.add(refKey(ref))
    refs.push(ref)
  }
  return refs
}

/** Caminho de menção ("notes/Ideias.md", "mindmap/Principal/mapa.json", "timer/timer.json#s_1"…). */
export function refPath(ref: MentionRef): string {
  switch (ref.kind) {
    case 'note':
      return ref.path
    case 'map':
      return `${DATA_PATHS.mindmapDir}/${ref.map}/${ref.note}`
    case 'mindmap':
      return mapMentionPath(ref.map)
    default:
      return idMentionPath(ref.kind, ref.id)
  }
}

/**
 * Caminho de menção → menção (null se o caminho não é de algo que dá para mencionar).
 * `title` = título que fica guardado; `url` = endereço (links salvos).
 */
export function refFromPath(path: string, title?: string, url?: string): MentionRef | null {
  const found = idOf(path)
  if (found) {
    if (found.kind === 'link') return { kind: 'link', id: found.id, url: url ?? '', title: title ?? url ?? '' }
    return { kind: found.kind, id: found.id, title: title ?? '' }
  }
  const map = mapOfMentionPath(path)
  if (map) return { kind: 'mindmap', map, title: title ?? map }
  const parts = path.split('/')
  const file = parts.at(-1) ?? ''
  if (!/\.md$/i.test(file)) return null
  const name = title ?? stripExtension(file)
  // Notas: soltas (notes/X.md) ou numa categoria (notes/Trabalho/X.md)
  if ((parts.length === 2 || parts.length === 3) && parts[0] === DATA_PATHS.notesDir) return { kind: 'note', path, title: name }
  if (parts.length === 3 && parts[0] === DATA_PATHS.mindmapDir) return { kind: 'map', map: parts[1]!, note: file, title: name }
  return null
}

/** A menção depois de uma nota, categoria ou mapa ser renomeado; null se ela não foi afetada. */
export function renamedRef(ref: MentionRef, change: NoteChange): MentionRef | null {
  if (change.type === 'note-renamed') {
    if (ref.kind !== 'note' || nameKey(ref.path) !== nameKey(change.from)) return null
    return { ...ref, path: change.to }
  }
  if (change.type === 'notes-folder-renamed') {
    const prefix = `${change.from}/`
    if (ref.kind !== 'note' || !nameKey(ref.path).startsWith(nameKey(prefix))) return null
    return { ...ref, path: `${change.to}/${ref.path.slice(prefix.length)}` }
  }
  if (change.type === 'map-renamed') {
    if (ref.kind === 'mindmap') return nameKey(ref.map) === nameKey(change.from) ? { ...ref, map: change.to, title: change.to } : null
    if (ref.kind !== 'map') return null
    return nameKey(ref.map) === nameKey(change.from) ? { ...ref, map: change.to } : null
  }
  if (ref.kind !== 'map') return null
  if (nameKey(ref.map) !== nameKey(change.map) || nameKey(ref.note) !== nameKey(change.from)) return null
  return { ...ref, note: change.to, title: stripExtension(change.to) }
}
