<script setup lang="ts">
/**
 * Balão dos gráficos do Timer: o valor primeiro (em destaque), depois o rótulo.
 * Fica dentro do gráfico (position: absolute) e nunca recebe o mouse.
 */
defineProps<{
  x: number
  y: number
  value: string
  label: string
  /** Linhas extras (ex.: o período anterior), com a cor da série ao lado. */
  rows?: { color: string; text: string }[]
  /** Acima (padrão) ou abaixo do ponto. */
  below?: boolean
}>()
</script>

<template>
  <div class="chart-tip" :class="{ below }" :style="{ left: `${x}px`, top: `${y}px` }" role="status">
    <strong class="tip-value">{{ value }}</strong>
    <span class="tip-label">{{ label }}</span>
    <span v-for="row in rows ?? []" :key="row.text" class="tip-row"><i :style="{ background: row.color }" />{{ row.text }}</span>
  </div>
</template>

<style scoped>
.chart-tip {
  position: absolute;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 96px;
  max-width: 220px;
  padding: 7px 10px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-md);
  transform: translate(-50%, calc(-100% - 10px));
  pointer-events: none;
  white-space: nowrap;
}
.chart-tip.below {
  transform: translate(-50%, 10px);
}
.tip-value {
  font-size: 13.5px;
  font-weight: 650;
  color: var(--text);
}
.tip-label {
  font-size: 11.5px;
  color: var(--text-3);
}
.tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-2);
}
.tip-row i {
  width: 10px;
  height: 2px;
  border-radius: 1px;
}
</style>
