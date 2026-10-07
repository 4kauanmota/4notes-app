<script setup lang="ts">
/**
 * Escolha do ícone de uma categoria (Notas ou Links): a inicial do nome
 * ou um dos ícones prontos de lib/category-icons.ts, desenhados na cor escolhida.
 */
import { computed } from 'vue'
import { CATEGORY_ICONS } from '~/lib/category-icons'
import { paletteVar, type PaletteColor } from '~/lib/colors'

const props = withDefaults(
  defineProps<{
    /** Ícone escolhido; null = a inicial do nome. */
    modelValue: string | null
    color: PaletteColor
    /** Nome da categoria (a opção "Inicial" mostra a primeira letra dele). */
    name?: string
    label?: string
  }>(),
  { name: '', label: 'Ícone' },
)
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const initial = computed(() => Array.from(props.name.trim())[0]?.toLocaleUpperCase('pt-BR') ?? 'A')
const pick = (value: string | null) => {
  if (value !== props.modelValue) emit('update:modelValue', value)
}
</script>

<template>
  <div class="icon-picker" role="radiogroup" :aria-label="label" :style="{ '--c': paletteVar(color) }">
    <button
      type="button"
      class="option"
      role="radio"
      :class="{ active: modelValue === null }"
      :aria-checked="modelValue === null"
      data-icon=""
      data-tip="Inicial do nome"
      data-tip-pos="top"
      aria-label="Inicial do nome"
      @click="pick(null)"
    >
      <span class="initial">{{ initial }}</span>
    </button>
    <button
      v-for="icon in CATEGORY_ICONS"
      :key="icon.name"
      type="button"
      class="option"
      role="radio"
      :class="{ active: modelValue === icon.name }"
      :aria-checked="modelValue === icon.name"
      :data-icon="icon.name"
      :data-tip="icon.label"
      data-tip-pos="top"
      :aria-label="icon.label"
      @click="pick(icon.name)"
    >
      <AppIcon :name="icon.name" :size="17" :stroke="1.9" />
    </button>
  </div>
</template>

<style scoped>
.icon-picker {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 4px;
}
.option {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  padding: 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast) var(--ease-out);
}
.option:hover {
  background: var(--hover);
  color: var(--text);
}
.option.active {
  background: color-mix(in srgb, var(--c) 18%, var(--surface));
  color: var(--c);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c) 70%, transparent);
}
.initial {
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}
</style>
