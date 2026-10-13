<script setup lang="ts">
/**
 * Configurações › Geral › Atualizações: a versão instalada, "Procurar atualização" e,
 * com uma versão nova, "Instalar" (com o andamento do download e as notas da versão).
 * É onde a versão fica depois de um "Agora não" na pergunta da abertura.
 */
import { computed, onMounted } from 'vue'
import { notesSummary } from '#shared/updates'
import { desktop } from '~/lib/platform'
import { useUpdatesStore } from '~/stores/updates'

const updates = useUpdatesStore()
const state = updates.state
const current = desktop().bootstrap.appVersion
const android = desktop().bootstrap.platform === 'android'

onMounted(() => {
  // Ainda não procurou nesta abertura (ou deu erro): procura agora
  if (state.status === 'idle' || state.status === 'error') void updates.checkForUpdates()
})

const busy = computed(() => ['checking', 'downloading', 'installing'].includes(state.status))

const note = computed(() => {
  switch (state.status) {
    case 'checking':
      return 'Procurando…'
    case 'latest':
      return `Versão ${current} — é a mais recente.`
    case 'available':
      return `Versão ${state.available?.version} disponível (você está na ${current}).`
    case 'downloading':
      return `Baixando a versão ${state.available?.version}… ${state.progress}%`
    case 'installing':
      return android ? 'O instalador do Android abriu: confirme por lá.' : 'Instalando… o 4notes fecha e abre de novo sozinho.'
    case 'permission':
      return 'Permita que o 4notes instale apps (na tela que abriu) e toque em Instalar.'
    case 'unsupported':
      return state.reason === 'dev'
        ? 'Disponível no 4notes instalado.'
        : 'Ainda sem o repositório das versões (package.json › "updates" › "github").'
    case 'error':
      return state.message
    default:
      return `Versão ${current}.`
  }
})

const summary = computed(() =>
  state.available && ['available', 'downloading', 'permission'].includes(state.status) ? notesSummary(state.available.notes, 600) : '',
)
const canInstall = computed(() => !!state.available && ['available', 'permission', 'error'].includes(state.status))
</script>

<template>
  <section data-section="updates">
    <h3 class="section-label">Atualizações</h3>
    <SettingRow
      label="Versão do 4notes"
      help="Ao abrir, o 4notes procura uma versão nova no GitHub e pergunta se você quer instalar. Atualizar não mexe nas suas notas nem nas configurações."
      :note="note"
    >
      <button v-if="canInstall" class="btn btn-sm btn-primary" data-action="update-install" @click="updates.installUpdate()">
        <AppIcon name="download" :size="14" /> Instalar {{ state.available?.version }}
      </button>
      <button
        v-else
        class="btn btn-sm"
        data-action="update-check"
        :disabled="busy || state.status === 'unsupported'"
        @click="updates.checkForUpdates()"
      >
        <AppIcon name="refresh" :size="14" :class="{ spinning: state.status === 'checking' }" />
        {{ state.status === 'checking' ? 'Procurando…' : 'Procurar atualização' }}
      </button>
    </SettingRow>
    <div
      v-if="state.status === 'downloading'"
      class="update-progress"
      role="progressbar"
      :aria-valuenow="state.progress"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span :style="{ width: `${state.progress}%` }" />
    </div>
    <p v-if="summary" class="update-notes" data-update-notes>{{ summary }}</p>
  </section>
</template>

<style scoped>
.update-progress {
  height: 4px;
  margin: 2px 0 8px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}
.update-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
  transition: width 200ms var(--ease-out);
}
.update-notes {
  margin: 2px 0 6px;
  padding: 10px 12px;
  border-radius: var(--r-md, 10px);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-line;
}
.spinning {
  animation: spin 900ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
