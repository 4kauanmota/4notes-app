<script setup lang="ts">
/**
 * O mostrador do Timer: um anel com o tempo no meio.
 * - Temporizador e Pomodoro: o anel esvazia conforme o tempo passa (roxo no foco,
 *   amarelo nas pausas).
 * - Cronômetro: um ponto dá a volta a cada minuto.
 * O tempo vem pronto de quem usa (calculado pelo relógio, lib/timer/engine.ts).
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Texto grande ("25:00"). */
    time: string
    /** Linha de baixo ("Foco · 2 de 4"). */
    caption?: string
    /** Quanto falta (0–1) — null no cronômetro. */
    progress?: number | null
    /** Cronômetro: segundos do minuto atual (0–1), para o ponto que gira. */
    sweep?: number | null
    tone?: 'focus' | 'break'
    state?: 'idle' | 'running' | 'paused' | 'done'
    /** Bolinhas do Pomodoro: quantas e quantas cheias. */
    dots?: { total: number; filled: number } | null
  }>(),
  { caption: '', progress: null, sweep: null, tone: 'focus', state: 'idle', dots: null },
)

const SIZE = 248
const R = 108
const STROKE = 10
const circumference = 2 * Math.PI * R

const dashOffset = computed(() => (props.progress === null ? 0 : circumference * (1 - Math.min(1, Math.max(0, props.progress)))))
const sweepPoint = computed(() => {
  if (props.sweep === null) return null
  const angle = props.sweep * 2 * Math.PI - Math.PI / 2
  return { x: SIZE / 2 + R * Math.cos(angle), y: SIZE / 2 + R * Math.sin(angle) }
})
</script>

<template>
  <div class="dial" :class="[`tone-${tone}`, `state-${state}`]">
    <svg :viewBox="`0 0 ${SIZE} ${SIZE}`" class="ring" aria-hidden="true">
      <circle :cx="SIZE / 2" :cy="SIZE / 2" :r="R" class="track" :stroke-width="STROKE" />
      <circle
        v-if="progress !== null"
        :cx="SIZE / 2"
        :cy="SIZE / 2"
        :r="R"
        class="progress"
        :stroke-width="STROKE"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        :transform="`rotate(-90 ${SIZE / 2} ${SIZE / 2})`"
      />
      <circle v-if="sweepPoint" :cx="sweepPoint.x" :cy="sweepPoint.y" r="7" class="sweep" />
    </svg>
    <div class="center">
      <span class="time" data-timer-display>{{ time }}</span>
      <span v-if="caption" class="caption">{{ caption }}</span>
      <span v-if="dots" class="dots" :aria-label="`${dots.filled} de ${dots.total} ciclos`">
        <i v-for="n in dots.total" :key="n" :class="{ on: n <= dots.filled }" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.dial {
  position: relative;
  width: min(248px, 72vw);
  aspect-ratio: 1;
  --ring: var(--primary);
}
.dial.tone-break {
  --ring: var(--accent-strong);
}
.ring {
  width: 100%;
  height: 100%;
  overflow: visible;
}
.track {
  fill: none;
  stroke: var(--surface-3);
}
.progress {
  fill: none;
  stroke: var(--ring);
  stroke-linecap: round;
  transition:
    stroke-dashoffset 260ms linear,
    stroke 320ms var(--ease-out);
}
.sweep {
  fill: var(--ring);
  stroke: var(--surface);
  stroke-width: 3;
}
.state-paused .progress,
.state-paused .sweep {
  opacity: 0.45;
}
.state-done .track {
  stroke: color-mix(in srgb, var(--ring) 30%, var(--surface-3));
}
.center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.time {
  font-size: clamp(38px, 11vw, 54px);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1;
  /* Relógio que muda a cada segundo: dígitos de largura igual (não "tremem") */
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.state-paused .time {
  color: var(--text-2);
  animation: blink 1.6s ease-in-out infinite;
}
.state-done .time {
  color: var(--accent-text);
}
.caption {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-3);
}
.dots {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.dots i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--surface-3);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}
.dots i.on {
  background: var(--primary);
  box-shadow: none;
}
@keyframes blink {
  50% {
    opacity: 0.55;
  }
}
@media (prefers-reduced-motion: reduce) {
  .state-paused .time {
    animation: none;
  }
  .progress {
    transition: none;
  }
}
</style>
