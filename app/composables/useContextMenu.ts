/**
 * Menus de clique direito com o visual do 4notes (desenhados por ContextMenuHost.vue).
 *
 *   const choice = await showContextMenu([{ id: 'open', label: 'Abrir' }, separator, …])
 *
 * O menu abre onde o mouse está (ou abaixo de um elemento, se ele for passado) e
 * devolve o `id` do item escolhido — ou null se fechar sem escolha.
 */
import { shallowRef } from 'vue'
import { canReveal } from '~/lib/platform'

export interface MenuItemSpec {
  id?: string
  label?: string
  type?: 'normal' | 'separator' | 'checkbox' | 'radio'
  checked?: boolean
  enabled?: boolean
  /** Ação destrutiva (aparece em vermelho). */
  danger?: boolean
  /** Atalho mostrado à direita (ex.: "Ctrl+C"). */
  hint?: string
  /** Bolinha de cor antes do texto (cor CSS), ex.: nas opções de cor. */
  swatch?: string
  submenu?: MenuItemSpec[]
}

export interface ContextMenuRequest {
  items: MenuItemSpec[]
  x: number
  y: number
  /** Fecha o menu devolvendo a escolha. */
  resolve(id: string | null): void
}

export const separator: MenuItemSpec = { type: 'separator' }

/** "Mostrar no Explorador" — só onde há um gerenciador de arquivos (não no celular). */
export function revealItem(enabled = true): MenuItemSpec[] {
  return canReveal() ? [{ id: 'reveal', label: 'Mostrar no Explorador', enabled }] : []
}

/** Menu aberto agora (só um por vez). */
export const openMenu = shallowRef<ContextMenuRequest | null>(null)

// Último ponto clicado: é onde o menu abre
let pointer = { x: 0, y: 0 }
if (typeof window !== 'undefined') {
  const track = (event: MouseEvent) => {
    pointer = { x: event.clientX, y: event.clientY }
  }
  window.addEventListener('pointerdown', track, true)
  window.addEventListener('contextmenu', track, true)
}

export function showContextMenu(items: MenuItemSpec[], anchor?: Element | null): Promise<string | null> {
  openMenu.value?.resolve(null)
  let { x, y } = pointer
  if (anchor) {
    const rect = anchor.getBoundingClientRect()
    x = rect.left
    y = rect.bottom + 4
  }
  return new Promise((resolve) => {
    const request: ContextMenuRequest = {
      items,
      x,
      y,
      resolve(id) {
        if (openMenu.value === request) openMenu.value = null
        resolve(id)
      },
    }
    openMenu.value = request
  })
}
