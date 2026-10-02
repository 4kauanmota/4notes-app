/**
 * Atalhos de teclado.
 *
 *   useShortcut('mod+n', () => novaNota())
 *
 * "mod" = Ctrl no Windows/Linux e ⌘ no macOS. Atalhos registrados por páginas
 * mantidas em cache (keep-alive) só funcionam enquanto a página está visível.
 */
import { onActivated, onDeactivated, onMounted, onUnmounted } from 'vue'
import { isMac } from '~/lib/platform'

type Handler = (event: KeyboardEvent) => void | boolean

interface Binding {
  combo: string
  handler: Handler
  allowInInputs: boolean
}

const bindings: Binding[] = []
let listening = false

function normalizeKey(key: string): string {
  const k = key.toLowerCase()
  if (k === ' ') return 'space'
  if (k === 'esc') return 'escape'
  return k
}

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts.pop()!
  const wantMod = parts.includes('mod')
  const wantShift = parts.includes('shift')
  const wantAlt = parts.includes('alt')
  const mod = isMac() ? event.metaKey : event.ctrlKey
  if (wantMod !== mod || wantShift !== event.shiftKey || wantAlt !== event.altKey) return false
  // Compara pela tecla física quando possível (funciona em teclados ABNT2, US etc.)
  const pressed = normalizeKey(event.key)
  if (pressed === key) return true
  if (/^[a-z0-9]$/.test(key)) return event.code === (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`)
  if (key === '\\') return event.code === 'Backslash' || event.code === 'IntlBackslash'
  return false
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

function onKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  for (let i = bindings.length - 1; i >= 0; i--) {
    const binding = bindings[i]!
    if (!matches(event, binding.combo)) continue
    if (!binding.allowInInputs && isTypingTarget(event.target)) continue
    if (binding.handler(event) !== false) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
  }
}

export function registerShortcut(combo: string, handler: Handler, options: { allowInInputs?: boolean } = {}): () => void {
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeydown, true)
    listening = true
  }
  const binding: Binding = {
    combo,
    handler,
    allowInInputs: options.allowInInputs ?? /mod|alt/.test(combo),
  }
  bindings.push(binding)
  return () => {
    const index = bindings.indexOf(binding)
    if (index >= 0) bindings.splice(index, 1)
  }
}

/** Registra atalhos enquanto o componente estiver montado/ativo. */
export function useShortcuts(map: Record<string, Handler>, options: { allowInInputs?: boolean } = {}): void {
  let disposers: (() => void)[] = []
  const on = () => {
    if (disposers.length) return
    disposers = Object.entries(map).map(([combo, handler]) => registerShortcut(combo, handler, options))
  }
  const off = () => {
    disposers.forEach((dispose) => dispose())
    disposers = []
  }
  onMounted(on)
  onActivated(on)
  onDeactivated(off)
  onUnmounted(off)
}
