/**
 * Resposta ao clique nos ícones: o ícone de um botão "afunda" e volta com um leve
 * quique (~0,3 s). O mesmo movimento em todo o 4notes — botões de ícone, módulos e
 * botões do menu lateral, abas das Configurações e do tutorial, barras de
 * formatação e dos blocos, botões com ícone e texto.
 *
 * - Um lugar só, sem mexer em cada componente: escuta o `pointerdown` da janela e
 *   anima o ícone (o <svg>) do controle clicado. Pelo teclado (Enter/Espaço num
 *   botão), anima no `click`.
 * - Anima a propriedade `scale` (não `transform`), então não briga com ícones que já
 *   estão girados ou se mexendo (a seta de uma pasta aberta, a troca do sol/lua).
 * - Só o ícone do próprio controle: clicar numa aba de nota não mexe no × dela; linhas
 *   de lista (notas, tarefas, links) não são controles e não animam.
 * - Nada com "reduzir movimento" do sistema, em controles desativados ou nos que já
 *   têm a própria animação (a caixa de concluir tarefa).
 */

/** O que conta como controle clicável. */
const CONTROL = 'button, a[href], [role="button"], [role="tab"]'
/** Controles com animação própria (não ganham esta). */
const EXCLUDE = '[data-no-tap], .task-checkbox'

const KEYFRAMES: Keyframe[] = [
  { scale: '1', easing: 'cubic-bezier(0.4, 0, 0.7, 1)' },
  { scale: '0.8', offset: 0.32, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
  { scale: '1.08', offset: 0.68, easing: 'ease-in-out' },
  { scale: '1' },
]
const DURATION = 320

const running = new WeakMap<Element, Animation>()

/** O ícone do controle clicado (null = nada para animar). */
function iconFor(target: EventTarget | null): SVGSVGElement | null {
  if (!(target instanceof Element)) return null
  const control = target.closest<HTMLElement>(CONTROL)
  if (!control || control.closest(EXCLUDE)) return null
  if ((control as HTMLButtonElement).disabled || control.getAttribute('aria-disabled') === 'true') return null
  // O primeiro ícone que é do próprio controle (não de um botão dentro dele)
  for (const svg of control.querySelectorAll('svg')) {
    if (svg.closest(CONTROL) === control && !svg.parentElement?.closest('svg')) return svg
  }
  return null
}

function tap(svg: SVGSVGElement): void {
  running.get(svg)?.cancel()
  const animation = svg.animate(KEYFRAMES, { duration: DURATION })
  animation.id = 'icon-tap'
  running.set(svg, animation)
  animation.onfinish = () => running.delete(svg)
}

export default defineNuxtPlugin(() => {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const play = (target: EventTarget | null) => {
    if (reduced?.matches) return
    const svg = iconFor(target)
    if (svg) tap(svg)
  }
  window.addEventListener('pointerdown', (event) => event.button === 0 && play(event.target), { capture: true, passive: true })
  // Enter/Espaço num botão (o clique do teclado chega com detail 0)
  window.addEventListener('click', (event) => event.detail === 0 && play(event.target), { capture: true, passive: true })
})
