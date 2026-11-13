<script setup lang="ts">
/**
 * Módulo DOCUMENTOS (1.7.3): categorias à esquerda; à direita, a lista dos documentos
 * ou o documento aberto (PDF com anotações, imagem, texto).
 *
 * Importar (botão, Ctrl+O ou arrastar arquivos para a tela) guarda uma cópia em
 * documents/arquivos/. Marque vários documentos para mudar a categoria ou excluir.
 */
import { computed, nextTick, reactive, ref } from 'vue'
import DocumentsSidebar from '~/components/documents/DocumentsSidebar.vue'
import { onBackButton } from '~/composables/useBackButton'
import { pickCategory } from '~/composables/useCategoryPicker'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import { promptDialog } from '~/composables/useDialog'
import { useLayoutSize } from '~/composables/useLayoutSize'
import { useShortcuts } from '~/composables/useShortcuts'
import { DOCUMENT_DRAG_TYPE, formatSize, KIND_LABELS, type DocumentKind, type DocumentSort, type StoredDocument } from '~/lib/documents/model'
import { pickFiles } from '~/lib/mobile/pick-files'
import { canReveal, hasDesktopApi, modKeyLabel } from '~/lib/platform'
import { useDocumentsStore } from '~/stores/documents'

const documents = useDocumentsStore()
const mod = modKeyLabel()
const reveal = canReveal()
const sidebar = ref<InstanceType<typeof DocumentsSidebar>>()
const { isCompact } = useLayoutSize()
const categoriesOpen = ref(false)
const categoryDialog = reactive({ open: false, id: null as string | null })

const searching = computed(() => !!documents.state.search.trim())
const category = computed(() => documents.selectedCategory.value)
const shown = computed(() => documents.visibleDocuments.value)
const opened = computed(() => documents.openDocument.value)
const checked = computed(() => documents.state.checked)
const allChecked = computed(() => shown.value.length > 0 && shown.value.every((doc) => checked.value.includes(doc.id)))
const showCategory = computed(() => searching.value || documents.state.selection === 'all')

const header = computed(() => {
  const count = shown.value.length
  const countLabel = `${count} ${count === 1 ? 'documento' : 'documentos'}`
  if (searching.value) return { title: 'Busca', subtitle: count ? `${count} ${count === 1 ? 'resultado' : 'resultados'}` : 'Nenhum resultado' }
  if (category.value) return { title: category.value.name, subtitle: count ? countLabel : 'Nenhum documento nesta categoria' }
  if (documents.state.selection === 'none') return { title: 'Sem categoria', subtitle: count ? countLabel : 'Nenhum documento sem categoria' }
  return { title: 'Todos os documentos', subtitle: count ? countLabel : 'Nenhum documento guardado ainda' }
})

const SORT_OPTIONS: { value: DocumentSort; label: string }[] = [
  { value: 'recent', label: 'Recentes' },
  { value: 'name', label: 'A–Z' },
  { value: 'kind', label: 'Tipo' },
]
const sort = computed({ get: () => documents.state.sort, set: (value: DocumentSort) => documents.setSort(value) })

const KIND_ICONS: Record<DocumentKind, string> = { pdf: 'file-text', image: 'image', text: 'notes', other: 'documents' }

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
const dateOf = (doc: StoredDocument) => dateFormat.format(new Date(doc.addedAt)).replace('.', '')

// ── Importar ────────────────────────────────────────────────────────────────

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp,.avif,.svg,.txt,.md,.csv,.json,.log,.xml,.yml,.yaml,*/*'

async function importDocuments() {
  categoriesOpen.value = false
  const files = await pickFiles({ accept: ACCEPT, multiple: true })
  if (files.length) await documents.importFiles(files, category.value?.id ?? null)
}

const dragging = ref(0)
const isFileDrag = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files') && !event.dataTransfer.types.includes(DOCUMENT_DRAG_TYPE)

function onDragEnter(event: DragEvent) {
  if (!isFileDrag(event)) return
  event.preventDefault()
  dragging.value++
}
function onDragOver(event: DragEvent) {
  if (!isFileDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}
function onDragLeave(event: DragEvent) {
  if (isFileDrag(event)) dragging.value = Math.max(0, dragging.value - 1)
}
function onDrop(event: DragEvent) {
  if (!isFileDrag(event)) return
  event.preventDefault()
  dragging.value = 0
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length) void documents.importFiles(files, category.value?.id ?? null)
}

// ── Lista ───────────────────────────────────────────────────────────────────

function openDoc(doc: StoredDocument) {
  documents.open(doc.id)
}

function closeDoc() {
  documents.open(null)
}

function onRowClick(event: MouseEvent, doc: StoredDocument) {
  // Ctrl/Shift + clique (ou com algo marcado): marca em vez de abrir
  if (event.ctrlKey || event.metaKey || event.shiftKey || checked.value.length) {
    documents.toggleChecked(doc.id)
    return
  }
  openDoc(doc)
}

function onDragStart(event: DragEvent, doc: StoredDocument) {
  const ids = checked.value.includes(doc.id) ? checked.value : [doc.id]
  event.dataTransfer?.setData(DOCUMENT_DRAG_TYPE, ids.join(','))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function toggleAll() {
  documents.setChecked(allChecked.value ? [] : shown.value.map((doc) => doc.id))
}

async function chooseCategory(ids: string[]) {
  const first = documents.findDocument(ids[0]!)
  const picked = await pickCategory({ module: 'documents', selected: [ids.length === 1 ? (first?.categoryId ?? null) : null], title: ids.length === 1 ? 'Categoria do documento' : `Categoria de ${ids.length} documentos` })
  if (picked) documents.setCategory(ids, picked[0] ?? null)
}

async function rename(doc: StoredDocument) {
  const name = await promptDialog({ title: 'Renomear documento', label: 'Nome', value: doc.name, confirmLabel: 'Renomear', icon: 'edit' })
  if (name !== null) documents.renameDocument(doc.id, name)
}

async function rowMenu(doc: StoredDocument) {
  const many = checked.value.length > 1 && checked.value.includes(doc.id)
  const ids = many ? [...checked.value] : [doc.id]
  const choice = await showContextMenu(
    many
      ? [
          { id: 'category', label: `Categoria de ${ids.length} documentos…` },
          separator,
          { id: 'delete', label: `Excluir ${ids.length} documentos…`, danger: true },
        ]
      : [
          { id: 'open', label: 'Abrir' },
          { id: 'rename', label: 'Renomear…' },
          { id: 'category', label: 'Categoria…' },
          { id: 'check', label: checked.value.includes(doc.id) ? 'Desmarcar' : 'Marcar' },
          ...(doc.kind === 'other' && hasDesktopApi() && window.fourNotes?.documents?.openExternal ? [{ id: 'external', label: 'Abrir no programa do sistema' }] : []),
          ...(reveal ? [{ id: 'reveal', label: 'Mostrar no Explorador' }] : []),
          separator,
          { id: 'delete', label: 'Excluir…', danger: true },
        ],
  )
  if (choice === 'open') openDoc(doc)
  else if (choice === 'rename') void rename(doc)
  else if (choice === 'category') void chooseCategory(ids)
  else if (choice === 'check') documents.toggleChecked(doc.id)
  else if (choice === 'external') void documents.openExternal(doc.id)
  else if (choice === 'reveal') documents.revealDocument(doc.id)
  else if (choice === 'delete') void documents.requestDelete(ids)
}

// ── Categorias ──────────────────────────────────────────────────────────────

const editingCategory = computed(() => (categoryDialog.id ? (documents.categoryById.value.get(categoryDialog.id) ?? null) : null))

function openCategoryDialog(id: string | null) {
  categoriesOpen.value = false
  categoryDialog.id = id
  categoryDialog.open = true
}

// ── Teclado e "voltar" ──────────────────────────────────────────────────────

useShortcuts({
  'mod+o': () => void importDocuments(),
  'mod+f': () => {
    documents.state.openId = null
    if (isCompact.value) categoriesOpen.value = true
    void nextTick(() => sidebar.value?.focusSearch())
  },
})

/** Esc fecha o documento aberto (ou desmarca), menos dentro de um campo. */
function onEscape(event: KeyboardEvent) {
  if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
  if (opened.value) closeDoc()
  else if (checked.value.length) documents.setChecked([])
  else return
  event.preventDefault()
}

onBackButton(() => {
  if (!opened.value) return false
  closeDoc()
  return true
})
</script>

<template>
  <div class="documents-page" @keydown.esc="onEscape" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <MobileDrawer v-model:open="categoriesOpen" label="Categorias de documentos">
      <DocumentsSidebar
        ref="sidebar"
        @import="importDocuments"
        @search-done="categoriesOpen = false"
        @new-category="openCategoryDialog(null)"
        @edit-category="openCategoryDialog"
      />
    </MobileDrawer>

    <section class="documents-main">
      <div v-if="documents.state.error" class="documents-error">
        <AppIcon name="alert" :size="34" />
        <h2>Não foi possível ler o arquivo dos documentos</h2>
        <p class="selectable">{{ documents.state.error }}</p>
        <p class="muted">Nada foi sobrescrito. Corrija o arquivo <code>documents/documents.json</code> e tente de novo.</p>
        <button class="btn btn-primary" @click="documents.retry()">Tentar novamente</button>
      </div>

      <DocumentViewer v-else-if="opened" :doc="opened" @close="closeDoc" />

      <div v-else class="documents-scroll">
        <div class="documents-content module-content">
          <header class="documents-header">
            <button v-if="isCompact" class="icon-btn categories-toggle" aria-label="Categorias" data-action="document-categories" @click="categoriesOpen = true">
              <AppIcon name="sidebar" :size="19" />
            </button>
            <div class="title-block">
              <h1>
                <SharedCategoryIcon v-if="category && !searching" :id="category.id" :name="category.name" :color="category.color" :size="28" />
                <span class="title-text">{{ header.title }}</span>
              </h1>
              <p>
                {{ header.subtitle }}
                <span v-if="documents.state.importing" class="importing">· Importando {{ documents.state.importing.done }}/{{ documents.state.importing.total }}…</span>
              </p>
            </div>
            <div class="header-side">
              <UiSegmented v-if="shown.length > 1" v-model="sort" :options="SORT_OPTIONS" size="sm" aria-label="Ordem dos documentos" />
              <button class="btn btn-sm btn-primary" data-action="import" :data-tip="`Importar (${mod}+O)`" @click="importDocuments">
                <AppIcon name="upload" :size="14" /> Importar
              </button>
            </div>
          </header>

          <div v-if="checked.length" class="bulk-bar" data-bulk>
            <span class="bulk-count">{{ checked.length }} {{ checked.length === 1 ? 'marcado' : 'marcados' }}</span>
            <button class="btn btn-sm" data-action="bulk-category" @click="chooseCategory([...checked])"><AppIcon name="tag" :size="14" /> Categoria…</button>
            <button class="btn btn-sm btn-ghost danger" data-action="bulk-delete" @click="documents.requestDelete([...checked])"><AppIcon name="trash" :size="14" /> Excluir</button>
            <span class="spacer" />
            <button class="btn btn-sm btn-ghost" @click="documents.setChecked([])">Desmarcar</button>
          </div>

          <div v-if="shown.length" class="doc-list" role="list" aria-label="Documentos">
            <div class="list-head">
              <label class="check" :data-tip="allChecked ? 'Desmarcar todos' : 'Marcar todos'">
                <input type="checkbox" :checked="allChecked" aria-label="Marcar todos" @change="toggleAll" />
              </label>
              <span class="col-name">Nome</span>
              <span v-if="showCategory" class="col-category">Categoria</span>
              <span class="col-size">Tamanho</span>
              <span class="col-date">Adicionado</span>
            </div>
            <div
              v-for="doc in shown"
              :key="doc.id"
              class="doc-row"
              :class="{ checked: checked.includes(doc.id) }"
              role="listitem"
              :data-document="doc.name"
              draggable="true"
              tabindex="0"
              @click="onRowClick($event, doc)"
              @keydown.enter.prevent="openDoc(doc)"
              @keydown.space.prevent="documents.toggleChecked(doc.id)"
              @contextmenu.prevent="rowMenu(doc)"
              @dragstart="onDragStart($event, doc)"
            >
              <label class="check" @click.stop>
                <input type="checkbox" :checked="checked.includes(doc.id)" :aria-label="`Marcar ${doc.name}`" @change="documents.toggleChecked(doc.id)" />
              </label>
              <span class="col-name">
                <span class="kind" :data-kind="doc.kind"><AppIcon :name="KIND_ICONS[doc.kind]" :size="16" /></span>
                <span class="name-text">{{ doc.name }}</span>
                <span class="kind-label">{{ KIND_LABELS[doc.kind] }}</span>
              </span>
              <span v-if="showCategory" class="col-category">
                <template v-if="documents.categoryOf(doc)">
                  <SharedCategoryIcon :id="doc.categoryId" :name="documents.categoryOf(doc)!.name" :color="documents.categoryOf(doc)!.color" :size="16" />
                  <span class="category-name">{{ documents.categoryOf(doc)!.name }}</span>
                </template>
              </span>
              <span class="col-size">{{ formatSize(doc.size) }}</span>
              <span class="col-date">{{ dateOf(doc) }}</span>
              <button class="icon-btn sm row-menu" aria-label="Opções do documento" @click.stop="rowMenu(doc)"><AppIcon name="more" :size="15" /></button>
            </div>
          </div>

          <div v-else-if="!searching && !documents.state.documents.length" class="documents-empty">
            <span class="empty-icon"><AppIcon name="documents" :size="30" /></span>
            <h2>Guarde seus documentos aqui</h2>
            <p>PDFs, imagens e textos ficam numa pasta do seu workspace, organizados por categoria. Nos PDFs dá para desenhar, marcar e escrever por cima.</p>
            <button class="btn btn-primary" data-action="import-empty" @click="importDocuments"><AppIcon name="upload" :size="15" /> Importar documentos</button>
            <p class="muted">Ou arraste os arquivos para esta tela.</p>
          </div>
          <p v-else class="muted list-empty">{{ searching ? 'Nenhum documento com esse nome.' : 'Nada aqui ainda: importe ou arraste documentos para esta categoria.' }}</p>
        </div>
      </div>

      <div v-if="dragging" class="drop-overlay">
        <div class="drop-card"><AppIcon name="upload" :size="20" /> Solte para guardar{{ category ? ` em “${category.name}”` : '' }}</div>
      </div>
    </section>

    <CategoryDialog
      :open="categoryDialog.open"
      :category="editingCategory"
      :source="documents.categorySource"
      placeholder="Ex.: Casa, Saúde, Trabalho"
      @close="categoryDialog.open = false"
    />
  </div>
</template>

<style scoped>
.documents-page {
  display: flex;
  height: 100%;
}
.documents-main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.documents-scroll {
  flex: 1;
  overflow-y: auto;
}
.documents-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 16px;
  margin-bottom: 18px;
}
.title-block {
  flex: 1 1 220px;
  min-width: 0;
}
.title-block h1 {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 750;
  letter-spacing: -0.02em;
}
.title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title-block p {
  margin-top: 3px;
  color: var(--text-3);
  font-size: 13.5px;
}
.importing {
  color: var(--primary-text);
}
.header-side {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  padding-top: 4px;
}
.bulk-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: var(--r-md);
  background: var(--primary-soft);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 30%, transparent);
}
.bulk-count {
  color: var(--primary-text);
  font-size: 13px;
  font-weight: 650;
}
.spacer {
  flex: 1;
}
.danger {
  color: var(--danger);
}
.doc-list {
  display: flex;
  flex-direction: column;
  container-type: inline-size;
}
.list-head,
.doc-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) minmax(0, 180px) 84px 108px 32px;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
}
.doc-list:not(:has(.col-category)) .list-head,
.doc-list:not(:has(.col-category)) .doc-row {
  grid-template-columns: 28px minmax(0, 1fr) 84px 108px 32px;
}
.list-head {
  height: 30px;
  border-bottom: 1px solid var(--border);
  color: var(--text-3);
  font-size: 11.5px;
  font-weight: 650;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.list-head .col-name {
  grid-column: 2;
}
.doc-row {
  min-height: 46px;
  border-radius: var(--r-md);
  color: var(--text);
  cursor: pointer;
  outline: none;
}
.doc-row:hover {
  background: var(--hover);
}
.doc-row:focus-visible {
  box-shadow: inset 0 0 0 2px var(--primary-soft-2);
}
.doc-row.checked {
  background: var(--primary-soft);
}
.check {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  cursor: pointer;
}
.check input {
  width: 16px;
  height: 16px;
  accent-color: var(--primary);
  cursor: pointer;
}
.col-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.kind {
  display: grid;
  flex: none;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--surface-3);
  color: var(--text-2);
}
.kind[data-kind='pdf'] {
  background: color-mix(in srgb, var(--cat-red) 14%, transparent);
  color: var(--cat-red);
}
.kind[data-kind='image'] {
  background: color-mix(in srgb, var(--cat-blue) 14%, transparent);
  color: var(--cat-blue);
}
.kind[data-kind='text'] {
  background: var(--primary-soft);
  color: var(--primary-text);
}
.name-text {
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kind-label {
  flex: none;
  color: var(--text-3);
  font-size: 11.5px;
}
.col-category {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--text-2);
  font-size: 12.5px;
}
.category-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-size,
.col-date {
  color: var(--text-3);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.row-menu {
  opacity: 0;
}
.doc-row:hover .row-menu,
.doc-row:focus-within .row-menu,
html[data-touch] .row-menu {
  opacity: 1;
}
.documents-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 52ch;
  margin: 48px auto;
  text-align: center;
  color: var(--text-2);
}
.empty-icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: var(--primary-soft);
  color: var(--primary-text);
}
.documents-empty h2 {
  color: var(--text);
  font-family: var(--font-display);
  font-size: 20px;
}
.muted {
  color: var(--text-3);
  font-size: 13px;
}
.list-empty {
  padding: 20px 8px;
}
.documents-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  padding: 32px;
  text-align: center;
  color: var(--text-2);
}
.documents-error > :deep(.app-icon) {
  color: var(--danger);
}
.documents-error code {
  font-family: var(--font-mono);
}
.drop-overlay {
  position: absolute;
  inset: 10px;
  z-index: 5;
  display: grid;
  place-items: center;
  border: 2px dashed var(--primary);
  border-radius: var(--r-xl);
  background: color-mix(in srgb, var(--primary-soft) 70%, transparent);
  pointer-events: none;
}
.drop-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-radius: var(--r-lg);
  background: var(--elevated);
  box-shadow: var(--shadow-md);
  color: var(--primary-text);
  font-weight: 600;
}
/* Lista estreita (Fold aberto com a lista lateral, celular): menos colunas */
@container (max-width: 640px) {
  .list-head,
  .doc-row,
  .doc-list:not(:has(.col-category)) .list-head,
  .doc-list:not(:has(.col-category)) .doc-row {
    grid-template-columns: 28px minmax(0, 1fr) 72px 32px;
  }
  .col-category,
  .col-date {
    display: none;
  }
}
@container (max-width: 440px) {
  .list-head {
    display: none;
  }
  .doc-row,
  .doc-list:not(:has(.col-category)) .doc-row {
    grid-template-columns: 28px minmax(0, 1fr) 40px;
  }
  .col-size {
    display: none;
  }
}
html[data-layout='compact'] .doc-row {
  min-height: 56px;
}
</style>
