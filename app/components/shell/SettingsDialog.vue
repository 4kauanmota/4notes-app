<script setup lang="ts">
/**
 * Configurações, em duas abas:
 *  - Geral: tema, iniciar com o computador, workspace (pasta de dados), a
 *    biblioteca de imagens e os tutoriais;
 *  - Módulos: primeiro as configurações gerais dos módulos (quais estão ativos e
 *    como aparecem no menu lateral); depois as de cada módulo ativo que fazem
 *    sentido como ajuste permanente. Tudo guardado no workspace. O que se usa toda
 *    hora — ordenar, reorganizar, criar — continua na tela do próprio módulo.
 * Os atalhos de teclado ficam nos Tutoriais (F1), junto de cada módulo.
 * Toda configuração tem um "?" com uma explicação curta (SettingRow).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { errorMessage, type LaunchAtLogin, type ThemePreference } from '#shared/ipc'
import { useRoute } from 'vue-router'
import { openImageLibrary } from '~/composables/useImageLibrary'
import { useSortableList } from '~/composables/useSortableList'
import { notifyError } from '~/composables/useToasts'
import { useTheme } from '~/composables/useTheme'
import { openTutorial } from '~/composables/useTutorial'
import { MODULES, moduleForPath, type ModuleId, type NavStyle } from '~/lib/modules'
import { desktop } from '~/lib/platform'
import { useAppStore, type SettingsTab } from '~/stores/app'
import { useModulesStore } from '~/stores/modules'

const app = useAppStore()
const modules = useModulesStore()
const route = useRoute()
const { theme, setTheme } = useTheme()
const changing = ref(false)
const body = ref<HTMLElement>()

const tab = computed({
  get: () => app.state.settingsTab,
  set: (value: SettingsTab) => (app.state.settingsTab = value),
})

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'general', label: 'Geral', icon: 'settings' },
  { id: 'modules', label: 'Módulos', icon: 'layers' },
]

const themeModel = computed({
  get: () => theme.preference,
  set: (value: ThemePreference) => void setTheme(value),
})

const themeOptions = [
  { value: 'system' as const, label: 'Sistema', icon: 'monitor' },
  { value: 'light' as const, label: 'Claro', icon: 'sun' },
  { value: 'dark' as const, label: 'Escuro', icon: 'moon' },
]

// ── Iniciar com o computador ────────────────────────────────────────────────

const launch = ref<LaunchAtLogin>({ supported: false, enabled: false })
const launchNote = computed(() => {
  if (launch.value.supported) return undefined
  return launch.value.reason === 'dev' ? 'Disponível no 4notes instalado.' : 'Disponível no Windows e no macOS.'
})

async function readLaunch() {
  try {
    launch.value = await desktop().system.launchAtLogin()
  } catch (error) {
    console.warn('[4notes] Não foi possível ler "iniciar com o computador":', error)
  }
}

const launchModel = computed({
  get: () => launch.value.enabled,
  set: (value: boolean) => {
    launch.value = { ...launch.value, enabled: value }
    desktop()
      .system.setLaunchAtLogin(value)
      .then((result) => (launch.value = result))
      .catch((error) => {
        notifyError(`Não foi possível mudar essa opção: ${errorMessage(error)}`, error)
        void readLaunch()
      })
  },
})

onMounted(readLaunch)

// ── Workspace ───────────────────────────────────────────────────────────────

async function runWorkspace(action: () => Promise<boolean>) {
  if (changing.value) return
  changing.value = true
  try {
    await action()
  } finally {
    changing.value = false
  }
}

// ── Módulos ─────────────────────────────────────────────────────────────────

/** Módulos que têm configurações aqui (os outros mostram o aviso). */
const WITH_SETTINGS = new Set<ModuleId>(['notes', 'mindmap'])

/** Configurações de cada módulo: só dos ativos (as dos desativados continuam guardadas). */
const moduleSections = computed(() => modules.enabled.value)

function setEnabled(id: ModuleId, on: boolean) {
  modules.setEnabled(id, on)
}

const effectOf = (id: ModuleId) => modules.state.effects.find((effect) => effect.id === id)?.kind ?? null

/** Reorganizar arrastando os cards (a mesma ordem do menu lateral). */
const moduleList = ref<HTMLElement>()
const sortable = useSortableList({
  container: moduleList,
  itemSelector: '.module-card',
  ignoreSelector: '.module-switch',
  keyOf: (el) => el.dataset.moduleToggle ?? '',
  onReorder: (keys) => modules.setOrder(keys),
})

const navStyle = computed({
  get: () => modules.state.prefs.navStyle,
  set: (value: NavStyle) => modules.setNavStyle(value),
})
const NAV_STYLES: { value: NavStyle; label: string }[] = [
  { value: 'icon-label', label: 'Ícone e nome' },
  { value: 'icon', label: 'Só o ícone' },
]

/**
 * Na aba Módulos, o fundo escurecido cobre só a área de conteúdo: a barra de cima
 * (workspace) e o menu lateral ficam nítidos — dá para ver as mudanças no menu na hora.
 */
const scrimInset = computed(() => (tab.value === 'modules' ? 'var(--titlebar-h) 0 0 var(--rail-w)' : undefined))

/** Tutoriais: abre o do módulo atual, por cima do módulo (as Configurações fecham). */
function showTutorials() {
  app.closeSettings()
  openTutorial(moduleForPath(route.path)?.id ?? 'general')
}

// Aberto já num módulo (ex.: o botão de ajustes do mapa): rola até ele
watch(
  () => [app.state.settingsOpen, app.state.settingsTab, app.state.settingsSection] as const,
  async ([open, current, section]) => {
    if (!open) return
    void readLaunch()
    await nextTick()
    if (current === 'modules' && section) {
      body.value?.querySelector(`[data-module="${section}"]`)?.scrollIntoView({ block: 'start' })
    } else {
      body.value?.scrollTo({ top: 0 })
    }
  },
)

const version = computed(() => app.state.bootstrap?.appVersion ?? '')
</script>

<template>
  <UiModal :open="app.state.settingsOpen" :width="640" label="Configurações" :scrim-inset="scrimInset" @close="app.closeSettings()">
    <div class="settings">
      <header class="settings-head">
        <h2>Configurações</h2>
        <button class="icon-btn" aria-label="Fechar" @click="app.closeSettings()"><AppIcon name="x" /></button>
      </header>

      <nav class="tabs" role="tablist" aria-label="Seções das configurações">
        <button
          v-for="item in TABS"
          :key="item.id"
          type="button"
          role="tab"
          class="tab"
          :class="{ active: tab === item.id }"
          :aria-selected="tab === item.id"
          :data-tab="item.id"
          @click="tab = item.id"
        >
          <AppIcon :name="item.icon" :size="15" /> {{ item.label }}
        </button>
      </nav>

      <div ref="body" class="settings-body" role="tabpanel">
        <!-- Geral -->
        <template v-if="tab === 'general'">
          <section>
            <h3 class="section-label">Aparência</h3>
            <SettingRow label="Tema" help="“Sistema” acompanha o modo claro/escuro do Windows.">
              <UiSegmented v-model="themeModel" :options="themeOptions" />
            </SettingRow>
          </section>

          <section>
            <h3 class="section-label">Ajuda</h3>
            <SettingRow label="Tutoriais e atalhos" help="Um resumo bem curto de cada módulo: para que serve, o que dá para fazer e os atalhos.">
              <button class="btn btn-sm" data-action="tutorials" data-tutorial-toggle @click="showTutorials"><AppIcon name="help" :size="14" /> Abrir <kbd class="kbd">F1</kbd></button>
            </SettingRow>
          </section>

          <section>
            <h3 class="section-label">Sistema</h3>
            <SettingRow
              label="Iniciar com o computador"
              help="Abre o 4notes sozinho quando você liga o computador."
              :note="launchNote"
              :disabled="!launch.supported"
            >
              <UiSwitch v-model="launchModel" label="Iniciar com o computador" :disabled="!launch.supported" />
            </SettingRow>
          </section>

          <section>
            <h3 class="section-label">Workspace</h3>
            <div class="folder-card">
              <AppIcon name="workspace" :size="20" class="folder-icon" />
              <div class="folder-text">
                <span class="folder-name">{{ app.workspaceName() }}</span>
                <code class="folder-path selectable">{{ app.state.dataDir?.path }}</code>
              </div>
            </div>
            <div class="folder-actions">
              <button class="btn btn-sm" @click="app.revealDataFolder()"><AppIcon name="external" :size="14" /> Abrir no Explorador</button>
              <button class="btn btn-sm" :disabled="changing" @click="runWorkspace(() => app.openWorkspace(false))">
                <AppIcon name="folder-open" :size="14" /> Abrir outro workspace…
              </button>
              <button class="btn btn-sm" :disabled="changing" @click="runWorkspace(() => app.createWorkspace(false))">
                <AppIcon name="plus" :size="14" /> Criar workspace…
              </button>
              <button class="btn btn-sm" data-action="image-library" @click="openImageLibrary()"><AppIcon name="image" :size="14" /> Biblioteca de imagens…</button>
            </div>
            <ul class="structure">
              <li><code>notes/</code> notas rápidas (um .md por nota)</li>
              <li><code>tasks/tasks.json</code> tarefas e categorias</li>
              <li><code>mindmap/</code> mapas mentais — uma pasta por mapa, com as notas (.md) e o mapa.json (conexões e cores)</li>
              <li><code>links/links.json</code> links salvos e categorias (ícones dos sites em <code>links/icons/</code>)</li>
              <li><code>attachments/</code> biblioteca de imagens (coladas nas notas, enviadas, fotos das categorias)</li>
              <li><code>.4notes/</code> abas abertas, configurações dos módulos, posições do mapa e backups diários das tarefas e dos links</li>
            </ul>
            <p class="hint">Para fazer backup, copie a pasta inteira. Os arquivos podem ser abertos e editados em qualquer editor de texto.</p>
          </section>

          <footer class="about">
            <AppLogo :size="26" />
            <div>
              <div class="about-name">4notes <span class="muted">v{{ version }}</span></div>
              <div class="about-hint">Feito com Nuxt + Electron · seus dados ficam só no seu computador</div>
            </div>
          </footer>
        </template>

        <!-- Módulos -->
        <template v-else-if="tab === 'modules'">
          <p class="modules-lead">
            Ajustes que valem para o workspace <strong>{{ app.workspaceName() }}</strong>. O que você usa toda hora (ordenar, reorganizar, criar) fica
            na tela de cada módulo.
          </p>

          <!-- Configurações gerais dos módulos -->
          <section class="module" data-module="general">
            <h3 class="module-title"><AppIcon name="layers" :size="16" /> Geral</h3>
            <SettingRow
              label="Módulos ativos"
              help="Desativar só tira o módulo do menu lateral: as notas, tarefas, mapas e links dele continuam guardados. Arraste para mudar a ordem do menu."
            >
              <span class="enabled-count">{{ modules.enabled.value.length }} de {{ MODULES.length }}</span>
            </SettingRow>
            <ul ref="moduleList" class="module-list" aria-label="Módulos ativos (arraste para mudar a ordem)" @pointerdown="sortable.onPointerDown">
              <li
                v-for="item in modules.ordered.value"
                :key="item.id"
                class="module-card"
                :class="{ off: !modules.isEnabled(item.id), [effectOf(item.id) ?? '']: !!effectOf(item.id) }"
                :data-module-toggle="item.id"
              >
                <span class="module-grip" data-tip="Arraste para mudar a ordem" data-tip-pos="left" aria-hidden="true"><AppIcon name="grip" :size="16" /></span>
                <span class="module-tile"><AppIcon :name="item.icon" :size="18" /></span>
                <span class="module-text">
                  <span class="module-name">{{ item.name }}</span>
                  <span class="module-desc">{{ item.description }}</span>
                </span>
                <span
                  class="module-switch"
                  :data-tip="modules.isEnabled(item.id) && !modules.canDisable(item.id) ? 'Pelo menos um módulo fica ativo' : undefined"
                  data-tip-pos="left"
                >
                  <UiSwitch
                    :model-value="modules.isEnabled(item.id)"
                    :label="`Módulo ${item.name}`"
                    :disabled="modules.isEnabled(item.id) && !modules.canDisable(item.id)"
                    @update:model-value="(on: boolean) => setEnabled(item.id, on)"
                  />
                </span>
              </li>
            </ul>
            <SettingRow label="Menu lateral" help="Como os módulos aparecem no menu da esquerda. Só o ícone deixa o menu mais estreito; o nome aparece ao passar o mouse.">
              <UiSegmented v-model="navStyle" size="sm" :options="NAV_STYLES" aria-label="Menu lateral" />
            </SettingRow>
          </section>

          <TransitionGroup name="module-section">
            <section v-for="section in moduleSections" :key="section.id" class="module" :data-module="section.id">
              <h3 class="module-title"><AppIcon :name="section.icon" :size="16" /> {{ section.name }}</h3>
              <div v-if="WITH_SETTINGS.has(section.id)" class="module-rows">
                <NotesSettings v-if="section.id === 'notes'" />
                <GraphSettings v-else-if="section.id === 'mindmap'" />
              </div>
              <p v-else class="no-settings">Sem nenhuma configuração disponível no momento.</p>
            </section>
          </TransitionGroup>
        </template>
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  height: min(640px, calc(100vh - 48px));
  padding: 8px 0 0;
}
.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px 8px;
}
.settings-head h2 {
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 700;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
}
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: color var(--t-fast);
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  color: var(--primary-text);
}
.tab.active::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--primary);
}
.settings-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 24px 20px;
}
section {
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
section:last-of-type {
  border-bottom: none;
}
section .section-label {
  margin-bottom: 12px;
}
.hint {
  font-size: 12.5px;
  color: var(--text-3);
}
.folder-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-2);
}
.folder-icon {
  flex: none;
  color: var(--primary-text);
}
.folder-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.folder-name {
  font-weight: 650;
  color: var(--text);
}
.folder-path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-2);
  word-break: break-all;
}
.folder-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.structure {
  margin: 14px 0 8px;
  padding-left: 18px;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.8;
}
.structure code {
  font-family: var(--font-mono);
  font-size: 0.95em;
  color: var(--primary-text);
  margin-right: 4px;
}
.modules-lead {
  margin-top: 16px;
  color: var(--text-3);
  font-size: 12.5px;
  line-height: 1.5;
}
.modules-lead strong {
  color: var(--text-2);
  font-weight: 600;
}
.module {
  scroll-margin-top: 8px;
}
.module-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-family: var(--font-display);
  font-size: 14.5px;
  font-weight: 650;
}
.module-title :deep(.app-icon) {
  color: var(--primary-text);
}
.no-settings {
  color: var(--text-3);
  font-size: 13px;
}
.enabled-count {
  font-size: 12.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.module-list {
  display: grid;
  gap: 6px;
  margin: 4px 0 14px;
  padding: 0;
  list-style: none;
}
.module-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px 9px 6px;
  cursor: grab;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-2);
  transition:
    background var(--t-med),
    border-color var(--t-med),
    opacity var(--t-med);
}
.module-card.is-sorting-item {
  z-index: 2;
  background: var(--elevated);
  box-shadow: var(--shadow-md);
}
.module-grip {
  display: grid;
  place-items: center;
  flex: none;
  width: 18px;
  margin-right: -4px;
  color: var(--text-3);
  opacity: 0.6;
  transition: opacity var(--t-fast);
}
.module-card:hover .module-grip {
  opacity: 1;
}
.module-card.off {
  background: transparent;
  border-style: dashed;
}
.module-tile {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary-text);
  transition:
    background var(--t-med),
    color var(--t-med);
}
.off .module-tile {
  background: var(--surface-3);
  color: var(--text-3);
}
/* Ligou: o ícone "encaixa" com um anel de luz (o mesmo do menu lateral) */
.module-tile::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 13px;
  border: 2px solid var(--primary);
  opacity: 0;
  pointer-events: none;
}
.connect .module-tile {
  animation: tile-plug 520ms var(--ease-spring);
}
.connect .module-tile::after {
  animation: tile-ring 620ms 180ms var(--ease-out);
}
.disconnect .module-tile {
  animation: tile-unplug 420ms var(--ease-out);
}
.module-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.module-name {
  font-weight: 600;
}
.off .module-name {
  color: var(--text-2);
}
.module-desc {
  font-size: 12px;
  color: var(--text-3);
}
.module-switch {
  flex: none;
  display: inline-flex;
}
.module-section-enter-active,
.module-section-leave-active {
  transition: opacity 200ms var(--ease-out);
}
.module-section-enter-from,
.module-section-leave-to {
  opacity: 0;
}
@keyframes tile-plug {
  0% {
    transform: translateX(8px) scale(0.8);
  }
  100% {
    transform: none;
  }
}
@keyframes tile-ring {
  0% {
    opacity: 0.9;
    transform: scale(0.8);
  }
  100% {
    opacity: 0;
    transform: scale(1.35);
  }
}
@keyframes tile-unplug {
  0% {
    transform: none;
  }
  45% {
    transform: translateX(6px) scale(0.9);
  }
  100% {
    transform: none;
  }
}
.about {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 16px;
}
.about-name {
  font-weight: 650;
}
.about-hint {
  font-size: 12px;
  color: var(--text-3);
}
</style>
