/**
 * Tamanho e tipo de tela. A interface se organiza por isso — não pelo aparelho:
 *
 *  - compact (até 599 px de largura): celular, ou a tela externa (fechada) do
 *    Galaxy Z Fold → uma coisa por vez, módulos na barra de baixo, menus como
 *    folhas que sobem da borda;
 *  - medium (600–839 px, com toque): a tela interna (aberta) do Fold, tablets
 *    pequenos → menu lateral, lista e conteúdo lado a lado. Também o celular deitado
 *    (largo, mas baixo: menos de 480 px de altura), mesmo com 840 px ou mais;
 *  - expanded (840 px ou mais, ou qualquer tamanho com mouse): o layout do desktop.
 *
 * Muda na hora ao abrir/fechar o Fold, girar a tela ou redimensionar a janela.
 * Marca o <html> para o CSS: data-layout="compact|medium|expanded", data-touch (tela
 * de toque, sem mouse) e data-keyboard (teclado do celular aberto).
 */
import { computed, reactive, readonly } from 'vue'
import { isAndroid } from '~/lib/platform'

export type LayoutSize = 'compact' | 'medium' | 'expanded'

/** Larguras (px) em que o layout muda. */
export const COMPACT_MAX = 599
export const MEDIUM_MAX = 839
/** Abaixo desta altura (celular deitado), o toque fica no layout medium mesmo largo. */
export const SHORT_MAX = 479

/** O tamanho do layout para uma janela (regra pura — também usada nos testes). */
export function classifyLayout(width: number, height: number, touch: boolean): LayoutSize {
  if (width <= COMPACT_MAX) return 'compact'
  if (touch && (width <= MEDIUM_MAX || height <= SHORT_MAX)) return 'medium'
  return 'expanded'
}

const state = reactive({
  size: 'expanded' as LayoutSize,
  /** Tela de toque como forma principal de usar (sem hover). */
  touch: false,
  /** Teclado virtual aberto (celular). */
  keyboard: false,
  width: 0,
  height: 0,
})

let installed = false
/** Altura sem teclado na largura atual (o teclado encolhe a área do app). */
let fullHeight = 0
let fullWidth = 0

const query = (text: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(text) : null)
const coarse = query('(pointer: coarse)')
const noHover = query('(hover: none)')

function isEditable(element: Element | null): boolean {
  if (!element) return false
  if (element instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'file'].includes(element.type)
  return element instanceof HTMLTextAreaElement || (element as HTMLElement).isContentEditable
}

function update(): void {
  const width = window.innerWidth
  const height = window.innerHeight
  const touch = !!(coarse?.matches && noHover?.matches) || isAndroid()
  // Abriu/fechou o Fold, girou: a altura "cheia" é medida de novo
  if (Math.abs(width - fullWidth) > 40 || height > fullHeight) {
    fullWidth = width
    fullHeight = height
  }
  const keyboard = touch && isEditable(document.activeElement) && height < fullHeight * 0.8
  // Com o teclado aberto a altura encolhe — o layout continua o da tela inteira
  const size = classifyLayout(width, keyboard ? fullHeight : height, touch)

  state.width = width
  state.height = height
  state.size = size
  state.touch = touch
  state.keyboard = keyboard

  const root = document.documentElement
  root.dataset.layout = size
  root.toggleAttribute('data-touch', touch)
  root.toggleAttribute('data-keyboard', keyboard)
}

/** Chamado uma vez, antes de a interface aparecer (plugins/touch.client.ts). */
export function installLayoutSize(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  if (isAndroid()) document.documentElement.dataset.platform = 'android'
  update()
  window.addEventListener('resize', update)
  window.visualViewport?.addEventListener('resize', update)
  coarse?.addEventListener('change', update)
  noHover?.addEventListener('change', update)
  // O teclado abre/fecha junto com o foco num campo
  document.addEventListener('focusin', () => requestAnimationFrame(update))
  document.addEventListener('focusout', () => setTimeout(update, 50))
}

const isCompact = computed(() => state.size === 'compact')
const isMedium = computed(() => state.size === 'medium')
/** Telas pequenas (compact ou medium): sem o layout completo do desktop. */
const isMobileLayout = computed(() => state.size !== 'expanded')

export function useLayoutSize() {
  return { layout: readonly(state), isCompact, isMedium, isMobileLayout }
}
