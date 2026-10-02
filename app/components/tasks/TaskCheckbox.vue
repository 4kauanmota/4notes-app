<script setup lang="ts">
/** Caixa de seleção redonda com animação de "check" e uma pequena explosão amarela. */
defineProps<{ checked: boolean; color?: string | null; recurring?: boolean; label?: string }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    class="task-checkbox"
    :class="{ checked, recurring }"
    role="checkbox"
    :aria-checked="checked"
    :aria-label="label ?? 'Concluir tarefa'"
    :style="{ '--ring': color ? `var(--cat-${color})` : 'var(--text-3)' }"
    @click.stop="emit('toggle')"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle class="ring" cx="12" cy="12" r="9.2" />
      <path class="tick" d="M7.6 12.4l3 3 5.9-6.3" />
    </svg>
    <span v-if="checked" class="burst" aria-hidden="true">
      <i v-for="n in 8" :key="n" :style="{ '--a': `${n * 45}deg` }" />
    </span>
  </button>
</template>

<style scoped>
.task-checkbox {
  position: relative;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}
svg {
  width: 22px;
  height: 22px;
  overflow: visible;
}
.ring {
  fill: transparent;
  stroke: var(--ring);
  stroke-width: 1.8;
  transition: fill 220ms var(--ease-out), stroke 220ms, transform 260ms var(--ease-spring);
  transform-origin: center;
}
.recurring .ring {
  stroke-dasharray: 3.2 2.2;
}
.tick {
  fill: none;
  stroke: var(--ring);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 16;
  stroke-dashoffset: 16;
  opacity: 0;
  transition: stroke-dashoffset 260ms var(--ease-out), opacity 120ms, stroke 160ms;
}
.task-checkbox:hover .ring {
  fill: color-mix(in srgb, var(--ring) 12%, transparent);
}
.task-checkbox:hover .tick {
  opacity: 0.55;
  stroke-dashoffset: 0;
}
.task-checkbox:active .ring {
  transform: scale(0.86);
}
.checked .ring {
  fill: var(--primary);
  stroke: var(--primary);
  stroke-dasharray: none;
  animation: pop 360ms var(--ease-spring);
}
.checked .tick {
  stroke: #fff;
  opacity: 1;
  stroke-dashoffset: 0;
}
.burst {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.burst i {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 4px;
  margin: -2px;
  border-radius: 50%;
  background: var(--accent-strong);
  transform: rotate(var(--a)) translateY(0);
  animation: burst 520ms var(--ease-out) forwards;
}
.burst i:nth-child(even) {
  background: var(--primary);
  width: 3px;
  height: 3px;
}
@keyframes pop {
  0% {
    transform: scale(0.7);
  }
  60% {
    transform: scale(1.12);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes burst {
  0% {
    opacity: 1;
    transform: rotate(var(--a)) translateY(-6px) scale(1);
  }
  100% {
    opacity: 0;
    transform: rotate(var(--a)) translateY(-17px) scale(0.4);
  }
}
</style>
