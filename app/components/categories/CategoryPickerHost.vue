<script setup lang="ts">
/**
 * Mostra o seletor de categorias pedido por `pickCategory` (composables/useCategoryPicker.ts):
 * num balão perto do botão (ou do clique) no computador e numa folha que sobe de baixo
 * no celular (layout compact). Clicar fora ou Esc fecha; com um diálogo por baixo, o Esc
 * fecha só o seletor.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { markPickerClosed, pickerRequest, type PickerRequest } from '~/composables/useCategoryPicker'
import { useLayoutSize } from '~/composables/useLayoutSize'
import { closeModal, isTopModal, openModal } from '~/composables/useModalStack'

const { isCompact } = useLayoutSize()
const id = Symbol('category-picker')
const layer = ref(1400)
const popover = ref<HTMLElement>()
const position = ref<{ left: number; top: number; maxHeight: number } | null>(null)

const WIDTH = 300
const MAX_HEIGHT = 380
const GAP = 6
const MARGIN = 8

const request = computed(() => pickerRequest.value)

function close(target: EventTarget | null = null) {
  const current = pickerRequest.value
  if (!current) return
  markPickerClosed(target)
  current.resolve(current.multiple ? current.selected : null)
}

function place(current: PickerRequest) {
  const { rect } = current
  const vw = window.innerWidth
  const vh = window.innerHeight
  const below = vh - rect.bottom - GAP - MARGIN
  const above = rect.top - GAP - MARGIN
  const openUp = below < 240 && above > below
  const maxHeight = Math.max(160, Math.min(MAX_HEIGHT, openUp ? above : below))
  const left = Math.min(Math.max(MARGIN, rect.left), vw - WIDTH - MARGIN)
  const top = openUp ? rect.top - GAP - maxHeight : rect.bottom + GAP
  position.value = { left, top, maxHeight }
  // Abrindo para cima, o balão encosta no botão mesmo quando a lista é curta
  if (openUp)
    void nextTick(() => {
      const height = popover.value?.offsetHeight
      if (height && position.value) position.value = { ...position.value, top: rect.top - GAP - height }
    })
}

function onPointerDown(event: PointerEvent) {
  if (!pickerRequest.value || isCompact.value) return
  const target = event.target as Node | null
  if (target && popover.value?.contains(target)) return
  // Um menu do botão direito aberto pelo seletor (editar, excluir) não fecha o seletor
  if ((target as Element | null)?.closest?.('.ctx-menu, .modal-backdrop, .sheet-backdrop')) return
  close(event.target)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !pickerRequest.value || !isTopModal(id) || event.defaultPrevented) return
  event.preventDefault()
  event.stopImmediatePropagation()
  close()
}

function onResize() {
  if (pickerRequest.value && !isCompact.value) place(pickerRequest.value)
}

watch(
  request,
  (current, previous) => {
    if (current && !previous) {
      layer.value = 1400 + openModal(id)
      window.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('keydown', onKeydown, true)
      window.addEventListener('resize', onResize)
    } else if (!current && previous) {
      closeModal(id)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeydown, true)
      window.removeEventListener('resize', onResize)
    }
    if (current) place(current)
  },
  { flush: 'sync' },
)

onBeforeUnmount(() => {
  closeModal(id)
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <template v-if="isCompact">
    <UiSheet :open="!!request" :label="request?.title" @close="close()">
      <div v-if="request" class="sheet-picker">
        <div class="sheet-title">{{ request.title }}</div>
        <CategoryPickerPanel :key="request.source.module + request.rect.top" :request="request" @close="close()" />
      </div>
    </UiSheet>
  </template>
  <Teleport v-else to="body">
    <Transition name="picker">
      <div
        v-if="request && position"
        ref="popover"
        class="picker-pop"
        role="dialog"
        :aria-label="request.title"
        data-category-picker
        :style="{ left: `${position.left}px`, top: `${position.top}px`, maxHeight: `${position.maxHeight}px`, zIndex: layer }"
      >
        <CategoryPickerPanel :key="`${request.source.module}:${request.rect.left}:${request.rect.top}`" :request="request" @close="close()" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.picker-pop {
  position: fixed;
  display: flex;
  flex-direction: column;
  width: 300px;
  max-width: calc(100vw - 16px);
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.picker-pop > :deep(.picker) {
  max-height: inherit;
}
.picker-enter-active {
  transition:
    opacity 120ms var(--ease-out),
    transform 140ms var(--ease-out);
}
.picker-leave-active {
  transition: opacity 90ms ease;
}
.picker-enter-from {
  opacity: 0;
  transform: translateY(-4px) scale(0.985);
}
.picker-leave-to {
  opacity: 0;
}
.sheet-picker {
  display: flex;
  flex-direction: column;
  height: min(72vh, 560px);
}
.sheet-picker > :deep(.picker) {
  flex: 1;
  min-height: 0;
  max-height: none;
}
.sheet-title {
  padding: 0 16px 6px;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 650;
}
@media (prefers-reduced-motion: reduce) {
  .picker-enter-active,
  .picker-leave-active {
    transition: none;
  }
}
</style>
