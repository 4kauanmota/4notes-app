/**
 * Menções a notas dentro das tarefas.
 *
 * Uma menção guarda onde a nota está (para abri-la) e o último título conhecido
 * (para mostrar algo mesmo se a nota sumir):
 *   { "kind": "note", "path": "notes/Ideias.md", "title": "Ideias" }
 *   { "kind": "map", "map": "Principal", "note": "Godot.md", "title": "Godot" }
 */
import { nameKey, stripExtension } from '../files/filename'
import type { NoteChange } from '../note-events'

export type NoteRef =
  | { kind: 'note'; path: string; title: string }
  | { kind: 'map'; map: string; note: string; title: string }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function normalizeRef(raw: unknown): NoteRef | null {
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
  return null
}

/** Identidade da menção (sem diferenciar maiúsculas, como o Windows). */
export function refKey(ref: NoteRef): string {
  return ref.kind === 'note' ? `note:${nameKey(ref.path)}` : `map:${nameKey(ref.map)}/${nameKey(ref.note)}`
}

export function normalizeRefs(raw: unknown): NoteRef[] {
  const refs: NoteRef[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const ref = normalizeRef(item)
    if (!ref || seen.has(refKey(ref))) continue
    seen.add(refKey(ref))
    refs.push(ref)
  }
  return refs
}

/** A menção depois de uma nota (ou mapa) ser renomeada; null se ela não foi afetada. */
export function renamedRef(ref: NoteRef, change: NoteChange): NoteRef | null {
  if (change.type === 'note-renamed') {
    if (ref.kind !== 'note' || nameKey(ref.path) !== nameKey(change.from)) return null
    return { ...ref, path: change.to }
  }
  if (change.type === 'notes-folder-renamed') {
    const prefix = `${change.from}/`
    if (ref.kind !== 'note' || !nameKey(ref.path).startsWith(nameKey(prefix))) return null
    return { ...ref, path: `${change.to}/${ref.path.slice(prefix.length)}` }
  }
  if (ref.kind !== 'map') return null
  if (change.type === 'map-renamed') {
    return nameKey(ref.map) === nameKey(change.from) ? { ...ref, map: change.to } : null
  }
  if (nameKey(ref.map) !== nameKey(change.map) || nameKey(ref.note) !== nameKey(change.from)) return null
  return { ...ref, note: change.to, title: stripExtension(change.to) }
}
