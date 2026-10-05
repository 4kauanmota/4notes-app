/**
 * Avisos de notas que mudaram de lugar (Notas e Mapa Mental).
 *
 * As menções (nas tarefas e dentro das notas) guardam o caminho da nota; quando
 * ela muda de nome ou de pasta no app, o módulo dono da nota avisa aqui e o store
 * de menções (stores/mentions.ts) corrige tudo. Os módulos só avisam — não sabem
 * quem está ouvindo.
 */
export type NoteChange =
  /** Nota das Notas renomeada ou movida de categoria: "notes/A.md" → "notes/Trabalho/B.md". */
  | { type: 'note-renamed'; from: string; to: string }
  /** Categoria das Notas renomeada (a pasta dela): "notes/Trabalho" → "notes/Projetos". */
  | { type: 'notes-folder-renamed'; from: string; to: string }
  /** Nota de um mapa renomeada: arquivos "Godot.md" → "Godot 4.md" dentro do mapa. */
  | { type: 'map-note-renamed'; map: string; from: string; to: string }
  /** Mapa renomeado (a pasta dele). */
  | { type: 'map-renamed'; from: string; to: string }

type Listener = (change: NoteChange) => void

const listeners = new Set<Listener>()

export function onNoteChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitNoteChange(change: NoteChange): void {
  for (const listener of listeners) {
    try {
      listener(change)
    } catch (error) {
      console.error('[4notes] Erro ao atualizar menções:', error)
    }
  }
}
