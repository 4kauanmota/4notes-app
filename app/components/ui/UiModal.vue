<script setup lang="ts">
/**
 * Moldura de janela modal (fundo escurecido + cartão central animado).
 * Com um modal aberto por cima de outro (ex.: a biblioteca de imagens sobre o
 * diálogo da categoria), o Esc fecha só o de cima.
 * `scrimInset` limita o escurecido/desfoque a uma parte da janela (as Configurações ›
 * Módulos deixam a barra de cima e o menu lateral nítidos); clicar fora do cartão
 * continua fechando em qualquer lugar.
 * No celular (layout compact) o cartão ocupa a largura da tela; com `fullOnCompact`,
 * a tela inteira (janelas grandes: configurações, biblioteca de imagens…).
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { closeModal, isTopModal, openModal } from '~/composables/useModalStack'

const props = defineProps<{
  open: boolean
  width?: number
  label?: string
  /** Onde fica o fundo escurecido (valor do `inset` do CSS; padrão: a janela toda). */
  scrimInset?: string
  /** No celular, ocupa a tela inteira. */
  fullOnCompact?: boolean
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
        :class="{ partial: !!scrimInset, 'full-compact': fullOnCompact }"
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
  /* A coluna tem a largura da tela: um cartão mais largo que ela encolhe (max-width) em vez de vazar */
  grid-template-columns: minmax(0, 1fr);
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

/* ── Celular ── */
html[data-layout='compact'] .modal-backdrop {
  padding: calc(12px + var(--safe-top)) 10px calc(12px + var(--safe-bottom));
}
html[data-layout='compact'] .modal-backdrop .modal-card {
  width: 100% !important;
  max-height: 100%;
}
html[data-layout='compact'] .modal-backdrop.full-compact {
  padding: 0;
}
html[data-layout='compact'] .modal-backdrop.full-compact .modal-card {
  height: 100%;
  max-height: none;
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
  border: none;
  border-radius: 0;
}
html[data-layout='medium'] .modal-card {
  max-height: calc(100dvh - 48px - var(--safe-top) - var(--safe-bottom));
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
