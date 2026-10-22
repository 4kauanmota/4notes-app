<script setup lang="ts">
/**
 * Lista com barras horizontais (tempo por atividade, por dia da semana…): o nome e o
 * valor escritos em cada linha, a barra fina embaixo, na cor da categoria. Sem
 * balões: todo valor já está escrito.
 */
import { computed, ref } from 'vue'
import { TIME_FORMAT, type ChartFormat } from '~/lib/chart-format'

interface BarRow {
  key: string
  label: string
  /** Texto menor ao lado do nome (categoria, sessões…). */
  detail?: string
  /** Cor CSS da barra. */
  color: string
  ms: number
}

const props = withDefaults(
  defineProps<{
    rows: BarRow[]
    limit?: number
    emptyLabel?: string
    /** Como escrever os valores (padrão: tempo; as Finanças usam dinheiro). Os valores vêm em `ms`. */
    format?: ChartFormat
  }>(),
  { limit: 8, emptyLabel: 'Sem dados', format: () => TIME_FORMAT },
)
const formatDuration = (value: number, _options?: unknown) => props.format.full(value)

const expanded = ref(false)
const shown = computed(() => (expanded.value ? props.rows : props.rows.slice(0, props.limit)))
const max = computed(() => Math.max(1, ...props.rows.map((row) => row.ms)))
</script>

<template>
  <div class="bar-list">
    <p v-if="!rows.length" class="empty">{{ emptyLabel }}</p>
    <ol v-else>
      <li v-for="row in shown" :key="row.key">
        <div class="line">
          <span class="label" :class="{ unnamed: !row.label }">{{ row.label || 'Sem nome' }}</span>
          <span v-if="row.detail" class="detail">{{ row.detail }}</span>
          <span class="value">{{ formatDuration(row.ms, { seconds: false }) }}</span>
        </div>
        <div class="track">
          <div class="fill" :style="{ width: `${Math.max(1.5, (row.ms / max) * 100)}%`, background: row.color }" />
        </div>
      </li>
    </ol>
    <button v-if="rows.length > limit" type="button" class="more" @click="expanded = !expanded">
      {{ expanded ? 'Mostrar menos' : `Mostrar todas (${rows.length})` }}
    </button>
  </div>
</template>

<style scoped>
ol {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 13px;
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.label.unnamed {
  color: var(--text-3);
  font-style: italic;
}
.detail {
  flex: none;
  overflow: hidden;
  max-width: 40%;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--text-3);
}
.value {
  flex: none;
  margin-left: auto;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.track {
  height: 8px;
  border-radius: 4px;
  background: var(--surface-3);
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: 4px;
  transition: width 360ms var(--ease-out);
}
.empty {
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-3);
}
.more {
  margin-top: 10px;
  padding: 2px 0;
  border: none;
  background: none;
  color: var(--primary-text);
  font-size: 12.5px;
  cursor: pointer;
}
.more:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
