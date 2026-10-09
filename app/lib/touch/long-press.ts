/**
 * Toque prolongado = clique direito: segurar o dedo ~0,5 s sobre algo abre o mesmo
 * menu do clique direito do desktop (o app inteiro já trata o evento "contextmenu").
 *
 * - Não vale dentro de textos editáveis: lá o toque prolongado é do Android (selecionar
 *   texto, colar).
 * - Mexeu o dedo (rolando a lista): não é toque prolongado.
 * - Depois do menu, o "toque" que termina o gesto não vira um clique (não abre o item).
 * - Se o próprio navegador também mandar o "contextmenu", só um menu abre.
 * - Arrastar e soltar do desktop (HTML5) não começa por toque: os menus têm "Mover para…".
 */

const DELAY_MS = 500
const MOVE_TOLERANCE = 10

/** Onde o toque prolongado não abre o menu do app. */
const SKIP = 'input, textarea, select, [contenteditable="true"], .cm-content, [data-no-longpress]'

let installed = false

export function installLongPress(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  let timer: ReturnType<typeof setTimeout> | null = null
  let start: { x: number; y: number; target: Element; id: number } | null = null
  /** O toque que terminou o gesto não vira clique (só nesse mesmo lugar, logo em seguida). */
  let suppressClick: { until: number; target: Element } | null = null
  let suppressNativeMenuUntil = 0
  /** Um dedo está na tela agora (o arrastar do HTML5 não começa por toque). */
  let touching = false

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    start = null
  }

  window.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'touch') return
      touching = true
      cancel()
      const target = event.target instanceof Element ? event.target : null
      if (!target || !event.isPrimary || target.closest(SKIP)) return
      start = { x: event.clientX, y: event.clientY, target, id: event.pointerId }
      timer = setTimeout(() => {
        const press = start
        cancel()
        if (!press || !press.target.isConnected) return
        suppressClick = { until: performance.now() + 700, target: press.target }
        suppressNativeMenuUntil = performance.now() + 900
        navigator.vibrate?.(10)
        press.target.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: press.x, clientY: press.y, button: 2, buttons: 0, view: window }),
        )
      }, DELAY_MS)
    },
    { capture: true, passive: true },
  )

  window.addEventListener(
    'pointermove',
    (event) => {
      if (!start || event.pointerId !== start.id) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE) cancel()
    },
    { capture: true, passive: true },
  )

  const end = (event: PointerEvent) => {
    if (event.pointerType === 'touch') touching = false
    if (start && event.pointerId === start.id) cancel()
  }
  window.addEventListener('pointerup', end, { capture: true, passive: true })
  window.addEventListener('pointercancel', end, { capture: true, passive: true })

  // O menu do navegador para o mesmo toque: o nosso já abriu (ou abre agora no lugar dele)
  window.addEventListener(
    'contextmenu',
    (event) => {
      if (!event.isTrusted) return
      if (performance.now() < suppressNativeMenuUntil) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      // Veio antes do nosso tempo: vale o do navegador (e o toque não vira clique)
      if (start) {
        suppressClick = { until: performance.now() + 700, target: start.target }
        cancel()
      }
    },
    true,
  )

  window.addEventListener(
    'click',
    (event) => {
      const pending = suppressClick
      if (!pending) return
      suppressClick = null
      const target = event.target instanceof Node ? event.target : null
      if (performance.now() < pending.until && target && (pending.target.contains(target) || target.contains(pending.target))) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    },
    true,
  )

  // Arrastar (HTML5) com o dedo: não começa — no toque, mover é pelos menus
  window.addEventListener(
    'dragstart',
    (event) => {
      if (touching) event.preventDefault()
    },
    true,
  )
}
