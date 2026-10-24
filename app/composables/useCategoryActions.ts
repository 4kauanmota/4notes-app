/**
 * Ações das categorias compartilhadas que abrem uma janela (1.7.0): excluir (com a
 * escolha do destino dos registros) e juntar com outra. As janelas ficam no app.vue
 * (uma de cada), e qualquer módulo pode pedir. As categorias em si ficam em
 * Configurações › Categorias (1.7.1): openCategoriesPanel abre lá (o app.vue atende).
 */
import { reactive } from 'vue'
import type { CategoryModuleId } from '~/lib/categories/model'

interface Pending {
  id: string
  resolve: (done: boolean) => void
}

const ui = reactive({
  /** Excluir: `module` = pedido pela lista de um módulo (dá para tirar só de lá). */
  removal: null as (Pending & { module: CategoryModuleId | null }) | null,
  /** Juntar `id` com outra categoria. */
  merge: null as Pending | null,
  /** Configurações › Categorias: pedidos para abrir (o app.vue atende) e a categoria aberta (null = a lista). */
  panel: { request: 0, selected: null as string | null },
})

function settle(pending: Pending | null, done: boolean): void {
  pending?.resolve(done)
}

/** Excluir uma categoria: pergunta o que fazer com os registros. true = excluiu (ou tirou do módulo). */
export function requestCategoryRemoval(id: string, module: CategoryModuleId | null = null): Promise<boolean> {
  settle(ui.removal, false)
  return new Promise((resolve) => {
    ui.removal = { id, module, resolve }
  })
}

/** Juntar uma categoria com outra (escolhida na janela). true = juntou. */
export function requestCategoryMerge(id: string): Promise<boolean> {
  settle(ui.merge, false)
  return new Promise((resolve) => {
    ui.merge = { id, resolve }
  })
}

/** Abre Configurações › Categorias (já numa categoria, se `id` vier). */
export function openCategoriesPanel(id: string | null = null): void {
  ui.panel.selected = id
  ui.panel.request++
}

/** Fecha a janela de exclusão (ou de junção) dizendo se a ação aconteceu. */
export function finishRemoval(done: boolean): void {
  const pending = ui.removal
  ui.removal = null
  settle(pending, done)
}

export function finishMerge(done: boolean): void {
  const pending = ui.merge
  ui.merge = null
  settle(pending, done)
}

export function useCategoryUi() {
  return ui
}
