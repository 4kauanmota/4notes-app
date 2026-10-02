<script setup lang="ts">
const model = defineModel<boolean>({ required: true })
defineProps<{ disabled?: boolean; label?: string }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    class="switch"
    :class="{ on: model }"
    :aria-checked="model"
    :aria-label="label"
    :disabled="disabled"
    @click="model = !model"
  >
    <span class="knob" />
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  width: 36px;
  height: 21px;
  flex: none;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--border-strong);
  cursor: pointer;
  transition: background var(--t-med) var(--ease-out);
}
.switch.on {
  background: var(--primary);
}
.switch:disabled {
  opacity: 0.5;
  cursor: default;
}
.knob {
  position: absolute;
  top: 2.5px;
  left: 2.5px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform var(--t-med) var(--ease-spring);
}
.switch.on .knob {
  transform: translateX(15px);
}
.switch:active .knob {
  width: 19px;
}
.switch.on:active .knob {
  transform: translateX(12px);
}
</style>
