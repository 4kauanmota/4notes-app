<script setup lang="ts">
/**
 * Editar um link: título, endereço e categoria. "Buscar no site" pega de novo o título e
 * o ícone da página (o título novo aparece no campo, se você não o tinha mudado).
 * "Ver menções" mostra onde o link foi mencionado (notas e tarefas).
 */
import { computed, nextTick, ref, watch } from 'vue'
import { displayHost } from '~/lib/links/model'
import { useCategoriesStore } from '~/stores/categories'
import { useLinksStore } from '~/stores/links'
import { savedLinkSubject, showMentionsOf } from '~/stores/mentions'

const props = defineProps<{ open: boolean; linkId: string | null }>()
const emit = defineEmits<{ close: [] }>()
const links = useLinksStore()
const shared = useCategoriesStore()

/** Categorias do app que ainda não estão nos Links (escolher uma a coloca aqui). */
const others = computed(() => shared.availableFor('links'))

const title = ref('')
const url = ref('')
/** '' = sem categoria. */
const folderId = ref('')
const error = ref<string | null>(null)
const titleInput = ref<HTMLInputElement>()
/** Último título vindo do link (para saber se você mexeu no campo). */
let syncedTitle = ''

const link = computed(() => links.findLink(props.linkId))
const loading = computed(() => !!link.value && links.state.fetching.has(link.value.id))
const urlEdited = computed(() => !!link.value && url.value.trim() !== link.value.url)

watch(
  () => props.open,
  async (open) => {
    if (!open || !link.value) return
    title.value = syncedTitle = link.value.title
    url.value = link.value.url
    folderId.value = links.folderOf(link.value)?.id ?? ''
    error.value = null
    await nextTick()
    titleInput.value?.focus()
    titleInput.value?.select()
  },
)

// O link foi excluído enquanto o diálogo estava aberto (Desfazer de outro lugar, arquivo editado…)
watch(link, (current) => {
  if (props.open && !current) emit('close')
})

watch(
  () => link.value?.title,
  (next) => {
    if (!props.open || next === undefined) return
    if (title.value === syncedTitle) title.value = next
    syncedTitle = next
  },
)

function refresh() {
  if (link.value && !urlEdited.value) links.refreshLink(link.value.id)
}

function save() {
  if (!link.value) return
  // Uma categoria do app que ainda não estava nos Links passa a aparecer aqui
  if (folderId.value && !links.folderById.value.has(folderId.value)) links.attachFolder(folderId.value)
  const problem = links.updateLink(link.value.id, { title: title.value, url: url.value, folderId: folderId.value || null })
  if (problem) {
    error.value = problem
    return
  }
  emit('close')
}

function showMentions() {
  const current = link.value
  emit('close')
  if (current) showMentionsOf(savedLinkSubject(current))
}

function remove() {
  if (link.value) links.deleteLink(link.value.id)
  emit('close')
}
</script>

<template>
  <UiModal :open="open && !!link" :width="480" label="Editar link" @close="emit('close')">
    <form v-if="link" class="edit-dialog" @submit.prevent="save">
      <div class="head">
        <LinkIcon :url="link.url" :icon="links.iconPath(link)" :version="links.state.iconVersion" :loading="loading" :size="34" />
        <div class="head-text">
          <h2>Editar link</h2>
          <span class="host">{{ displayHost(link.url) }}</span>
        </div>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="loading || urlEdited"
          :data-tip="urlEdited ? 'Salve o novo endereço antes' : 'Busca de novo o título e o ícone da página'"
          @click="refresh"
        >
          <AppIcon name="refresh" :size="14" /> {{ loading ? 'Buscando…' : 'Buscar no site' }}
        </button>
      </div>

      <label class="field-label" for="link-edit-title">Título</label>
      <input id="link-edit-title" ref="titleInput" v-model="title" class="input" spellcheck="false" />

      <label class="field-label gap" for="link-edit-url">Endereço</label>
      <input id="link-edit-url" v-model="url" class="input mono" spellcheck="false" autocomplete="off" @input="error = null" />
      <Transition name="fade"><p v-if="error" class="error">{{ error }}</p></Transition>

      <label class="field-label gap" for="link-edit-folder">Categoria</label>
      <select id="link-edit-folder" v-model="folderId" class="select">
        <option value="">Sem categoria</option>
        <option v-for="folder in links.state.folders" :key="folder.id" :value="folder.id">{{ folder.name }}</option>
        <optgroup v-if="others.length" label="Outras categorias do app">
          <option v-for="category in others" :key="category.id" :value="category.id">{{ category.name }}</option>
        </optgroup>
      </select>

      <div class="actions">
        <button type="button" class="btn btn-danger-ghost delete-btn" @click="remove"><AppIcon name="trash" :size="15" /> Excluir</button>
        <button type="button" class="btn btn-ghost mentions-btn" data-action="link-mentions" @click="showMentions">
          <AppIcon name="backlink" :size="15" /> Ver menções
        </button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.edit-dialog {
  padding: 22px;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.head-text {
  flex: 1;
  min-width: 0;
}
h2 {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.host {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3);
  font-size: 12.5px;
}
.gap {
  margin-top: 14px;
}
.mono {
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.error {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--danger);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}
.delete-btn {
  padding-left: 10px;
}
.mentions-btn {
  margin-right: auto;
  padding-left: 10px;
}
</style>
