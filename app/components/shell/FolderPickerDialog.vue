<script setup lang="ts">
/**
 * Seletor de pastas do celular (pickFolder em composables/useFolderPicker.ts): navega
 * pelas pastas do armazenamento interno, cria pastas e escolhe uma.
 */
import { computed, ref, watch } from 'vue'
import { errorMessage } from '#shared/ipc'
import { promptDialog } from '~/composables/useDialog'
import { useFolderPicker } from '~/composables/useFolderPicker'
import { notifyError } from '~/composables/useToasts'

const { state } = useFolderPicker()
const request = computed(() => state.request)

const current = ref('')
const folders = ref<string[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const listEl = ref<HTMLElement>()

const norm = (path: string) => path.replace(/\/+$/, '') || '/'
const root = computed(() => norm(request.value?.root ?? '/'))

/** Pedaços do caminho abaixo da raiz: [{ name, path }]. */
const crumbs = computed(() => {
  const base = root.value
  const rest = current.value.slice(base.length).split('/').filter(Boolean)
  return rest.map((name, index) => ({ name, path: `${base}/${rest.slice(0, index + 1).join('/')}` }))
})
const atRoot = computed(() => current.value === root.value)

async function open(path: string) {
  const picker = request.value
  if (!picker) return
  loading.value = true
  error.value = null
  try {
    const names = await picker.list(path)
    if (request.value !== picker) return
    folders.value = names.filter((name) => !name.startsWith('.')).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
    current.value = path
    listEl.value?.scrollTo({ top: 0 })
  } catch (failure) {
    error.value = errorMessage(failure)
    current.value = path
    folders.value = []
  } finally {
    loading.value = false
  }
}

watch(
  request,
  (picker) => {
    if (!picker) return
    const start = picker.start && norm(picker.start).toLowerCase().startsWith(norm(picker.root).toLowerCase()) ? norm(picker.start) : norm(picker.root)
    folders.value = []
    void open(start)
  },
  { immediate: true },
)

function up() {
  if (atRoot.value) return
  void open(current.value.slice(0, current.value.lastIndexOf('/')) || root.value)
}

async function createFolder() {
  const picker = request.value
  if (!picker) return
  const name = await promptDialog({
    title: 'Nova pasta',
    label: 'Nome da pasta',
    icon: 'folder',
    confirmLabel: 'Criar pasta',
    validate: (value) => {
      const text = value.trim()
      if (!text) return 'Digite um nome.'
      if (/[<>:"/\\|?*\u0000-\u001f]/.test(text)) return 'O nome não pode ter estes caracteres: < > : " / \\ | ? *'
      if (text.startsWith('.')) return 'O nome não pode começar com ponto.'
      if (folders.value.some((folder) => folder.toLowerCase() === text.toLowerCase())) return 'Já existe uma pasta com esse nome aqui.'
      return null
    },
  })
  if (!name || request.value !== picker) return
  try {
    await open(await picker.create(current.value, name))
  } catch (failure) {
    notifyError(`Não foi possível criar a pasta: ${errorMessage(failure)}`, failure)
  }
}

const close = (path: string | null) => request.value?.resolve(path)
</script>

<template>
  <UiModal :open="!!request" :width="460" :label="request?.title" full-on-compact @close="close(null)">
    <div v-if="request" class="picker">
      <div class="picker-head">
        <span class="picker-icon"><AppIcon name="folder-open" :size="18" /></span>
        <h2 class="picker-title">{{ request.title }}</h2>
      </div>

      <nav class="crumbs" aria-label="Pasta atual">
        <button class="crumb" :class="{ current: atRoot }" @click="open(root)">{{ request.rootLabel }}</button>
        <template v-for="(crumb, index) in crumbs" :key="crumb.path">
          <AppIcon name="chevron-right" :size="13" class="crumb-sep" />
          <button class="crumb" :class="{ current: index === crumbs.length - 1 }" @click="open(crumb.path)">{{ crumb.name }}</button>
        </template>
      </nav>

      <div ref="listEl" class="folders" role="list" :aria-busy="loading">
        <button v-if="!atRoot" class="folder up" role="listitem" @click="up">
          <AppIcon name="arrow-left" :size="17" />
          <span>Voltar</span>
        </button>
        <button v-for="name in folders" :key="name" class="folder" role="listitem" :data-folder="name" @click="open(`${current}/${name}`)">
          <AppIcon name="folder" :size="17" />
          <span class="folder-name">{{ name }}</span>
          <AppIcon name="chevron-right" :size="15" class="folder-go" />
        </button>
        <p v-if="error" class="picker-note error">{{ error }}</p>
        <p v-else-if="!loading && !folders.length" class="picker-note">Nenhuma pasta aqui.</p>
      </div>

      <div class="picker-actions">
        <button class="btn btn-ghost new-folder" data-action="new-folder" @click="createFolder"><AppIcon name="plus" :size="15" /> Nova pasta</button>
        <span class="spacer" />
        <button class="btn btn-ghost" @click="close(null)">Cancelar</button>
        <button class="btn btn-primary" data-action="choose" :disabled="loading" @click="close(current)">{{ request.buttonLabel }}</button>
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  max-height: min(640px, calc(100dvh - 48px));
  padding: 20px 20px 16px;
}
.picker-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.picker-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary-text);
}
.picker-title {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin: 14px 0 8px;
  font-size: 13px;
}
.crumb {
  padding: 4px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
}
.crumb:hover {
  background: var(--hover);
}
.crumb.current {
  color: var(--text);
  font-weight: 600;
}
.crumb-sep {
  color: var(--text-3);
}
.folders {
  flex: 1;
  min-height: 160px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 4px;
}
.folder {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14.5px;
  text-align: left;
  cursor: pointer;
}
.folder:hover,
.folder:focus-visible {
  background: var(--hover);
}
.folder > :first-child {
  color: var(--primary-text);
}
.folder.up > :first-child {
  color: var(--text-2);
}
.folder-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.folder-go {
  color: var(--text-3);
}
.picker-note {
  padding: 18px 12px;
  color: var(--text-3);
  font-size: 13px;
  text-align: center;
}
.picker-note.error {
  color: var(--danger);
}
.picker-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}
.spacer {
  flex: 1;
}

/* ── Celular: tela inteira, botões grandes embaixo ── */
html[data-layout='compact'] .picker {
  height: 100%;
  max-height: none;
  padding: 16px 14px 12px;
}
html[data-touch] .crumb {
  min-height: 34px;
  padding: 4px 8px;
}
html[data-touch] .folder {
  min-height: 50px;
  font-size: 15.5px;
}
html[data-layout='compact'] .picker-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
html[data-layout='compact'] .picker-actions .spacer {
  display: none;
}
html[data-layout='compact'] .picker-actions .btn-primary {
  grid-column: 1 / -1;
  order: -1;
}
</style>
