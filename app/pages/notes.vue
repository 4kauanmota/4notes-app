<script setup lang="ts">
/**
 * Módulo NOTAS: lista + abas + editor + barra de status.
 *
 * No celular (layout compact) a lista e a nota são duas telas: tocar numa nota (ou
 * criar uma) abre a nota; o ‹ das abas ou o "voltar" do Android volta para a lista.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import MarkdownEditor from '~/components/editor/MarkdownEditor.vue'
import { onBackButton } from '~/composables/useBackButton'
import { SHORT_MAX, useLayoutSize } from '~/composables/useLayoutSize'
import { useShortcuts } from '~/composables/useShortcuts'
import type { MentionHost } from '~/lib/editor/host'
import type { CursorInfo } from '~/lib/editor/setup'
import { describeMention, mentionRevision, openMentionPath, savedLinkIcon, searchMentions } from '~/stores/mentions'
import { onNoteOpened, useNotesStore } from '~/stores/notes'

const notes = useNotesStore()
const editor = ref<InstanceType<typeof MarkdownEditor>>()
const cursor = ref<CursorInfo>({ line: 1, col: 1, selected: 0 })

// ── Celular: a lista ou a nota ──────────────────────────────────────────────

const { isCompact, layout } = useLayoutSize()
/** Barra de status só com espaço de sobra (não no celular, nem deitado/com o teclado aberto). */
const statusBar = computed(() => !isCompact.value && layout.height > SHORT_MAX)
/** Continua de onde parou: com uma nota aberta, começa nela. */
const screen = ref<'list' | 'note'>(notes.activeNote.value ? 'note' : 'list')
const stopOpened = onNoteOpened(() => (screen.value = 'note'))
onBeforeUnmount(stopOpened)
// Fechou a última aba: volta para a lista
watch(
  () => notes.activeNote.value,
  (note) => {
    if (!note) screen.value = 'list'
  },
)

function showList() {
  screen.value = 'list'
  ;(document.activeElement as HTMLElement | null)?.blur?.()
}

onBackButton(() => {
  if (!isCompact.value || screen.value !== 'note') return false
  showList()
  return true
})

/** Menções (@) a itens de todos os módulos — stores/mentions.ts. */
const mentions: MentionHost = {
  search: (query) => searchMentions(query, { exceptPath: notes.activeNote.value?.path ?? null }),
  describe: describeMention,
  open: openMentionPath,
  revision: () => mentionRevision.value,
  linkIcon: savedLinkIcon,
}

/**
 * Nota nova (na categoria `category`, se vier de uma categoria da lista lateral).
 * `titlePrefix` (o + de uma pasta pelo título): a nota já começa com o título da
 * pasta ("4notes ") e o cursor fica no fim, pronto para completar.
 */
function newNote(category: string | null = null, titlePrefix?: string) {
  if (titlePrefix) {
    // Com "Título na primeira linha" desligado, o começo do título entra como texto comum
    const heading = notes.state.settings.titleFirstLine ? '# ' : ''
    notes.createNote(`${heading}${titlePrefix} `, category, { template: true, autoCategory: true })
    void nextTick(() => editor.value?.focusEnd())
    return
  }
  notes.createNote('', category, { autoCategory: true })
  void nextTick(() => editor.value?.focus())
}

/** Você editou a nota: a aba dela fica fixa (a aba temporária não é trocada com alterações suas). */
function onEdit(value: string) {
  const note = notes.activeNote.value
  if (!note) return
  notes.updateContent(note.id, value)
  notes.pinTab(note.id)
}

function closeActive() {
  if (notes.state.activeId) void notes.closeTab(notes.state.activeId)
}

function saveActive() {
  if (notes.state.activeId) void notes.saveNow(notes.state.activeId)
}

useShortcuts({
  'mod+n': () => newNote(),
  'mod+t': () => newNote(),
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
  <div class="notes-page" :class="{ 'sidebar-open': notes.state.sidebarOpen, compact: isCompact, [`screen-${screen}`]: isCompact }">
    <NotesSidebar @new="newNote" />
    <section class="notes-main">
      <NotesTabs @new="newNote()" @list="showList" />
      <div class="notes-editor">
        <MarkdownEditor
          v-if="notes.activeNote.value"
          ref="editor"
          :doc-key="notes.activeNote.value.id"
          :model-value="notes.activeNote.value.content"
          :asset-base="notes.activeNote.value.dir"
          :mentions="mentions"
          :title-first-line="notes.state.settings.titleFirstLine"
          :placeholder="notes.state.settings.titleFirstLine ? 'Título da nota' : 'Comece a escrever…'"
          autofocus
          @update:model-value="onEdit"
          @cursor="(info) => (cursor = info)"
        />
        <NotesEmptyState v-else @new="newNote" />
      </div>
      <NotesStatusBar v-if="notes.activeNote.value && statusBar" :note="notes.activeNote.value" :cursor="cursor" />
    </section>
    <NoteCategoryDialog />
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

/* ── Celular: uma tela de cada vez (a lista ou a nota) ── */
.notes-page.compact.screen-list .notes-main {
  display: none;
}
.notes-page.compact.screen-note :deep(.notes-sidebar) {
  display: none;
}
.notes-page.compact.screen-list :deep(.notes-sidebar),
.notes-page.compact.screen-list :deep(.notes-sidebar .sidebar-inner) {
  flex: 1;
  width: 100%;
  border-right: none;
}
</style>
