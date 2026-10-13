<script setup lang="ts">
/**
 * Gráfico de colunas da evolução do tempo (horas do dia, dias, meses).
 *
 * - Colunas finas (até 24 px), canto arredondado em cima e retas na base; grade em
 *   linhas finas e discretas; o maior valor ganha o número em cima.
 * - Comparando: duas colunas por posição — o período (roxo) e o anterior (cinza) —,
 *   com legenda.
 * - Passar o mouse (ou tocar, ou focar com o teclado) numa posição mostra o valor.
 */
import { computed, ref } from 'vue'
import { useElementWidth } from '~/composables/useElementWidth'
import { formatDuration, formatShortDuration } from '~/lib/timer/format'
import type { EvolutionPoint } from '~/lib/timer/stats'

const props = withDefaults(
  defineProps<{
    points: EvolutionPoint[]
    /** Valores do período anterior, na mesma ordem (comparação). */
    previous?: number[] | null
    currentLabel?: string
    previousLabel?: string
    height?: number
  }>(),
  { previous: null, currentLabel: 'Este período', previousLabel: 'Anterior', height: 170 },
)

const root = ref<HTMLElement>()
const width = useElementWidth(root)

const AXIS_W = 46
const TOP = 20
const LABELS_H = 22
const MIN = 60_000
const STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720, 1440, 2880, 4320, 7200, 14400].map((m) => m * MIN)

const comparing = computed(() => !!props.previous && props.previous.length === props.points.length)
const plotW = computed(() => Math.max(60, width.value - AXIS_W - 6))
const plotH = computed(() => props.height)
const baseline = computed(() => TOP + plotH.value)

/** Escala com valores "redondos" (no máximo 4 linhas de grade). */
const scale = computed(() => {
  const values = props.points.map((point) => point.ms)
  if (comparing.value) values.push(...props.previous!)
  const max = Math.max(0, ...values)
  const step = STEPS.find((candidate) => Math.ceil(max / candidate) <= 4) ?? STEPS.at(-1)!
  const top = Math.max(step, Math.ceil(max / step) * step)
  const ticks: number[] = []
  for (let value = 0; value <= top + 1; value += step) ticks.push(value)
  return { top, ticks, max }
})

const y = (ms: number) => baseline.value - (ms / scale.value.top) * plotH.value
const band = computed(() => plotW.value / Math.max(1, props.points.length))
const barW = computed(() =>
  comparing.value ? Math.max(2, Math.min(14, (band.value - 4) * 0.4)) : Math.max(2, Math.min(24, band.value * 0.62)),
)

/** Coluna com o canto de cima arredondado (4 px) e a base reta. */
function columnPath(x: number, ms: number): string {
  const top = y(ms)
  const h = baseline.value - top
  if (h <= 0.5) return ''
  const w = barW.value
  const r = Math.min(4, w / 2, h)
  return `M${x},${baseline.value}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${baseline.value}Z`
}

const columns = computed(() =>
  props.points.map((point, index) => {
    const center = AXIS_W + band.value * index + band.value / 2
    const w = barW.value
    const currentX = comparing.value ? center + 1 : center - w / 2
    const previousX = center - w - 1
    return {
      point,
      index,
      center,
      current: point.future ? '' : columnPath(currentX, point.ms),
      previous: comparing.value ? columnPath(previousX, props.previous![index]!) : '',
    }
  }),
)

/** Rótulos do eixo de baixo sem se encostar (um a cada N, mais o atual). */
const labelEvery = computed(() => {
  const longest = Math.max(...props.points.map((point) => point.label.length), 1)
  const needed = longest * 6.5 + 8
  return Math.max(1, Math.ceil(needed / band.value))
})

/** O número fica só em cima da maior coluna (sem comparação). */
const peakIndex = computed(() => {
  if (comparing.value || scale.value.max <= 0) return -1
  let best = -1
  props.points.forEach((point, index) => {
    if (best < 0 || point.ms > props.points[best]!.ms) best = index
  })
  return best
})

const hover = ref<number | null>(null)
const tip = computed(() => {
  if (hover.value === null) return null
  const column = columns.value[hover.value]
  if (!column) return null
  const { point } = column
  const value = point.future ? 'Ainda não chegou' : formatDuration(point.ms, { seconds: false })
  const rows = comparing.value
    ? [
        { color: 'var(--primary)', text: `${props.currentLabel}: ${formatDuration(point.ms, { seconds: false })}` },
        {
          color: 'var(--chart-previous)',
          text: `${props.previousLabel}: ${formatDuration(props.previous![hover.value]!, { seconds: false })}`,
        },
      ]
    : undefined
  const top = Math.min(y(point.ms), comparing.value ? y(props.previous![hover.value]!) : Infinity)
  return {
    x: Math.min(Math.max(column.center, 70), width.value - 70),
    y: Math.max(top, 36),
    value: comparing.value ? point.title : value,
    label: comparing.value ? '' : point.title,
    rows,
  }
})

const summary = computed(() => {
  const total = props.points.reduce((sum, point) => sum + point.ms, 0)
  return `Gráfico de colunas: ${formatDuration(total, { seconds: false })} no total, de ${props.points[0]?.title ?? ''} a ${props.points.at(-1)?.title ?? ''}.`
})
</script>

<template>
  <div ref="root" class="columns-chart" @pointerleave="hover = null">
    <div v-if="comparing" class="legend" aria-hidden="true">
      <span><i class="key current" />{{ currentLabel }}</span>
      <span><i class="key previous" />{{ previousLabel }}</span>
    </div>
    <svg :width="width" :height="baseline + LABELS_H" role="img" :aria-label="summary">
      <!-- Grade -->
      <g class="grid">
        <template v-for="tick in scale.ticks" :key="tick">
          <line :x1="AXIS_W" :x2="AXIS_W + plotW" :y1="Math.round(y(tick)) + 0.5" :y2="Math.round(y(tick)) + 0.5" />
          <text :x="AXIS_W - 8" :y="y(tick) + 4" text-anchor="end">{{ tick === 0 ? '0' : formatShortDuration(tick) }}</text>
        </template>
      </g>
      <!-- Colunas -->
      <g v-for="column in columns" :key="column.point.key" :class="{ hovered: hover === column.index }">
        <rect
          v-if="hover === column.index"
          class="hover-band"
          :x="column.center - band / 2"
          :y="TOP"
          :width="band"
          :height="plotH"
          rx="6"
        />
        <path v-if="column.previous" class="bar previous" :d="column.previous" />
        <path v-if="column.current" class="bar current" :d="column.current" />
        <text v-if="column.index === peakIndex" class="peak" :x="column.center" :y="y(column.point.ms) - 6" text-anchor="middle">
          {{ formatShortDuration(column.point.ms) }}
        </text>
        <text
          v-if="column.index % labelEvery === 0 || column.point.current"
          class="x-label"
          :class="{ now: column.point.current, future: column.point.future }"
          :x="column.center"
          :y="baseline + 15"
          text-anchor="middle"
        >
          {{ column.point.label }}
        </text>
        <!-- Área do mouse/toque: a posição inteira, não só a coluna -->
        <rect
          class="hit"
          :x="column.center - band / 2"
          :y="TOP - 10"
          :width="band"
          :height="plotH + 10 + LABELS_H"
          tabindex="0"
          role="img"
          :aria-label="`${column.point.title}: ${formatDuration(column.point.ms, { seconds: false })}`"
          @pointerenter="hover = column.index"
          @pointerdown="hover = column.index"
          @focus="hover = column.index"
          @blur="hover = null"
        />
      </g>
    </svg>
    <ChartTip v-if="tip" :x="tip.x" :y="tip.y" :value="tip.value" :label="tip.label" :rows="tip.rows" />
  </div>
</template>

<style scoped>
.columns-chart {
  position: relative;
  width: 100%;
  --chart-previous: color-mix(in srgb, var(--text-3) 55%, transparent);
}
svg {
  display: block;
  overflow: visible;
}
.grid line {
  stroke: var(--border);
  stroke-width: 1;
  shape-rendering: crispEdges;
}
.grid text,
.x-label {
  fill: var(--text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.x-label.now {
  fill: var(--primary-text);
  font-weight: 700;
}
.x-label.future {
  opacity: 0.5;
}
.peak {
  fill: var(--text-2);
  font-size: 11px;
  font-weight: 650;
}
.bar.current {
  fill: var(--primary);
  transition: opacity var(--t-fast);
}
.bar.previous {
  fill: var(--chart-previous);
}
.hovered .bar.current {
  opacity: 0.82;
}
.hover-band {
  fill: var(--hover);
}
.hit {
  fill: transparent;
  cursor: default;
  outline: none;
}
.hit:focus-visible {
  stroke: var(--primary);
  stroke-width: 1.5;
}
.legend {
  display: flex;
  gap: 16px;
  margin: 0 0 6px 46px;
  font-size: 12px;
  color: var(--text-2);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.key {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.key.current {
  background: var(--primary);
}
.key.previous {
  background: var(--chart-previous);
}
</style>
