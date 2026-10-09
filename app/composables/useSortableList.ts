/**
 * Reorganizar uma lista vertical arrastando com o mouse (menu lateral dos módulos,
 * lista de módulos nas Configurações).
 *
 * - Segurar e arrastar um item (mais de 5 px) o "levanta": ele segue o mouse e os
 *   outros abrem espaço. Soltar grava a ordem nova (`onReorder`) e o item desliza
 *   até o lugar dele. Esc cancela.
 * - Um clique sem arrastar continua sendo um clique normal (abrir o módulo…); o clique
 *   que encerra um arraste é engolido.
 * - Usa eventos de ponteiro (não o arrastar-e-soltar do navegador), então funciona
 *   com links e mostra o item de verdade se mexendo.
 * - `flip(mudar)` anima qualquer outra troca de ordem (ex.: "Mover para cima").
 * - No toque (celular), arrastar com o dedo rola a tela: o arraste só começa pela
 *   alça (`touchHandle`, ex.: o ⠿ das Configurações). Sem alça, reorganize pelo menu
 *   do toque prolongado ("Mover para cima/baixo").
 */
import { nextTick, onBeforeUnmount, ref, type Ref } from 'vue'

export interface SortableOptions {
  container: Ref<HTMLElement | undefined>
  /** Itens que podem ser arrastados (dentro do container), na ordem da tela. */
  itemSelector: string
  /** Onde um arraste não começa (botões, switches…). */
  ignoreSelector?: string
  keyOf(el: HTMLElement): string
  /** A ordem nova (das chaves), ao soltar. */
  onReorder(keys: string[]): void
  /** false = não dá para arrastar agora (ex.: durante uma animação). */
  enabled?(): boolean
  /** No toque, o arraste só começa por aqui (sem isso, o toque não arrasta). */
  touchHandle?: string
}

interface Session {
  el: HTMLElement
  els: HTMLElement[]
  rects: DOMRect[]
  index: number
  target: number
  startY: number
  slot: number
  active: boolean
}

const THRESHOLD = 5
const SETTLE_MS = 220

export function useSortableList(options: SortableOptions) {
  /** Chave do item sendo arrastado (null = nenhum). */
  const dragging = ref<string | null>(null)
  let session: Session | null = null

  const items = () => [...(options.container.value?.querySelectorAll<HTMLElement>(options.itemSelector) ?? [])]

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || session || options.enabled?.() === false) return
    const target = event.target as HTMLElement | null
    const el = target?.closest<HTMLElement>(options.itemSelector)
    if (!el || !options.container.value?.contains(el)) return
    if (options.ignoreSelector && target?.closest(options.ignoreSelector)) return
    if (event.pointerType === 'touch' && !(options.touchHandle && target?.closest(options.touchHandle))) return
    const els = items()
    const index = els.indexOf(el)
    if (index < 0 || els.length < 2) return
    const rects = els.map((item) => item.getBoundingClientRect())
    const slot = index < els.length - 1 ? rects[index + 1]!.top - rects[index]!.top : rects[index]!.top - rects[index - 1]!.top
    session = { el, els, rects, index, target: index, startY: event.clientY, slot, active: false }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKeydown, true)
  }

  function start(s: Session): void {
    s.active = true
    dragging.value = options.keyOf(s.el)
    document.documentElement.classList.add('is-sorting')
    s.el.classList.add('is-sorting-item')
    s.el.style.zIndex = '5'
    s.el.style.transition = 'none'
    for (const el of s.els) if (el !== s.el) el.style.transition = 'transform 180ms var(--ease-out)'
  }

  function onPointerMove(event: PointerEvent): void {
    const s = session
    if (!s) return
    let dy = event.clientY - s.startY
    if (!s.active) {
      if (Math.abs(dy) < THRESHOLD) return
      start(s)
    }
    event.preventDefault()
    const first = s.rects[0]!
    const last = s.rects.at(-1)!
    const own = s.rects[s.index]!
    dy = Math.max(first.top - own.top, Math.min(last.bottom - own.bottom, dy))
    s.el.style.transform = `translateY(${dy}px)`
    // Troca de lugar quando a borda do item passa do meio do vizinho (dá para chegar
    // às pontas mesmo com o item preso dentro da lista)
    const middle = (j: number) => s.rects[j]!.top + s.rects[j]!.height / 2
    let target = s.index
    for (let j = s.index + 1; j < s.rects.length; j++) if (own.bottom + dy >= middle(j)) target = j
    for (let j = s.index - 1; j >= 0; j--) if (own.top + dy <= middle(j)) target = j
    s.target = target
    s.els.forEach((el, j) => {
      if (j === s.index) return
      const offset = s.index < j && j <= target ? -s.slot : target <= j && j < s.index ? s.slot : 0
      el.style.transform = offset ? `translateY(${offset}px)` : ''
    })
  }

  function stopListening(): void {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKeydown, true)
  }

  function swallowClick(event: MouseEvent): void {
    event.preventDefault()
    event.stopPropagation()
  }

  function finish(commit: boolean): void {
    const s = session
    session = null
    stopListening()
    if (!s?.active) return
    // O clique que vem logo depois de soltar não abre o item
    window.addEventListener('click', swallowClick, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }), 0)
    const keys = s.els.map(options.keyOf)
    const moved = commit && s.target !== s.index
    if (moved) keys.splice(s.target, 0, ...keys.splice(s.index, 1))
    void flip(() => {
      if (moved) options.onReorder(keys)
    }).then(() => {
      s.el.classList.remove('is-sorting-item')
      s.el.style.zIndex = ''
      document.documentElement.classList.remove('is-sorting')
      dragging.value = null
    })
  }

  const onPointerUp = () => finish(true)
  const onCancel = () => finish(false)
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !session?.active) return
    event.preventDefault()
    event.stopPropagation()
    finish(false)
  }

  /**
   * Anima uma troca de ordem: cada item sai de onde está agora (inclusive no meio de
   * um arraste) e desliza até o lugar novo.
   */
  async function flip(change: () => void): Promise<void> {
    const before = new Map(items().map((el) => [el, el.getBoundingClientRect().top]))
    change()
    await nextTick()
    const els = items()
    for (const el of els) {
      el.style.transition = 'none'
      el.style.transform = ''
    }
    const after = els.map((el) => el.getBoundingClientRect().top)
    els.forEach((el, i) => {
      const from = before.get(el)
      if (from !== undefined && Math.abs(from - after[i]!) > 0.5) el.style.transform = `translateY(${from - after[i]!}px)`
    })
    void options.container.value?.offsetHeight // aplica a posição de partida antes de animar
    for (const el of els) {
      el.style.transition = `transform ${SETTLE_MS}ms var(--ease-out)`
      el.style.transform = ''
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 20))
    for (const el of els) if (!session) el.style.transition = ''
  }

  onBeforeUnmount(() => {
    if (session) finish(false)
  })

  return { dragging, onPointerDown, flip }
}
