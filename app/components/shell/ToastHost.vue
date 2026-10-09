<script setup lang="ts">
/** Mostra os avisos (toasts). Some sozinho; pausa enquanto o mouse está em cima. */
import { onBeforeUnmount, watch } from 'vue'
import { useToasts, type Toast } from '~/composables/useToasts'

const { toasts, dismissToast } = useToasts()
const timers = new Map<number, { handle: ReturnType<typeof setTimeout>; remaining: number; started: number }>()

function start(toast: Toast, duration = toast.duration) {
  const handle = setTimeout(() => {
    timers.delete(toast.id)
    dismissToast(toast.id)
  }, duration)
  timers.set(toast.id, { handle, remaining: duration, started: Date.now() })
}

function pause(toast: Toast) {
  const timer = timers.get(toast.id)
  if (!timer) return
  clearTimeout(timer.handle)
  timer.remaining = Math.max(1200, timer.remaining - (Date.now() - timer.started))
}

function resume(toast: Toast) {
  const timer = timers.get(toast.id)
  if (timer) start(toast, timer.remaining)
}

watch(
  () => toasts.map((t) => t.id),
  () => {
    for (const toast of toasts) if (!timers.has(toast.id)) start(toast)
    for (const id of [...timers.keys()]) {
      if (!toasts.some((t) => t.id === id)) {
        clearTimeout(timers.get(id)!.handle)
        timers.delete(id)
      }
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => timers.forEach((timer) => clearTimeout(timer.handle)))

async function runAction(toast: Toast) {
  dismissToast(toast.id)
  await toast.action?.run()
}

const iconFor = (toast: Toast) => toast.icon ?? (toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : 'info')
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast"
        :class="`tone-${toast.tone}`"
        role="status"
        @mouseenter="pause(toast)"
        @mouseleave="resume(toast)"
      >
        <span class="toast-icon"><AppIcon :name="iconFor(toast)" :size="16" :stroke="2" /></span>
        <span class="toast-message">{{ toast.message }}</span>
        <button v-if="toast.action" class="toast-action" @click="runAction(toast)">{{ toast.action.label }}</button>
        <button class="toast-close" aria-label="Fechar aviso" @click="dismissToast(toast.id)">
          <AppIcon name="x" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 50%;
  /* No celular: acima da barra de módulos e da barra de gestos do Android */
  bottom: calc(22px + var(--bottom-nav-h) + var(--safe-bottom));
  z-index: 950;
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 8px;
  transform: translateX(-50%);
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  max-width: min(560px, calc(100vw - 48px));
  padding: 6px 6px 6px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--text) 94%, var(--purple-500));
  color: var(--surface);
  box-shadow: var(--shadow-lg);
  font-size: 13.5px;
  pointer-events: auto;
}
[data-theme='dark'] .toast {
  background: #2c2838;
  color: var(--text);
  border: 1px solid var(--border-strong);
}
.toast-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.12);
  color: var(--accent);
}
.tone-success .toast-icon {
  background: var(--accent);
  color: var(--on-accent);
}
.tone-error .toast-icon {
  background: var(--danger);
  color: #fff;
}
.toast-message {
  flex: 1;
  min-width: 0;
  line-height: 1.35;
}
.toast-action {
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  color: var(--accent);
  font-weight: 650;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--t-fast);
}
.toast-action:hover {
  background: rgba(255, 255, 255, 0.2);
}
.toast-close {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
}
.toast-close:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.1);
}

.toast-enter-active {
  transition: transform 300ms var(--ease-spring), opacity 200ms var(--ease-out);
}
.toast-leave-active {
  transition: transform 180ms ease, opacity 180ms ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(16px) scale(0.96);
}
.toast-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
.toast-move {
  transition: transform 220ms var(--ease-out);
}
</style>
