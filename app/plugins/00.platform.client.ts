// Android: instala a API do 4notes (window.fourNotes) antes dos outros plugins e da
// interface — no desktop o preload do Electron já fez isso e aqui nada acontece.
import { installMobilePlatform } from '~/lib/mobile/install'

export default defineNuxtPlugin({
  name: 'platform',
  enforce: 'pre',
  async setup() {
    await installMobilePlatform(String(useRuntimeConfig().public.updatesRepository ?? ''))
  },
})
