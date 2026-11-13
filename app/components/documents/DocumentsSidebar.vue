<script setup lang="ts">
/**
 * Lista lateral dos Documentos (1.7.3): busca, "Todos os documentos", "Sem categoria"
 * (só quando há algum) e as categorias. Arraste documentos da lista até uma categoria
 * para mudar a categoria deles.
 */
import { computed, ref } from 'vue'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import { DOCUMENT_DRAG_TYPE, type DocumentCategory } from '~/lib/documents/model'
import { modKeyLabel } from '~/lib/platform'
import { useDocumentsStore, type DocumentSelection } from '~/stores/documents'

const emit = defineEmits<{ import: []; 'new-category': []; 'edit-category': [id: string]; 'search-done': [] }>()
const documents = useDocumentsStore()
const mod = modKeyLabel()
const search = ref<HTMLInputElement>()

const total = computed(() => documents.state.documents.length)
const loose = computed(() => documents.countByCategory.value.get('none') ?? 0)
const searching = computed(() => !!documents.state.search.trim())
const showLoose = computed(() => loose.value > 0 || isActive('none'))

function isActive(selection: DocumentSelection) {
  return !searching.value && documents.state.selection === selection
}

function choose(selection: DocumentSelection) {
  documents.state.search = ''
  documents.state.openId = null
  documents.select(selection)
}

async function categoryMenu(category: DocumentCategory) {
  const index = documents.state.categories.findIndex((item) => item.id === category.id)
  const last = documents.state.categories.length - 1
  const choice = await showContextMenu([
    { id: 'edit', label: 'Editar categoria…' },
    { id: 'up', label: 'Mover para cima', enabled: index > 0 },
    { id: 'down', label: 'Mover para baixo', enabled: index >= 0 && index < last },
    separator,
    { id: 'delete', label: 'Excluir categoria…', danger: true },
  ])
  if (choice === 'edit') emit('edit-category', category.id)
  else if (choice === 'up' || choice === 'down') documents.moveCategory(category.id, choice === 'up' ? -1 : 1)
  else if (choice === 'delete') void documents.requestDeleteCategory(category.id)
}

// ── Soltar documentos numa categoria ────────────────────────────────────────

const dropZone = ref<string | null>(null)

function onDragOver(event: DragEvent, zone: string) {
  if (!event.dataTransfer?.types.includes(DOCUMENT_DRAG_TYPE)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropZone.value = zone
}

function onDragLeave(event: DragEvent, zone: string) {
  const target = event.currentTarget as HTMLElement
  if (dropZone.value === zone && !target.contains(event.relatedTarget as Node | null)) dropZone.value = null
}

function onDrop(event: DragEvent, categoryId: string | null) {
  dropZone.value = null
  const raw = event.dataTransfer?.getData(DOCUMENT_DRAG_TYPE)
  if (!raw) return
  const ids = raw.split(',').filter(Boolean)
  documents.setCategory(ids, categoryId)
}

defineExpose({ focusSearch: () => search.value?.focus() })
</script>

<template>
  <aside class="documents-sidebar" aria-label="Categorias de documentos">
    <label class="search">
      <AppIcon name="search" :size="15" />
      <input
        ref="search"
        v-model="documents.state.search"
        placeholder="Buscar documentos…"
        spellcheck="false"
        enterkeyhint="search"
        :aria-label="`Buscar documentos (${mod}+F)`"
        data-field="document-search"
        @input="documents.state.openId = null"
        @keydown.enter="emit('search-done')"
      />
      <button v-if="documents.state.search" class="icon-btn sm" aria-label="Limpar busca" @click="documents.state.search = ''">
        <AppIcon name="x" :size="13" />
      </button>
    </label>

    <div class="group">
      <button class="nav-item" :class="{ active: isActive('all') }" data-selection="all" @click="choose('all')">
        <AppIcon name="documents" :size="17" />
        <span class="nav-label">Todos os documentos</span>
        <span v-if="total" class="count">{{ total }}</span>
      </button>
      <button
        v-if="showLoose"
        class="nav-item"
        :class="{ active: isActive('none'), 'drop-target': dropZone === 'none' }"
        data-selection="none"
        @click="choose('none')"
        @dragover="onDragOver($event, 'none')"
        @dragleave="onDragLeave($event, 'none')"
        @drop.prevent="onDrop($event, null)"
      >
        <AppIcon name="inbox" :size="17" />
        <span class="nav-label">Sem categoria</span>
        <span v-if="loose" class="count">{{ loose }}</span>
      </button>
    </div>

    <div class="group-head">
      <span class="section-label">Categorias</span>
      <button class="icon-btn sm" data-tip="Nova categoria" aria-label="Nova categoria" data-action="new-document-category" @click="emit('new-category')"><AppIcon name="plus" :size="15" /></button>
    </div>
    <div class="group categories">
      <button
        v-for="category in documents.state.categories"
        :key="category.id"
        class="nav-item category"
        :class="{ active: isActive(`category:${category.id}`), 'drop-target': dropZone === category.id }"
        :data-category="category.name"
        @click="choose(`category:${category.id}`)"
        @dblclick="emit('edit-category', category.id)"
        @contextmenu.prevent="categoryMenu(category)"
        @dragover="onDragOver($event, category.id)"
        @dragleave="onDragLeave($event, category.id)"
        @drop.prevent="onDrop($event, category.id)"
      >
        <SharedCategoryIcon :id="category.id" :name="category.name" :color="category.color" :size="22" />
        <span class="nav-label">{{ category.name }}</span>
        <span v-if="documents.countByCategory.value.get(category.id)" class="count">{{ documents.countByCategory.value.get(category.id) }}</span>
        <span class="item-actions">
          <span class="icon-btn sm" role="button" data-tip="Mais opções" aria-label="Opções da categoria" @click.stop="categoryMenu(category)">
            <AppIcon name="more" :size="13" />
          </span>
        </span>
      </button>
      <button v-if="!documents.state.categories.length" class="empty-categories" @click="emit('new-category')">+ Criar a primeira categoria</button>
    </div>

    <footer class="sidebar-foot">
      <button class="import-btn" data-action="import-documents" :data-tip="`PDF, imagens, textos… (${mod}+O)`" @click="emit('import')">
        <AppIcon name="upload" :size="15" /> <span class="import-label">Importar documentos</span>
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.documents-sidebar {
  display: flex;
  flex-direction: column;
  width: 248px;
  flex: none;
  padding: 12px 10px 0;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
  overflow-y: auto;
}
html[data-layout='compact'] .documents-sidebar {
  width: 100%;
  border-right: none;
}
.search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  margin-bottom: 10px;
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
.group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 20px 4px 6px 10px;
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-2);
  font-size: 13.5px;
  font-weight: 550;
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast), box-shadow var(--t-fast);
}
html[data-touch] .nav-item {
  height: 44px;
  font-size: 15px;
}
.nav-item.category {
  padding-left: 7px;
}
.nav-item:hover {
  background: var(--hover);
  color: var(--text);
}
.nav-item.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
}
.nav-item.active > :deep(.app-icon) {
  color: var(--primary-text);
}
.nav-item.drop-target {
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--primary) 60%, transparent);
}
.nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  min-width: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 11.5px;
  font-weight: 650;
  line-height: 20px;
  text-align: center;
}
.nav-item.active .count {
  background: var(--accent);
  color: var(--on-accent);
}
.item-actions {
  display: none;
  margin-right: -4px;
}
.categories .nav-item:hover .item-actions {
  display: flex;
}
.categories .nav-item:hover .count {
  display: none;
}
.empty-categories {
  margin-top: 4px;
  padding: 8px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-3);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.empty-categories:hover {
  color: var(--primary-text);
  border-color: var(--primary);
}
.sidebar-foot {
  margin-top: auto;
  padding: 14px 4px 12px;
}
.import-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 34px;
  padding: 0 9px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
}
.import-btn:hover {
  border-color: var(--primary);
  color: var(--primary-text);
  background: var(--primary-soft);
}
.import-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 880px) {
  .documents-sidebar {
    width: 208px;
  }
}
</style>
