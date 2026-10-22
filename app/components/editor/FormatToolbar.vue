<script setup lang="ts">
/**
 * Barra de formatação que aparece sobre o texto selecionado (como no Notion).
 * Só mostra botões e avisa o que foi clicado — quem aplica é o MarkdownEditor
 * (inclusive o "Bloco de texto" e o "Bloco de código", que transformam a seleção num bloco).
 * O mousedown é cancelado para o editor não perder o foco nem a seleção (menos no
 * campo do endereço do link, que precisa do foco para receber o texto).
 *
 * `docked` (toque/celular): a barra fica fixa embaixo da nota, acima do teclado, rolando
 * para o lado quando não cabe; ganha "Imagem" e, num link, "Abrir" (no desktop isso fica
 * no botão direito e no Ctrl + clique).
 */
import { computed, nextTick, ref, watch } from 'vue'
import { PALETTE, PALETTE_LABELS, paletteVar, type PaletteColor } from '~/lib/colors'
import type { ActiveFormats, InlineFormat, LineFormat } from '~/lib/editor/formatting'
import { modKeyLabel } from '~/lib/platform'

const props = defineProps<{
  x: number
  y: number
  /** true = abaixo da seleção (quando não há espaço acima). */
  below: boolean
  active: ActiveFormats
  /** Editando o endereço do link (campo no lugar dos botões). */
  linkMode: boolean
  /** Endereço inicial do campo (o do link atual ou um copiado). */
  linkInitial: string
  /** A seleção pode virar um bloco de texto ou de código (fora de blocos de código/texto). */
  textBlock: boolean
  /** A seleção tem formatação removível: só então o "Limpar formatação" aparece (1.7.0). */
  clearable?: boolean
  /** Fixa embaixo da nota (toque). */
  docked?: boolean
  /** Largura máxima: num editor estreito, os botões quebram em duas fileiras. */
  maxWidth?: number | null
}>()

const emit = defineEmits<{
  inline: [format: InlineFormat]
  color: [color: PaletteColor | null]
  line: [format: LineFormat]
  'open-link': []
  link: [url: string]
  unlink: []
  'close-link': []
  clear: []
  'text-block': []
  'code-block': []
  image: []
  'open-url': [url: string]
}>()

const mod = modKeyLabel()
const paletteOpen = ref(false)
const linkInput = ref<HTMLInputElement>()
const linkValue = ref('')
watch(
  () => [props.x, props.y],
  () => (paletteOpen.value = false),
)
watch(
  () => props.linkMode,
  async (open) => {
    if (!open) return
    linkValue.value = props.linkInitial
    await nextTick()
    linkInput.value?.focus()
    linkInput.value?.select()
  },
  { immediate: true },
)

function onMouseDown(event: MouseEvent) {
  // Só o campo do link pode receber o foco; o resto não tira a seleção do editor
  if (!(event.target as HTMLElement).closest('input')) event.preventDefault()
}

function submitLink() {
  const url = linkValue.value.trim()
  if (url) emit('link', url)
  else if (props.active.link) emit('unlink')
  else emit('close-link')
}

function onLinkKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close-link')
  }
}

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
    :class="{ below: below && !docked, docked, wrap: !docked && !!maxWidth }"
    :style="docked ? undefined : { left: `${x}px`, top: `${y}px`, maxWidth: maxWidth ? `${maxWidth}px` : undefined }"
    role="toolbar"
    aria-label="Formatação do texto"
    @mousedown="onMouseDown"
  >
    <form v-if="linkMode" class="row link-row" @submit.prevent="submitLink">
      <AppIcon name="link" :size="15" class="link-icon" />
      <input
        ref="linkInput"
        v-model="linkValue"
        class="link-input"
        placeholder="Cole ou digite o endereço (https://…)"
        spellcheck="false"
        aria-label="Endereço do link"
        @keydown="onLinkKeydown"
      />
      <button v-if="docked && active.link" type="button" class="fmt-btn" aria-label="Abrir o link" data-action="open-link" @click="emit('open-url', active.link)">
        <AppIcon name="external" :size="16" :stroke="1.9" />
      </button>
      <button type="submit" class="fmt-btn" data-tip="Aplicar (Enter)" data-tip-pos="top" aria-label="Aplicar link">
        <AppIcon name="check" :size="16" :stroke="2.2" />
      </button>
      <button v-if="active.link" type="button" class="fmt-btn" data-tip="Remover link" data-tip-pos="top" aria-label="Remover link" @click="emit('unlink')">
        <AppIcon name="unlink" :size="16" :stroke="1.9" />
      </button>
      <button type="button" class="fmt-btn" data-tip="Cancelar (Esc)" data-tip-pos="top" aria-label="Cancelar" @click="emit('close-link')">
        <AppIcon name="x" :size="15" :stroke="2" />
      </button>
    </form>
    <div v-else class="row">
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
      <button
        v-if="textBlock"
        class="fmt-btn"
        data-format="text-block"
        data-tip="Bloco de texto"
        data-tip-pos="top"
        aria-label="Bloco de texto"
        @click="emit('text-block')"
      >
        <AppIcon name="text-block" :size="16" :stroke="1.9" />
      </button>
      <button
        v-if="textBlock"
        class="fmt-btn"
        data-format="code-block"
        data-tip="Bloco de código"
        data-tip-pos="top"
        aria-label="Bloco de código"
        @click="emit('code-block')"
      >
        <AppIcon name="code-block" :size="16" :stroke="1.9" />
      </button>
      <button
        class="fmt-btn"
        :class="{ on: !!active.link }"
        data-format="link"
        :data-tip="active.link ? `Link: ${active.link}` : `Link (${mod}+K)`"
        data-tip-pos="top"
        aria-label="Link"
        @click="emit('open-link')"
      >
        <AppIcon name="link" :size="16" :stroke="1.9" />
      </button>
      <button v-if="docked" class="fmt-btn" data-format="image" aria-label="Inserir imagem" @click="emit('image')">
        <AppIcon name="image" :size="16" :stroke="1.9" />
      </button>
      <button v-if="clearable" class="fmt-btn" data-format="clear" data-tip="Limpar formatação" data-tip-pos="top" aria-label="Limpar formatação" @click="emit('clear')">
        <AppIcon name="clear-format" :size="16" :stroke="1.9" />
      </button>
    </div>

    <div v-if="paletteOpen && !linkMode" class="palette" role="radiogroup" aria-label="Cor do texto">
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
.link-row {
  gap: 4px;
  padding-left: 8px;
}
.link-icon {
  color: var(--primary-text);
}
.link-input {
  width: 260px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  outline: none;
  user-select: text;
}
.link-input:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
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
/* Editor estreito (ex.: descrição das tarefas): duas fileiras em vez de cortar a barra.
   max-content + max-width: a largura é a do editor, não a que sobra à direita do ponto */
.format-toolbar.wrap {
  width: max-content;
}
.format-toolbar.wrap .row:not(.link-row),
.format-toolbar.wrap .palette {
  flex-wrap: wrap;
  justify-content: center;
}
.format-toolbar.wrap .link-input {
  flex: 1;
  width: auto;
  min-width: 120px;
}
@keyframes toolbar-in {
  from {
    opacity: 0;
  }
}

/* ── Toque: fixa embaixo da nota ── */
.format-toolbar.docked {
  position: relative;
  flex: none;
  width: 100%;
  padding: 4px 6px;
  border-width: 1px 0 0;
  border-radius: 0;
  background: var(--chrome);
  box-shadow: none;
  transform: none;
  animation: none;
}
.docked .row {
  overflow-x: auto;
  scrollbar-width: none;
}
.docked .fmt-btn {
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 10px;
}
.docked .sep {
  flex: none;
}
.docked .link-row {
  padding-left: 6px;
}
.docked .link-input {
  flex: 1;
  width: auto;
  min-width: 0;
  height: 38px;
  font-size: 15px;
}
.docked .palette {
  flex-wrap: wrap;
  gap: 10px;
  padding: 6px 8px 4px;
}
.docked .swatch {
  width: 30px;
  height: 30px;
}
</style>
