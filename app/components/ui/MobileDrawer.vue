<script setup lang="ts">
/**
 * A lista lateral de um módulo (Tarefas, Links…). No celular (layout compact) ela vira
 * uma gaveta que entra pela esquerda, por cima do conteúdo: abre pelo botão de lista
 * do módulo e fecha tocando fora, arrastando para a esquerda, com o "voltar" do
 * Android (que manda um Esc — composables/useBackButton.ts) ou quando o módulo fecha
 * depois de você escolher algo nela.
 *
 * Nos outros tamanhos nada muda: o conteúdo fica no lugar de sempre (display: contents).
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { useLayoutSize } from '~/composables/useLayoutSize'
import { closeModal, isTopModal, openModal } from '~/composables/useModalStack'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ label: string }>()

const { isCompact } = useLayoutSize()
const id = Symbol('drawer')
const layer = ref(880)
/** Arrastando a gaveta para a esquerda (px, negativo). */
const drag = ref(0)
let start: { x: number; y: number; id: number; horizontal: boolean | null } | null = null

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || !isTopModal(id)) return
  event.preventDefault()
  event.stopImmediatePropagation()
  open.value = false
}

function setActive(active: boolean) {
  if (active) {
    layer.value = 880 + openModal(id)
    window.addEventListener('keydown', onKeydown, true)
  } else {
    closeModal(id)
    window.removeEventListener('keydown', onKeydown, true)
    drag.value = 0
    start = null
  }
}

watch(
  () => open.value && isCompact.value,
  (active) => setActive(active),
  { immediate: true },
)
// Abriu o Fold (a lista volta para o lado): a gaveta não fica "aberta" escondida
watch(isCompact, (compact) => {
  if (!compact) open.value = false
})
onBeforeUnmount(() => setActive(false))

// Arrastar para a esquerda fecha
function onPointerDown(event: PointerEvent) {
  if (!open.value || event.pointerType === 'mouse') return
  start = { x: event.clientX, y: event.clientY, id: event.pointerId, horizontal: null }
}
function onPointerMove(event: PointerEvent) {
  if (!start || event.pointerId !== start.id) return
  const dx = event.clientX - start.x
  const dy = event.clientY - start.y
  if (start.horizontal === null && Math.hypot(dx, dy) > 10) start.horizontal = Math.abs(dx) > Math.abs(dy) * 1.2
  if (start.horizontal) drag.value = Math.min(0, dx)
}
function onPointerUp(event: PointerEvent) {
  if (!start || event.pointerId !== start.id) return
  const closing = start.horizontal && drag.value < -70
  start = null
  drag.value = 0
  if (closing) open.value = false
}
</script>

<template>
  <Teleport to="body" :disabled="!isCompact">
    <Transition name="drawer-scrim">
      <div v-if="isCompact && open" class="drawer-scrim" :style="{ zIndex: layer }" aria-hidden="true" @pointerdown="open = false" />
    </Transition>
    <div
      class="module-drawer"
      :class="{ compact: isCompact, open: isCompact && open, dragging: drag !== 0 }"
      :style="isCompact ? { zIndex: layer + 1, transform: drag ? `translateX(${drag}px)` : undefined } : undefined"
      :role="isCompact ? 'dialog' : undefined"
      :aria-label="isCompact ? label : undefined"
      :aria-hidden="isCompact && !open ? 'true' : undefined"
      :inert="isCompact && !open"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.module-drawer {
  display: contents;
}
.module-drawer.compact {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  display: flex;
  width: min(86vw, 320px);
  padding: var(--safe-top) 0 var(--safe-bottom) var(--safe-left);
  background: var(--surface-2);
  border-radius: 0 18px 18px 0;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  transform: translateX(calc(-100% - 24px));
  visibility: hidden;
  transition:
    transform 260ms var(--ease-out),
    visibility 0s linear 260ms;
}
.module-drawer.compact.open {
  transform: none;
  visibility: visible;
  transition: transform 260ms var(--ease-out);
}
.module-drawer.compact.dragging {
  transition: none;
}
/* A lista ocupa a gaveta inteira (no desktop ela tem a largura dela) */
.module-drawer.compact > :deep(*) {
  flex: 1;
  width: 100% !important;
  min-width: 0;
  border-right: none !important;
  background: transparent;
}
.drawer-scrim {
  position: fixed;
  inset: 0;
  background: var(--scrim);
}
.drawer-scrim-enter-active,
.drawer-scrim-leave-active {
  transition: opacity 220ms var(--ease-out);
}
.drawer-scrim-enter-from,
.drawer-scrim-leave-to {
  opacity: 0;
}
</style>
