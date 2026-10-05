<script setup lang="ts">
/** Configurações: tema, workspace (pasta de dados), atalhos e informações do app. */
import { computed, ref } from 'vue'
import type { ThemePreference } from '#shared/ipc'
import { useTheme } from '~/composables/useTheme'
import { modKeyLabel } from '~/lib/platform'
import { useAppStore } from '~/stores/app'

const app = useAppStore()
const { theme, setTheme } = useTheme()
const mod = modKeyLabel()
const changing = ref(false)

const themeModel = computed({
  get: () => theme.preference,
  set: (value: ThemePreference) => void setTheme(value),
})

const themeOptions = [
  { value: 'system' as const, label: 'Sistema', icon: 'monitor' },
  { value: 'light' as const, label: 'Claro', icon: 'sun' },
  { value: 'dark' as const, label: 'Escuro', icon: 'moon' },
]

async function runWorkspace(action: () => Promise<boolean>) {
  if (changing.value) return
  changing.value = true
  try {
    await action()
  } finally {
    changing.value = false
  }
}

const shortcuts = [
  { keys: [mod, '1 / 2 / 3 / 4'], label: 'Ir para Notas / Tarefas / Mapa Mental / Links' },
  { keys: [mod, 'N'], label: 'Nova nota, tarefa, nó ou link (no módulo atual)' },
  { keys: [mod, 'W'], label: 'Fechar a aba de nota atual' },
  { keys: [mod, 'Tab'], label: 'Próxima aba de nota' },
  { keys: [mod, 'Shift', 'T'], label: 'Reabrir a última aba fechada' },
  { keys: [mod, 'S'], label: 'Salvar agora (o salvamento já é automático)' },
  { keys: [mod, 'F'], label: 'Procurar dentro da nota' },
  { keys: [mod, 'B / I / U'], label: 'Negrito / itálico / sublinhado (selecione o texto para ver todas as opções)' },
  { keys: [mod, 'K'], label: 'Transformar o texto selecionado em link' },
  { keys: [mod, 'Shift', 'V'], label: 'Colar sem formatação (código não vira bloco)' },
  { keys: [mod, 'Clique'], label: 'Abrir um endereço web' },
  { keys: ['Shift', 'Arrastar'], label: 'Conectar notas no mapa (soltar no vazio cria uma nota)' },
  { keys: ['Delete'], label: 'Excluir a nota ou a conexão selecionada no mapa' },
  { keys: [mod, '+ / −'], label: 'Aumentar / diminuir o zoom da interface' },
]

const version = computed(() => app.state.bootstrap?.appVersion ?? '')
</script>

<template>
  <UiModal :open="app.state.settingsOpen" :width="580" label="Configurações" @close="app.closeSettings()">
    <div class="settings">
      <header class="settings-head">
        <h2>Configurações</h2>
        <button class="icon-btn" aria-label="Fechar" @click="app.closeSettings()"><AppIcon name="x" /></button>
      </header>

      <section>
        <h3 class="section-label">Aparência</h3>
        <div class="row">
          <div>
            <div class="row-title">Tema</div>
            <div class="row-hint">“Sistema” acompanha o modo claro/escuro do Windows.</div>
          </div>
          <UiSegmented v-model="themeModel" :options="themeOptions" />
        </div>
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
        </div>
        <ul class="structure">
          <li><code>notes/</code> notas rápidas (um .md por nota)</li>
          <li><code>tasks/tasks.json</code> tarefas e categorias</li>
          <li><code>mindmap/</code> mapas mentais — uma pasta por mapa, com as notas (.md) e o mapa.json (conexões e cores)</li>
          <li><code>links/links.json</code> links salvos e pastas (ícones dos sites em <code>links/icons/</code>)</li>
          <li><code>attachments/</code> imagens coladas nas notas</li>
          <li><code>.4notes/</code> abas abertas, posições do mapa e backups diários das tarefas e dos links</li>
        </ul>
        <p class="hint">Para fazer backup, copie a pasta inteira. Os arquivos podem ser abertos e editados em qualquer editor de texto.</p>
      </section>

      <section>
        <h3 class="section-label">Atalhos de teclado</h3>
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

      <footer class="about">
        <AppLogo :size="26" />
        <div>
          <div class="about-name">4notes <span class="muted">v{{ version }}</span></div>
          <div class="about-hint">Feito com Nuxt + Electron · seus dados ficam só no seu computador</div>
        </div>
      </footer>
    </div>
  </UiModal>
</template>

<style scoped>
.settings {
  padding: 8px 24px 20px;
}
.settings-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0 10px;
  background: var(--elevated);
}
.settings-head h2 {
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 700;
}
section {
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
section .section-label {
  margin-bottom: 12px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.row-title {
  font-weight: 600;
}
.row-hint,
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
