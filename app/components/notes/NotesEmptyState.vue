<script setup lang="ts">
/** Tela exibida quando nenhuma aba está aberta. */
import { computed } from 'vue'
import { useNow } from '~/composables/useNow'
import { relativeTime } from '~/lib/dates'
import { modKeyLabel } from '~/lib/platform'
import { noteTitle, useNotesStore } from '~/stores/notes'

const emit = defineEmits<{ new: [] }>()
const notes = useNotesStore()
const now = useNow()
const mod = modKeyLabel()
const recent = computed(() => notes.visibleNotes.value.slice(0, 5))
</script>

<template>
  <div class="empty">
    <div class="empty-card">
      <div class="empty-art" aria-hidden="true">
        <span class="sheet back" />
        <span class="sheet front">
          <span class="line l1" />
          <span class="line l2" />
          <span class="line l3" />
        </span>
      </div>
      <h2>Nenhuma nota aberta</h2>
      <p>Notas rápidas para ideias, rascunhos e lembretes. A primeira linha vira o título.</p>
      <button class="btn btn-primary btn-lg" @click="emit('new')">
        <AppIcon name="plus" :size="17" /> Nova nota
        <span class="shortcut">{{ mod }}+N</span>
      </button>

      <div v-if="recent.length" class="recent">
        <div class="section-label">Recentes</div>
        <button v-for="note in recent" :key="note.id" class="recent-item" @click="notes.openNote(note.id, { preview: true })">
          <AppIcon name="notes" :size="15" />
          <span class="recent-title">{{ noteTitle(note) }}</span>
          <span class="recent-time">{{ relativeTime(note.mtimeMs, now) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.empty {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 32px;
  overflow: auto;
}
.empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(420px, 100%);
  text-align: center;
  animation: rise 420ms var(--ease-out) both;
}
.empty-art {
  position: relative;
  width: 92px;
  height: 92px;
  margin-bottom: 18px;
}
.sheet {
  position: absolute;
  width: 62px;
  height: 76px;
  border-radius: 10px;
}
.sheet.back {
  left: 26px;
  top: 4px;
  background: var(--accent);
  transform: rotate(9deg);
  opacity: 0.9;
}
.sheet.front {
  left: 8px;
  top: 10px;
  background: var(--surface);
  border: 1.5px solid var(--border-strong);
  box-shadow: var(--shadow-md);
  transform: rotate(-5deg);
  transition: transform 400ms var(--ease-spring);
}
.empty-card:hover .sheet.front {
  transform: rotate(-9deg) translateY(-3px);
}
.line {
  position: absolute;
  left: 11px;
  height: 5px;
  border-radius: 3px;
  background: var(--primary-soft-2);
}
.l1 {
  top: 14px;
  width: 30px;
  background: var(--primary);
}
.l2 {
  top: 28px;
  width: 38px;
}
.l3 {
  top: 40px;
  width: 26px;
}
h2 {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
}
p {
  margin: 8px 0 20px;
  color: var(--text-2);
  line-height: 1.55;
}
.shortcut {
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 11.5px;
  font-weight: 600;
}
.recent {
  width: 100%;
  margin-top: 30px;
  text-align: left;
}
.recent .section-label {
  margin: 0 0 6px 10px;
}
.recent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-2);
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}
.recent-item:hover {
  background: var(--hover);
  color: var(--text);
}
.recent-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-time {
  font-size: 12px;
  color: var(--text-3);
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
</style>
