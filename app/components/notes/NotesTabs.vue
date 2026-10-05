<script setup lang="ts">
/**
 * Abas das notas abertas (como no Bloco de Notas do Windows 11). Arraste para reordenar
 * — ou até uma categoria da lista lateral, para colocar a nota nela.
 * A aba de uma nota com categoria é marcada com a cor da categoria.
 * Com muitas abas, a faixa rola na horizontal (roda do mouse ou barra fina no topo).
 */
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { choiceDialog } from '~/composables/useDialog'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import { categorySubmenu, handleCategoryChoice, startNoteDrag } from '~/composables/useNoteCategories'
import { paletteVar } from '~/lib/colors'
import { modKeyLabel } from '~/lib/platform'
import { noteTitle, useNotesStore, type QuickNote } from '~/stores/notes'

const emit = defineEmits<{ new: [] }>()
const notes = useNotesStore()
const mod = modKeyLabel()
const scroller = ref<HTMLElement>()
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

// ── Rolagem horizontal ──────────────────────────────────────────────────────

const bar = reactive({ overflow: false, atStart: true, atEnd: true, thumbLeft: 0, thumbWidth: 0 })

function measure() {
  const el = scroller.value
  if (!el) return
  const { scrollWidth, clientWidth, scrollLeft } = el
  const max = scrollWidth - clientWidth
  bar.overflow = max > 1
  bar.atStart = scrollLeft <= 1
  bar.atEnd = scrollLeft >= max - 1
  if (!bar.overflow) return
  bar.thumbWidth = Math.max(36, (clientWidth / scrollWidth) * clientWidth)
  bar.thumbLeft = (scrollLeft / max) * (clientWidth - bar.thumbWidth)
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  resizeObserver = new ResizeObserver(measure)
  resizeObserver.observe(scroller.value!)
  if (scroller.value?.firstElementChild) resizeObserver.observe(scroller.value.firstElementChild)
  measure()
})
onBeforeUnmount(() => resizeObserver?.disconnect())

// Mantém a aba ativa visível
watch(
  () => notes.state.activeId,
  async (id) => {
    await nextTick()
    const el = scroller.value?.querySelector<HTMLElement>(`[data-tab="${id}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  },
)

function onWheel(event: WheelEvent) {
  if (!scroller.value || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
  scroller.value.scrollLeft += event.deltaY
}

function onThumbDown(event: PointerEvent) {
  const el = scroller.value
  if (!el) return
  const thumb = event.currentTarget as HTMLElement
  thumb.setPointerCapture(event.pointerId)
  const startX = event.clientX
  const startScroll = el.scrollLeft
  const ratio = (el.scrollWidth - el.clientWidth) / Math.max(1, el.clientWidth - bar.thumbWidth)
  const move = (e: PointerEvent) => {
    el.scrollLeft = startScroll + (e.clientX - startX) * ratio
  }
  const up = () => {
    thumb.removeEventListener('pointermove', move)
    thumb.removeEventListener('pointerup', up)
  }
  thumb.addEventListener('pointermove', move)
  thumb.addEventListener('pointerup', up)
}

function onTrackDown(event: PointerEvent) {
  const el = scroller.value
  if (!el || event.target !== event.currentTarget) return
  const x = event.clientX - (event.currentTarget as HTMLElement).getBoundingClientRect().left
  el.scrollBy({ left: (x < bar.thumbLeft ? -1 : 1) * el.clientWidth * 0.8, behavior: 'smooth' })
}

// ── Reordenar arrastando ────────────────────────────────────────────────────

function onDragStart(index: number, note: QuickNote, event: DragEvent) {
  dragIndex.value = index
  startNoteDrag(event, note.id)
  event.dataTransfer?.setData('text/plain', String(index))
}

/** Cor da categoria da nota (marca a aba), ou null. */
function categoryColor(note: QuickNote): string | null {
  const category = notes.categoryOf(note)
  return category ? paletteVar(category.color) : null
}

function onDragOver(index: number, event: DragEvent) {
  if (dragIndex.value === null) return
  event.preventDefault()
  dropIndex.value = index
}

function onDrop(index: number) {
  if (dragIndex.value !== null) notes.moveTab(dragIndex.value, index)
  dragIndex.value = null
  dropIndex.value = null
}

function onDragEnd() {
  dragIndex.value = null
  dropIndex.value = null
}

// ── Fechar ──────────────────────────────────────────────────────────────────

/**
 * X da aba: numa nota sem categoria, pergunta se ela deve ser guardada (só fecha a
 * aba) ou apagada. Nota com categoria é sempre guardada (apagar fica pela lixeira
 * da lista lateral).
 */
async function requestClose(note: QuickNote) {
  if (notes.isBlank(note) || notes.categoryOf(note)) {
    void notes.closeTab(note.id) // nada a guardar (aba vazia) ou nota de categoria: fecha guardando
    return
  }
  const choice = await choiceDialog({
    title: `Fechar “${noteTitle(note)}”`,
    message: 'Guardar fecha só a aba — a nota continua salva na lista de notas. Apagar envia o arquivo para a Lixeira.',
    icon: 'notes',
    buttons: [
      { id: 'cancel', label: 'Cancelar', variant: 'ghost' },
      { id: 'delete', label: 'Apagar nota', variant: 'danger' },
      { id: 'keep', label: 'Guardar nota', variant: 'primary' },
    ],
    defaultButton: 'keep',
  })
  if (choice === 'keep') void notes.closeTab(note.id)
  if (choice === 'delete') void notes.deleteNote(note.id)
}

async function openMenu(note: QuickNote) {
  const choice = await showContextMenu([
    { id: 'close', label: 'Fechar aba' },
    { id: 'close-others', label: 'Fechar as outras abas', enabled: notes.state.openIds.length > 1 },
    separator,
    categorySubmenu(note),
    { id: 'duplicate', label: 'Duplicar nota' },
    { id: 'reveal', label: 'Mostrar no Explorador', enabled: !!note.path },
    separator,
    { id: 'delete', label: 'Excluir nota', danger: true },
  ])
  if (handleCategoryChoice(choice, note)) return
  if (choice === 'close') void notes.closeTab(note.id)
  if (choice === 'close-others') notes.closeOtherTabs(note.id)
  if (choice === 'duplicate') notes.duplicateNote(note.id)
  if (choice === 'reveal') notes.revealNote(note.id)
  if (choice === 'delete') void notes.deleteNote(note.id)
}
</script>

<template>
  <div class="tabs-bar">
    <button
      class="icon-btn sidebar-toggle"
      :class="{ 'is-active': notes.state.sidebarOpen }"
      :data-tip="`Lista de notas (${mod}+\\)`"
      aria-label="Mostrar ou ocultar a lista de notas"
      @click="notes.toggleSidebar()"
    >
      <AppIcon name="sidebar" :size="17" />
    </button>

    <div class="tabs-area" :class="{ 'fade-start': bar.overflow && !bar.atStart, 'fade-end': bar.overflow && !bar.atEnd }">
      <div ref="scroller" class="tabs-scroll" @wheel.passive="onWheel" @scroll.passive="measure">
        <!-- A aba que sai fica "solta" durante a animação e aumenta a faixa: mede de novo no fim -->
        <TransitionGroup name="tab" tag="div" class="tabs" role="tablist" @after-leave="measure" @after-enter="measure">
          <div
            v-for="(note, index) in notes.openTabs.value"
            :key="note.id"
            class="tab"
            :class="{
              active: note.id === notes.state.activeId,
              dragging: dragIndex === index,
              'drop-target': dropIndex === index && dragIndex !== index,
              'has-category': !!categoryColor(note),
            }"
            :style="categoryColor(note) ? { '--tab-cat': categoryColor(note)! } : undefined"
            :data-tab="note.id"
            :data-category="notes.categoryOf(note)?.name"
            role="tab"
            :aria-selected="note.id === notes.state.activeId"
            :title="notes.categoryOf(note) ? `${noteTitle(note)} · ${notes.categoryOf(note)!.name}` : noteTitle(note)"
            draggable="true"
            @click="notes.activate(note.id)"
            @mousedown.middle.prevent="notes.closeTab(note.id)"
            @contextmenu.prevent="openMenu(note)"
            @dragstart="onDragStart(index, note, $event)"
            @dragover="onDragOver(index, $event)"
            @drop.prevent="onDrop(index)"
            @dragend="onDragEnd"
          >
            <span class="tab-title">{{ noteTitle(note) }}</span>
            <span class="tab-end">
              <span v-if="note.status !== 'saved'" class="tab-dot" :class="note.status" />
              <button class="tab-close" aria-label="Fechar aba" @click.stop="requestClose(note)">
                <AppIcon name="x" :size="12" :stroke="2" />
              </button>
            </span>
          </div>
        </TransitionGroup>
      </div>
      <div v-if="bar.overflow" class="tabs-track" @pointerdown="onTrackDown">
        <div class="tabs-thumb" :style="{ width: `${bar.thumbWidth}px`, transform: `translateX(${bar.thumbLeft}px)` }" @pointerdown="onThumbDown" />
      </div>
    </div>

    <button class="tab-new" :data-tip="`Nova nota (${mod}+N)`" aria-label="Nova nota" @click="emit('new')">
      <AppIcon name="plus" :size="16" />
    </button>
  </div>
</template>

<style scoped>
.tabs-bar {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 40px;
  padding: 0 8px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
.sidebar-toggle {
  margin-bottom: 4px;
  width: 28px;
  height: 28px;
}
.tabs-area {
  position: relative;
  flex: 0 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: flex-end;
}
.tabs-scroll {
  display: flex;
  align-items: flex-end;
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.tabs-scroll::-webkit-scrollbar {
  display: none;
}
/* Esmaece as pontas quando há abas escondidas para os lados */
.tabs-area.fade-start .tabs-scroll {
  mask-image: linear-gradient(90deg, transparent 0, #000 28px);
}
.tabs-area.fade-end .tabs-scroll {
  mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent 100%);
}
.tabs-area.fade-start.fade-end .tabs-scroll {
  mask-image: linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%);
}
.tabs {
  position: relative; /* a aba que está saindo (animação) fica dentro da faixa */
  display: flex;
  align-items: flex-end;
  flex: none;
}
.tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  width: 168px;
  height: 32px;
  margin-right: 2px;
  padding: 0 4px 0 12px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 9px 9px 0 0;
  color: var(--text-2);
  font-size: 12.5px;
  cursor: default;
  transition: background var(--t-fast), color var(--t-fast);
}
.tab:hover {
  background: var(--hover);
  color: var(--text);
}
.tab.active {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
  font-weight: 550;
  margin-bottom: -1px;
  height: 33px;
}
/* Indicador amarelo da aba ativa: embaixo, ocupando toda a largura da aba */
.tab.active::before {
  content: '';
  position: absolute;
  left: -1px;
  right: -1px;
  bottom: 0;
  height: 2.5px;
  background: linear-gradient(90deg, var(--accent-strong), var(--accent));
}
/* Nota com categoria: o indicador usa a cor da categoria (nas abas inativas, mais discreto) */
.tab.has-category::before {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--tab-cat);
  opacity: 0.7;
}
.tab.has-category.active::before {
  left: -1px;
  right: -1px;
  height: 2.5px;
  border-radius: 0;
  opacity: 1;
}
/* Separador discreto entre abas inativas */
.tab:not(.active)::after {
  content: '';
  position: absolute;
  right: -2px;
  top: 9px;
  bottom: 9px;
  width: 1px;
  background: var(--border-strong);
  transition: opacity var(--t-fast);
}
.tab:hover::after,
.tab:has(+ .tab.active)::after,
.tab:has(+ .tab:hover)::after {
  opacity: 0;
}
.tab.dragging {
  opacity: 0.45;
}
.tab.drop-target {
  box-shadow: inset 2px 0 0 var(--primary);
}
.tab-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-end {
  position: relative;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: none;
}
.tab-dot {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary);
  transition: opacity var(--t-fast);
}
.tab-dot.saving {
  animation: pulse 900ms ease-in-out infinite;
}
.tab-dot.error {
  background: var(--danger);
}
.tab-close {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-3);
  opacity: 0;
  cursor: pointer;
  transition: opacity var(--t-fast), background var(--t-fast), color var(--t-fast);
}
.tab.active .tab-close,
.tab:hover .tab-close {
  opacity: 1;
}
.tab:hover .tab-dot,
.tab.active .tab-dot {
  opacity: 0;
}
.tab:not(:hover):not(.active) .tab-dot + .tab-close {
  opacity: 0;
}
.tab-close:hover {
  background: var(--hover);
  color: var(--text);
}
/* Barra de rolagem fina no topo da faixa de abas */
.tabs-track {
  position: absolute;
  left: 0;
  right: 0;
  top: 1px;
  height: 5px;
  border-radius: 3px;
  opacity: 0.55;
  transition: opacity var(--t-fast);
}
.tabs-bar:hover .tabs-track {
  opacity: 1;
}
.tabs-thumb {
  height: 100%;
  border-radius: 3px;
  background: color-mix(in srgb, var(--text-3) 45%, transparent);
  cursor: default;
}
.tabs-thumb:hover,
.tabs-thumb:active {
  background: color-mix(in srgb, var(--text-3) 75%, transparent);
}
.tab-new {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  margin: 0 0 3px 2px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast), transform var(--t-fast) var(--ease-spring);
}
.tab-new:hover {
  background: var(--hover);
  color: var(--text);
}
.tab-new:active {
  transform: scale(0.88) rotate(90deg);
}

.tab-enter-active {
  transition: opacity 180ms var(--ease-out), transform 240ms var(--ease-spring);
}
.tab-leave-active {
  transition: opacity 120ms ease;
  position: absolute;
  pointer-events: none;
}
.tab-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.tab-leave-to {
  opacity: 0;
}
.tab-move {
  transition: transform 220ms var(--ease-out);
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
