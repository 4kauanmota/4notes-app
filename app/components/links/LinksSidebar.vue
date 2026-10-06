<script setup lang="ts">
/**
 * Lista lateral dos Links: busca, "Todos os links", "Sem categoria" (só quando há
 * links sem categoria — ou enquanto um link é arrastado, para soltar ali) e as
 * categorias. Arraste um link da lista até uma categoria para movê-lo (ou um link
 * do navegador, para salvá-lo nela); arraste as categorias para reordenar.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import { showToast } from '~/composables/useToasts'
import { droppedText, isExternalLinkDrag, isLinkDrag, LINK_DRAG_TYPE } from '~/lib/links/drag'
import type { LinkFolder } from '~/lib/links/model'
import { modKeyLabel } from '~/lib/platform'
import { useLinksStore, type LinkSelection } from '~/stores/links'

const emit = defineEmits<{ import: []; 'new-folder': []; 'edit-folder': [id: string] }>()
const links = useLinksStore()
const mod = modKeyLabel()
const search = ref<HTMLInputElement>()

const total = computed(() => links.state.links.length)
const loose = computed(() => links.countByFolder.value.get('none') ?? 0)
const searching = computed(() => !!links.state.search.trim())

function isActive(selection: LinkSelection) {
  return !searching.value && links.state.selection === selection
}

function choose(selection: LinkSelection) {
  links.state.search = ''
  links.select(selection)
}

async function folderMenu(folder: LinkFolder) {
  const choice = await showContextMenu([{ id: 'edit', label: 'Editar categoria…' }, separator, { id: 'delete', label: 'Excluir categoria…', danger: true }])
  if (choice === 'edit') emit('edit-folder', folder.id)
  if (choice === 'delete') void links.requestDeleteFolder(folder.id)
}

// ── Arrastar: links para as categorias, categorias para reordenar ───────────

const dropZone = ref<string | null>(null)
const dragFolder = ref<number | null>(null)
/** Um link da lista está sendo arrastado ("Sem categoria" aparece para receber ele). */
const draggingLink = ref(false)

const showLoose = computed(() => loose.value > 0 || isActive('none') || draggingLink.value)

// O arrastar começa numa linha da lista (que já marcou o tipo) e pode terminar em qualquer lugar
const onAnyDragStart = (event: DragEvent) => (draggingLink.value = isLinkDrag(event))
const onAnyDragEnd = () => (draggingLink.value = false)
onMounted(() => {
  document.addEventListener('dragstart', onAnyDragStart)
  window.addEventListener('dragend', onAnyDragEnd, true)
  window.addEventListener('drop', onAnyDragEnd, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('dragstart', onAnyDragStart)
  window.removeEventListener('dragend', onAnyDragEnd, true)
  window.removeEventListener('drop', onAnyDragEnd, true)
})

function onDragOver(event: DragEvent, zone: string) {
  const external = isExternalLinkDrag(event)
  if (!isLinkDrag(event) && !external && dragFolder.value === null) return
  // Categorias só se reordenam entre categorias
  if (dragFolder.value !== null && zone === 'none') return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = external ? 'copy' : 'move'
  dropZone.value = zone
}

function onDragLeave(event: DragEvent, zone: string) {
  const target = event.currentTarget as HTMLElement
  if (dropZone.value === zone && !target.contains(event.relatedTarget as Node | null)) dropZone.value = null
}

function onDrop(event: DragEvent, folderId: string | null, index = -1) {
  dropZone.value = null
  const id = event.dataTransfer?.getData(LINK_DRAG_TYPE)
  if (id) {
    links.moveLink(id, folderId)
  } else if (dragFolder.value !== null) {
    if (index >= 0) links.moveFolder(dragFolder.value, index)
  } else if (isExternalLinkDrag(event)) {
    // Link vindo do navegador: salva direto nesta categoria
    if (links.addLink(droppedText(event.dataTransfer), folderId).status === 'invalid') {
      showToast({ message: 'Isso não parece o endereço de um site.', icon: 'alert' })
    }
  }
  dragFolder.value = null
}

defineExpose({ focusSearch: () => search.value?.focus() })
</script>

<template>
  <aside class="links-sidebar" aria-label="Categorias de links">
    <label class="search">
      <AppIcon name="search" :size="15" />
      <input ref="search" v-model="links.state.search" placeholder="Buscar links…" spellcheck="false" :aria-label="`Buscar links (${mod}+F)`" />
      <button v-if="links.state.search" class="icon-btn sm" aria-label="Limpar busca" @click="links.state.search = ''">
        <AppIcon name="x" :size="13" />
      </button>
    </label>

    <div class="group">
      <button class="nav-item" :class="{ active: isActive('all') }" @click="choose('all')">
        <AppIcon name="link" :size="17" />
        <span class="nav-label">Todos os links</span>
        <span v-if="total" class="count">{{ total }}</span>
      </button>
      <button
        v-if="showLoose"
        class="nav-item"
        :class="{ active: isActive('none'), 'drop-target': dropZone === 'none' }"
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
      <button class="icon-btn sm" data-tip="Nova categoria" aria-label="Nova categoria" @click="emit('new-folder')"><AppIcon name="plus" :size="15" /></button>
    </div>
    <div class="group folders">
      <TransitionGroup name="folder">
        <button
          v-for="(folder, index) in links.state.folders"
          :key="folder.id"
          class="nav-item folder"
          :class="{ active: isActive(`folder:${folder.id}`), 'drop-target': dropZone === folder.id, dragging: dragFolder === index }"
          :data-folder="folder.name"
          draggable="true"
          @click="choose(`folder:${folder.id}`)"
          @dblclick="emit('edit-folder', folder.id)"
          @contextmenu.prevent="folderMenu(folder)"
          @dragstart="dragFolder = index"
          @dragend="dragFolder = null"
          @dragover="onDragOver($event, folder.id)"
          @dragleave="onDragLeave($event, folder.id)"
          @drop.prevent="onDrop($event, folder.id, index)"
        >
          <CategoryAvatar :name="folder.name" :color="folder.color" :icon="folder.icon" :image="folder.image" :size="22" />
          <span class="nav-label">{{ folder.name }}</span>
          <span v-if="links.countByFolder.value.get(folder.id)" class="count">{{ links.countByFolder.value.get(folder.id) }}</span>
          <span class="item-actions">
            <span class="icon-btn sm" role="button" data-tip="Editar categoria" aria-label="Editar categoria" @click.stop="emit('edit-folder', folder.id)">
              <AppIcon name="edit" :size="13" />
            </span>
            <span class="icon-btn sm" role="button" data-tip="Mais opções" aria-label="Opções da categoria" @click.stop="folderMenu(folder)">
              <AppIcon name="more" :size="13" />
            </span>
          </span>
        </button>
      </TransitionGroup>
      <button v-if="!links.state.folders.length" class="empty-folders" @click="emit('new-folder')">+ Criar a primeira categoria</button>
    </div>

    <footer class="sidebar-foot">
      <button class="import-btn" data-tip="Brave, Opera GX, Chrome, Edge, Firefox, Zen… ou um arquivo de favoritos" @click="emit('import')">
        <AppIcon name="download" :size="15" /> <span class="import-label">Importar do navegador</span>
      </button>
      <button class="foot-link" @click="links.revealFile()"><AppIcon name="folder" :size="13" /> links.json</button>
    </footer>
  </aside>
</template>

<style scoped>
.links-sidebar {
  display: flex;
  flex-direction: column;
  width: 248px;
  flex: none;
  padding: 12px 10px 0;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
  overflow-y: auto;
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
.search input::placeholder {
  color: var(--text-3);
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
.nav-item.folder {
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
.nav-item.dragging {
  opacity: 0.4;
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
  gap: 1px;
  margin-right: -4px;
}
.folders .nav-item:hover .item-actions {
  display: flex;
}
.folders .nav-item:hover .count {
  display: none;
}
.empty-folders {
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
.empty-folders:hover {
  color: var(--primary-text);
  border-color: var(--primary);
}
.sidebar-foot {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
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
  transition: border-color var(--t-fast), color var(--t-fast), background var(--t-fast);
}
.import-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.import-btn:hover {
  border-color: var(--primary);
  color: var(--primary-text);
  background: var(--primary-soft);
}
.foot-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  padding: 0 6px;
  color: var(--text-3);
  font-family: var(--font-mono);
  font-size: 11.5px;
  cursor: pointer;
}
.foot-link:hover {
  color: var(--primary-text);
}
.folder-enter-active,
.folder-leave-active {
  transition: opacity 200ms, transform 220ms var(--ease-out);
}
.folder-enter-from,
.folder-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
.folder-move {
  transition: transform 220ms var(--ease-out);
}
@media (max-width: 880px) {
  .links-sidebar {
    width: 208px;
  }
}
</style>
