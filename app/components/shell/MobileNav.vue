<script setup lang="ts">
/**
 * Navegação do celular (layout compact — celular, tela externa do Fold): os módulos
 * ativos na barra de baixo, ao alcance do polegar, na ordem escolhida por você; e
 * "Mais": workspace, tema, categorias, tutorial e configurações (o que fica no menu lateral do
 * desktop). Toque prolongado num módulo: mover ou desativar.
 */
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { openCategoriesPanel } from '~/composables/useCategoryActions'
import { showContextMenu } from '~/composables/useContextMenu'
import { useTheme } from '~/composables/useTheme'
import { openTutorial } from '~/composables/useTutorial'
import { moduleById, moduleForPath, type ModuleId } from '~/lib/modules'
import type { ThemePreference } from '#shared/ipc'
import { useAppStore } from '~/stores/app'
import { useModulesStore } from '~/stores/modules'
import { useTasksStore } from '~/stores/tasks'
import { useTimerStore } from '~/stores/timer'
import { useUpdatesStore } from '~/stores/updates'

/** Módulos na barra (os outros ficam em "Mais"). */
const MAX_ITEMS = 4

const route = useRoute()
const app = useAppStore()
const modules = useModulesStore()
const tasks = useTasksStore()
const { theme, setTheme } = useTheme()

const shown = computed(() => modules.enabled.value.slice(0, MAX_ITEMS))
const overflow = computed(() => modules.enabled.value.slice(MAX_ITEMS))
const current = computed(() => moduleForPath(route.path))
/** Versão nova esperando: ponto discreto em "Mais" e em Configurações. */
const updates = useUpdatesStore()
const updateReady = computed(() => updates.state.status === 'available' || updates.state.status === 'permission')
const dueCount = computed(() => tasks.progress.value.total - tasks.progress.value.done)
const badgeOf = (id: ModuleId) => (id === 'tasks' ? dueCount.value : 0)
const timer = useTimerStore()
/** Timer com uma sessão em andamento: um ponto no ícone (pulsando enquanto conta). */
const liveOf = (id: ModuleId) => (id === 'timer' && timer.state.active ? (timer.state.active.runningSince !== null ? 'running' : 'paused') : null)

const moreOpen = ref(false)

const themeChoice = computed<ThemePreference>({
  get: () => theme.preference,
  set: (value) => void setTheme(value),
})
const themeOptions: { value: ThemePreference; label: string; icon: string }[] = [
  { value: 'light', label: 'Claro', icon: 'sun' },
  { value: 'dark', label: 'Escuro', icon: 'moon' },
  { value: 'system', label: 'Sistema', icon: 'monitor' },
]

async function itemMenu(id: ModuleId) {
  const visible = modules.enabled.value.map((module) => module.id)
  const position = visible.indexOf(id)
  const choice = await showContextMenu([
    { id: 'left', label: 'Mover para a esquerda', enabled: position > 0 },
    { id: 'right', label: 'Mover para a direita', enabled: position < visible.length - 1 },
    { id: 'disable', label: `Desativar ${moduleById(id).name}`, enabled: modules.canDisable(id) },
  ])
  if (choice === 'left' || choice === 'right') modules.moveModule(id, choice === 'left' ? -1 : 1)
  else if (choice === 'disable') modules.setEnabled(id, false)
}

function run(action: () => unknown) {
  moreOpen.value = false
  void action()
}
</script>

<template>
  <nav class="mobile-nav" aria-label="Módulos">
    <NuxtLink
      v-for="item in shown"
      :key="item.id"
      :to="item.route"
      class="nav-item"
      :class="{ active: current?.id === item.id }"
      :data-module="item.id"
      :aria-label="item.name"
      draggable="false"
      @contextmenu.prevent="itemMenu(item.id)"
    >
      <span class="nav-pill">
        <AppIcon :name="item.icon" :size="21" />
        <span v-if="badgeOf(item.id) > 0" class="nav-badge">{{ badgeOf(item.id) > 99 ? '99+' : badgeOf(item.id) }}</span>
        <span v-if="liveOf(item.id)" class="nav-live" :class="liveOf(item.id)" data-live aria-hidden="true" />
      </span>
      <span class="nav-label">{{ item.label }}</span>
    </NuxtLink>
    <button type="button" class="nav-item" :class="{ active: moreOpen }" data-action="more" aria-label="Mais opções" @click="moreOpen = true">
      <span class="nav-pill"><AppIcon name="more" :size="21" /><span v-if="updateReady" class="nav-update" aria-hidden="true" /></span>
      <span class="nav-label">Mais</span>
    </button>
  </nav>

  <UiSheet :open="moreOpen" label="Mais opções" @close="moreOpen = false">
    <div class="more">
      <div class="more-head">
        <AppLogo :size="36" />
        <div class="more-ws">
          <span class="more-ws-label">Workspace</span>
          <span class="more-ws-name selectable">{{ app.workspaceName() }}</span>
        </div>
      </div>

      <div v-if="overflow.length" class="more-group">
        <NuxtLink v-for="item in overflow" :key="item.id" :to="item.route" class="more-row" :class="{ active: current?.id === item.id }" @click="moreOpen = false">
          <AppIcon :name="item.icon" :size="19" />
          <span>{{ item.name }}</span>
          <span v-if="liveOf(item.id)" class="more-live">{{ liveOf(item.id) === 'running' ? 'contando' : 'pausado' }}</span>
        </NuxtLink>
      </div>

      <div class="more-group">
        <div class="more-theme">
          <span class="more-theme-label">Tema</span>
          <UiSegmented v-model="themeChoice" :options="themeOptions" />
        </div>
      </div>

      <div class="more-group">
        <button type="button" class="more-row" data-action="workspace-open" @click="run(() => app.openWorkspace(false))">
          <AppIcon name="folder-open" :size="19" />
          <span>Abrir outro workspace…</span>
        </button>
        <button type="button" class="more-row" data-action="workspace-create" @click="run(() => app.createWorkspace(false))">
          <AppIcon name="plus" :size="19" />
          <span>Criar workspace…</span>
        </button>
      </div>

      <div class="more-group">
        <button type="button" class="more-row" data-action="categories" @click="run(() => openCategoriesPanel())">
          <AppIcon name="tag" :size="19" />
          <span>Categorias</span>
        </button>
        <button type="button" class="more-row" data-action="tutorial" @click="run(() => openTutorial(current?.id ?? 'general'))">
          <AppIcon name="help" :size="19" />
          <span>Tutorial{{ current ? ` de ${current.name}` : '' }}</span>
        </button>
        <button type="button" class="more-row" data-action="settings" @click="run(() => app.openSettings())">
          <AppIcon name="settings" :size="19" />
          <span>Configurações</span>
          <span v-if="updateReady" class="more-update">Versão nova</span>
        </button>
      </div>
    </div>
  </UiSheet>
</template>

<style scoped>
.mobile-nav {
  display: flex;
  align-items: stretch;
  height: calc(var(--bottom-nav-h) + var(--safe-bottom));
  padding: 0 4px var(--safe-bottom);
  background: var(--chrome);
  border-top: 1px solid var(--border);
  overflow: hidden;
}
.nav-item {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-3);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}
.nav-pill {
  position: relative;
  display: grid;
  place-items: center;
  width: 56px;
  height: 30px;
  border-radius: 15px;
  transition: background var(--t-med) var(--ease-out), color var(--t-med);
}
.nav-update {
  position: absolute;
  top: 3px;
  right: 14px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 0 2px var(--chrome);
}
.more-update {
  margin-left: auto;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary-text);
  font-size: 12px;
  font-weight: 650;
}
.nav-item.active {
  color: var(--primary-text);
}
.nav-item.active .nav-pill {
  background: var(--primary-soft);
}
.nav-label {
  max-width: 100%;
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Timer com uma sessão em andamento: um ponto amarelo (pulsando enquanto conta) */
.nav-live {
  position: absolute;
  top: 2px;
  right: 13px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent-strong);
  box-shadow: 0 0 0 2px var(--chrome);
}
.nav-live.paused {
  background: var(--text-3);
}
.nav-live.running::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--accent);
  animation: live-pulse 1.8s var(--ease-out) infinite;
}
@keyframes live-pulse {
  from {
    transform: scale(1);
    opacity: 0.75;
  }
  to {
    transform: scale(2.7);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .nav-live.running::after {
    animation: none;
  }
}
.more-live {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-text);
}
.nav-badge {
  position: absolute;
  top: -1px;
  right: 8px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
}

.more {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 4px 4px;
}
.more-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 8px 10px;
}
.more-ws {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.more-ws-label {
  color: var(--text-3);
  font-size: 12px;
}
.more-ws-name {
  overflow: hidden;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.more-group {
  display: flex;
  flex-direction: column;
  padding: 4px;
  border-radius: 14px;
  background: var(--surface-2);
}
.more-row {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 48px;
  padding: 0 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 15px;
  text-align: left;
  text-decoration: none;
}
.more-row > :first-child {
  color: var(--text-2);
}
.more-row.active {
  color: var(--primary-text);
}
.more-row:active {
  background: var(--hover);
}
.more-theme {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 10px 8px 8px 12px;
}
/* As três opções dividem a largura (não cabem lado a lado com o nome na tela externa do Fold) */
.more-theme :deep(.segmented) {
  display: flex;
  width: 100%;
}
.more-theme :deep(.segmented > *) {
  flex: 1;
  justify-content: center;
}
.more-theme-label {
  font-size: 15px;
}
</style>
