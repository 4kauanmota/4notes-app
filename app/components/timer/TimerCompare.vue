<script setup lang="ts">
/**
 * Comparação com o período anterior equivalente: o tempo de cada um, a diferença e a
 * variação (sem percentual quando antes era zero), as categorias lado a lado e as
 * atividades que aumentaram ou diminuíram.
 */
import { computed } from 'vue'
import { formatDuration, formatPercent, formatSignedDuration } from '~/lib/timer/format'
import type { Comparison, Delta } from '~/lib/timer/stats'

const props = defineProps<{
  comparison: Comparison
  currentLabel: string
  previousLabel: string
  /** Período atual em andamento: os dois vão só até o mesmo ponto. */
  partialNote?: string | null
  categoryColor: (id: string | null) => string
}>()

const nothing = computed(() => props.comparison.current.total <= 0 && props.comparison.previous.total <= 0)
const categories = computed(() => props.comparison.categories.filter((item) => item.current > 0 || item.previous > 0))
const maxCategory = computed(() => Math.max(1, ...categories.value.flatMap((item) => [item.current, item.previous])))
const up = computed(() => props.comparison.activities.filter((item) => item.diff >= 60_000).slice(0, 5))
const down = computed(() => props.comparison.activities.filter((item) => item.diff <= -60_000).slice(0, 5))

/** "+25%", "novo" (antes era zero) ou nada (os dois zero). */
function change(item: Pick<Delta, 'current' | 'previous' | 'pct'>): string {
  if (item.pct !== null) return formatPercent(item.pct)
  return item.current > 0 ? 'novo' : ''
}

const direction = (diff: number) => (Math.abs(diff) < 60_000 ? 'same' : diff > 0 ? 'up' : 'down')
</script>

<template>
  <div class="compare">
    <p v-if="partialNote" class="note"><AppIcon name="info" :size="14" /> {{ partialNote }}</p>
    <p v-if="nothing" class="empty">Sem tempo registrado nos dois períodos.</p>
    <template v-else>
      <div class="figures">
        <div class="figure">
          <span class="fig-label">{{ currentLabel }}</span>
          <strong class="fig-value">{{ formatDuration(comparison.current.total, { seconds: false }) }}</strong>
        </div>
        <div class="figure">
          <span class="fig-label">{{ previousLabel }}</span>
          <strong class="fig-value muted-value">{{ formatDuration(comparison.previous.total, { seconds: false }) }}</strong>
        </div>
        <div class="figure">
          <span class="fig-label">Diferença</span>
          <strong class="fig-value delta" :class="direction(comparison.diff)">
            <AppIcon v-if="direction(comparison.diff) !== 'same'" :name="comparison.diff > 0 ? 'arrow-up' : 'arrow-down'" :size="16" />
            {{ formatSignedDuration(comparison.diff) }}
          </strong>
          <span class="fig-sub">{{
            comparison.pct !== null ? formatPercent(comparison.pct) : comparison.current.total > 0 ? 'antes: nada registrado' : ''
          }}</span>
        </div>
      </div>

      <h4 class="sub-title">Por categoria</h4>
      <div class="legend" aria-hidden="true">
        <span><i class="key current" /> {{ currentLabel }} (na cor da categoria)</span>
        <span><i class="key previous" /> {{ previousLabel }}</span>
      </div>
      <ul class="cat-rows">
        <li v-for="item in categories" :key="item.key">
          <div class="cat-line">
            <span class="cat-name"><i class="dot" :style="{ background: categoryColor(item.categoryId) }" />{{ item.label }}</span>
            <span class="cat-values">
              {{ formatDuration(item.current, { seconds: false }) }}
              <span class="vs">× {{ formatDuration(item.previous, { seconds: false }) }}</span>
            </span>
            <span class="cat-change" :class="direction(item.diff)">{{ change(item) }}</span>
          </div>
          <div class="pair">
            <div class="bar">
              <i :style="{ width: `${(item.current / maxCategory) * 100}%`, background: categoryColor(item.categoryId) }" />
            </div>
            <div class="bar"><i class="previous" :style="{ width: `${(item.previous / maxCategory) * 100}%` }" /></div>
          </div>
        </li>
      </ul>

      <div v-if="up.length || down.length" class="movers">
        <div>
          <h4 class="sub-title"><AppIcon name="arrow-up" :size="14" /> Aumentaram</h4>
          <ul v-if="up.length" class="mover-list">
            <li v-for="item in up" :key="item.key">
              <i class="dot" :style="{ background: categoryColor(item.categoryId) }" />
              <span class="mover-name" :class="{ unnamed: !item.label }">{{ item.label || 'Sem nome' }}</span>
              <span class="mover-delta">{{ formatSignedDuration(item.diff) }}</span>
            </li>
          </ul>
          <p v-else class="none">Nenhuma atividade.</p>
        </div>
        <div>
          <h4 class="sub-title"><AppIcon name="arrow-down" :size="14" /> Diminuíram</h4>
          <ul v-if="down.length" class="mover-list">
            <li v-for="item in down" :key="item.key">
              <i class="dot" :style="{ background: categoryColor(item.categoryId) }" />
              <span class="mover-name" :class="{ unnamed: !item.label }">{{ item.label || 'Sem nome' }}</span>
              <span class="mover-delta">{{ formatSignedDuration(item.diff) }}</span>
            </li>
          </ul>
          <p v-else class="none">Nenhuma atividade.</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.compare {
  display: flex;
  flex-direction: column;
  gap: 12px;
  --chart-previous: color-mix(in srgb, var(--text-3) 55%, transparent);
}
.note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-3);
}
.note .app-icon {
  margin-top: 2px;
}
.empty,
.none {
  font-size: 13px;
  color: var(--text-3);
}
.figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.figure {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--r-lg);
  background: var(--surface-3);
  min-width: 0;
}
.fig-label {
  overflow: hidden;
  font-size: 12px;
  color: var(--text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fig-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 18px;
  font-weight: 650;
}
.muted-value {
  color: var(--text-2);
}
.fig-sub {
  font-size: 12px;
  color: var(--text-2);
}
.sub-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.legend {
  display: flex;
  gap: 16px;
  margin-top: -6px;
  font-size: 12px;
  color: var(--text-3);
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
  background: linear-gradient(90deg, var(--cat-purple) 50%, var(--cat-yellow) 50%);
}
.key.previous,
.bar i.previous {
  background: var(--chart-previous);
}
.cat-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cat-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 4px;
  font-size: 13px;
}
.cat-name {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.cat-values {
  margin-left: auto;
  flex: none;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.vs {
  color: var(--text-3);
}
.cat-change {
  flex: none;
  min-width: 44px;
  font-size: 12px;
  font-weight: 650;
  text-align: right;
  color: var(--text-2);
}
.pair {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bar {
  height: 7px;
  border-radius: 4px;
  background: var(--surface-3);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 4px;
  transition: width 360ms var(--ease-out);
}
.movers {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.mover-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.mover-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.mover-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mover-name.unnamed {
  color: var(--text-3);
  font-style: italic;
}
.mover-delta {
  flex: none;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 560px) {
  .figures {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .figures .figure:last-child {
    grid-column: span 2;
  }
  .movers {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
