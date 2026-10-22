/**
 * De onde vêm as categorias com nome e cor que o diálogo de categoria edita
 * (components/tasks/CategoryDialog.vue): as das Tarefas (padrão) ou as do Timer.
 * Desde a 1.7.0 as categorias são as compartilhadas do app (stores/categories.ts);
 * cada módulo tem a lista das que ele mostra.
 */
import type { CategoryModuleId } from './categories/model'
import type { PaletteColor } from './colors'

export interface ColorCategory {
  id: string
  name: string
  color: PaletteColor
}

export interface CategorySource {
  /** O módulo (para o "Usar categoria existente" e a exclusão). */
  readonly module: CategoryModuleId
  readonly categories: readonly ColorCategory[]
  /** Cria (no app) e põe na lista do módulo. null = nome com problema. */
  add(name: string, color: PaletteColor): ColorCategory | null
  /** Põe uma categoria do app na lista do módulo. */
  attach(id: string): ColorCategory | null
  update(id: string, patch: { name: string; color: PaletteColor }): Promise<boolean> | void
  /** Pede o que fazer com os registros e exclui (devolve true se excluiu). */
  requestDelete(id: string): Promise<boolean>
}
