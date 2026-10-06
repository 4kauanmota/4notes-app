<script setup lang="ts">
/**
 * Uma configuração: o nome, o "?" com uma explicação bem curta (ao passar o
 * mouse) e o controle à direita (switch, opções…).
 */
defineProps<{
  label: string
  /** Explicação curta mostrada no "?". */
  help: string
  /** Aviso discreto abaixo do nome (ex.: "Disponível no app instalado"). */
  note?: string
  disabled?: boolean
}>()
</script>

<template>
  <div class="setting-row" :class="{ disabled }">
    <div class="setting-text">
      <div class="setting-title">
        <span class="setting-label">{{ label }}</span>
        <span class="setting-help" tabindex="0" role="img" :aria-label="help" :data-tip="help" data-tip-pos="top">
          <AppIcon name="help" :size="15" />
        </span>
      </div>
      <p v-if="note" class="setting-note">{{ note }}</p>
    </div>
    <div class="setting-control"><slot /></div>
  </div>
</template>

<style scoped>
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 40px;
}
.setting-row + .setting-row {
  margin-top: 10px;
}
.setting-text {
  min-width: 0;
}
.setting-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.setting-label {
  font-weight: 600;
}
.setting-help {
  display: inline-grid;
  place-items: center;
  flex: none;
  color: var(--text-3);
  border-radius: 50%;
  cursor: help;
  outline: none;
  transition: color var(--t-fast);
}
.setting-help:hover,
.setting-help:focus-visible {
  color: var(--primary-text);
}
.setting-note {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-3);
}
.setting-control {
  flex: none;
}
.disabled .setting-control {
  opacity: 0.5;
  pointer-events: none;
}
</style>
