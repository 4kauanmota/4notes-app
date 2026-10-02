<script setup lang="ts">
/** Seletor de cor da paleta do app (categorias de tarefas, nós do mapa). */
import { PALETTE, PALETTE_LABELS, type PaletteColor } from '~/lib/colors'

const props = withDefaults(
  defineProps<{
    modelValue: PaletteColor | null
    /** Mostra a opção "Padrão" (sem cor). */
    allowNone?: boolean
    noneLabel?: string
    size?: number
    label?: string
  }>(),
  { allowNone: false, noneLabel: 'Padrão', size: 30, label: 'Cor' },
)
const emit = defineEmits<{ 'update:modelValue': [value: PaletteColor | null] }>()

const pick = (value: PaletteColor | null) => {
  if (value !== props.modelValue) emit('update:modelValue', value)
}
</script>

<template>
  <div class="swatches" role="radiogroup" :aria-label="label" :style="{ '--size': `${size}px` }">
    <button
      v-if="allowNone"
      type="button"
      class="swatch none"
      role="radio"
      :aria-checked="modelValue === null"
      :class="{ active: modelValue === null }"
      :aria-label="noneLabel"
      :data-tip="noneLabel"
      data-tip-pos="top"
      @click="pick(null)"
    >
      <AppIcon v-if="modelValue === null" name="check" :size="size * 0.46" :stroke="2.6" />
    </button>
    <button
      v-for="option in PALETTE"
      :key="option"
      type="button"
      class="swatch"
      role="radio"
      :aria-checked="modelValue === option"
      :class="{ active: modelValue === option }"
      :style="{ '--c': `var(--cat-${option})` }"
      :data-color="option"
      :aria-label="PALETTE_LABELS[option]"
      :data-tip="PALETTE_LABELS[option]"
      data-tip-pos="top"
      @click="pick(option)"
    >
      <AppIcon v-if="modelValue === option" name="check" :size="size * 0.46" :stroke="2.6" />
    </button>
  </div>
</template>

<style scoped>
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--size) * 0.27);
}
.swatch {
  display: grid;
  place-items: center;
  width: var(--size);
  height: var(--size);
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--c);
  color: #fff;
  cursor: pointer;
  transition: transform var(--t-fast) var(--ease-spring), box-shadow var(--t-fast);
}
.swatch:hover {
  transform: scale(1.1);
}
.swatch.active {
  box-shadow: 0 0 0 3px var(--elevated), 0 0 0 5px var(--c);
}
.swatch.none {
  --c: var(--border-strong);
  background: repeating-linear-gradient(135deg, var(--surface-3) 0 4px, var(--surface) 4px 8px);
  box-shadow: inset 0 0 0 1.5px var(--border-strong);
  color: var(--text-2);
}
.swatch.none.active {
  box-shadow: inset 0 0 0 1.5px var(--border-strong), 0 0 0 3px var(--elevated), 0 0 0 5px var(--text-3);
}
</style>
