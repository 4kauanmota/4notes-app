<script setup lang="ts">
/**
 * Uma linha da lista lateral das Notas: uma pasta (pelo título) ou uma nota.
 * Clique: abre a nota na aba temporária; duplo clique: abre numa aba fixa (`pin`).
 */
import { startNoteDrag } from '~/composables/useNoteCategories'
import { useNow } from '~/composables/useNow'
import { relativeTime } from '~/lib/dates'
import type { TreeRow } from '~/lib/notes/title-tree'
import { noteTitle, useNotesStore, type QuickNote } from '~/stores/notes'

const props = defineProps<{ row: TreeRow<QuickNote> }>()
const emit = defineEmits<{ activate: []; pin: []; toggle: []; menu: []; new: []; latest: [] }>()
const notes = useNotesStore()
const now = useNow()

/** Duplo clique na linha (não nos botões dela nem na setinha da pasta): fixa a nota. */
function onDoubleClick(event: MouseEvent) {
  if (!props.row.note || (event.target as HTMLElement).closest('button, .twisty')) return
  emit('pin')
}

function onDragStart(event: DragEvent) {
  if (props.row.note) startNoteDrag(event, props.row.note.id)
  else event.preventDefault()
}
</script>

<template>
  <div
    class="tree-row"
    :class="[row.kind, { active: !!row.note && row.note.id === notes.state.activeId, 'is-open': !!row.note && notes.state.openIds.includes(row.note.id) }]"
    :style="{ '--depth': row.depth }"
    :data-note="row.note?.id"
    :data-folder="row.folderKey ?? undefined"
    role="button"
    tabindex="0"
    :draggable="!!row.note"
    @click="emit('activate')"
    @dblclick="onDoubleClick"
    @keydown.enter="emit('activate')"
    @contextmenu.prevent="emit('menu')"
    @dragstart="onDragStart"
  >
    <span v-if="row.kind === 'folder'" class="twisty" @click.stop="emit('toggle')">
      <AppIcon name="chevron-right" :size="12" class="chevron" :class="{ open: row.open }" />
    </span>
    <span v-else class="twisty" />
    <AppIcon :name="row.kind === 'folder' ? (row.open ? 'folder-open' : 'folder') : 'notes'" :size="14" class="row-icon" />
    <span class="row-label" :title="row.note ? noteTitle(row.note) : row.label">{{ row.label }}</span>
    <template v-if="row.kind === 'folder'">
      <span class="row-count">{{ row.count }}</span>
      <button
        v-if="row.latest"
        class="row-latest icon-btn sm"
        :data-tip="`Abrir a mais recente: “${noteTitle(row.latest)}”`"
        data-tip-pos="left"
        aria-label="Abrir a nota mais recente da pasta"
        data-action="open-latest"
        @click.stop="emit('latest')"
      >
        <AppIcon name="clock" :size="14" />
      </button>
      <button
        class="row-new icon-btn sm"
        :data-tip="`Nova nota em “${row.titlePath}”`"
        data-tip-pos="left"
        aria-label="Nova nota nesta pasta"
        @click.stop="emit('new')"
      >
        <AppIcon name="plus" :size="14" />
      </button>
    </template>
    <template v-else-if="row.note">
      <span class="row-time">{{ row.note.path ? relativeTime(row.note.mtimeMs, now) : 'nova' }}</span>
      <button
        class="row-delete icon-btn sm danger"
        data-tip="Excluir"
        data-tip-pos="left"
        aria-label="Excluir nota"
        @click.stop="notes.deleteNote(row.note.id)"
      >
        <AppIcon name="trash" :size="13" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.tree-row {
  --row-accent: var(--cat, var(--accent-strong));
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px 0 calc(4px + var(--depth) * 16px);
  border-radius: var(--r-md);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}
/* Toque: linhas mais altas (alvo confortável para o dedo) */
html[data-touch] .tree-row {
  height: 42px;
  font-size: 14.5px;
}
.tree-row:hover {
  background: var(--hover);
  color: var(--text);
}
.tree-row.is-open {
  color: var(--text);
}
.tree-row.folder {
  color: var(--text);
  font-weight: 550;
}
.tree-row.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
}
.tree-row.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--row-accent);
}
.twisty {
  display: grid;
  place-items: center;
  flex: none;
  width: 16px;
  height: 20px;
  border-radius: 4px;
}
.twisty:hover {
  background: var(--hover);
}
.chevron {
  flex: none;
  color: var(--text-3);
  transition: transform var(--t-fast) var(--ease-out);
}
.chevron.open {
  transform: rotate(90deg);
}
.row-icon {
  flex: none;
  color: var(--text-3);
}
.tree-row.folder .row-icon {
  color: color-mix(in srgb, var(--cat, var(--primary)) 75%, var(--text-3));
}
.row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-time,
.row-count {
  flex: none;
  font-size: 11.5px;
  color: var(--text-3);
}
.row-delete {
  display: none;
  flex: none;
  width: 22px;
  height: 22px;
  margin-right: -4px;
}
.tree-row:hover .row-delete {
  display: grid;
}
.tree-row:hover .row-time {
  display: none;
}
/* Pasta: "abrir a mais recente" e o + aparecem no lugar da contagem */
.row-latest,
.row-new {
  display: none;
  flex: none;
  width: 22px;
  height: 22px;
}
.row-new {
  margin-right: -4px;
}
.tree-row.folder:hover .row-latest,
.tree-row.folder:focus-within .row-latest,
.tree-row.folder:hover .row-new,
.tree-row.folder:focus-within .row-new {
  display: grid;
}
.tree-row.folder:hover .row-count,
.tree-row.folder:focus-within .row-count {
  display: none;
}
.row-count {
  min-width: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-3);
  font-weight: 650;
  line-height: 18px;
  text-align: center;
}
</style>
