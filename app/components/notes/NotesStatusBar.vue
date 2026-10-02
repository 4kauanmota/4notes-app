<script setup lang="ts">
/** Barra de status inspirada no Bloco de Notas: posição do cursor, contagem e estado do salvamento. */
import { computed } from 'vue'
import { stripHtmlFormatting, stripImages } from '~/lib/editor/markup'
import type { CursorInfo } from '~/lib/editor/setup'
import { basename } from '~/lib/files/filename'
import { countWords } from '~/lib/notes/title'
import { useNotesStore, type QuickNote } from '~/stores/notes'

const props = defineProps<{ note: QuickNote; cursor: CursorInfo }>()
const notes = useNotesStore()

const words = computed(() => countWords(props.note.content))
const chars = computed(() => stripImages(stripHtmlFormatting(props.note.content)).length)
const fileName = computed(() => (props.note.path ? basename(props.note.path) : 'não salvo ainda'))

const status = computed(() => {
  switch (props.note.status) {
    case 'saving':
      return { label: 'Salvando…', cls: 'saving' }
    case 'dirty':
      return { label: 'Alterações pendentes', cls: 'dirty' }
    case 'error':
      return { label: 'Erro ao salvar', cls: 'error' }
    default:
      return { label: props.note.path ? 'Salvo' : 'Vazia', cls: 'saved' }
  }
})
</script>

<template>
  <footer class="status-bar">
    <span>Ln {{ cursor.line }}, Col {{ cursor.col }}</span>
    <span v-if="cursor.selected" class="accent">{{ cursor.selected }} selecionados</span>
    <span>{{ words }} {{ words === 1 ? 'palavra' : 'palavras' }}</span>
    <span>{{ chars }} caracteres</span>
    <span class="spacer" />
    <span class="save-state" :class="status.cls" :title="note.error ?? undefined">
      <span class="save-dot" />
      {{ status.label }}
    </span>
    <button
      class="file-name"
      :disabled="!note.path"
      :data-tip="note.path ? 'Mostrar no Explorador' : undefined"
      data-tip-pos="top"
      @click="notes.revealNote(note.id)"
    >
      {{ fileName }}
    </button>
    <span>Markdown</span>
    <span>UTF-8</span>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 18px;
  height: 30px;
  padding: 0 16px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
}
.spacer {
  flex: 1;
}
.accent {
  color: var(--accent-text);
}
.save-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.save-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  transition: background var(--t-med);
}
.save-state.dirty .save-dot {
  background: var(--accent-strong);
}
.save-state.saving .save-dot {
  background: var(--primary);
  animation: pulse 800ms ease-in-out infinite;
}
.save-state.error {
  color: var(--danger);
}
.save-state.error .save-dot {
  background: var(--danger);
}
.file-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.file-name:hover:not(:disabled) {
  color: var(--primary-text);
}
.file-name:disabled {
  cursor: default;
  font-style: italic;
}
@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
@media (max-width: 900px) {
  .status-bar > span:nth-last-child(-n + 2) {
    display: none;
  }
}
</style>
