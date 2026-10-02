// Configuração do Nuxt — a "camada de interface" do 4notes.
// Docs: https://nuxt.com/docs/api/nuxt-config
//
// Pontos importantes para um app desktop:
//  - ssr: false  → o Nuxt vira uma SPA (Single Page Application). Não existe
//    servidor em produção: o Electron carrega os arquivos estáticos gerados
//    por `nuxt generate` (pasta .output/public).
//  - Durante o desenvolvimento (`npm run dev`) o Nuxt sobe um servidor Vite
//    em http://127.0.0.1:3141 e o Electron abre essa URL (com hot reload).

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',

  ssr: false,
  devtools: { enabled: false },
  telemetry: false,

  app: {
    head: {
      title: '4notes',
      htmlAttrs: { lang: 'pt-BR' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'light dark' },
      ],
    },
    // Transição suave ao trocar de módulo (Notas / Tarefas / Mapa Mental)
    pageTransition: { name: 'page', mode: 'out-in' },
  },

  css: ['~/assets/css/main.css'],

  // Componentes são registrados pelo nome do arquivo (ex.: <TaskItem />),
  // independentemente da subpasta em que estão.
  components: [{ path: '~/components', pathPrefix: false }],

  devServer: {
    host: '127.0.0.1',
    port: 3141,
  },

  typescript: {
    strict: true,
  },

  vite: {
    clearScreen: false,
    build: {
      // O Electron usa um Chromium recente: não precisamos transpilar para navegadores antigos.
      target: 'esnext',
      chunkSizeWarningLimit: 2000,
    },
    optimizeDeps: {
      include: [
        '@codemirror/autocomplete',
        '@codemirror/commands',
        '@codemirror/lang-markdown',
        '@codemirror/language',
        '@codemirror/search',
        '@codemirror/state',
        '@codemirror/view',
        '@lezer/highlight',
      ],
    },
  },
})
