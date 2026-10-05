<script setup lang="ts">
/** Painel da nota de um nó: cor, título (= nome do arquivo), editor e conexões. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MarkdownEditor from '~/components/editor/MarkdownEditor.vue'
import { confirmDialog } from '~/composables/useDialog'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import type { MentionHost } from '~/lib/editor/host'
import { paletteVar, type PaletteColor } from '~/lib/colors'
import { countWords } from '~/lib/notes/title'
import { DATA_PATHS } from '~/lib/storage/paths'
import { describeMention, mentionRevision, openMentionPath, searchMentions } from '~/stores/mentions'
import { useMindmapStore } from '~/stores/mindmap'

const emit = defineEmits<{ newLinked: [] }>()
const mindmap = useMindmapStore()
const editor = ref<InstanceType<typeof MarkdownEditor>>()
const titleDraft = ref('')
const colorOpen = ref(false)
const colorWrap = ref<HTMLElement>()

const note = computed(() => mindmap.selectedNote.value!)
const noteDir = computed(() => `${DATA_PATHS.mindmapDir}/${mindmap.state.currentMap}`)
const notePath = computed(() => `${noteDir.value}/${note.value.id}`)

/** Menções (@) a notas (das Notas e dos mapas) e a tarefas — stores/mentions.ts. */
const mentions: MentionHost = {
  search: (query) => searchMentions(query, notePath.value),
  describe: describeMention,
  open: openMentionPath,
  revision: () => mentionRevision.value,
}
const neighbors = computed(() => mindmap.neighbors(note.value.id))
const color = computed(() => mindmap.noteColor(note.value.id))
const words = computed(() => countWords(note.value.content))

watch(
  () => [note.value?.key, note.value?.title] as const,
  () => {
    if (note.value) titleDraft.value = note.value.title
    colorOpen.value = false
  },
  { immediate: true },
)

async function commitTitle() {
  const next = titleDraft.value.trim()
  if (!next || next === note.value.title) {
    titleDraft.value = note.value.title
    return
  }
  const ok = await mindmap.renameNote(note.value.id, next)
  if (!ok) titleDraft.value = note.value.title
}

function setColor(value: PaletteColor | null) {
  mindmap.setColor(note.value.id, value)
  colorOpen.value = false
}

function onPointerDown(event: PointerEvent) {
  if (colorOpen.value && colorWrap.value && !colorWrap.value.contains(event.target as Node)) colorOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', onPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))

const status = computed(() => {
  switch (note.value.status) {
    case 'saving':
      return 'Salvando…'
    case 'dirty':
      return 'Editando…'
    case 'error':
      return 'Erro ao salvar'
    default:
      return 'Salvo'
  }
})

async function remove() {
  const ok = await confirmDialog({
    title: `Excluir “${note.value.title}”?`,
    message: 'O arquivo vai para a Lixeira e as conexões dela são removidas.',
    confirmLabel: 'Excluir nota',
    danger: true,
  })
  if (ok) await mindmap.deleteNote(note.value.id)
}

async function openMenu() {
  const choice = await showContextMenu([
    { id: 'rename', label: 'Renomear' },
    { id: 'linked', label: 'Nova nota conectada…' },
    { id: 'reveal', label: 'Mostrar no Explorador' },
    separator,
    { id: 'delete', label: 'Excluir nota…', danger: true },
  ])
  if (choice === 'rename') document.querySelector<HTMLInputElement>('.note-title-input')?.select()
  if (choice === 'linked') emit('newLinked')
  if (choice === 'reveal') mindmap.revealNote(note.value.id)
  if (choice === 'delete') void remove()
}

defineExpose({ focusEditor: () => editor.value?.focusEnd(), focusTitle: () => document.querySelector<HTMLInputElement>('.note-title-input')?.select() })
</script>

<template>
  <aside class="note-panel" :class="{ expanded: mindmap.state.panelExpanded }" aria-label="Nota permanente">
    <header class="panel-head">
      <span class="crumb">
        <AppIcon name="graph" :size="14" />
        {{ mindmap.state.currentMap }}
      </span>
      <div class="panel-actions">
        <button class="icon-btn" data-tip="Nova nota conectada" aria-label="Nova nota conectada" @click="emit('newLinked')">
          <AppIcon name="node-plus" :size="17" />
        </button>
        <button
          class="icon-btn"
          :data-tip="mindmap.state.panelExpanded ? 'Reduzir' : 'Expandir'"
          aria-label="Expandir painel"
          @click="mindmap.state.panelExpanded = !mindmap.state.panelExpanded"
        >
          <AppIcon :name="mindmap.state.panelExpanded ? 'shrink' : 'expand'" :size="16" />
        </button>
        <button class="icon-btn" data-tip="Mais opções" aria-label="Mais opções" @click="openMenu"><AppIcon name="more" :size="17" /></button>
        <button class="icon-btn" data-tip="Fechar (Esc)" data-tip-pos="left" aria-label="Fechar painel" @click="mindmap.closePanel()">
          <AppIcon name="x" :size="17" />
        </button>
      </div>
    </header>

    <div class="panel-title">
      <div class="title-row">
        <div ref="colorWrap" class="color-wrap">
          <button
            class="color-btn"
            :class="{ open: colorOpen }"
            :style="{ '--c': color ? paletteVar(color) : 'var(--graph-node)' }"
            data-tip="Cor da nota"
            aria-label="Cor da nota"
            :aria-expanded="colorOpen"
            @click="colorOpen = !colorOpen"
          >
            <span class="color-dot" />
          </button>
          <div v-if="colorOpen" class="color-pop">
            <span class="section-label">Cor no mapa</span>
            <ColorSwatches :model-value="color" allow-none none-label="Padrão" :size="24" label="Cor da nota" @update:model-value="setColor" />
          </div>
        </div>
        <input
          v-model="titleDraft"
          class="note-title-input"
          spellcheck="false"
          aria-label="Título da nota (nome do arquivo)"
          title="O título é o nome do arquivo .md."
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          @keydown.esc.prevent="titleDraft = note.title; ($event.target as HTMLInputElement).blur()"
          @blur="commitTitle"
        />
      </div>
      <div class="panel-status">
        <span class="status-dot" :class="note.status" />
        {{ status }} · {{ words }} {{ words === 1 ? 'palavra' : 'palavras' }} · <span class="file">{{ note.id }}</span>
      </div>
    </div>

    <div class="panel-editor">
      <MarkdownEditor
        ref="editor"
        :doc-key="note.key"
        :model-value="note.content"
        :asset-base="noteDir"
        :note-path="notePath"
        :mentions="mentions"
        placeholder="Escreva aqui… (@ menciona notas e tarefas)"
        @update:model-value="(value) => mindmap.updateContent(note.id, value)"
      />
    </div>

    <footer class="connections">
      <div v-if="neighbors.length" class="conn-group">
        <span class="conn-label"><AppIcon name="link" :size="13" /> Conexões</span>
        <div class="conn-chips">
          <span v-for="item in neighbors" :key="item.noteId" class="conn-chip" :class="{ incoming: !item.outgoing }">
            <button
              class="chip-open"
              :data-tip="item.outgoing ? 'A seta sai desta nota — clique para abrir' : 'A seta chega nesta nota — clique para abrir'"
              data-tip-pos="top"
              @click="mindmap.openNote(item.noteId)"
            >
              <AppIcon :name="item.outgoing ? 'arrow-right' : 'backlink'" :size="12" /> {{ item.title }}
            </button>
            <button class="chip-remove" data-tip="Remover conexão" data-tip-pos="top" aria-label="Remover conexão" @click="mindmap.disconnectNotes(note.id, item.noteId)">
              <AppIcon name="x" :size="11" :stroke="2.2" />
            </button>
          </span>
        </div>
      </div>
      <p v-else class="conn-empty">Sem conexões ainda. No mapa, arraste desta nota até outra para conectá-las.</p>
    </footer>
  </aside>
</template>

<style scoped>
.note-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: min(480px, 100%);
  border-left: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  transition: width 320ms var(--ease-out);
  --editor-padding-x: 26px;
  --editor-padding-top: 6px;
  --editor-font-size: 14.5px;
}
.note-panel.expanded {
  width: min(820px, 100%);
  --editor-padding-x: 44px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 10px 0 22px;
}
.crumb {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-3);
}
.panel-actions {
  display: flex;
  gap: 2px;
}
.panel-title {
  padding: 4px 26px 12px;
}
.note-panel.expanded .panel-title {
  padding-left: 44px;
  padding-right: 44px;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.color-wrap {
  position: relative;
  flex: none;
}
.color-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  transition: background var(--t-fast);
}
.color-btn:hover,
.color-btn.open {
  background: var(--hover);
}
.color-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 22%, transparent);
}
.color-pop {
  position: absolute;
  top: calc(100% + 8px);
  left: -4px;
  z-index: 30;
  display: grid;
  gap: 10px;
  width: 232px;
  padding: 12px 14px 14px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  animation: pop-in 180ms var(--ease-spring);
  transform-origin: top left;
}
@keyframes pop-in {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-4px);
  }
}
.note-title-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: 2px 0;
  border: none;
  border-radius: 6px;
  outline: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 750;
  letter-spacing: -0.02em;
}
.note-title-input:focus {
  background: var(--surface-2);
  box-shadow: 0 0 0 6px var(--surface-2);
}
.panel-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
}
.panel-status .file {
  font-family: var(--font-mono);
  font-size: 11px;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
}
.status-dot.dirty {
  background: var(--accent-strong);
}
.status-dot.saving {
  background: var(--primary);
}
.status-dot.error {
  background: var(--danger);
}
.panel-editor {
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--border);
}
.connections {
  display: grid;
  gap: 10px;
  max-height: 34%;
  overflow-y: auto;
  padding: 12px 22px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}
.conn-group {
  display: grid;
  gap: 6px;
}
.conn-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.conn-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.conn-chip {
  display: inline-flex;
  align-items: center;
  height: 26px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary-text);
  transition: background var(--t-fast);
}
.conn-chip:hover {
  background: var(--primary-soft-2);
}
.conn-chip.incoming {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.chip-open {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 100%;
  padding: 0 4px 0 10px;
  border: none;
  background: none;
  color: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
}
.chip-remove {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-right: 3px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  opacity: 0.55;
  cursor: pointer;
  transition: opacity var(--t-fast), background var(--t-fast);
}
.chip-remove:hover {
  opacity: 1;
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.conn-empty {
  font-size: 12.5px;
  color: var(--text-3);
}
</style>
