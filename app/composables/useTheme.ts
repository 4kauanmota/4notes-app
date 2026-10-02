/**
 * Tema claro/escuro.
 *
 * A preferência ("system" | "light" | "dark") é salva pelo processo principal
 * (config.json) e também aplicada ao `nativeTheme` do Electron, para que menus,
 * caixas de diálogo e a barra de título nativa acompanhem o app.
 */
import { reactive, readonly } from 'vue'
import type { ThemePreference } from '#shared/ipc'
import { desktop, hasDesktopApi } from '~/lib/platform'

type ResolvedTheme = 'light' | 'dark'

const state = reactive({
  preference: 'system' as ThemePreference,
  resolved: 'light' as ResolvedTheme,
})

const systemQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return systemQuery?.matches ? 'dark' : 'light'
  return preference
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function syncTitleBar(): void {
  if (!hasDesktopApi()) return
  const color = cssVar('--chrome')
  const symbolColor = cssVar('--titlebar-symbol')
  if (/^#[0-9a-f]{6}$/i.test(color) && /^#[0-9a-f]{6}$/i.test(symbolColor)) {
    desktop().window.setTitleBarColors({ color, symbolColor })
  }
}

function applyResolved(theme: ResolvedTheme): void {
  state.resolved = theme
  document.documentElement.dataset.theme = theme
  syncTitleBar()
}

/** Chamado uma vez, antes de montar a interface (plugins/theme.client.ts). */
export function initTheme(preference: ThemePreference): void {
  state.preference = preference
  applyResolved(resolve(preference))
  systemQuery?.addEventListener('change', () => {
    if (state.preference === 'system') applyResolved(resolve('system'))
  })
}

/**
 * Troca o tema. Se `origin` for informado, faz uma animação de "revelação"
 * circular a partir daquele ponto (View Transitions API do Chromium).
 */
export async function setTheme(preference: ThemePreference, origin?: { x: number; y: number }): Promise<void> {
  const next = resolve(preference)
  const change = () => {
    state.preference = preference
    applyResolved(next)
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const canAnimate = !!origin && next !== state.resolved && !reduceMotion && 'startViewTransition' in document

  if (canAnimate) {
    const transition = document.startViewTransition(change)
    void transition.ready.then(() => {
      const { x, y } = origin!
      const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
  } else {
    change()
  }

  if (hasDesktopApi()) await desktop().settings.setTheme(preference)
}

export function useTheme() {
  return { theme: readonly(state), setTheme }
}
