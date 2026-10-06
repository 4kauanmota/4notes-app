<script setup lang="ts">
/** Uma linha da lista de links: ícone, título e site. Clique abre no navegador. */
import { computed } from 'vue'
import { LINK_DRAG_TYPE } from '~/lib/links/drag'
import { displayHost, type SavedLink } from '~/lib/links/model'
import { useLinksStore } from '~/stores/links'

const props = defineProps<{ link: SavedLink; showFolder: boolean; active: boolean }>()
const emit = defineEmits<{ edit: []; menu: [event: MouseEvent]; focus: [] }>()
const links = useLinksStore()

const folder = computed(() => (props.showFolder ? links.folderOf(props.link) : null))
const host = computed(() => displayHost(props.link.url))
const loading = computed(() => links.state.fetching.has(props.link.id))

function onDragStart(event: DragEvent) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(LINK_DRAG_TYPE, props.link.id)
  // Soltar fora do 4notes (no navegador, numa nota…) leva o endereço
  event.dataTransfer.setData('text/uri-list', props.link.url)
  event.dataTransfer.setData('text/plain', props.link.url)
  event.dataTransfer.effectAllowed = 'copyMove'
}

function open(event: MouseEvent) {
  emit('focus')
  if (event.button === 0 || event.button === 1) links.openLink(props.link.id)
}
</script>

<template>
  <div
    class="link-row"
    :class="{ active, highlight: links.state.highlight === link.id }"
    :data-link="link.id"
    role="link"
    tabindex="-1"
    :title="link.url"
    draggable="true"
    @click="open"
    @auxclick.prevent="open"
    @contextmenu.prevent="emit('focus'); emit('menu', $event)"
    @dragstart="onDragStart"
  >
    <LinkIcon :url="link.url" :icon="links.iconPath(link)" :version="links.state.iconVersion" :loading="loading" />
    <span class="link-title">{{ link.title }}</span>
    <span class="link-host">{{ host }}</span>
    <span v-if="folder" class="link-folder" :data-tip="`Categoria: ${folder.name}`">
      <CategoryAvatar :name="folder.name" :color="folder.color" :icon="folder.icon" :image="folder.image" :size="16" />
      <span class="link-folder-name">{{ folder.name }}</span>
    </span>
    <span class="link-actions" @click.stop>
      <button class="icon-btn sm" data-tip="Copiar endereço" aria-label="Copiar endereço" @click="links.copyLink(link.id)">
        <AppIcon name="copy" :size="14" />
      </button>
      <button class="icon-btn sm" data-tip="Editar" aria-label="Editar link" @click="emit('edit')">
        <AppIcon name="edit" :size="14" />
      </button>
      <button class="icon-btn sm" data-tip="Mais opções" aria-label="Mais opções" @click="emit('menu', $event)">
        <AppIcon name="more" :size="14" />
      </button>
    </span>
  </div>
</template>

<style scoped>
.link-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 42px;
  /* Listas longas: linhas fora da tela não são calculadas nem desenhadas */
  content-visibility: auto;
  contain-intrinsic-size: auto 42px;
  padding: 0 8px 0 12px;
  border-radius: var(--r-md);
  color: var(--text);
  cursor: pointer;
  transition: background var(--t-fast), box-shadow var(--t-fast);
}
.link-row:hover {
  background: var(--hover);
}
.link-row.active {
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--border);
}
.link-row.highlight {
  animation: highlight 1.6s var(--ease-out);
}
@keyframes highlight {
  0%,
  35% {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-strong) 50%, transparent);
  }
}
.link-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
  font-weight: 550;
}
.link-host {
  flex: 1 1 0;
  min-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3);
  font-size: 12.5px;
}
.link-folder {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  max-width: 160px;
  height: 22px;
  padding: 0 8px 0 4px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 12px;
}
.link-folder-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.link-actions {
  display: none;
  gap: 2px;
  flex: none;
}
.link-row:hover .link-actions,
.link-row.active .link-actions {
  display: flex;
}
.link-row:hover .link-folder,
.link-row.active .link-folder {
  display: none;
}
</style>
