<script setup lang="ts">
/**
 * Moldura de janela modal (fundo escurecido + cartão central animado).
 * Com um modal aberto por cima de outro (ex.: a biblioteca de imagens sobre o
 * diálogo da categoria), o Esc fecha só o de cima.
 * `scrimInset` limita o escurecido/desfoque a uma parte da janela (as Configurações ›
 * Módulos deixam a barra de cima e o menu lateral nítidos); clicar fora do cartão
 * continua fechando em qualquer lugar.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { closeModal, isTopModal, openModal } from '~/composables/useModalStack'

const props = defineProps<{
  open: boolean
  width?: number
  label?: string
  /** Onde fica o fundo escurecido (valor do `inset` do CSS; padrão: a janela toda). */
  scrimInset?: string
}>()
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
      <div
        v-if="open"
        class="modal-backdrop"
        :class="{ partial: !!scrimInset }"
        :style="{ zIndex: layer, '--scrim-inset': scrimInset ?? '0px' }"
        @mousedown.self="emit('close')"
      >
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
}
/* O escurecido com desfoque (só na parte coberta por --scrim-inset) */
.modal-backdrop::before {
  content: '';
  position: absolute;
  inset: var(--scrim-inset);
  background: var(--scrim);
  backdrop-filter: blur(3px);
  pointer-events: none;
  transition:
    inset 260ms var(--ease-out),
    border-radius 260ms var(--ease-out);
}
/* Mesmo canto arredondado da área de conteúdo do app */
.modal-backdrop.partial::before {
  border-top-left-radius: 14px;
}
.modal-card {
  position: relative;
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
