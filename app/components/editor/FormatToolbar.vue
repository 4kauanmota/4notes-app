<script setup lang="ts">
/**
 * Barra de formatação que aparece sobre o texto selecionado (como no Notion).
 * Só mostra botões e avisa o que foi clicado — quem aplica é o MarkdownEditor.
 * O mousedown é cancelado para o editor não perder o foco nem a seleção.
 */
import { computed, ref, watch } from 'vue'
import { PALETTE, PALETTE_LABELS, paletteVar, type PaletteColor } from '~/lib/colors'
import type { InlineFormat, LineFormat } from '~/lib/editor/formatting'
import { modKeyLabel } from '~/lib/platform'

const props = defineProps<{
  x: number
  y: number
  /** true = abaixo da seleção (quando não há espaço acima). */
  below: boolean
  active: { formats: Set<InlineFormat>; color: string | null }
}>()

const emit = defineEmits<{
  inline: [format: InlineFormat]
  color: [color: PaletteColor | null]
  line: [format: LineFormat]
  link: []
  clear: []
}>()

const mod = modKeyLabel()
const paletteOpen = ref(false)
watch(
  () => [props.x, props.y],
  () => (paletteOpen.value = false),
)

const inlineButtons = computed(() => [
  { format: 'bold' as const, icon: 'bold', label: `Negrito (${mod}+B)` },
  { format: 'italic' as const, icon: 'italic', label: `Itálico (${mod}+I)` },
  { format: 'underline' as const, icon: 'underline', label: `Sublinhado (${mod}+U)` },
  { format: 'strike' as const, icon: 'strike', label: `Tachado (${mod}+Shift+X)` },
])
const lineButtons = [
  { format: 'heading' as const, icon: 'heading', label: 'Título' },
  { format: 'bullet' as const, icon: 'list', label: 'Lista' },
  { format: 'task' as const, icon: 'checklist', label: 'Lista de tarefas' },
]

const currentColor = computed(() => {
  const color = props.active.color
  return color && (PALETTE as readonly string[]).includes(color) ? (color as PaletteColor) : null
})

function pickColor(color: PaletteColor | null) {
  emit('color', color)
  paletteOpen.value = false
}
</script>

<template>
  <div
    class="format-toolbar"
    :class="{ below }"
    :style="{ left: `${x}px`, top: `${y}px` }"
    role="toolbar"
    aria-label="Formatação do texto"
    @mousedown.prevent
  >
    <div class="row">
      <button
        v-for="item in inlineButtons"
        :key="item.format"
        class="fmt-btn"
        :class="{ on: active.formats.has(item.format) }"
        :data-format="item.format"
        :data-tip="item.label"
        data-tip-pos="top"
        :aria-label="item.label"
        :aria-pressed="active.formats.has(item.format)"
        @click="emit('inline', item.format)"
      >
        <AppIcon :name="item.icon" :size="16" :stroke="item.format === 'bold' ? 2.4 : 2" />
      </button>
      <span class="sep" />
      <button
        class="fmt-btn color-btn"
        :class="{ on: paletteOpen }"
        data-format="color"
        data-tip="Cor do texto"
        data-tip-pos="top"
        aria-label="Cor do texto"
        :aria-expanded="paletteOpen"
        @click="paletteOpen = !paletteOpen"
      >
        <AppIcon name="text-color" :size="15" :stroke="2" />
        <span class="color-bar" :style="{ background: currentColor ? paletteVar(currentColor) : 'var(--text-3)' }" />
      </button>
      <button
        class="fmt-btn"
        :class="{ on: active.formats.has('highlight') }"
        data-format="highlight"
        :data-tip="`Marca-texto (${mod}+Shift+H)`"
        data-tip-pos="top"
        aria-label="Marca-texto"
        @click="emit('inline', 'highlight')"
      >
        <AppIcon name="highlighter" :size="16" :stroke="1.9" />
      </button>
      <span class="sep" />
      <button
        v-for="item in lineButtons"
        :key="item.format"
        class="fmt-btn"
        :data-format="item.format"
        :data-tip="item.label"
        data-tip-pos="top"
        :aria-label="item.label"
        @click="emit('line', item.format)"
      >
        <AppIcon :name="item.icon" :size="16" :stroke="1.9" />
      </button>
      <span class="sep" />
      <button
        class="fmt-btn"
        :class="{ on: active.formats.has('code') }"
        data-format="code"
        :data-tip="`Código (${mod}+E)`"
        data-tip-pos="top"
        aria-label="Código"
        @click="emit('inline', 'code')"
      >
        <AppIcon name="code" :size="16" :stroke="2" />
      </button>
      <button class="fmt-btn" data-format="link" data-tip="Link" data-tip-pos="top" aria-label="Link" @click="emit('link')">
        <AppIcon name="link" :size="16" :stroke="1.9" />
      </button>
      <button class="fmt-btn" data-format="clear" data-tip="Limpar formatação" data-tip-pos="top" aria-label="Limpar formatação" @click="emit('clear')">
        <AppIcon name="clear-format" :size="16" :stroke="1.9" />
      </button>
    </div>

    <div v-if="paletteOpen" class="palette" role="radiogroup" aria-label="Cor do texto">
      <button class="swatch default" role="radio" :aria-checked="!active.color" data-tip="Cor padrão" data-tip-pos="top" aria-label="Cor padrão" @click="pickColor(null)">
        <span class="default-a">A</span>
      </button>
      <button
        v-for="color in PALETTE"
        :key="color"
        class="swatch"
        role="radio"
        :aria-checked="currentColor === color"
        :class="{ on: currentColor === color }"
        :style="{ '--c': paletteVar(color) }"
        :data-color="color"
        :data-tip="PALETTE_LABELS[color]"
        data-tip-pos="top"
        :aria-label="PALETTE_LABELS[color]"
        @click="pickColor(color)"
      />
    </div>
  </div>
</template>

<style scoped>
.format-toolbar {
  position: absolute;
  z-index: 30;
  display: flex;
  flex-direction: column-reverse;
  gap: 4px;
  padding: 4px;
  border-radius: 11px;
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  transform: translate(-50%, -100%);
  animation: toolbar-in 140ms var(--ease-out);
  cursor: default;
  user-select: none;
}
.format-toolbar.below {
  flex-direction: column;
  transform: translate(-50%, 0);
}
.row {
  display: flex;
  align-items: center;
  gap: 1px;
}
.sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--border);
}
.fmt-btn {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}
.fmt-btn:hover {
  background: var(--hover);
  color: var(--text);
}
.fmt-btn.on {
  background: var(--primary-soft);
  color: var(--primary-text);
}
.color-btn {
  grid-template-rows: 1fr auto;
  padding: 5px 0 5px;
}
.color-bar {
  width: 14px;
  height: 3px;
  border-radius: 2px;
}
.palette {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 2px;
}
.swatch {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--c);
  cursor: pointer;
  transition: transform var(--t-fast) var(--ease-spring), box-shadow var(--t-fast);
}
.swatch:hover {
  transform: scale(1.12);
}
.swatch.on {
  box-shadow: 0 0 0 2px var(--elevated), 0 0 0 4px var(--c);
}
.swatch.default {
  background: var(--surface-3);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}
.default-a {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}
@keyframes toolbar-in {
  from {
    opacity: 0;
  }
}
</style>
