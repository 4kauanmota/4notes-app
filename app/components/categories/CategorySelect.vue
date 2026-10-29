<script setup lang="ts">
/**
 * Campo de categoria (1.7.2): mostra a escolhida (ícone, foto ou inicial + nome) e abre o
 * seletor de categorias com busca (composables/useCategoryPicker.ts). Com `multiple`
 * (filtros), guarda uma lista (null = "sem categoria"; vazia = todas).
 */
import { computed, ref } from 'vue'
import { pickCategory, pickerJustClosedFrom, pickerRequest, NOTE_NAME_PREFIX } from '~/composables/useCategoryPicker'
import type { CategoryModuleId } from '~/lib/categories/model'
import type { PaletteColor } from '~/lib/colors'
import { useCategoriesStore } from '~/stores/categories'

type Value = string | null | (string | null)[]

const props = withDefaults(
  defineProps<{
    module: CategoryModuleId
    modelValue: Value
    multiple?: boolean
    allowNone?: boolean
    noneLabel?: string
    /** Texto com nada escolhido nos filtros. */
    allLabel?: string
    allowCreate?: boolean
    size?: 'md' | 'sm'
    /** Etiqueta depois do nome (ex.: "automática", na categoria sugerida das Finanças). */
    tag?: string | null
    disabled?: boolean
    label?: string
  }>(),
  {
    multiple: false,
    allowNone: true,
    noneLabel: 'Sem categoria',
    allLabel: 'Todas as categorias',
    allowCreate: undefined,
    size: 'md',
    tag: null,
    disabled: false,
    label: 'Categoria',
  },
)
const emit = defineEmits<{ 'update:modelValue': [value: Value]; picked: [id: string | null] }>()
const shared = useCategoriesStore()
const button = ref<HTMLButtonElement>()

const values = computed<(string | null)[]>(() => {
  const value = props.modelValue
  if (Array.isArray(value)) return value
  return props.multiple ? (value === undefined ? [] : [value]) : [value ?? null]
})

interface Shown {
  name: string
  color: PaletteColor
  icon: string | null
  image: string | null
}

function describe(id: string | null): Shown | null {
  if (!id) return null
  if (id.startsWith(NOTE_NAME_PREFIX)) return { name: id.slice(NOTE_NAME_PREFIX.length), color: 'gray', icon: null, image: null }
  const category = shared.resolveCategory(id)
  return category ? { name: category.name, color: category.color, icon: category.icon, image: category.image } : null
}

const first = computed(() => describe(values.value.find((id) => id !== null) ?? null))
const text = computed(() => {
  if (props.multiple) {
    const list = values.value
    if (!list.length) return props.allLabel
    const names = list.map((id) => (id === null ? props.noneLabel : (describe(id)?.name ?? props.noneLabel)))
    return list.length === 1 ? names[0]! : `${names[0]} +${list.length - 1}`
  }
  return first.value?.name ?? props.noneLabel
})
const empty = computed(() => (props.multiple ? !values.value.length : !first.value))
const open = computed(() => !!pickerRequest.value && openedHere.value)
const openedHere = ref(false)

async function toggle() {
  if (props.disabled) return
  if (pickerJustClosedFrom(button.value)) return
  openedHere.value = true
  try {
    const result = await pickCategory({
      module: props.module,
      selected: values.value,
      multiple: props.multiple,
      allowNone: props.allowNone,
      noneLabel: props.noneLabel,
      allowCreate: props.allowCreate,
      anchor: button.value,
      title: props.label,
      onChange: props.multiple ? (next) => emit('update:modelValue', next) : undefined,
    })
    if (!result || props.multiple) return
    emit('update:modelValue', result[0] ?? null)
    emit('picked', result[0] ?? null)
  } finally {
    openedHere.value = false
    button.value?.focus({ preventScroll: true })
  }
}

defineExpose({ open: toggle })
</script>

<template>
  <button
    ref="button"
    type="button"
    class="cat-select"
    :class="[size, { empty, open, multiple }]"
    :disabled="disabled"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-label="`${label}: ${text}`"
    :data-category-select="module"
    :data-value="multiple ? values.join(',') : (values[0] ?? '')"
    @click="toggle"
  >
    <CategoryAvatar v-if="first && !(multiple && values.length !== 1)" :name="first.name" :color="first.color" :icon="first.icon" :image="first.image" :size="size === 'sm' ? 16 : 18" />
    <AppIcon v-else-if="multiple" name="tag" :size="size === 'sm' ? 13 : 14" class="lead" />
    <span v-else class="none-dot" aria-hidden="true" />
    <span class="text">{{ text }}</span>
    <span v-if="tag && !empty" class="tag">{{ tag }}</span>
    <AppIcon name="chevron-down" :size="13" class="chevron" />
  </button>
</template>

<style scoped>
.cat-select {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  min-width: 0;
  height: 34px;
  padding: 0 10px 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--t-fast),
    box-shadow var(--t-fast),
    background var(--t-fast);
}
.cat-select.sm {
  height: 30px;
  gap: 6px;
  padding: 0 8px 0 7px;
  font-size: 12.5px;
}
html[data-touch] .cat-select {
  height: 40px;
}
html[data-touch] .cat-select.sm {
  height: 36px;
}
.cat-select:hover:not(:disabled) {
  border-color: var(--border-strong);
}
.cat-select.open,
.cat-select:focus-visible {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
  outline: none;
}
.cat-select:disabled {
  opacity: 0.55;
  cursor: default;
}
.cat-select.empty {
  color: var(--text-2);
}
.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.none-dot {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border: 1.5px dashed var(--border-strong);
  border-radius: 5px;
}
.sm .none-dot {
  width: 14px;
  height: 14px;
}
.lead {
  flex-shrink: 0;
  color: var(--text-3);
}
.tag {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 10.5px;
  font-weight: 650;
}
.chevron {
  flex-shrink: 0;
  margin-left: 2px;
  color: var(--text-3);
  transition: transform var(--t-fast);
}
.open .chevron {
  transform: rotate(180deg);
}
</style>
