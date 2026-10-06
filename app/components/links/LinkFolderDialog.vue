<script setup lang="ts">
/**
 * Criar ou editar uma categoria de links: nome, cor e aparência — a inicial do
 * nome, um ícone pronto ou uma foto da biblioteca de imagens. Escolher um ícone
 * tira a foto, e escolher uma foto tira o ícone.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { pickLibraryImage } from '~/composables/useImageLibrary'
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
/** Foto: imagem da biblioteca (attachments/…), ou null. */
const image = ref<string | null>(null)
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
    image.value = editing.value?.image ?? null
    error.value = null
    await nextTick()
    input.value?.focus()
    input.value?.select()
  },
)

/** Escolhe a foto na biblioteca (dá para enviar uma nova por lá). */
async function chooseImage() {
  const picked = await pickLibraryImage({ title: 'Foto da categoria', confirmLabel: 'Usar foto' })
  const path = picked ? await links.libraryImage(picked) : null
  if (!path || !props.open) return
  image.value = path
  icon.value = null
}

/** Ícone (ou a inicial): a foto sai, senão ela continuaria aparecendo no lugar do ícone. */
function chooseIcon(value: string | null) {
  icon.value = value
  image.value = null
}

function save() {
  const problem = links.folderProblem(name.value, editing.value?.id)
  if (problem) {
    error.value = problem
    return
  }
  const values = { name: name.value, color: color.value, icon: icon.value, image: image.value }
  if (editing.value) {
    if (!links.updateFolder(editing.value.id, values)) return
    emit('saved', editing.value.id)
  } else {
    const folder = links.addFolder(values.name, values.color, values.icon, values.image)
    if (!folder) return
    emit('saved', folder.id)
  }
  emit('close')
}

/** Excluir (só ao editar): fecha este diálogo e pede confirmação. Os links ficam sem categoria. */
function remove() {
  const id = editing.value?.id
  emit('close')
  if (id) void links.requestDeleteFolder(id)
}
</script>

<template>
  <UiModal :open="open" :width="456" :label="editing ? 'Editar categoria' : 'Nova categoria'" @close="emit('close')">
    <form class="folder-dialog" @submit.prevent="save">
      <h2>{{ editing ? 'Editar categoria' : 'Nova categoria' }}</h2>

      <div class="identity">
        <div class="image-box">
          <CategoryAvatar :name="name || '?'" :color="color" :icon="icon" :image="image" :size="64" />
        </div>
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
          <div class="image-actions">
            <button type="button" class="btn btn-sm" @click="chooseImage">
              <AppIcon name="image" :size="15" /> {{ image ? 'Trocar foto…' : 'Escolher foto…' }}
            </button>
            <button v-if="image" type="button" class="btn btn-ghost btn-sm" @click="image = null">Remover</button>
          </div>
        </div>
      </div>
      <Transition name="fade"><p v-if="error" class="error">{{ error }}</p></Transition>

      <span class="field-label section-gap">Ícone</span>
      <IconPicker :model-value="image ? '' : icon" :color="color" :name="name" label="Ícone da categoria" @update:model-value="chooseIcon" />

      <span class="field-label section-gap">Cor</span>
      <ColorSwatches :model-value="color" label="Cor da categoria" @update:model-value="(value) => value && (color = value)" />

      <p v-if="editing" class="hint">
        <AppIcon name="link" :size="13" />
        {{ count ? `${count} ${count === 1 ? 'link nesta categoria' : 'links nesta categoria'}` : 'Categoria vazia' }}
      </p>

      <div class="actions">
        <button v-if="editing" type="button" class="btn btn-danger-ghost delete-btn" @click="remove">
          <AppIcon name="trash" :size="15" /> Excluir
        </button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Cancelar</button>
        <button type="submit" class="btn btn-primary">{{ editing ? 'Salvar' : 'Criar categoria' }}</button>
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
  align-items: flex-start;
  gap: 16px;
}
.image-box {
  flex: none;
  padding-top: 20px;
}
.identity-fields {
  flex: 1;
  min-width: 0;
}
.image-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
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
