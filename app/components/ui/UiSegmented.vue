<script setup lang="ts" generic="T extends string">
const model = defineModel<T>({ required: true })
defineProps<{ options: { value: T; label: string; icon?: string }[]; size?: 'sm' | 'md' }>()
</script>

<template>
  <div class="segmented" :class="size ?? 'md'" role="radiogroup">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="model === option.value"
      :class="{ active: model === option.value }"
      @click="model = option.value"
    >
      <AppIcon v-if="option.icon" :name="option.icon" :size="15" />
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--r-md);
  background: var(--surface-3);
  border: 1px solid var(--border);
}
.segmented button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast), box-shadow var(--t-fast);
}
.segmented.sm button {
  height: 24px;
  padding: 0 9px;
  font-size: 12px;
}
.segmented button:hover {
  color: var(--text);
}
.segmented button.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
}
</style>
