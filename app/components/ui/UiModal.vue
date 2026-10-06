<script setup lang="ts">
/**
 * Moldura de janela modal (fundo escurecido + cartão central animado).
 * Com um modal aberto por cima de outro (ex.: a biblioteca de imagens sobre o
 * diálogo da categoria), o Esc fecha só o de cima.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { closeModal, isTopModal, openModal } from '~/composables/useModalStack'

const props = defineProps<{ open: boolean; width?: number; label?: string }>()
const emit = defineEmits<{ close: [] }>()
const id = Symbol('modal')
/** Camada do modal: o aberto por último fica por cima. */
const layer = ref(900)

function onKeydown(event: KeyboardEvent) {
  // Esc já usado por outra coisa (ex.: fechar um menu do clique direito aberto no diálogo)
  if (event.key !== 'Escape' || event.defaultPrevented || !isTopModal(id)) return
  event.preventDefault()
  event.stopImmediatePropagation()
  emit('close')
}

function setOpen(open: boolean) {
  if (open) {
    layer.value = 900 + openModal(id)
    window.addEventListener('keydown', onKeydown, true)
  } else {
    closeModal(id)
    window.removeEventListener('keydown', onKeydown, true)
  }
}

watch(
  () => props.open,
  (open) => setOpen(open),
  { immediate: true },
)
onBeforeUnmount(() => setOpen(false))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" :style="{ zIndex: layer }" @mousedown.self="emit('close')">
        <div class="modal-card" :style="{ width: `${width ?? 440}px` }" role="dialog" aria-modal="true" :aria-label="label">
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--scrim);
  backdrop-filter: blur(3px);
}
.modal-card {
  max-width: 100%;
  max-height: calc(100vh - 48px);
  overflow: auto;
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 180ms var(--ease-out);
}
.modal-enter-active .modal-card {
  transition: transform 260ms var(--ease-spring), opacity 180ms var(--ease-out);
}
.modal-leave-active .modal-card {
  transition: transform 150ms ease, opacity 150ms ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal-card,
.modal-leave-to .modal-card {
  opacity: 0;
  transform: translateY(10px) scale(0.97);
}
</style>
