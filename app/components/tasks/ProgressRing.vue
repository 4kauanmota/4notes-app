<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ value: number; total: number; size?: number }>(), { size: 38 })
const radius = 15
const circumference = 2 * Math.PI * radius
const ratio = computed(() => (props.total > 0 ? Math.min(1, props.value / props.total) : 0))
const complete = computed(() => props.total > 0 && props.value >= props.total)
</script>

<template>
  <div class="progress" :class="{ complete }" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle class="track" cx="18" cy="18" :r="radius" />
      <circle
        class="bar"
        cx="18"
        cy="18"
        :r="radius"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="circumference * (1 - ratio)"
      />
    </svg>
    <AppIcon v-if="complete" name="check" :size="15" :stroke="2.6" class="done-icon" />
  </div>
</template>

<style scoped>
.progress {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
}
svg {
  position: absolute;
  inset: 0;
  transform: rotate(-90deg);
}
circle {
  fill: none;
  stroke-width: 3.4;
}
.track {
  stroke: var(--surface-3);
}
.bar {
  stroke: var(--accent-strong);
  stroke-linecap: round;
  transition: stroke-dashoffset 600ms var(--ease-out), stroke 300ms;
}
.complete .bar {
  stroke: var(--primary);
}
.done-icon {
  color: var(--primary);
  animation: pop 420ms var(--ease-spring);
}
@keyframes pop {
  from {
    transform: scale(0.3);
    opacity: 0;
  }
}
</style>
