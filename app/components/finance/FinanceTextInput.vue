<script setup lang="ts">
/**
 * Campo de texto das Finanças com "#" (1.7.1): ao digitar "#", a lista das categorias do
 * app (a mesma do "#" das notas) abre embaixo; a escolhida (ou criada ali) vira a
 * categoria do lançamento e o "#texto" sai do campo ("Feira #Mercado" → "Feira",
 * categoria Mercado). Usado na descrição dos lançamentos, das recorrências e da prévia
 * do extrato.
 */
import { ref } from 'vue'
import { useMentionTrigger, type MentionPickerControls } from '~/composables/useMentionTrigger'
import type { MentionTarget } from '~/lib/editor/host'
import { idOf } from '~/lib/notes/mention-links'
import { useFinanceStore } from '~/stores/finance'

const model = defineModel<string>({ required: true })
const props = withDefaults(defineProps<{ placeholder?: string; maxlength?: number; label: string; list?: string; inputClass?: string; field?: string; inputId?: string }>(), {
  placeholder: '',
  maxlength: 200,
  list: undefined,
  inputClass: 'input',
  field: undefined,
  inputId: undefined,
})
const emit = defineEmits<{ category: [id: string]; keydown: [event: KeyboardEvent]; input: [] }>()

const finance = useFinanceStore()
const input = ref<HTMLInputElement>()
const picker = ref<MentionPickerControls>()

const hash = useMentionTrigger({
  trigger: '#',
  getText: () => model.value,
  setText: (value) => (model.value = value),
  element: () => input.value,
})
const query = hash.query

function pick(target: MentionTarget) {
  const found = idOf(target.path)
  hash.replace('')
  if (found?.kind !== 'category') return
  const category = finance.attachCategory(found.id)
  if (category) emit('category', category.id)
}

function onKeydown(event: KeyboardEvent) {
  if (hash.onKeydown(event, picker.value)) return
  emit('keydown', event)
}

function onInput() {
  hash.onInput()
  emit('input')
}

defineExpose({
  focus: () => input.value?.focus(),
  select: () => input.value?.select(),
  element: () => input.value,
})
</script>

<template>
  <input
    :id="props.inputId"
    ref="input"
    v-model="model"
    :class="props.inputClass"
    :list="props.list"
    :maxlength="props.maxlength"
    :placeholder="props.placeholder"
    :aria-label="props.label"
    :data-field="props.field"
    autocomplete="off"
    @input="onInput"
    @keydown="onKeydown"
  />
  <CategoryMentionPicker v-if="query !== null && input" ref="picker" :anchor="input" :query="query" @pick="pick" @close="hash.close()" />
</template>
