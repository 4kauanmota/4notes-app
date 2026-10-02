<script setup lang="ts">
/** Módulo NOTAS: lista + abas + editor + barra de status. */
import { nextTick, ref } from 'vue'
import MarkdownEditor from '~/components/editor/MarkdownEditor.vue'
import { useShortcuts } from '~/composables/useShortcuts'
import type { MentionHost } from '~/lib/editor/host'
import type { CursorInfo } from '~/lib/editor/setup'
import { DATA_PATHS } from '~/lib/storage/paths'
import { openMentionPath, searchNoteMentions, titleOfMentionPath } from '~/stores/mentions'
import { useNotesStore } from '~/stores/notes'

const notes = useNotesStore()
const editor = ref<InstanceType<typeof MarkdownEditor>>()
const cursor = ref<CursorInfo>({ line: 1, col: 1, selected: 0 })

/** Menções (@) a outras notas — das Notas e do Mapa Mental (stores/mentions.ts). */
const mentions: MentionHost = {
  search: (query) => searchNoteMentions(query, notes.activeNote.value?.path ?? null),
  titleOf: titleOfMentionPath,
  open: openMentionPath,
}

function newNote() {
  notes.createNote()
  void nextTick(() => editor.value?.focus())
}

function closeActive() {
  if (notes.state.activeId) void notes.closeTab(notes.state.activeId)
}

function saveActive() {
  if (notes.state.activeId) void notes.saveNow(notes.state.activeId)
}

useShortcuts({
  'mod+n': newNote,
  'mod+t': newNote,
  'mod+w': closeActive,
  'mod+s': saveActive,
  'mod+tab': () => notes.cycleTab(1),
  'mod+shift+tab': () => notes.cycleTab(-1),
  'mod+pagedown': () => notes.cycleTab(1),
  'mod+pageup': () => notes.cycleTab(-1),
  'mod+shift+t': () => {
    notes.reopenClosedTab()
  },
  'mod+\\': () => notes.toggleSidebar(),
})
</script>

<template>
  <div class="notes-page" :class="{ 'sidebar-open': notes.state.sidebarOpen }">
    <NotesSidebar @new="newNote" />
    <section class="notes-main">
      <NotesTabs @new="newNote" />
      <div class="notes-editor">
        <MarkdownEditor
          v-if="notes.activeNote.value"
          ref="editor"
          :doc-key="notes.activeNote.value.id"
          :model-value="notes.activeNote.value.content"
          :asset-base="DATA_PATHS.notesDir"
          :note-path="notes.activeNote.value.path"
          :mentions="mentions"
          placeholder="Comece a escrever… a primeira linha vira o título (ex.: # Minha nota)"
          autofocus
          @update:model-value="(value) => notes.updateContent(notes.activeNote.value!.id, value)"
          @cursor="(info) => (cursor = info)"
        />
        <NotesEmptyState v-else @new="newNote" />
      </div>
      <NotesStatusBar v-if="notes.activeNote.value" :note="notes.activeNote.value" :cursor="cursor" />
    </section>
  </div>
</template>

<style scoped>
.notes-page {
  display: flex;
  height: 100%;
}
.notes-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.notes-editor {
  flex: 1;
  min-height: 0;
  background: var(--surface);
}
</style>
