<script setup lang="ts">
/** Prévia ao passar o mouse sobre um nó (como um "card" da nota). */
import { computed } from 'vue'
import { paletteVar } from '~/lib/colors'
import { toPlainText } from '~/lib/editor/markup'
import { noteIdOfNode } from '~/lib/mindmap/graph'
import type { GraphNodeInfo } from '~/lib/mindmap/graph-view'
import { useMindmapStore } from '~/stores/mindmap'

const props = defineProps<{ node: GraphNodeInfo; x: number; y: number }>()
const mindmap = useMindmapStore()

const noteId = computed(() => noteIdOfNode(props.node.id))
const note = computed(() => mindmap.findNote(noteId.value))
const color = computed(() => mindmap.noteColor(noteId.value))
const excerpt = computed(() => {
  const text = toPlainText(note.value?.content ?? '')
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
})
</script>

<template>
  <div class="hover-card" :style="{ left: `${x + 18}px`, top: `${y + 14}px` }">
    <div class="card-title">
      <span class="dot" :style="color ? { background: paletteVar(color) } : undefined" />
      {{ node.title }}
    </div>
    <p v-if="excerpt" class="card-text">{{ excerpt }}</p>
    <p v-else class="card-text muted">Nota vazia — clique para escrever.</p>
    <div class="card-meta">
      <span><AppIcon name="link" :size="12" /> {{ node.degree }} {{ node.degree === 1 ? 'conexão' : 'conexões' }}</span>
      <span class="tip">Shift + arrastar para conectar</span>
    </div>
  </div>
</template>

<style scoped>
.hover-card {
  position: absolute;
  z-index: 25;
  width: 260px;
  padding: 12px 14px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  pointer-events: none;
  animation: appear 160ms var(--ease-out) 120ms both;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 650;
  font-size: 13.5px;
  color: var(--text);
}
.dot {
  width: 9px;
  height: 9px;
  flex: none;
  border-radius: 50%;
  background: var(--graph-node);
}
.card-text {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-2);
}
.card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--text-3);
}
.card-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tip {
  font-size: 11px;
  opacity: 0.85;
}
@keyframes appear {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
</style>
