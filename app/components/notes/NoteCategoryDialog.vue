<script setup lang="ts">
/**
 * Criar ou editar uma categoria das Notas: nome (= nome da pasta), cor (marca as
 * abas das notas dela) e aparência: a inicial do nome, um ícone pronto ou uma
 * imagem da biblioteca (uma cópia fica na pasta da categoria, com o nome dela).
 * Escolher um ícone tira a imagem, e escolher uma imagem tira o ícone.
 * As categorias são as do app inteiro (1.7.0): ao criar, dá para usar uma que já
 * existe (de outro módulo); ao editar, a mudança vale em todos os módulos.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { pickLibraryImage } from '~/composables/useImageLibrary'
import { requestDeleteCategory, useCategoryDialog } from '~/composables/useNoteCategories'
import type { PaletteColor } from '~/lib/colors'
import { categoryImagePath, MAX_CATEGORY_NAME, suggestCategoryColor } from '~/lib/notes/categories'
import { useCategoriesStore } from '~/stores/categories'
import { useNotesStore } from '~/stores/notes'

const notes = useNotesStore()
const shared = useCategoriesStore()
const { dialog, close } = useCategoryDialog()

const name = ref('')
const color = ref<PaletteColor>('purple')
/** Ícone pronto (null = inicial do nome). */
const icon = ref<string | null>(null)
/** undefined = manter a imagem atual; null = sem imagem; texto = imagem da biblioteca escolhida agora. */
const image = ref<string | null | undefined>(undefined)
const error = ref<string | null>(null)
const saving = ref(false)
const input = ref<HTMLInputElement>()

const editing = computed(() => (dialog.category ? (notes.findCategory(dialog.category) ?? null) : null))

/** Nome digitado igual ao de uma categoria do app que ainda não está nas Notas: ela é usada. */
const sameAsExisting = computed(() => {
  if (editing.value) return null
  const found = shared.findByName(name.value)
  return found && !notes.state.categories.some((category) => category.id === found.id) ? found : null
})

/** O que aparece no quadrinho da prévia (caminho da imagem no workspace). */
const shownImage = computed(() => {
  if (image.value === null) return null
  if (image.value) return image.value
  return editing.value ? categoryImagePath(editing.value) : null
})

watch(
  () => dialog.open,
  async (open) => {
    if (!open) return
    name.value = editing.value?.name ?? ''
    color.value = editing.value?.color ?? suggestCategoryColor(notes.state.categories.map((category) => category.color))
    icon.value = editing.value?.icon ?? null
    image.value = undefined
    error.value = null
    saving.value = false
    await nextTick()
    input.value?.focus()
    input.value?.select()
  },
)

/** Escolhe a imagem na biblioteca (dá para enviar uma nova por lá). */
async function chooseImage() {
  const picked = await pickLibraryImage({ title: 'Imagem da categoria', confirmLabel: 'Usar imagem' })
  // A foto da categoria do app é sempre uma imagem da biblioteca (attachments/)
  const path = picked ? await shared.libraryImage(picked) : null
  if (!path || !dialog.open) return
  image.value = path
  icon.value = null
}

function removeImage() {
  image.value = null
}

/** Ícone (ou a inicial): a imagem sai, senão ela continuaria aparecendo no lugar do ícone. */
function chooseIcon(value: string | null) {
  icon.value = value
  if (shownImage.value) removeImage()
}

async function save() {
  if (sameAsExisting.value) return useExisting(sameAsExisting.value.id)
  const problem = notes.categoryProblem(name.value, editing.value?.name)
  if (problem) {
    error.value = problem
    return
  }
  saving.value = true
  const values = { name: name.value.trim(), color: color.value, icon: icon.value, image: image.value }
  if (editing.value) {
    const ok = await notes.updateCategory(editing.value.name, values)
    saving.value = false
    if (ok) close()
    return
  }
  const created = await notes.createCategory(values)
  saving.value = false
  if (!created) return
  if (dialog.assignNote) await notes.moveToCategory(dialog.assignNote, created.name, { undo: false })
  close()
}

/** "Usar uma categoria que já existe": ela vira uma pasta nas Notas. */
async function useExisting(id: string) {
  saving.value = true
  const category = await notes.attachCategory(id)
  saving.value = false
  if (!category) return
  if (dialog.assignNote) await notes.moveToCategory(dialog.assignNote, category.name, { undo: false })
  close()
}

/** Excluir (só ao editar): fecha este diálogo e pede confirmação. */
function remove() {
  const name = editing.value?.name
  close()
  if (name) void requestDeleteCategory(name)
}
</script>

<template>
  <UiModal :open="dialog.open" :width="456" :label="editing ? 'Editar categoria' : 'Nova categoria'" @close="close">
    <form class="cat-dialog" @submit.prevent="save">
      <h2>{{ editing ? 'Editar categoria' : 'Nova categoria' }}</h2>

      <div class="identity">
        <div class="image-box">
          <CategoryAvatar :name="name || '?'" :color="color" :image="shownImage" :icon="icon" :version="notes.state.imageVersion" :size="64" />
        </div>
        <div class="identity-fields">
          <label class="field-label" for="note-cat-name">Nome</label>
          <input
            id="note-cat-name"
            ref="input"
            v-model="name"
            class="input"
            placeholder="Ex.: Trabalho"
            :maxlength="MAX_CATEGORY_NAME"
            spellcheck="false"
            @input="error = null"
          />
          <div class="image-actions">
            <button type="button" class="btn btn-sm" @click="chooseImage">
              <AppIcon name="image" :size="15" /> {{ shownImage ? 'Trocar imagem…' : 'Escolher imagem…' }}
            </button>
            <button v-if="shownImage" type="button" class="btn btn-ghost btn-sm" @click="removeImage">Remover</button>
          </div>
        </div>
      </div>
      <Transition name="fade"><p v-if="error" class="error">{{ error }}</p></Transition>
      <p v-if="sameAsExisting" class="same-hint">
        <AppIcon name="tag" :size="13" /> “{{ sameAsExisting.name }}” já existe no app: ao confirmar, ela é usada aqui (com a cor e a foto dela).
      </p>

      <span class="field-label section-gap">Ícone</span>
      <IconPicker :model-value="shownImage ? '' : icon" :color="color" :name="name" label="Ícone da categoria" @update:model-value="chooseIcon" />

      <span class="field-label section-gap">Cor (marca as abas das notas desta categoria)</span>
      <ColorSwatches :model-value="color" label="Cor da categoria" @update:model-value="(value) => value && (color = value)" />

      <p class="hint">
        <AppIcon name="folder" :size="13" />
        <span>A categoria é a pasta <code>notes/{{ name.trim() || '…' }}</code>; a imagem (da biblioteca) fica dentro dela, com o nome da categoria.</span>
      </p>

      <ExistingCategories v-if="!editing" module="notes" :query="name" @pick="useExisting" />
      <CategoryShareInfo v-else-if="editing.id" :id="editing.id" module="notes" @leave="close" />

      <div class="actions">
        <button v-if="editing" type="button" class="btn btn-danger-ghost delete-btn" @click="remove">
          <AppIcon name="trash" :size="15" /> Excluir
        </button>
        <button type="button" class="btn btn-ghost" @click="close">Cancelar</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ editing ? 'Salvar' : sameAsExisting ? 'Usar esta categoria' : 'Criar categoria' }}</button>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.cat-dialog {
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
  gap: 16px;
  align-items: flex-start;
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
.same-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--primary-text);
}
.hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 16px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-3);
}
.hint :deep(.app-icon) {
  flex: none;
  margin-top: 2px;
}
.hint code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-2);
  overflow-wrap: anywhere;
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
