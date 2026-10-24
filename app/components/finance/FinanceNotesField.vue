<script setup lang="ts">
/**
 * Observações de um lançamento ou de uma recorrência (1.7.1): abrem e fecham (o texto
 * continua lá), com o mesmo editor das notas (negrito, listas…) e o "#" das categorias
 * (a menção fica no texto, ligada à categoria de verdade, e abre a categoria).
 * Fechadas e com texto, mostram o começo dele.
 */
import { computed, nextTick, ref } from 'vue'
import type { MentionHost } from '~/lib/editor/host'
import { toPlainText } from '~/lib/editor/markup'
import { MAX_NOTES } from '~/lib/finance/model'
import { DATA_PATHS } from '~/lib/storage/paths'
import { categoryMentions, describeMention, mentionRevision, openMentionPath } from '~/stores/mentions'

const model = defineModel<string>({ required: true })
const props = withDefaults(defineProps<{ docKey: string; startOpen?: boolean }>(), { startOpen: false })

const open = ref(props.startOpen || !!model.value.trim())
const root = ref<HTMLElement>()

/** Só o "#" (as Finanças não mencionam notas e tarefas com "@"). */
const host: MentionHost = {
  search: async () => [],
  describe: describeMention,
  open: openMentionPath,
  revision: () => mentionRevision.value,
  categories: categoryMentions,
}

const preview = computed(() => toPlainText(model.value).slice(0, 120))
const length = computed(() => model.value.length)

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  await nextTick()
  root.value?.querySelector<HTMLElement>('.cm-content')?.focus()
}

function update(value: string) {
  model.value = value.slice(0, MAX_NOTES)
}
</script>

<template>
  <div ref="root" class="notes-field" :class="{ open }">
    <button type="button" class="notes-head" :aria-expanded="open" data-action="toggle-notes" @click="toggle">
      <AppIcon name="edit" :size="13" />
      <span class="notes-label">Observações</span>
      <span v-if="!open && preview" class="notes-preview">{{ preview }}</span>
      <AppIcon :name="open ? 'chevron-up' : 'chevron-down'" :size="14" class="notes-chevron" />
    </button>
    <div v-if="open" class="notes-body" data-field="finance-notes">
      <MarkdownEditor
        :model-value="model"
        :doc-key="props.docKey"
        :asset-base="DATA_PATHS.financeDir"
        :mentions="host"
        placeholder="Opcional. # menciona uma categoria"
        toolbar-overflow
        @update:model-value="update"
      />
      <span v-if="length > MAX_NOTES * 0.9" class="notes-count">{{ length }}/{{ MAX_NOTES }}</span>
    </div>
  </div>
</template>

<style scoped>
.notes-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.notes-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  max-width: 100%;
  padding: 4px 6px;
  margin-left: -6px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-3);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.notes-head:hover {
  color: var(--primary-text);
}
.notes-label {
  flex: none;
  font-weight: 600;
}
.notes-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3);
  font-weight: 400;
}
.notes-chevron {
  flex: none;
}
.notes-body {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  --editor-padding-x: 12px;
  --editor-padding-top: 8px;
  --editor-padding-bottom: 8px;
  --editor-font-size: 13.5px;
}
.notes-body:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}
.notes-body :deep(.markdown-editor),
.notes-body :deep(.editor-parent),
.notes-body :deep(.cm-editor) {
  height: auto;
}
.notes-body :deep(.cm-editor),
.notes-body :deep(.cm-scroller) {
  min-height: 64px;
}
.notes-body :deep(.cm-scroller) {
  overflow-y: visible;
}
.notes-count {
  position: absolute;
  right: 8px;
  bottom: 4px;
  font-size: 11px;
  color: var(--text-3);
}
</style>
