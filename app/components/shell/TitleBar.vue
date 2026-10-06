<script setup lang="ts">
/**
 * Barra de título personalizada. Ela é "arrastável" (move a janela) e deixa
 * espaço para os botões nativos do sistema (minimizar/maximizar/fechar).
 * Mostra o nome do workspace antes do resto; clicar nele abre/cria workspaces.
 */
import { computed, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import { noteTitle, useNotesStore } from '~/stores/notes'
import { useMindmapStore } from '~/stores/mindmap'
import { useTasksStore } from '~/stores/tasks'
import { useAppStore } from '~/stores/app'
import { useLinksStore } from '~/stores/links'

const route = useRoute()
const app = useAppStore()
const notes = useNotesStore()
const tasks = useTasksStore()
const mindmap = useMindmapStore()
const links = useLinksStore()

const platform = computed(() => app.state.bootstrap?.platform ?? 'win32')
const workspace = computed(() => (app.state.phase === 'ready' ? app.workspaceName() : ''))

async function workspaceMenu(event: MouseEvent) {
  const choice = await showContextMenu(
    [
      { id: 'open', label: 'Abrir outro workspace…' },
      { id: 'create', label: 'Criar workspace…' },
      separator,
      { id: 'reveal', label: 'Mostrar no Explorador' },
    ],
    event.currentTarget as Element,
  )
  if (choice === 'open') await app.openWorkspace(false)
  else if (choice === 'create') await app.createWorkspace(false)
  else if (choice === 'reveal') await app.revealDataFolder()
}

const moduleLabel = computed(() => {
  if (app.state.phase !== 'ready') return null
  if (route.path.startsWith('/notes')) return 'Notas'
  if (route.path.startsWith('/tasks')) return 'Tarefas'
  if (route.path.startsWith('/mindmap')) return 'Mapa Mental'
  if (route.path.startsWith('/links')) return 'Links'
  return null
})

const context = computed(() => {
  if (!moduleLabel.value) return null
  if (route.path.startsWith('/notes')) {
    const note = notes.activeNote.value
    if (!note) return null
    const category = notes.categoryOf(note)
    return category ? `${category.name} / ${noteTitle(note)}` : noteTitle(note)
  }
  if (route.path.startsWith('/mindmap')) {
    const note = mindmap.state.panelOpen ? mindmap.selectedNote.value?.title : null
    return note ? `${mindmap.state.currentMap} / ${note}` : mindmap.state.currentMap || null
  }
  if (route.path.startsWith('/tasks')) {
    const selection = tasks.state.selection
    if (selection === 'pending') return 'Pendentes'
    if (selection === 'scheduled') return 'Agendadas'
    if (selection === 'done') return 'Concluídas'
    const id = selection.slice(4)
    return id === 'none' ? 'Sem categoria' : (tasks.categoryById.value.get(id)?.name ?? null)
  }
  if (route.path.startsWith('/links')) {
    if (links.state.selection === 'none') return 'Sem categoria'
    return links.selectedFolder.value?.name ?? null
  }
  return null
})

// Título da janela (aparece na barra de tarefas do sistema)
watchEffect(() => {
  const app4 = workspace.value ? `${workspace.value} — 4notes` : '4notes'
  document.title = context.value ? `${context.value} — ${app4}` : moduleLabel.value ? `${moduleLabel.value} — ${app4}` : app4
})
</script>

<template>
  <header class="titlebar drag-region" :class="`platform-${platform}`">
    <div class="titlebar-brand" title="4notes">
      <AppLogo :size="20" />
    </div>
    <button
      v-if="workspace"
      type="button"
      class="workspace-btn no-drag"
      data-tip="Workspace — abrir ou criar outro"
      aria-label="Workspace: abrir ou criar outro"
      @click="workspaceMenu"
    >
      <span class="workspace-name">{{ workspace }}</span>
      <AppIcon name="chevron-down" :size="13" />
    </button>
    <Transition name="fade" mode="out-in">
      <div v-if="moduleLabel" :key="moduleLabel" class="titlebar-crumbs">
        <span class="sep">/</span>
        <span class="crumb">{{ moduleLabel }}</span>
        <template v-if="context">
          <span class="sep">/</span>
          <span class="crumb current">{{ context }}</span>
        </template>
      </div>
    </Transition>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--titlebar-h);
  /* A logo fica centralizada sobre o menu lateral (que estreita com "só o ícone") */
  padding: 0 14px 0 calc(var(--rail-w) / 2 - 12px);
  /* Reserva o espaço dos botões nativos (Window Controls Overlay) */
  padding-right: calc(100% - env(titlebar-area-width, 100%) + 14px);
  background: var(--chrome);
  color: var(--text-2);
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  transition: padding-left 260ms var(--ease-out);
}
.titlebar.platform-darwin {
  padding-left: 84px;
}
.titlebar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.workspace-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  height: 24px;
  margin-left: -2px;
  padding: 0 6px 0 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
  flex: none;
}
.workspace-btn:hover {
  background: var(--hover);
}
.workspace-btn :deep(.app-icon) {
  color: var(--text-3);
}
.workspace-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.titlebar-crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.sep {
  color: var(--text-3);
  opacity: 0.7;
}
.crumb {
  overflow: hidden;
  text-overflow: ellipsis;
}
.crumb.current {
  color: var(--text);
  font-weight: 550;
}
</style>
