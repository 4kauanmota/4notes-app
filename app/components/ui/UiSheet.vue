<script setup lang="ts">
/**
 * Folha que sobe da borda de baixo (celular): menus, "Mais", painéis.
 * Fecha tocando fora, arrastando a alça para baixo, com Esc ou com o "voltar" do
 * Android (que manda um Esc — composables/useBackButton.ts). Com uma folha ou modal
 * por cima de outro, só o de cima fecha.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { closeModal, isTopModal, openModal } from '~/composables/useModalStack'

const props = defineProps<{ open: boolean; label?: string }>()
const emit = defineEmits<{ close: [] }>()
const id = Symbol('sheet')
const layer = ref(950)
const drag = ref(0)
let startY: number | null = null

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || !isTopModal(id)) return
  event.preventDefault()
  event.stopImmediatePropagation()
  emit('close')
}

function setOpen(open: boolean) {
  if (open) {
    layer.value = 950 + openModal(id)
    window.addEventListener('keydown', onKeydown, true)
  } else {
    closeModal(id)
    window.removeEventListener('keydown', onKeydown, true)
    drag.value = 0
  }
}

watch(
  () => props.open,
  (open) => setOpen(open),
  { immediate: true },
)
onBeforeUnmount(() => setOpen(false))

// Arrastar a alça para baixo fecha
function onHandleDown(event: PointerEvent) {
  startY = event.clientY
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function onHandleMove(event: PointerEvent) {
  if (startY !== null) drag.value = Math.max(0, event.clientY - startY)
}
function onHandleUp() {
  if (startY === null) return
  startY = null
  if (drag.value > 70) emit('close')
  drag.value = 0
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="sheet-backdrop" :style="{ zIndex: layer }" @pointerdown.self="emit('close')">
        <div
          class="sheet-panel"
          role="dialog"
          aria-modal="true"
          :aria-label="label"
          :style="drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined"
        >
          <div class="sheet-handle" aria-hidden="true" @pointerdown="onHandleDown" @pointermove="onHandleMove" @pointerup="onHandleUp" @pointercancel="onHandleUp">
            <span />
          </div>
          <div class="sheet-body">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  background: var(--scrim);
}
.sheet-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 640px;
  max-height: calc(100dvh - var(--safe-top) - 40px);
  border-radius: 18px 18px 0 0;
  border: 1px solid var(--border);
  border-bottom: none;
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  transition: transform 220ms var(--ease-out);
}
.sheet-handle {
  display: grid;
  place-items: center;
  flex: none;
  height: 22px;
  touch-action: none;
}
.sheet-handle span {
  width: 36px;
  height: 4px;
  border-radius: 4px;
  background: var(--border-strong);
}
.sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 8px calc(10px + var(--safe-bottom));
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 200ms var(--ease-out);
}
.sheet-enter-active .sheet-panel,
.sheet-leave-active .sheet-panel {
  transition: transform 240ms var(--ease-out);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet-panel,
.sheet-leave-to .sheet-panel {
  transform: translateY(100%);
}
</style>
