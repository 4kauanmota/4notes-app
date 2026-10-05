<script setup lang="ts">
/** Criar ou editar uma pasta de links: nome, ícone (ou a inicial do nome) e cor. */
import { computed, nextTick, ref, watch } from 'vue'
import type { PaletteColor } from '~/lib/colors'
import { MAX_FOLDER_NAME, suggestFolderColor } from '~/lib/links/model'
import { useLinksStore } from '~/stores/links'

const props = defineProps<{ open: boolean; folderId: string | null }>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()
const links = useLinksStore()

const name = ref('')
const color = ref<PaletteColor>('purple')
/** Ícone pronto (null = inicial do nome). */
const icon = ref<string | null>(null)
const error = ref<string | null>(null)
const input = ref<HTMLInputElement>()

const editing = computed(() => (props.folderId ? (links.folderById.value.get(props.folderId) ?? null) : null))
const count = computed(() => (editing.value ? (links.countByFolder.value.get(editing.value.id) ?? 0) : 0))

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    name.value = editing.value?.name ?? ''
    color.value = editing.value?.color ?? suggestFolderColor(links.state.folders.map((folder) => folder.color))
    icon.value = editing.value?.icon ?? null
    error.value = null
    await nextTick()
    input.value?.focus()
    input.value?.select()
  },
)

function save() {
  const problem = links.folderProblem(name.value, editing.value?.id)
  if (problem) {
    error.value = problem
    return
  }
  const values = { name: name.value, color: color.value, icon: icon.value }
  if (editing.value) {
    if (!links.updateFolder(editing.value.id, values)) return
    emit('saved', editing.value.id)
  } else {
    const folder = links.addFolder(values.name, values.color, values.icon)
    if (!folder) return
    emit('saved', folder.id)
  }
  emit('close')
}

/** Excluir (só ao editar): fecha este diálogo e pede confirmação. Os links ficam sem pasta. */
function remove() {
  const id = editing.value?.id
  emit('close')
  if (id) void links.requestDeleteFolder(id)
}
</script>

<template>
  <UiModal :open="open" :width="440" :label="editing ? 'Editar pasta' : 'Nova pasta'" @close="emit('close')">
    <form class="folder-dialog" @submit.prevent="save">
      <h2>{{ editing ? 'Editar pasta' : 'Nova pasta' }}</h2>

      <div class="identity">
        <CategoryAvatar :name="name || '?'" :color="color" :icon="icon" :size="52" />
        <div class="identity-fields">
          <label class="field-label" for="link-folder-name">Nome</label>
          <input
            id="link-folder-name"
            ref="input"
            v-model="name"
            class="input"
            placeholder="Ex.: Dev, Estudos, Jogos"
            :maxlength="MAX_FOLDER_NAME"
            spellcheck="false"
            @input="error = null"
          />
        </div>
      </div>
      <Transition name="fade"><p v-if="error" class="error">{{ error }}</p></Transition>

      <span class="field-label section-gap">Ícone</span>
      <IconPicker v-model="icon" :color="color" :name="name" label="Ícone da pasta" />

      <span class="field-label section-gap">Cor</span>
      <ColorSwatches :model-value="color" label="Cor da pasta" @update:model-value="(value) => value && (color = value)" />

      <p v-if="editing" class="hint">
        <AppIcon name="link" :size="13" />
        {{ count ? `${count} ${count === 1 ? 'link nesta pasta' : 'links nesta pasta'}` : 'Pasta vazia' }}
      </p>

      <div class="actions">
        <button v-if="editing" type="button" class="btn btn-danger-ghost delete-btn" @click="remove">
          <AppIcon name="trash" :size="15" /> Excluir
        </button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Cancelar</button>
        <button type="submit" class="btn btn-primary">{{ editing ? 'Salvar' : 'Criar pasta' }}</button>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.folder-dialog {
  padding: 22px;
}
h2 {
  margin-bottom: 18px;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.identity {
  display: flex;
  align-items: flex-end;
  gap: 14px;
}
.identity-fields {
  flex: 1;
  min-width: 0;
}
.error {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--danger);
}
.section-gap {
  margin-top: 18px;
}
.hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  font-size: 12px;
  color: var(--text-3);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.delete-btn {
  margin-right: auto;
  padding-left: 10px;
}
</style>
