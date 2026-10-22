<script setup lang="ts">
/**
 * Distribuição do tempo entre as categorias: rosca (no máximo 6 fatias — o resto vira
 * "Outras") + a lista com o nome, o tempo e a porcentagem de cada uma (a cor nunca é
 * o único jeito de saber qual é qual). Passar o mouse numa fatia destaca a linha da
 * lista, e vice-versa.
 */
import { computed, ref } from 'vue'
import { TIME_FORMAT, type ChartFormat } from '~/lib/chart-format'

interface DonutItem {
  key: string
  label: string
  /** Cor CSS da fatia (a da categoria). */
  color: string
  ms: number
}

const props = withDefaults(
  defineProps<{
    items: DonutItem[]
    total: number
    /** Como escrever os valores (padrão: tempo; as Finanças usam dinheiro). Os valores vêm em `ms`. */
    format?: ChartFormat
    /** Rótulo do centro e do resumo. */
    totalLabel?: string
    /** Descrição para leitores de tela. */
    ariaLabel?: string
  }>(),
  { format: () => TIME_FORMAT, totalLabel: 'no total', ariaLabel: 'Distribuição por categoria' },
)
const formatDuration = (value: number, _options?: unknown) => props.format.full(value)

const MAX_SLICES = 6
const SIZE = 148
const R = 60
const STROKE = 18
const GAP = 2

const slices = computed(() => {
  const list = props.items.filter((item) => item.ms > 0)
  if (list.length <= MAX_SLICES) return list
  const head = list.slice(0, MAX_SLICES - 1)
  const rest = list.slice(MAX_SLICES - 1).reduce((sum, item) => sum + item.ms, 0)
  return [...head, { key: '__others', label: `Outras (${list.length - head.length})`, color: 'var(--cat-gray)', ms: rest }]
})

const hover = ref<string | null>(null)

/** Arcos com um espaço de 2 px entre as fatias (na cor do fundo, sem contorno). */
const arcs = computed(() => {
  const total = slices.value.reduce((sum, item) => sum + item.ms, 0)
  if (total <= 0) return []
  const circumference = 2 * Math.PI * R
  const gap = slices.value.length > 1 ? GAP : 0
  let offset = 0
  return slices.value.map((item) => {
    const length = (item.ms / total) * circumference
    const visible = Math.max(0.5, length - gap)
    const arc = { item, dash: `${visible} ${circumference - visible}`, offset: -offset, share: item.ms / total }
    offset += length
    return arc
  })
})

const pct = (share: number) => (share >= 0.995 ? '100%' : share < 0.01 ? '< 1%' : `${Math.round(share * 100)}%`)
</script>

<template>
  <div class="donut-wrap">
    <svg
      :width="SIZE"
      :height="SIZE"
      :viewBox="`0 0 ${SIZE} ${SIZE}`"
      class="donut"
      role="img"
      :aria-label="`${ariaLabel}: ${formatDuration(total, { seconds: false })} ${totalLabel}`"
    >
      <circle :cx="SIZE / 2" :cy="SIZE / 2" :r="R" class="track" :stroke-width="STROKE" />
      <circle
        v-for="arc in arcs"
        :key="arc.item.key"
        :cx="SIZE / 2"
        :cy="SIZE / 2"
        :r="R"
        class="slice"
        :class="{ dim: hover !== null && hover !== arc.item.key }"
        :stroke="arc.item.color"
        :stroke-width="hover === arc.item.key ? STROKE + 4 : STROKE"
        :stroke-dasharray="arc.dash"
        :stroke-dashoffset="arc.offset"
        :transform="`rotate(-90 ${SIZE / 2} ${SIZE / 2})`"
        @pointerenter="hover = arc.item.key"
        @pointerleave="hover = null"
      />
      <text :x="SIZE / 2" :y="SIZE / 2 - 2" text-anchor="middle" class="center-value">{{ formatDuration(total, { seconds: false }) }}</text>
      <text :x="SIZE / 2" :y="SIZE / 2 + 15" text-anchor="middle" class="center-label">{{ totalLabel }}</text>
    </svg>
    <ul class="donut-legend">
      <li
        v-for="arc in arcs"
        :key="arc.item.key"
        :class="{ active: hover === arc.item.key, dim: hover !== null && hover !== arc.item.key }"
        @pointerenter="hover = arc.item.key"
        @pointerleave="hover = null"
      >
        <i class="swatch" :style="{ background: arc.item.color }" />
        <span class="name">{{ arc.item.label }}</span>
        <span class="value">{{ formatDuration(arc.item.ms, { seconds: false }) }}</span>
        <span class="share">{{ pct(arc.share) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.donut-wrap {
  display: flex;
  align-items: center;
  gap: 22px;
}
.donut {
  flex: none;
  overflow: visible;
}
.track {
  fill: none;
  stroke: var(--surface-3);
}
.slice {
  fill: none;
  transition:
    stroke-width var(--t-fast) var(--ease-out),
    opacity var(--t-fast);
  cursor: default;
}
.slice.dim {
  opacity: 0.45;
}
.center-value {
  fill: var(--text);
  font-size: 15px;
  font-weight: 650;
}
.center-label {
  fill: var(--text-3);
  font-size: 11px;
}
.donut-legend {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.donut-legend li {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto 44px;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  font-size: 13px;
  transition:
    background var(--t-fast),
    opacity var(--t-fast);
}
.donut-legend li.active {
  background: var(--hover);
}
.donut-legend li.dim {
  opacity: 0.6;
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.value {
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.share {
  color: var(--text-3);
  font-size: 12px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
/* Tela estreita: a rosca em cima, a lista embaixo */
@container (max-width: 380px) {
  .donut-wrap {
    flex-direction: column;
    align-items: stretch;
  }
  .donut {
    align-self: center;
  }
}
</style>
