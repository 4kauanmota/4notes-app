<script setup lang="ts">
/**
 * Lista lateral das Notas: as categorias ficam no topo (cada uma com a imagem, a
 * cor e as notas dela) e, embaixo, as notas sem categoria. Dentro de cada grupo
 * as notas aparecem em pastas pelo título (lib/notes/title-tree.ts).
 * Arraste uma aba (ou uma nota daqui) até uma categoria para colocá-la nela.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { revealItem, separator, showContextMenu, type MenuItemSpec } from '~/composables/useContextMenu'
import {
  categorySubmenu,
  handleCategoryChoice,
  isNoteDrag,
  NOTE_DRAG_TYPE,
  requestDeleteCategory,
  useCategoryDialog,
} from '~/composables/useNoteCategories'
import { useLayoutSize } from '~/composables/useLayoutSize'
import { exportSubmenu, handleExportChoice } from '~/composables/useNoteExport'
import { paletteVar } from '~/lib/colors'
import { nameKey } from '~/lib/files/filename'
import { categoryImagePath, type NoteCategory } from '~/lib/notes/categories'
import { deriveTitle } from '~/lib/notes/title'
import { buildTitleTree, flattenTree, folderPathTo, type TitleTreeNode, type TreeRow } from '~/lib/notes/title-tree'
import { canReveal, capabilities, modKeyLabel } from '~/lib/platform'
import { useAppStore } from '~/stores/app'
import { noteTitle, useNotesStore, type QuickNote } from '~/stores/notes'

const emit = defineEmits<{ new: [category: string | null, titlePrefix?: string] }>()
const notes = useNotesStore()
const app = useAppStore()
const categoryDialog = useCategoryDialog()
const mod = modKeyLabel()
const list = ref<HTMLElement>()
const reveal = canReveal()
const { layout } = useLayoutSize()

const count = computed(() => notes.visibleNotes.value.length)
const searching = computed(() => !!notes.state.search.trim())

// ── Grupos (categorias + sem categoria) e as pastas pelo título ─────────────

type Row = TreeRow<QuickNote>

const sectionKey = (category: NoteCategory | null) => (category ? `c:${nameKey(category.name)}` : 'root')

/** Notas de cada grupo (já filtradas pela busca). */
const notesBySection = computed(() => {
  const map = new Map<string, QuickNote[]>()
  for (const note of notes.filteredNotes.value) {
    const key = sectionKey(notes.categoryOf(note))
    const bucket = map.get(key)
    if (bucket) bucket.push(note)
    else map.set(key, [note])
  }
  return map
})

/** Pastas pelo título de cada grupo. */
const trees = computed(() => {
  const map = new Map<string, TitleTreeNode[]>()
  for (const [key, group] of notesBySection.value) {
    // As mais recentes no topo (pela data da última alteração), também dentro das pastas
    map.set(key, buildTitleTree(group.map((note) => ({ id: note.id, title: deriveTitle(note.content), time: note.mtimeMs }))))
  }
  return map
})

function rowsOf(category: NoteCategory | null): Row[] {
  const key = sectionKey(category)
  const byId = new Map((notesBySection.value.get(key) ?? []).map((note) => [note.id, note]))
  return flattenTree(trees.value.get(key) ?? [], byId, (folder) => searching.value || notes.isFolderOpen(category?.name ?? null, folder))
}

const sections = computed(() =>
  notes.state.categories
    .map((category) => {
      const total = notesBySection.value.get(sectionKey(category))?.length ?? 0
      const collapsed = !searching.value && notes.isCategoryCollapsed(category.name)
      return { category, key: sectionKey(category), total, collapsed, rows: collapsed ? [] : rowsOf(category) }
    })
    .filter((section) => !searching.value || section.total > 0),
)
const rootRows = computed(() => rowsOf(null))
const nothingFound = computed(() => searching.value && !notes.filteredNotes.value.length)

// A nota ativa fica à vista: as pastas (pelo título) até ela abrem sozinhas
const activePlace = computed(() => {
  const note = notes.activeNote.value
  if (!note) return null
  const category = notes.categoryOf(note)
  const path = folderPathTo(trees.value.get(sectionKey(category)) ?? [], note.id)
  return path ? { id: note.id, category: category?.name ?? null, path } : null
})
watch(
  () => (activePlace.value ? `${activePlace.value.id}|${activePlace.value.category}|${activePlace.value.path.join('/')}` : ''),
  async () => {
    const place = activePlace.value
    if (!place) return
    for (const key of place.path) notes.setFolderOpen(place.category, key, true)
    await nextTick()
    list.value?.querySelector(`[data-note="${place.id}"]`)?.scrollIntoView({ block: 'nearest' })
  },
)

// ── Ações ────────────────────────────────────────────────────────────────────

function onRowClick(row: Row, category: NoteCategory | null) {
  if (row.kind === 'note') {
    if (row.note) notes.openNote(row.note.id)
    return
  }
  if (row.note) {
    notes.openNote(row.note.id)
    if (!row.open) notes.setFolderOpen(category?.name ?? null, row.folderKey!, true)
    return
  }
  toggleFolder(row, category)
}

function toggleFolder(row: Row, category: NoteCategory | null) {
  if (!searching.value && row.folderKey) notes.setFolderOpen(category?.name ?? null, row.folderKey, !row.open)
}

function toggleCategory(category: NoteCategory) {
  if (!searching.value) notes.setCategoryCollapsed(category.name, !notes.isCategoryCollapsed(category.name))
}

function newNoteIn(category: NoteCategory | null) {
  if (category) notes.setCategoryCollapsed(category.name, false)
  emit('new', category?.name ?? null)
}

/** A nota mais recente da pasta (pela data da última alteração), sem precisar abrir a pasta e procurar. */
function openLatestInFolder(row: Row) {
  // As pastas até ela abrem sozinhas (activePlace), e a lista rola até a nota
  if (row.latest) notes.openNote(row.latest.id)
}

/** + de uma pasta pelo título: a nota nova começa com o título da pasta ("4notes …") e fica junto das outras. */
function newNoteInFolder(row: Row, category: NoteCategory | null) {
  if (!row.titlePath) return
  if (row.folderKey) notes.setFolderOpen(category?.name ?? null, row.folderKey, true)
  emit('new', category?.name ?? null, row.titlePath)
}

function noteMenuItems(note: QuickNote): MenuItemSpec[] {
  return [
    { id: 'open', label: 'Abrir' },
    categorySubmenu(note),
    { id: 'duplicate', label: 'Duplicar' },
    exportSubmenu(note),
    ...revealItem(!!note.path),
    separator,
    // (no celular, a "lixeira" é a pasta .4notes/trash do workspace — o aviso depois de excluir diz)
    { id: 'delete', label: capabilities().systemTrash ? 'Excluir (enviar para a Lixeira)' : 'Excluir', danger: true },
  ]
}

function runNoteChoice(choice: string | null, note: QuickNote) {
  if (handleCategoryChoice(choice, note) || handleExportChoice(choice, note)) return
  if (choice === 'open') notes.openNote(note.id)
  if (choice === 'duplicate') notes.duplicateNote(note.id)
  if (choice === 'reveal') notes.revealNote(note.id)
  if (choice === 'delete') void notes.deleteNote(note.id)
}

async function noteMenu(note: QuickNote) {
  runNoteChoice(await showContextMenu(noteMenuItems(note)), note)
}

async function categoryMenu(category: NoteCategory) {
  const collapsed = notes.isCategoryCollapsed(category.name)
  const choice = await showContextMenu([
    { id: 'new', label: 'Nova nota nesta categoria' },
    { id: 'edit', label: 'Editar categoria…' },
    { id: 'toggle', label: collapsed ? 'Expandir' : 'Recolher' },
    ...revealItem(),
    separator,
    { id: 'delete', label: 'Excluir categoria…', danger: true },
  ])
  if (choice === 'new') newNoteIn(category)
  if (choice === 'edit') categoryDialog.openEdit(category.name)
  if (choice === 'toggle') toggleCategory(category)
  if (choice === 'reveal') notes.revealCategory(category.name)
  if (choice === 'delete') void requestDeleteCategory(category.name)
}

async function folderMenu(row: Row, category: NoteCategory | null) {
  const choice = await showContextMenu([
    ...(row.latest ? [{ id: 'open-latest', label: `Abrir a mais recente (“${noteTitle(row.latest)}”)` }] : []),
    { id: 'new-in-folder', label: 'Nova nota nesta pasta' },
    { id: 'toggle', label: row.open ? 'Recolher pasta' : 'Expandir pasta', enabled: !searching.value },
    ...(row.note ? [separator, { id: 'note', label: `Nota “${noteTitle(row.note)}”`, submenu: noteMenuItems(row.note) }] : []),
  ])
  if (choice === 'open-latest') openLatestInFolder(row)
  else if (choice === 'new-in-folder') newNoteInFolder(row, category)
  else if (choice === 'toggle') toggleFolder(row, category)
  else if (row.note) runNoteChoice(choice, row.note)
}

function rowMenu(row: Row, category: NoteCategory | null) {
  if (row.kind === 'folder') void folderMenu(row, category)
  else if (row.note) void noteMenu(row.note)
}

// ── Arrastar notas para as categorias ───────────────────────────────────────

const dropZone = ref<string | null>(null)

function onDragOver(event: DragEvent, zone: string) {
  if (!isNoteDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropZone.value = zone
}

function onDragLeave(event: DragEvent, zone: string) {
  const target = event.currentTarget as HTMLElement
  if (dropZone.value === zone && !target.contains(event.relatedTarget as Node | null)) dropZone.value = null
}

function onDrop(event: DragEvent, category: NoteCategory | null) {
  dropZone.value = null
  const id = event.dataTransfer?.getData(NOTE_DRAG_TYPE)
  if (id) void notes.moveToCategory(id, category?.name ?? null)
}

// O arrastar pode começar numa aba e terminar (ou ser cancelado) em qualquer lugar
const clearDrop = () => (dropZone.value = null)
onMounted(() => window.addEventListener('dragend', clearDrop, true))
onBeforeUnmount(() => window.removeEventListener('dragend', clearDrop, true))
</script>

<template>
  <aside
    class="notes-sidebar"
    :class="{ open: notes.state.sidebarOpen, 'folders-upper': notes.state.settings.folderCase === 'upper' }"
    aria-label="Lista de notas"
  >
    <div class="sidebar-inner">
      <div class="sidebar-head">
        <label class="search">
          <AppIcon name="search" :size="15" />
          <input v-model="notes.state.search" placeholder="Buscar notas…" spellcheck="false" />
          <button v-if="notes.state.search" class="icon-btn sm" aria-label="Limpar busca" @click="notes.state.search = ''">
            <AppIcon name="x" :size="13" />
          </button>
        </label>
        <button class="icon-btn" :data-tip="`Nova nota (${mod}+N)`" aria-label="Nova nota" @click="emit('new', null)">
          <AppIcon name="plus" />
        </button>
      </div>

      <div ref="list" class="sidebar-list">
        <!-- Categorias (fixas no topo) -->
        <div v-if="!searching" class="section-head">
          <span class="section-label">Categorias</span>
          <button class="icon-btn sm" data-tip="Nova categoria" aria-label="Nova categoria" @click="categoryDialog.openCreate()">
            <AppIcon name="plus" :size="15" />
          </button>
        </div>
        <button v-if="!searching && !notes.state.categories.length" class="empty-cats" @click="categoryDialog.openCreate()">+ Criar uma categoria</button>

        <section
          v-for="section in sections"
          :key="section.key"
          class="category"
          :class="{ 'drop-target': dropZone === section.key }"
          :style="{ '--cat': paletteVar(section.category.color) }"
          :data-category="section.category.name"
          @dragover="onDragOver($event, section.key)"
          @dragleave="onDragLeave($event, section.key)"
          @drop.prevent="onDrop($event, section.category)"
        >
          <div
            class="category-row"
            role="button"
            tabindex="0"
            :aria-expanded="!section.collapsed"
            @click="toggleCategory(section.category)"
            @keydown.enter="toggleCategory(section.category)"
            @dblclick="categoryDialog.openEdit(section.category.name)"
            @contextmenu.prevent="categoryMenu(section.category)"
          >
            <AppIcon name="chevron-right" :size="13" class="chevron" :class="{ open: !section.collapsed }" />
            <CategoryAvatar
              :name="section.category.name"
              :color="section.category.color"
              :image="categoryImagePath(section.category)"
              :icon="section.category.icon"
              :version="notes.state.imageVersion"
            />
            <span class="category-name">{{ section.category.name }}</span>
            <span class="row-count">{{ section.total }}</span>
            <span class="category-actions">
              <span class="icon-btn sm" role="button" data-tip="Nova nota nesta categoria" aria-label="Nova nota nesta categoria" @click.stop="newNoteIn(section.category)">
                <AppIcon name="plus" :size="14" />
              </span>
              <span class="icon-btn sm" role="button" data-tip="Mais opções" aria-label="Opções da categoria" @click.stop="categoryMenu(section.category)">
                <AppIcon name="more" :size="14" />
              </span>
            </span>
          </div>

          <div v-if="!section.collapsed" class="category-notes">
            <NoteTreeRow
              v-for="row in section.rows"
              :key="row.key"
              :row="row"
              @activate="onRowClick(row, section.category)"
              @toggle="toggleFolder(row, section.category)"
              @menu="rowMenu(row, section.category)"
              @new="newNoteInFolder(row, section.category)"
              @latest="openLatestInFolder(row)"
            />
            <div v-if="!section.rows.length" class="category-empty">Sem notas — arraste uma aba para cá</div>
          </div>
        </section>

        <!-- Notas sem categoria -->
        <section
          class="loose"
          :class="{ 'drop-target': dropZone === 'root' }"
          @dragover="onDragOver($event, 'root')"
          @dragleave="onDragLeave($event, 'root')"
          @drop.prevent="onDrop($event, null)"
        >
          <!-- Só com notas sem categoria (ou arrastando uma nota até aqui, para tirar da categoria) -->
          <div v-if="notes.state.categories.length && (rootRows.length || dropZone === 'root')" class="section-head">
            <span class="section-label">Notas</span>
          </div>
          <NoteTreeRow
            v-for="row in rootRows"
            :key="row.key"
            :row="row"
            @activate="onRowClick(row, null)"
            @toggle="toggleFolder(row, null)"
            @menu="rowMenu(row, null)"
            @new="newNoteInFolder(row, null)"
            @latest="openLatestInFolder(row)"
          />
          <div v-if="dropZone === 'root' && !rootRows.length" class="category-empty">Solte aqui para tirar da categoria</div>
          <div v-if="nothingFound" class="sidebar-empty">Nada encontrado para “{{ notes.state.search }}”.</div>
          <div v-else-if="!count" class="sidebar-empty">
            Nenhuma nota ainda.<br />
            <template v-if="layout.touch">Toque no + para criar uma.</template>
            <template v-else>Crie uma com <kbd class="kbd">{{ mod }}</kbd> + <kbd class="kbd">N</kbd>.</template>
          </div>
        </section>
      </div>

      <footer class="sidebar-foot">
        <span>{{ count }} {{ count === 1 ? 'nota' : 'notas' }}</span>
        <button v-if="reveal" class="foot-link" @click="app.revealDataFolder()">Abrir pasta</button>
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
/* Tela média (Fold aberto): a lista um pouco mais estreita, sobra mais espaço para a nota */
html[data-layout='medium'] .notes-sidebar.open,
html[data-layout='medium'] .sidebar-inner {
  width: 248px;
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
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
  padding: 2px 8px 12px;
}
/* As notas sem categoria ocupam o resto da lista: soltar em qualquer lugar ali tira a categoria */
.loose {
  flex: 1 0 auto;
  min-height: 56px;
  border-radius: var(--r-lg);
  transition: background var(--t-fast), box-shadow var(--t-fast);
}

/* Exibição das pastas pelo título em CAIXA ALTA (só a aparência; o título das notas não muda) */
.folders-upper :deep(.tree-row.folder .row-label) {
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* ── Cabeçalhos ── */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  margin-top: 6px;
  padding: 0 4px 0 10px;
}

/* ── Categorias ── */
.category {
  margin-bottom: 2px;
  border-radius: var(--r-lg);
  transition: background var(--t-fast), box-shadow var(--t-fast);
}
.category.drop-target,
.loose.drop-target {
  background: color-mix(in srgb, var(--cat, var(--primary)) 10%, transparent);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--cat, var(--primary)) 60%, transparent);
}
.category-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 6px 0 4px;
  border-radius: var(--r-md);
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--t-fast);
}
html[data-touch] .category-row {
  height: 46px;
  font-size: 15px;
}
.category-row:hover {
  background: var(--hover);
}
.category-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.category-actions {
  display: none;
  gap: 1px;
}
.category-row:hover .category-actions,
.category-row:focus-within .category-actions {
  display: flex;
}
.category-row:hover .row-count {
  display: none;
}
.category-notes {
  position: relative;
  margin: 0 0 4px 13px;
  padding-left: 6px;
}
/* Linha guia na cor da categoria */
.category-notes::before {
  content: '';
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 2px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--cat) 45%, transparent);
}
.category-empty {
  padding: 6px 10px 8px;
  font-size: 12px;
  color: var(--text-3);
}
.chevron {
  flex: none;
  color: var(--text-3);
  transition: transform var(--t-fast) var(--ease-out);
}
.chevron.open {
  transform: rotate(90deg);
}

.row-count {
  flex: none;
  min-width: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 11.5px;
  font-weight: 650;
  line-height: 18px;
  text-align: center;
}

.empty-cats {
  width: 100%;
  margin: 2px 0 4px;
  padding: 8px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-3);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.empty-cats:hover {
  color: var(--primary-text);
  border-color: var(--primary);
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
</style>
