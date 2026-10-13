/**
 * De onde vêm as categorias com nome e cor que o diálogo de categoria edita
 * (components/tasks/CategoryDialog.vue): as das Tarefas (padrão) ou as do Timer.
 * Cada módulo continua com as próprias categorias, no próprio arquivo.
 */
import type { PaletteColor } from './colors'

export interface ColorCategory {
  id: string
  name: string
  color: PaletteColor
}

export interface CategorySource {
  readonly categories: readonly ColorCategory[]
  add(name: string, color: PaletteColor): ColorCategory
  update(id: string, patch: { name: string; color: PaletteColor }): void
  /** Pede confirmação e exclui (devolve true se excluiu). */
  requestDelete(id: string): Promise<boolean>
}
