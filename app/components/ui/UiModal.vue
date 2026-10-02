<script setup lang="ts">
/** Moldura de janela modal (fundo escurecido + cartão central animado). */
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps<{ open: boolean; width?: number; label?: string }>()
const emit = defineEmits<{ close: [] }>()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown, true)
    else window.removeEventListener('keydown', onKeydown, true)
  },
  { immediate: true },
)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
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
