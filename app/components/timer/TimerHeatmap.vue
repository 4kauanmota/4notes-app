<script setup lang="ts">
/**
 * Quando você registra tempo: dias da semana × horas do dia. Uma cor só (roxo), do
 * mais claro (pouco) ao mais forte (muito), com a escala embaixo. Passar o mouse (ou
 * tocar) numa casa mostra o tempo dela.
 */
import { computed, ref } from 'vue'
import { formatDuration } from '~/lib/timer/format'
import { weekdayName, weekdayOrder, type WeekStart } from '~/lib/timer/stats'

const props = defineProps<{ heat: number[][]; weekStart: WeekStart }>()

/** 5 tons, de "pouco" a "muito" (o vazio fica no fundo). */
const LEVELS = [18, 36, 56, 78, 100]
const rows = computed(() => weekdayOrder(props.weekStart))
const max = computed(() => Math.max(0, ...props.heat.flat()))

function level(ms: number): number {
  if (ms <= 0 || max.value <= 0) return -1
  return Math.min(LEVELS.length - 1, Math.floor((ms / max.value) * LEVELS.length - 1e-9))
}

const cellColor = (ms: number) => {
  const index = level(ms)
  return index < 0 ? 'var(--surface-3)' : `color-mix(in srgb, var(--primary) ${LEVELS[index]}%, var(--surface-2))`
}

const root = ref<HTMLElement>()
const tip = ref<{ x: number; y: number; value: string; label: string } | null>(null)

function show(event: Event, day: number, hour: number) {
  const cell = event.currentTarget as HTMLElement
  const box = root.value!.getBoundingClientRect()
  const rect = cell.getBoundingClientRect()
  const ms = props.heat[day]![hour]!
  tip.value = {
    x: Math.min(Math.max(rect.left - box.left + rect.width / 2, 80), box.width - 80),
    y: rect.top - box.top,
    value: ms > 0 ? formatDuration(ms, { seconds: false }) : 'Nada registrado',
    label: `${weekdayName(day)}, ${hour}h–${hour + 1}h`,
  }
}
</script>

<template>
  <div ref="root" class="heatmap" @pointerleave="tip = null">
    <div class="grid" role="img" aria-label="Tempo por dia da semana e hora do dia">
      <template v-for="day in rows" :key="day">
        <span class="day">{{ weekdayName(day, true) }}</span>
        <span
          v-for="hour in 24"
          :key="hour"
          class="cell"
          :style="{ background: cellColor(heat[day]![hour - 1]!) }"
          @pointerenter="show($event, day, hour - 1)"
          @pointerdown="show($event, day, hour - 1)"
        />
      </template>
      <span />
      <span v-for="hour in 24" :key="`h${hour}`" class="hour">{{ (hour - 1) % 3 === 0 ? `${hour - 1}h` : '' }}</span>
    </div>
    <div class="scale" aria-hidden="true">
      <span>Menos</span>
      <i v-for="value in LEVELS" :key="value" :style="{ background: `color-mix(in srgb, var(--primary) ${value}%, var(--surface-2))` }" />
      <span>Mais</span>
    </div>
    <ChartTip v-if="tip" :x="tip.x" :y="tip.y" :value="tip.value" :label="tip.label" />
  </div>
</template>

<style scoped>
.heatmap {
  position: relative;
}
.grid {
  display: grid;
  grid-template-columns: 30px repeat(24, minmax(0, 1fr));
  gap: 3px;
  align-items: center;
}
.day {
  font-size: 11px;
  color: var(--text-3);
}
.cell {
  aspect-ratio: 1;
  min-height: 8px;
  max-height: 22px;
  border-radius: 3px;
  transition: outline-color var(--t-fast);
  outline: 1.5px solid transparent;
  outline-offset: 1px;
}
.cell:hover {
  outline-color: var(--text-2);
}
.hour {
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: visible;
}
.scale {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--text-3);
}
.scale i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
.scale span:first-child {
  margin-right: 4px;
}
.scale span:last-child {
  margin-left: 4px;
}
</style>
