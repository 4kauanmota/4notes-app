<script setup lang="ts">
/**
 * Primeira execução (ou workspace não encontrado): você cria um workspace (escolhe
 * onde e dá um nome) ou abre um que já existe. Não existe pasta sugerida — a
 * escolha é sempre feita no seletor de pastas do sistema.
 */
import { computed, ref } from 'vue'
import { errorMessage } from '#shared/ipc'
import { notifyError } from '~/composables/useToasts'
import { desktop, isAndroid } from '~/lib/platform'
import { useAppStore, workspaceName } from '~/stores/app'

const app = useAppStore()
const busy = ref(false)

const problem = computed(() => app.state.dataDir?.problem ?? 'not-configured')
const configuredPath = computed(() => app.state.dataDir?.path ?? null)

async function run(action: () => Promise<boolean>) {
  if (busy.value) return
  busy.value = true
  try {
    await action()
  } finally {
    busy.value = false
  }
}

const android = isAndroid()
/** Onde ficam os arquivos ("no seu computador" / "no seu celular"). */
const deviceName = android ? 'celular' : 'computador'

const recreate = () => run(() => app.applyDataFolder(configuredPath.value!, true))
/** Android: pede de novo o "Acesso a todos os arquivos" e, permitido, abre o workspace. */
const allowAccess = () =>
  run(async () => {
    try {
      if (await desktop().dataDir.requestAccess?.()) window.location.reload()
    } catch (error) {
      notifyError(`Não foi possível pedir a permissão: ${errorMessage(error)}`, error)
    }
    return false
  })
const create = () => run(() => app.createWorkspace(true))
const open = () => run(() => app.openWorkspace(true))

const structure = [
  { icon: 'notes', name: 'notes/', text: 'notas rápidas em Markdown (.md)' },
  { icon: 'tasks', name: 'tasks/', text: 'tarefas e categorias (tasks.json)' },
  { icon: 'graph', name: 'mindmap/', text: 'mapas mentais: uma pasta por mapa (.md + mapa.json)' },
  { icon: 'image', name: 'attachments/', text: 'imagens coladas nas notas' },
]
</script>

<template>
  <div class="welcome">
    <div class="welcome-glow" aria-hidden="true" />
    <section class="welcome-card">
      <AppLogo :size="56" class="welcome-logo" />

      <template v-if="problem === 'not-configured'">
        <h1>Bem-vindo ao <span class="brand">4notes</span></h1>
        <p class="lead">
          Tudo o que você escrever fica em arquivos comuns no seu {{ deviceName }} — sem conta, sem nuvem obrigatória — dentro de um
          <strong>workspace</strong>: uma pasta com o nome que você escolher (Pessoal, Trabalho, Estudos…).
        </p>
      </template>
      <template v-else-if="problem === 'no-permission'">
        <h1>Permita o acesso aos arquivos</h1>
        <p class="lead">
          O workspace fica em <code class="selectable">{{ configuredPath }}</code>. Para abri-lo, o 4notes precisa do
          <strong>“Acesso a todos os arquivos”</strong> do Android — ative a opção para o 4notes na tela que vai abrir e volte para o app.
        </p>
      </template>
      <template v-else>
        <h1>Workspace {{ problem === 'missing' ? 'não encontrado' : 'sem permissão' }}</h1>
        <p class="lead">
          O 4notes não conseguiu {{ problem === 'missing' ? 'encontrar' : 'gravar em' }}
          <code class="selectable">{{ configuredPath }}</code>. Se ele estava num pendrive ou na nuvem, conecte e reabra o app —
          ou abra outro workspace.
        </p>
      </template>

      <div class="choice">
        <div v-if="problem !== 'not-configured'" class="choice-path">
          <AppIcon name="workspace" :size="20" />
          <div class="choice-text">
            <span class="choice-label">Workspace “{{ workspaceName(configuredPath) }}”</span>
            <span class="choice-value selectable">{{ configuredPath }}</span>
          </div>
        </div>
        <div class="options">
          <button v-if="problem === 'no-permission'" class="option primary" :disabled="busy" @click="allowAccess">
            <AppIcon name="check" :size="20" class="option-icon" />
            <span class="option-text">
              <span class="option-title">Permitir acesso</span>
              <span class="option-hint">Abre a tela do Android com a permissão do 4notes.</span>
            </span>
          </button>
          <button v-if="problem === 'missing'" class="option" :disabled="busy" @click="recreate">
            <AppIcon name="refresh" :size="20" class="option-icon" />
            <span class="option-text">
              <span class="option-title">Recriar esta pasta</span>
              <span class="option-hint">Cria a pasta de novo, vazia, no mesmo lugar.</span>
            </span>
          </button>
          <button class="option" :class="{ primary: problem !== 'no-permission' }" :disabled="busy" @click="create">
            <AppIcon name="plus" :size="20" class="option-icon" />
            <span class="option-text">
              <span class="option-title">Criar workspace</span>
              <span class="option-hint">Escolha onde e dê um nome: o 4notes cria a pasta do workspace.</span>
            </span>
          </button>
          <button class="option" :disabled="busy" @click="open">
            <AppIcon name="folder-open" :size="20" class="option-icon" />
            <span class="option-text">
              <span class="option-title">Abrir workspace existente</span>
              <span class="option-hint">Escolha uma pasta que já tem dados do 4notes (ou qualquer pasta).</span>
            </span>
          </button>
        </div>
      </div>

      <ul class="structure">
        <li v-for="item in structure" :key="item.name">
          <AppIcon :name="item.icon" :size="16" />
          <code>{{ item.name }}</code>
          <span>{{ item.text }}</span>
        </li>
      </ul>
      <p class="footnote">
        Você pode abrir ou criar outros workspaces depois, {{ android ? 'tocando no nome do workspace no topo da tela (ou em Mais)' : 'clicando no nome do workspace no topo da janela' }}.
        Faça backup copiando a pasta inteira{{ android ? ' — ou sincronize a pasta para usar o mesmo workspace no computador e no celular' : '' }}.
      </p>
    </section>
  </div>
</template>

<style scoped>
.welcome {
  position: relative;
  display: grid;
  place-items: center;
  height: 100%;
  padding: 32px;
  overflow: auto;
  background: var(--surface);
}
.welcome-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(600px 300px at 30% 10%, var(--primary-soft), transparent 70%),
    radial-gradient(500px 260px at 75% 90%, var(--accent-soft), transparent 70%);
  pointer-events: none;
}
.welcome-card {
  position: relative;
  width: min(620px, 100%);
  animation: rise 520ms var(--ease-out) both;
}
.welcome-logo {
  margin-bottom: 22px;
  border-radius: 16px;
  box-shadow: 0 12px 32px rgba(90, 53, 230, 0.35);
  animation: float 5s ease-in-out infinite;
}
h1 {
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: 750;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
.brand {
  background: linear-gradient(90deg, var(--primary), var(--purple-400));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lead {
  margin-top: 12px;
  color: var(--text-2);
  font-size: 15px;
  line-height: 1.6;
}
.lead code,
.structure code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--surface-3);
  color: var(--text);
}
.choice {
  margin-top: 28px;
  padding: 18px;
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
  background: var(--surface-2);
  box-shadow: var(--shadow-sm);
}
.choice-path {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  color: var(--primary-text);
}
.choice-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.choice-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
}
.choice-value {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text);
  word-break: break-all;
}
.choice-hint-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-2);
}
.choice-path + .options {
  margin-top: 14px;
}
.options {
  display: grid;
  gap: 10px;
}
.option {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 16px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: border-color var(--t-fast), background var(--t-fast), transform var(--t-fast);
}
.option:hover:not(:disabled) {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.option:active:not(:disabled) {
  transform: scale(0.995);
}
.option:disabled {
  opacity: 0.6;
  cursor: default;
}
.option.primary {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}
.option-icon {
  flex: none;
  color: var(--primary-text);
}
.option-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.option-title {
  font-weight: 650;
  font-size: 14.5px;
}
.option-hint {
  font-size: 12.5px;
  color: var(--text-2);
}
.structure {
  display: grid;
  gap: 8px;
  margin: 26px 0 0;
  padding: 0;
  list-style: none;
  color: var(--text-2);
  font-size: 13px;
}
.structure li {
  display: flex;
  align-items: center;
  gap: 10px;
}
.structure li :deep(.app-icon) {
  color: var(--text-3);
}
.footnote {
  margin-top: 22px;
  font-size: 12.5px;
  color: var(--text-3);
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}
@keyframes float {
  50% {
    transform: translateY(-5px) rotate(-2deg);
  }
}
</style>
