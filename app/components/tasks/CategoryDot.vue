<script setup lang="ts">
import type { CategoryColor } from '~/lib/tasks/model'

withDefaults(defineProps<{ color?: CategoryColor | null; size?: number }>(), { color: null, size: 9 })
</script>

<template>
  <span
    class="category-dot"
    :class="{ empty: !color }"
    :style="{ width: `${size}px`, height: `${size}px`, '--dot': color ? `var(--cat-${color})` : 'transparent' }"
    aria-hidden="true"
  />
</template>

<style scoped>
.category-dot {
  display: inline-block;
  flex: none;
  border-radius: 50%;
  background: var(--dot);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dot) 22%, transparent);
}
.category-dot.empty {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--text-3);
}
</style>
