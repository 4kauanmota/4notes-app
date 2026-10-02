<script setup lang="ts">
/** Lista de todas as notas rápidas (para reabrir, buscar e excluir). */
import { computed } from 'vue'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import { useNow } from '~/composables/useNow'
import { relativeTime } from '~/lib/dates'
import { notePreview } from '~/lib/notes/title'
import { modKeyLabel } from '~/lib/platform'
import { useAppStore } from '~/stores/app'
import { noteTitle, useNotesStore, type QuickNote } from '~/stores/notes'

const emit = defineEmits<{ new: [] }>()
const notes = useNotesStore()
const app = useAppStore()
const now = useNow()
const mod = modKeyLabel()

const count = computed(() => notes.visibleNotes.value.length)

async function openMenu(note: QuickNote) {
  const choice = await showContextMenu([
    { id: 'open', label: 'Abrir' },
    { id: 'duplicate', label: 'Duplicar' },
    { id: 'reveal', label: 'Mostrar no Explorador', enabled: !!note.path },
    separator,
    { id: 'delete', label: 'Excluir (enviar para a Lixeira)', danger: true },
  ])
  if (choice === 'open') notes.openNote(note.id)
  if (choice === 'duplicate') notes.duplicateNote(note.id)
  if (choice === 'reveal') notes.revealNote(note.id)
  if (choice === 'delete') void notes.deleteNote(note.id)
}
</script>

<template>
  <aside class="notes-sidebar" :class="{ open: notes.state.sidebarOpen }" aria-label="Lista de notas">
    <div class="sidebar-inner">
      <div class="sidebar-head">
        <label class="search">
          <AppIcon name="search" :size="15" />
          <input v-model="notes.state.search" placeholder="Buscar notas…" spellcheck="false" />
          <button v-if="notes.state.search" class="icon-btn sm" aria-label="Limpar busca" @click="notes.state.search = ''">
            <AppIcon name="x" :size="13" />
          </button>
        </label>
        <button class="icon-btn" :data-tip="`Nova nota (${mod}+N)`" aria-label="Nova nota" @click="emit('new')">
          <AppIcon name="plus" />
        </button>
      </div>

      <div class="sidebar-list">
        <TransitionGroup name="note-row">
          <div
            v-for="note in notes.filteredNotes.value"
            :key="note.id"
            class="note-row"
            :class="{ active: note.id === notes.state.activeId, open: notes.state.openIds.includes(note.id) }"
            role="button"
            tabindex="0"
            @click="notes.openNote(note.id)"
            @keydown.enter="notes.openNote(note.id)"
            @contextmenu.prevent="openMenu(note)"
          >
            <div class="note-row-top">
              <span class="note-row-title">{{ noteTitle(note) }}</span>
              <span class="note-row-time">{{ note.path ? relativeTime(note.mtimeMs, now) : 'nova' }}</span>
            </div>
            <div class="note-row-preview">{{ notePreview(note.content) || 'Sem mais texto' }}</div>
            <button
              class="note-row-delete icon-btn sm danger"
              data-tip="Excluir"
              data-tip-pos="left"
              aria-label="Excluir nota"
              @click.stop="notes.deleteNote(note.id)"
            >
              <AppIcon name="trash" :size="14" />
            </button>
          </div>
        </TransitionGroup>

        <div v-if="!notes.filteredNotes.value.length" class="sidebar-empty">
          <template v-if="notes.state.search">Nada encontrado para “{{ notes.state.search }}”.</template>
          <template v-else>Nenhuma nota ainda.<br />Crie uma com <kbd class="kbd">{{ mod }}</kbd> + <kbd class="kbd">N</kbd>.</template>
        </div>
      </div>

      <footer class="sidebar-foot">
        <span>{{ count }} {{ count === 1 ? 'nota' : 'notas' }}</span>
        <button class="foot-link" @click="app.revealDataFolder()">Abrir pasta</button>
      </footer>
    </div>
  </aside>
</template>

<style scoped>
.notes-sidebar {
  flex: none;
  width: 0;
  overflow: hidden;
  border-right: 1px solid transparent;
  background: var(--surface-2);
  transition: width 260ms var(--ease-out), border-color 260ms;
}
.notes-sidebar.open {
  width: 272px;
  border-right-color: var(--border);
}
.sidebar-inner {
  display: flex;
  flex-direction: column;
  width: 272px;
  height: 100%;
}
.sidebar-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 10px 8px 12px;
}
.search {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  height: 32px;
  padding: 0 6px 0 10px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-3);
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
}
.search:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}
.search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.search input::placeholder {
  color: var(--text-3);
}
.sidebar-list {
  position: relative;
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 12px;
}
.note-row {
  position: relative;
  display: block;
  width: 100%;
  margin-bottom: 2px;
  padding: 9px 12px 10px;
  border-radius: var(--r-lg);
  cursor: pointer;
  transition: background var(--t-fast);
}
.note-row:hover {
  background: var(--hover);
}
.note-row.active {
  background: var(--surface);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
}
.note-row.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--accent-strong);
}
.note-row-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.note-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: 13.5px;
  color: var(--text);
}
.note-row-time {
  flex: none;
  font-size: 11.5px;
  color: var(--text-3);
  transition: opacity var(--t-fast);
}
.note-row-preview {
  margin-top: 2px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-3);
}
.note-row-delete {
  position: absolute;
  top: 7px;
  right: 7px;
  opacity: 0;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition: opacity var(--t-fast);
}
.note-row:hover .note-row-delete {
  opacity: 1;
}
.note-row:hover .note-row-time {
  opacity: 0;
}
.sidebar-empty {
  padding: 28px 12px;
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
  line-height: 1.9;
}
.sidebar-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-3);
}
.foot-link {
  border: none;
  background: none;
  padding: 0;
  color: var(--primary-text);
  font-size: 12px;
  cursor: pointer;
}
.foot-link:hover {
  text-decoration: underline;
}

.note-row-enter-active,
.note-row-leave-active {
  transition: opacity 200ms var(--ease-out), transform 220ms var(--ease-out);
}
.note-row-enter-from,
.note-row-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
.note-row-leave-active {
  position: absolute;
  left: 8px;
  right: 8px;
}
.note-row-move {
  transition: transform 260ms var(--ease-out);
}
</style>
