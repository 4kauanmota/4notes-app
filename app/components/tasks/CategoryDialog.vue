<script setup lang="ts">
/**
 * Criar ou editar uma categoria (nome + cor). Por padrão, as das Tarefas; com
 * `source`, as de outro módulo (o Timer usa o mesmo diálogo para as dele).
 * As categorias são as do app inteiro (1.7.0): ao criar, dá para usar uma que já
 * existe (de outro módulo); ao editar, a mudança vale em todos os módulos.
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { CategorySource, ColorCategory } from '~/lib/category-source'
import { CATEGORY_COLORS, type CategoryColor } from '~/lib/tasks/model'
import { useCategoriesStore } from '~/stores/categories'
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
const shared = useCategoriesStore()

/** As categorias das Tarefas, no formato do diálogo. */
const taskSource: CategorySource = {
  module: 'tasks',
  get categories() {
    return tasks.state.categories
  },
  add: (name, color) => tasks.addCategory(name, color),
  attach: (id) => tasks.attachCategory(id),
  update: (id, patch) => tasks.updateCategory(id, patch),
  requestDelete: (id) => tasks.requestDeleteCategory(id),
}
const categories = computed(() => props.source ?? taskSource)

/** Nome digitado igual ao de uma categoria do app que ainda não está neste módulo: ela é usada. */
const sameAsExisting = computed(() => {
  if (props.category) return null
  const found = shared.findByName(name.value)
  return found && !categories.value.categories.some((item) => item.id === found.id) ? found : null
})

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

async function save() {
  const trimmed = name.value.trim()
  if (sameAsExisting.value) return useExisting(sameAsExisting.value.id)
  const problem = shared.nameProblem(trimmed, props.category?.id ?? null)
  if (problem) {
    error.value = problem
    return
  }
  if (props.category) {
    const current = props.category
    emit('close')
    if ((await categories.value.update(current.id, { name: trimmed, color: color.value })) !== false) emit('saved', current)
    return
  }
  const created = categories.value.add(trimmed, color.value)
  if (!created) return
  emit('saved', created)
  emit('close')
}

/** "Usar uma categoria que já existe": ela passa a aparecer neste módulo. */
function useExisting(id: string) {
  const category = categories.value.attach(id)
  if (!category) return
  emit('saved', category)
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
      <p v-if="sameAsExisting" class="same-hint">
        <AppIcon name="tag" :size="13" /> “{{ sameAsExisting.name }}” já existe no app: ao confirmar, ela é usada aqui (com a cor dela).
      </p>

      <span class="field-label colors-label">Cor</span>
      <ColorSwatches :model-value="color" label="Cor da categoria" @update:model-value="(value) => value && (color = value)" />

      <div class="preview">
        <CategoryDot :color="color" :size="10" />
        <span>{{ name.trim() || 'Nome da categoria' }}</span>
      </div>

      <ExistingCategories v-if="!category" :module="categories.module" :query="name" @pick="useExisting" />
      <CategoryShareInfo v-else :id="category.id" :module="categories.module" @leave="emit('close')" />

      <div class="actions">
        <button v-if="category" type="button" class="btn btn-danger-ghost delete-btn" @click="remove">
          <AppIcon name="trash" :size="15" /> Excluir
        </button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Cancelar</button>
        <button type="submit" class="btn btn-primary">{{ category ? 'Salvar' : sameAsExisting ? 'Usar esta categoria' : 'Criar categoria' }}</button>
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
.same-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--primary-text);
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
