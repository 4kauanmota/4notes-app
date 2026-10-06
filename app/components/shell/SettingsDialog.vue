<script setup lang="ts">
/**
 * Configurações, em três abas:
 *  - Geral: tema, iniciar com o computador, workspace (pasta de dados) e a
 *    biblioteca de imagens;
 *  - Módulos: as configurações de cada módulo que fazem sentido como ajuste
 *    permanente (guardadas no workspace). O que se usa toda hora — ordenar,
 *    reorganizar, criar — continua na tela do próprio módulo;
 *  - Atalhos de teclado.
 * Toda configuração tem um "?" com uma explicação curta (SettingRow).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { errorMessage, type LaunchAtLogin, type ThemePreference } from '#shared/ipc'
import { openImageLibrary } from '~/composables/useImageLibrary'
import { notifyError } from '~/composables/useToasts'
import { useTheme } from '~/composables/useTheme'
import { desktop, modKeyLabel } from '~/lib/platform'
import { useAppStore, type ModuleId, type SettingsTab } from '~/stores/app'

const app = useAppStore()
const { theme, setTheme } = useTheme()
const mod = modKeyLabel()
const changing = ref(false)
const body = ref<HTMLElement>()

const tab = computed({
  get: () => app.state.settingsTab,
  set: (value: SettingsTab) => (app.state.settingsTab = value),
})

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'general', label: 'Geral', icon: 'settings' },
  { id: 'modules', label: 'Módulos', icon: 'layers' },
  { id: 'shortcuts', label: 'Atalhos', icon: 'keyboard' },
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

const MODULE_SECTIONS: { id: ModuleId; label: string; icon: string }[] = [
  { id: 'notes', label: 'Notas', icon: 'notes' },
  { id: 'tasks', label: 'Tarefas', icon: 'tasks' },
  { id: 'mindmap', label: 'Mapa Mental', icon: 'graph' },
  { id: 'links', label: 'Links', icon: 'link' },
]
/** Módulos que têm configurações aqui (os outros mostram o aviso). */
const WITH_SETTINGS = new Set<ModuleId>(['notes', 'mindmap'])

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

const shortcuts = [
  { keys: [mod, '1 / 2 / 3 / 4'], label: 'Ir para Notas / Tarefas / Mapa Mental / Links' },
  { keys: [mod, 'N'], label: 'Nova nota, tarefa, nó ou link (no módulo atual)' },
  { keys: [mod, 'W'], label: 'Fechar a aba de nota atual' },
  { keys: [mod, 'Tab'], label: 'Próxima aba de nota' },
  { keys: [mod, 'Shift', 'T'], label: 'Reabrir a última aba fechada' },
  { keys: [mod, 'S'], label: 'Salvar agora (o salvamento já é automático)' },
  { keys: [mod, 'F'], label: 'Procurar dentro da nota' },
  { keys: [mod, 'D'], label: 'Selecionar também a próxima ocorrência do texto selecionado (edita todas juntas; Esc volta a um cursor)' },
  { keys: [mod, 'B / I / U'], label: 'Negrito / itálico / sublinhado (selecione o texto para ver todas as opções)' },
  { keys: [mod, 'K'], label: 'Transformar o texto selecionado em link' },
  { keys: [mod, 'Shift', 'V'], label: 'Colar sem formatação (código não vira bloco)' },
  { keys: [mod, 'Clique'], label: 'Abrir um endereço web' },
  { keys: ['@'], label: 'Mencionar uma nota, tarefa ou link salvo (dentro de uma nota)' },
  { keys: ['Shift', 'Arrastar'], label: 'Conectar notas no mapa (soltar no vazio cria uma nota)' },
  { keys: ['Delete'], label: 'Excluir a nota ou a conexão selecionada no mapa' },
  { keys: [mod, ','], label: 'Abrir as configurações' },
  { keys: [mod, '+ / −'], label: 'Aumentar / diminuir o zoom da interface' },
]

const version = computed(() => app.state.bootstrap?.appVersion ?? '')
</script>

<template>
  <UiModal :open="app.state.settingsOpen" :width="640" label="Configurações" @close="app.closeSettings()">
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
          <section v-for="section in MODULE_SECTIONS" :key="section.id" class="module" :data-module="section.id">
            <h3 class="module-title"><AppIcon :name="section.icon" :size="16" /> {{ section.label }}</h3>
            <div v-if="WITH_SETTINGS.has(section.id)" class="module-rows">
              <NotesSettings v-if="section.id === 'notes'" />
              <GraphSettings v-else-if="section.id === 'mindmap'" />
            </div>
            <p v-else class="no-settings">Sem nenhuma configuração disponível no momento.</p>
          </section>
        </template>

        <!-- Atalhos -->
        <section v-else class="shortcuts-section">
          <div class="shortcuts">
            <div v-for="item in shortcuts" :key="item.label" class="shortcut">
              <span class="keys">
                <template v-for="(key, index) in item.keys" :key="key">
                  <span v-if="index" class="plus">+</span><kbd class="kbd">{{ key }}</kbd>
                </template>
              </span>
              <span class="shortcut-label">{{ item.label }}</span>
            </div>
          </div>
        </section>
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
.shortcuts-section {
  border-bottom: none;
}
.shortcuts {
  display: grid;
  gap: 8px;
}
.shortcut {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 13px;
}
.keys {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 176px;
}
.plus {
  color: var(--text-3);
  font-size: 11px;
}
.shortcut-label {
  color: var(--text-2);
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
