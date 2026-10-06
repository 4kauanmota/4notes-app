<script setup lang="ts">
/**
 * Casca do aplicativo: barra de título, navegação e a página do módulo atual.
 * A inicialização (carregar a pasta de dados) fica em stores/app.ts; os módulos
 * (rotas, atalhos Ctrl+1…4, quais estão ativos) vêm de lib/modules.ts e stores/modules.ts.
 */
import { nextTick, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useShortcuts } from '~/composables/useShortcuts'
import { toggleTutorial } from '~/composables/useTutorial'
import { MODULES, moduleById, moduleForPath, type ModuleId } from '~/lib/modules'
import { desktop, hasDesktopApi } from '~/lib/platform'
import { useAppStore } from '~/stores/app'
import { useModulesStore } from '~/stores/modules'

const app = useAppStore()
const modules = useModulesStore()
const route = useRoute()
const router = useRouter()

onMounted(async () => {
  await app.startApp()
  // Abre o último módulo usado (ou o primeiro ativo) — a rota "/" não tem tela própria
  if (app.state.phase === 'ready' && route.path === '/') await router.replace(moduleById(modules.startModule.value).route)
  await nextTick()
  // Dois quadros depois do primeiro desenho, pede ao Electron para mostrar a janela
  // (assim ela já aparece pronta, sem "piscar").
  requestAnimationFrame(() => requestAnimationFrame(() => hasDesktopApi() && desktop().app.ready()))
})

watch(
  () => route.path,
  (path) => {
    const module = moduleForPath(path)
    if (module && modules.isEnabled(module.id)) app.rememberModule(module.id)
  },
)

// Módulo aberto foi desativado (ou a rota veio de outro lugar): vai para um módulo ativo
watch(
  () => [route.path, modules.state.prefs.disabled, app.state.phase] as const,
  ([path, , phase]) => {
    const module = phase === 'ready' ? moduleForPath(path) : null
    if (module && !modules.isEnabled(module.id)) void router.replace(moduleById(modules.startModule.value).route)
  },
)

/** Ctrl+1…4: abre o módulo (desativado: avisa e oferece "Ativar"). */
function openModule(id: ModuleId) {
  if (app.state.phase !== 'ready') return
  const go = () => void router.push(moduleById(id).route)
  if (modules.requireModule(id, go)) go()
}

useShortcuts({
  ...Object.fromEntries(MODULES.map((module) => [`mod+${module.key}`, () => openModule(module.id)])),
  'mod+,': () => {
    if (app.state.phase === 'ready') app.openSettings()
  },
})
// F1: tutorial do módulo atual (também com o cursor num campo de texto)
useShortcuts(
  {
    f1: () => {
      if (app.state.phase !== 'ready') return false
      toggleTutorial(moduleForPath(route.path)?.id ?? 'general')
    },
  },
  { allowInInputs: true },
)

function reload() {
  window.location.reload()
}
</script>

<template>
  <div class="app-shell">
    <TitleBar />
    <div class="app-body">
      <NavRail v-if="app.state.phase === 'ready'" />
      <main class="app-main" :class="{ full: app.state.phase !== 'ready' }">
        <!-- As páginas ficam sempre montadas (ocultas até a pasta de dados carregar) -->
        <div v-show="app.state.phase === 'ready'" class="page-host">
          <NuxtPage :keepalive="{ max: 4 }" />
        </div>

        <WelcomeScreen v-if="app.state.phase === 'setup'" />

        <div v-else-if="app.state.phase === 'no-desktop'" class="app-message">
          <AppLogo :size="48" />
          <h1>O 4notes roda como aplicativo desktop</h1>
          <p>Esta interface precisa do Electron para acessar seus arquivos. No terminal, use <code>npm run dev</code>.</p>
        </div>

        <div v-else-if="app.state.phase === 'error'" class="app-message">
          <AppIcon name="alert" :size="40" class="error-icon" />
          <h1>Não foi possível carregar seus dados</h1>
          <p class="selectable">{{ app.state.error }}</p>
          <div class="app-message-actions">
            <button class="btn btn-primary" @click="reload">Tentar novamente</button>
            <button class="btn" @click="app.openWorkspace(false)">Abrir outro workspace…</button>
          </div>
        </div>
      </main>
    </div>

    <SettingsDialog v-if="app.state.phase === 'ready'" />
    <ImageLibraryDialog v-if="app.state.phase === 'ready'" />
    <TutorialPanel v-if="app.state.phase === 'ready'" />
    <DialogHost />
    <ToastHost />
    <ContextMenuHost />
    <TooltipHost />
  </div>
</template>

<style>
.app-shell {
  display: grid;
  /* minmax(0, 1fr): conteúdo largo (ex.: muitas abas) nunca alarga a janela inteira */
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: var(--titlebar-h) minmax(0, 1fr);
  height: 100vh;
  background: var(--chrome);
}
.app-body {
  display: flex;
  min-width: 0;
  min-height: 0;
}
.app-main {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--surface);
  border-top: 1px solid var(--border);
  border-left: 1px solid var(--border);
  border-top-left-radius: 14px;
  box-shadow: -1px -1px 0 rgba(255, 255, 255, 0.02);
}
.app-main.full {
  border-left: 0;
  border-top-left-radius: 0;
}
.page-host {
  height: 100%;
}
.app-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  padding: 32px;
  text-align: center;
}
.app-message h1 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
}
.app-message p {
  max-width: 520px;
  color: var(--text-2);
}
.app-message code {
  font-family: var(--font-mono);
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--surface-3);
}
.app-message-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.error-icon {
  color: var(--danger);
}
</style>
