// Configuração do Capacitor — o app Android do 4notes (npm run build:android).
// Docs: https://capacitorjs.com/docs/config
//
// O app Android usa a MESMA interface do desktop: o `nuxt generate` gera os arquivos
// em .output/public e o Capacitor os copia para dentro do projeto Android (android/).
// O que muda é só a "camada de plataforma" (app/lib/mobile): ela faz no Android o
// que o Electron faz no Windows (ler e gravar o workspace, escolher pastas…).
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.kauan.fournotes',
  appName: '4notes',
  webDir: '.output/public',
  plugins: {
    // Interface de ponta a ponta (atrás das barras do sistema): a interface recebe as
    // margens seguras em --safe-area-inset-* e o teclado encolhe a área do app.
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
  },
}

export default config
