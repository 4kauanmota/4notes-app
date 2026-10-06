<script setup lang="ts">
/**
 * Barra flutuante do mapa: mapa aberto, busca, nova nota, reorganizar o mapa e o
 * atalho para as configurações do mapa (Configurações › Módulos › Mapa Mental).
 */
import { computed, ref, watch } from 'vue'
import { toPlainText } from '~/lib/editor/markup'
import { modKeyLabel } from '~/lib/platform'
import { useAppStore } from '~/stores/app'
import { useMindmapStore, type PermanentNote } from '~/stores/mindmap'

const emit = defineEmits<{ new: []; relayout: [] }>()
const mindmap = useMindmapStore()
const app = useAppStore()
const mod = modKeyLabel()
const input = ref<HTMLInputElement>()
const focused = ref(false)
const activeIndex = ref(0)

const results = computed(() => mindmap.searchResults.value.slice(0, 8))
watch(results, () => (activeIndex.value = 0))

function snippet(note: PermanentNote): string {
  const text = toPlainText(note.content)
  return text.length > 70 ? `${text.slice(0, 70)}…` : text
}

function open(note: PermanentNote) {
  mindmap.openNote(note.id)
  mindmap.state.search = ''
  input.value?.blur()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = Math.min(results.value.length - 1, activeIndex.value + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = Math.max(0, activeIndex.value - 1)
  } else if (event.key === 'Enter') {
    const note = results.value[activeIndex.value]
    if (note) open(note)
  } else if (event.key === 'Escape') {
    mindmap.state.search = ''
    input.value?.blur()
  }
}

defineExpose({ focusSearch: () => input.value?.focus() })
</script>

<template>
  <div class="toolbar">
    <MapSwitcher />
    <div class="search" :class="{ active: focused || mindmap.state.search }">
      <AppIcon name="search" :size="15" />
      <input
        ref="input"
        v-model="mindmap.state.search"
        placeholder="Buscar no mapa…"
        spellcheck="false"
        aria-label="Buscar notas do mapa"
        @focus="focused = true"
        @blur="focused = false"
        @keydown="onKeydown"
      />
      <kbd v-if="!mindmap.state.search" class="kbd">{{ mod }} K</kbd>
      <button v-else class="icon-btn sm" aria-label="Limpar busca" @mousedown.prevent="mindmap.state.search = ''"><AppIcon name="x" :size="13" /></button>
      <Transition name="pop">
        <ul v-if="focused && mindmap.state.search" class="results">
          <li
            v-for="(note, index) in results"
            :key="note.key"
            :class="{ active: index === activeIndex }"
            @mousedown.prevent="open(note)"
            @mouseenter="activeIndex = index"
          >
            <span class="result-dot" :style="mindmap.noteColor(note.id) ? { background: `var(--cat-${mindmap.noteColor(note.id)})` } : undefined" />
            <span class="result-text">
              <span class="result-title">{{ note.title }}</span>
              <span v-if="snippet(note)" class="result-snippet">{{ snippet(note) }}</span>
            </span>
          </li>
          <li v-if="!results.length" class="no-results">Nenhuma nota encontrada</li>
        </ul>
      </Transition>
    </div>

    <button class="btn btn-primary btn-sm new-btn" @click="emit('new')">
      <AppIcon name="plus" :size="15" /> Nova nota
    </button>
    <button
      class="icon-btn tool-btn"
      data-action="relayout"
      data-tip="Reorganizar o mapa (evita cruzar as linhas)"
      aria-label="Reorganizar o mapa"
      :disabled="!mindmap.state.notes.length"
      @click="emit('relayout')"
    >
      <AppIcon name="refresh" :size="17" />
    </button>
    <button
      class="icon-btn tool-btn"
      data-action="map-settings"
      data-tip="Configurações do mapa"
      aria-label="Configurações do mapa"
      @click="app.openSettings('modules', 'mindmap')"
    >
      <AppIcon name="settings" :size="17" />
    </button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--elevated) 88%, transparent);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow-md);
}
.search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 220px;
  height: 32px;
  padding: 0 6px 0 10px;
  border-radius: 9px;
  background: var(--surface-3);
  color: var(--text-3);
  transition: width 260ms var(--ease-out), background var(--t-fast), box-shadow var(--t-fast);
}
.search.active {
  width: 300px;
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--primary), var(--focus-ring);
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
.results {
  position: absolute;
  top: calc(100% + 10px);
  left: -6px;
  right: -6px;
  z-index: 40;
  margin: 0;
  padding: 6px;
  list-style: none;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
}
.results li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--r-md);
  cursor: pointer;
}
.results li.active {
  background: var(--primary-soft);
}
.result-dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--graph-node);
}
.result-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.result-title {
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
}
.result-snippet {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3);
  font-size: 12px;
}
.no-results {
  color: var(--text-3);
  font-size: 13px;
  cursor: default !important;
}
.new-btn {
  height: 32px;
}
.tool-btn {
  width: 32px;
  height: 32px;
}
</style>
