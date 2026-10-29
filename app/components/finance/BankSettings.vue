<script setup lang="ts">
/**
 * Configurações › Finanças › Conexões bancárias (1.7.2): conectar o 4notes ao Meu Pluggy,
 * adicionar os bancos (pelo Item ID), escolher as contas, buscar agora e desconectar.
 * O passo a passo para criar as contas na Pluggy fica aqui mesmo (e no tutorial).
 */
import { computed, onMounted, ref } from 'vue'
import { MEU_PLUGGY, PLUGGY_DASHBOARD } from '#shared/pluggy'
import { confirmDialog } from '~/composables/useDialog'
import { addDays, formatDateBR } from '~/lib/dates'
import { DEFAULT_HISTORY_DAYS } from '~/lib/finance/bank'
import { desktop, hasDesktopApi } from '~/lib/platform'
import { useBankStore } from '~/stores/bank'
import { useFinanceStore } from '~/stores/finance'

const bank = useBankStore()
const finance = useFinanceStore()

const clientId = ref('')
const clientSecret = ref('')
const connecting = ref(false)
const connectError = ref<string | null>(null)

const itemId = ref('')
const from = ref(addDays(finance.today.value, -DEFAULT_HISTORY_DAYS))
const adding = ref(false)
const addError = ref<string | null>(null)
const refreshing = ref<string | null>(null)

const status = computed(() => bank.state.status)
const settings = computed(() => finance.state.settings.bank)
const connections = computed(() => settings.value.connections)
const autoSync = computed({
  get: () => settings.value.autoSync,
  set: (value: boolean) => bank.setAutoSync(value),
})
const lastSync = computed(() => {
  const value = settings.value.lastSync
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : `${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
})

onMounted(() => {
  void bank.refreshStatus()
})

function open(url: string) {
  if (hasDesktopApi()) void desktop().shell.openExternal(url)
}

async function connect() {
  connectError.value = null
  connecting.value = true
  try {
    const problem = await bank.configure(clientId.value, clientSecret.value)
    if (problem) connectError.value = problem
    else {
      clientId.value = ''
      clientSecret.value = ''
    }
  } finally {
    connecting.value = false
  }
}

async function disconnect() {
  const ok = await confirmDialog({
    title: 'Desconectar da Pluggy?',
    message: 'O Client ID e o Client Secret saem deste aparelho. Os bancos, as contas escolhidas e os lançamentos já importados continuam.',
    confirmLabel: 'Desconectar',
    danger: true,
  })
  if (ok) await bank.forget()
}

async function add() {
  addError.value = null
  adding.value = true
  try {
    const problem = await bank.addConnection(itemId.value, from.value)
    if (problem) addError.value = problem
    else itemId.value = ''
  } finally {
    adding.value = false
  }
}

async function remove(id: string, name: string) {
  const ok = await confirmDialog({
    title: `Remover ${name}?`,
    message: 'O 4notes para de buscar neste banco. Os lançamentos que já vieram dele continuam nas Finanças.',
    confirmLabel: 'Remover',
    danger: true,
  })
  if (ok) bank.removeConnection(id)
}

async function refresh(id: string) {
  refreshing.value = id
  try {
    await bank.refreshConnection(id)
  } finally {
    refreshing.value = null
  }
}

const accountKind = (type: string) => (type === 'CREDIT' ? 'Cartão' : 'Conta')
const since = (connection: { from: string; accounts: { syncedUntil: string | null }[] }) => {
  const dates = connection.accounts.map((account) => account.syncedUntil).filter((date): date is string => !!date).sort()
  return dates.length ? `buscado até ${formatDateBR(dates[0]!)}` : `a partir de ${formatDateBR(connection.from)}`
}
</script>

<template>
  <div class="bank" data-bank-settings>
    <div class="bank-head">
      <span class="bank-title">Conexões bancárias</span>
      <span class="bank-help" tabindex="0" role="img" aria-label="Importa as transações dos seus bancos pelo Open Finance, com o Meu Pluggy." data-tip="Importa as transações dos seus bancos pelo Open Finance, com o Meu Pluggy." data-tip-pos="top">
        <AppIcon name="help" :size="15" />
      </span>
    </div>

    <p v-if="!bank.state.available" class="muted">Disponível no 4notes instalado (Windows e Android).</p>

    <template v-else-if="status && !status.configured">
      <p class="muted">
        O 4notes lê as transações pelo <b>Meu Pluggy</b> (gratuito para uso pessoal). Você autoriza cada banco no próprio banco, pelo Open Finance: o 4notes nunca vê a sua senha.
      </p>
      <ol class="steps">
        <li>Conecte os seus bancos em <a href="#" @click.prevent="open(MEU_PLUGGY)">meu.pluggy.ai</a>.</li>
        <li>No <a href="#" @click.prevent="open(PLUGGY_DASHBOARD)">painel da Pluggy</a>, crie uma aplicação e copie o Client ID e o Client Secret.</li>
        <li>Na aplicação, adicione o conector “MeuPluggy”, abra a “Demo”, autorize cada banco e copie o Item ID dele.</li>
        <li>Cole aqui o Client ID e o Client Secret, e depois o Item ID de cada banco.</li>
      </ol>
      <form class="connect" @submit.prevent="connect">
        <label class="field">
          <span class="field-label">Client ID</span>
          <input v-model="clientId" class="input" autocomplete="off" spellcheck="false" data-field="pluggy-client-id" />
        </label>
        <label class="field">
          <span class="field-label">Client Secret</span>
          <input v-model="clientSecret" class="input" type="password" autocomplete="off" spellcheck="false" data-field="pluggy-client-secret" />
        </label>
        <p v-if="connectError" class="error" role="alert">{{ connectError }}</p>
        <div class="row-end">
          <span class="muted small">Fica só neste aparelho{{ status.secure ? ', criptografado pelo sistema' : '' }}.</span>
          <button type="submit" class="btn btn-primary btn-sm" :disabled="connecting || !clientId.trim() || !clientSecret.trim()" data-action="pluggy-connect">
            {{ connecting ? 'Testando…' : 'Conectar à Pluggy' }}
          </button>
        </div>
      </form>
    </template>

    <template v-else-if="status?.configured">
      <div class="connected" data-pluggy-connected>
        <AppIcon name="check" :size="14" />
        <span>Pluggy conectada <span class="muted small">· Client ID {{ status.clientId?.slice(0, 8) }}…</span></span>
        <button type="button" class="btn btn-ghost btn-sm" data-action="pluggy-forget" @click="disconnect">Desconectar</button>
      </div>
      <p v-if="!status.secure" class="muted small">No celular, as credenciais ficam no armazenamento do próprio app (outros apps não leem).</p>

      <ul v-if="connections.length" class="items">
        <li v-for="connection in connections" :key="connection.itemId" class="item" :data-bank-item="connection.itemId">
          <div class="item-head">
            <AppIcon name="wallet" :size="15" />
            <span class="item-name">{{ connection.name }}</span>
            <span class="muted small">{{ since(connection) }}</span>
            <span class="spacer" />
            <button type="button" class="icon-btn sm" :disabled="refreshing === connection.itemId" data-tip="Atualizar contas e situação" aria-label="Atualizar" @click="refresh(connection.itemId)">
              <AppIcon name="refresh" :size="14" />
            </button>
            <button type="button" class="icon-btn sm" data-tip="Remover banco" aria-label="Remover banco" data-action="remove-bank" @click="remove(connection.itemId, connection.name)">
              <AppIcon name="trash" :size="14" />
            </button>
          </div>
          <p v-if="bank.state.items[connection.itemId]?.problem" class="warn small">{{ bank.state.items[connection.itemId]?.problem }}</p>
          <p v-if="bank.state.errors[connection.itemId]" class="error small">{{ bank.state.errors[connection.itemId] }}</p>
          <label v-for="account in connection.accounts" :key="account.id" class="account">
            <input type="checkbox" :checked="account.enabled" :data-bank-account="account.id" @change="bank.setAccountEnabled(connection.itemId, account.id, ($event.target as HTMLInputElement).checked)" />
            <span class="kind">{{ accountKind(account.type) }}</span>
            <span class="account-name">{{ account.name }}</span>
            <span v-if="account.number" class="muted small">{{ account.number }}</span>
          </label>
        </li>
      </ul>

      <form class="add" @submit.prevent="add">
        <label class="field grow">
          <span class="field-label">Item ID do banco</span>
          <input v-model="itemId" class="input mono" autocomplete="off" spellcheck="false" placeholder="Copiado na Demo da Pluggy" data-field="pluggy-item-id" />
        </label>
        <label class="field">
          <span class="field-label">Buscar a partir de</span>
          <input v-model="from" class="input" type="date" :max="finance.today.value" data-field="pluggy-from" />
        </label>
        <button type="submit" class="btn btn-sm" :disabled="adding || !itemId.trim()" data-action="pluggy-add">{{ adding ? 'Conferindo…' : 'Adicionar banco' }}</button>
      </form>
      <p v-if="addError" class="error" role="alert">{{ addError }}</p>

      <div v-if="connections.length" class="sync">
        <label class="auto">
          <UiSwitch v-model="autoSync" label="Buscar ao abrir o app" />
          <span>Buscar ao abrir o app (uma vez por dia)</span>
        </label>
        <span class="spacer" />
        <span v-if="lastSync" class="muted small">Última busca: {{ lastSync }}</span>
        <button type="button" class="btn btn-primary btn-sm" :disabled="bank.state.syncing" data-action="bank-sync" @click="bank.sync({ manual: true })">
          <AppIcon name="refresh" :size="14" /> {{ bank.state.syncing ? 'Buscando…' : 'Buscar agora' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bank {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0 4px;
  border-top: 1px solid var(--border);
}
.bank-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bank-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}
.bank-help {
  display: inline-grid;
  place-items: center;
  color: var(--text-3);
  cursor: help;
}
.muted {
  margin: 0;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.5;
}
.small {
  font-size: 11.5px;
  color: var(--text-3);
}
.steps {
  margin: 0;
  padding-left: 20px;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.6;
}
.steps a {
  color: var(--primary-text);
}
.connect,
.add {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}
.connect .field {
  flex: 1 1 220px;
}
.field {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.field .field-label {
  margin-bottom: 4px;
}
.grow {
  flex: 1 1 240px;
}
.row-end {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.error {
  width: 100%;
  margin: 0;
  color: var(--danger);
  font-size: 12.5px;
}
.warn {
  margin: 0;
  color: var(--accent-text);
}
.connected {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--r-md);
  background: var(--success-soft);
  color: var(--success);
  font-size: 13px;
  font-weight: 550;
}
.connected > span {
  flex: 1;
  min-width: 0;
  color: var(--text);
}
.items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-2);
}
.item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.item-name {
  font-size: 13px;
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.account {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  font-size: 12.5px;
  cursor: pointer;
}
html[data-touch] .account {
  min-height: 40px;
}
.kind {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 10.5px;
  font-weight: 650;
}
.account-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sync {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.auto {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-2);
}
</style>
