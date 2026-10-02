// Aplica o tema salvo ANTES de a interface aparecer (evita o "flash" de tema errado).
import { initTheme } from '~/composables/useTheme'
import { desktop, hasDesktopApi } from '~/lib/platform'

export default defineNuxtPlugin(() => {
  initTheme(hasDesktopApi() ? desktop().bootstrap.settings.theme : 'system')
})
