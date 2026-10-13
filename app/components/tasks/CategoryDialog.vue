<script setup lang="ts">
/**
 * Criar ou editar uma categoria (nome + cor). Por padrão, as das Tarefas; com
 * `source`, as de outro módulo (o Timer usa o mesmo diálogo para as dele).
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { CategorySource, ColorCategory } from '~/lib/category-source'
import { CATEGORY_COLORS, type CategoryColor } from '~/lib/tasks/model'
import { useTasksStore } from '~/stores/tasks'

const props = defineProps<{
  open: boolean
  category?: ColorCategory | null
  /** De onde são as categorias (padrão: as das Tarefas). */
  source?: CategorySource
  /** Exemplo no campo do nome. */
  placeholder?: string
}>()
const emit = defineEmits<{ close: []; saved: [category: ColorCategory] }>()
const tasks = useTasksStore()

/** As categorias das Tarefas, no formato do diálogo. */
const taskSource: CategorySource = {
  get categories() {
    return tasks.state.categories
  },
  add: (name, color) => tasks.addCategory(name, color),
  update: (id, patch) => tasks.updateCategory(id, patch),
  requestDelete: (id) => tasks.requestDeleteCategory(id),
}
const categories = computed(() => props.source ?? taskSource)

const name = ref('')
const color = ref<CategoryColor>('purple')
const error = ref<string | null>(null)
const input = ref<HTMLInputElement>()

function suggestColor(): CategoryColor {
  const used = new Set(categories.value.categories.map((c) => c.color))
  return CATEGORY_COLORS.find((c) => !used.has(c)) ?? 'purple'
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    name.value = props.category?.name ?? ''
    color.value = props.category?.color ?? suggestColor()
    error.value = null
    await nextTick()
    input.value?.focus()
    input.value?.select()
  },
)

function save() {
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = 'Dê um nome à categoria.'
    return
  }
  const duplicate = categories.value.categories.find((c) => c.id !== props.category?.id && c.name.toLocaleLowerCase('pt-BR') === trimmed.toLocaleLowerCase('pt-BR'))
  if (duplicate) {
    error.value = 'Já existe uma categoria com esse nome.'
    return
  }
  if (props.category) {
    categories.value.update(props.category.id, { name: trimmed, color: color.value })
    emit('saved', props.category)
  } else {
    emit('saved', categories.value.add(trimmed, color.value))
  }
  emit('close')
}

/** Excluir (só ao editar): fecha este diálogo e pede confirmação. */
function remove() {
  const id = props.category?.id
  emit('close')
  if (id) void categories.value.requestDelete(id)
}
</script>

<template>
  <UiModal :open="open" :width="390" :label="category ? 'Editar categoria' : 'Nova categoria'" @close="emit('close')">
    <form class="cat-dialog" @submit.prevent="save">
      <h2>{{ category ? 'Editar categoria' : 'Nova categoria' }}</h2>

      <label class="field-label" for="cat-name">Nome</label>
      <input id="cat-name" ref="input" v-model="name" class="input" :placeholder="placeholder ?? 'Ex.: Faculdade'" maxlength="40" @input="error = null" />
      <Transition name="fade"><p v-if="error" class="error">{{ error }}</p></Transition>

      <span class="field-label colors-label">Cor</span>
      <ColorSwatches :model-value="color" label="Cor da categoria" @update:model-value="(value) => value && (color = value)" />

      <div class="preview">
        <CategoryDot :color="color" :size="10" />
        <span>{{ name.trim() || 'Nome da categoria' }}</span>
      </div>

      <div class="actions">
        <button v-if="category" type="button" class="btn btn-danger-ghost delete-btn" @click="remove">
          <AppIcon name="trash" :size="15" /> Excluir
        </button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Cancelar</button>
        <button type="submit" class="btn btn-primary">{{ category ? 'Salvar' : 'Criar categoria' }}</button>
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
.error {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--danger);
}
.colors-label {
  margin-top: 16px;
}
.preview {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 18px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-weight: 550;
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
