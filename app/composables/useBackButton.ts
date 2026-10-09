/**
 * Botão/gesto "voltar" do Android, na ordem que se espera de um app:
 *
 *  1. fecha o que estiver aberto por cima (menu, diálogo, painel, tutorial…) — tudo
 *     que fecha com Esc no desktop fecha com o "voltar";
 *  2. volta uma tela dentro do módulo (ex.: da nota para a lista de notas) — cada
 *     tela registra isso com onBackButton();
 *  3. sem nada para voltar: o app vai para o fundo (como sair, mas sem perder nada).
 */
import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'
import { isCapacitorAndroid } from '~/lib/mobile/install'

/** Devolve true se tratou o "voltar". */
type BackHandler = () => boolean

const handlers: BackHandler[] = []

/** Registra uma ação de "voltar" (a registrada por último é tentada primeiro). */
export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler)
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index >= 0) handlers.splice(index, 1)
  }
}

/**
 * Num componente: registra enquanto ele estiver na tela (páginas mantidas em cache —
 * keep-alive — saem do registro quando outro módulo está aberto).
 */
export function onBackButton(handler: BackHandler): void {
  let remove: (() => void) | null = null
  const on = () => {
    remove ??= registerBackHandler(handler)
  }
  const off = () => {
    remove?.()
    remove = null
  }
  onMounted(on)
  onActivated(on)
  onDeactivated(off)
  onBeforeUnmount(off)
}

function sendEscape(target: EventTarget): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

const isEditable = (element: HTMLElement) => element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)

/**
 * Passo 1: um Esc "de mentira" — quem fecha com Esc avisa (preventDefault). Primeiro no
 * campo com o foco (ele pode ter um menu aberto); se ninguém usou e era um campo de
 * texto, ele sai de foco e o Esc vai para a tela.
 */
function closeTopOverlay(): boolean {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) {
    if (sendEscape(active)) return true
    if (!isEditable(active)) return false
    active.blur()
  }
  return sendEscape(document.body)
}

/** O "voltar" completo (também usado pelos testes). Devolve false se nada aconteceu. */
export function handleBack(): boolean {
  if (closeTopOverlay()) return true
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]!()) return true
  return false
}

/** Liga o botão "voltar" do Android (só no app Android). */
export async function installBackButton(): Promise<void> {
  if (!isCapacitorAndroid()) return
  const { App } = await import('@capacitor/app')
  await App.addListener('backButton', () => {
    if (!handleBack()) void App.minimizeApp()
  })
}
