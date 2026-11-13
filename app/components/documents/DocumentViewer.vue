<script setup lang="ts">
/**
 * Um documento aberto (1.7.3): o cabeçalho (voltar, nome, categoria, ações) e o
 * conteúdo pelo tipo: PDF (com anotações, PdfViewer), imagem, texto ou, nos outros
 * formatos, "Abrir no programa do sistema".
 */
import { computed, nextTick, ref, watch } from 'vue'
import { errorMessage, workspaceFileUrl } from '#shared/ipc'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import { formatSize, KIND_LABELS, type StoredDocument } from '~/lib/documents/model'
import { canReveal, hasDesktopApi } from '~/lib/platform'
import { useDocumentsStore } from '~/stores/documents'

const props = defineProps<{ doc: StoredDocument }>()
const emit = defineEmits<{ close: [] }>()
const documents = useDocumentsStore()
const reveal = canReveal()
const canOpenExternal = computed(() => hasDesktopApi() && !!window.fourNotes?.documents?.openExternal)

const category = computed({
  get: () => props.doc.categoryId,
  set: (value: string | null) => void documents.setCategory([props.doc.id], value),
})

// ── Nome ────────────────────────────────────────────────────────────────────

const renaming = ref(false)
const draft = ref('')
const nameInput = ref<HTMLInputElement>()

async function startRename() {
  draft.value = props.doc.name
  renaming.value = true
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

function finishRename(save: boolean) {
  if (!renaming.value) return
  renaming.value = false
  if (save) documents.renameDocument(props.doc.id, draft.value)
}

// ── Imagem e texto ──────────────────────────────────────────────────────────

const imageZoom = ref<'fit' | 'full'>('fit')
const text = ref<string | null>(null)
const textError = ref('')

watch(
  () => [props.doc.id, props.doc.kind] as const,
  async ([, kind]) => {
    text.value = null
    textError.value = ''
    imageZoom.value = 'fit'
    if (kind !== 'text') return
    try {
      const content = await documents.readText(props.doc)
      if (content === null) textError.value = 'O arquivo não foi encontrado na pasta do workspace.'
      else text.value = content
    } catch (error) {
      textError.value = errorMessage(error)
    }
  },
  { immediate: true },
)

async function moreMenu() {
  const choice = await showContextMenu([
    { id: 'rename', label: 'Renomear' },
    ...(canOpenExternal.value ? [{ id: 'external', label: 'Abrir no programa do sistema' }] : []),
    ...(reveal ? [{ id: 'reveal', label: 'Mostrar no Explorador' }] : []),
    separator,
    { id: 'delete', label: 'Excluir…', danger: true },
  ])
  if (choice === 'rename') void startRename()
  else if (choice === 'external') void documents.openExternal(props.doc.id)
  else if (choice === 'reveal') documents.revealDocument(props.doc.id)
  else if (choice === 'delete' && (await documents.requestDelete([props.doc.id]))) emit('close')
}
</script>

<template>
  <div class="doc-viewer" :data-kind="doc.kind">
    <header class="doc-head">
      <button type="button" class="icon-btn" data-action="close-document" aria-label="Voltar para a lista" data-tip="Voltar (Esc)" @click="emit('close')">
        <AppIcon name="arrow-left" :size="18" />
      </button>
      <div class="doc-title">
        <input
          v-if="renaming"
          ref="nameInput"
          v-model="draft"
          class="name-input"
          aria-label="Nome do documento"
          maxlength="200"
          @keydown.enter.prevent="finishRename(true)"
          @keydown.esc.prevent.stop="finishRename(false)"
          @blur="finishRename(true)"
        />
        <button v-else type="button" class="name" data-tip="Renomear" @click="startRename">{{ doc.name }}</button>
        <span class="meta">{{ KIND_LABELS[doc.kind] }} · {{ formatSize(doc.size) }}</span>
      </div>
      <CategorySelect v-model="category" module="documents" size="sm" allow-none none-label="Sem categoria" label="Categoria do documento" data-field="document-category" />
      <button type="button" class="icon-btn" data-action="document-menu" aria-label="Mais opções" @click="moreMenu">
        <AppIcon name="more" :size="18" />
      </button>
    </header>

    <PdfViewer v-if="doc.kind === 'pdf'" :doc="doc" />

    <div v-else-if="doc.kind === 'image'" class="doc-body image" :class="imageZoom" @dblclick="imageZoom = imageZoom === 'fit' ? 'full' : 'fit'">
      <img :src="workspaceFileUrl(doc.file)" :alt="doc.name" draggable="false" @click="imageZoom = imageZoom === 'fit' ? 'full' : 'fit'" />
    </div>

    <div v-else-if="doc.kind === 'text'" class="doc-body text">
      <p v-if="textError" class="state">{{ textError }}</p>
      <pre v-else-if="text !== null" class="text-content selectable">{{ text }}</pre>
      <p v-else class="state">Abrindo…</p>
    </div>

    <div v-else class="doc-body other">
      <AppIcon name="file-text" :size="40" />
      <p>Este formato não abre dentro do 4notes.</p>
      <button v-if="canOpenExternal" type="button" class="btn btn-primary" data-action="open-external" @click="documents.openExternal(doc.id)">
        <AppIcon name="external" :size="15" /> Abrir no programa do sistema
      </button>
      <p v-else class="muted">O arquivo está guardado no workspace: abra pelo computador.</p>
    </div>
  </div>
</template>

<style scoped>
.doc-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}
.doc-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.doc-title {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.name {
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  border: none;
  background: none;
  color: var(--text);
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}
.name-input {
  width: 100%;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--primary);
  border-radius: var(--r-sm);
  outline: none;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 15px;
  font-weight: 650;
  box-shadow: var(--focus-ring);
}
.meta {
  color: var(--text-3);
  font-size: 12px;
}
.doc-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--surface-3);
}
.doc-body.image {
  display: grid;
  place-items: center;
  padding: 16px;
}
.doc-body.image img {
  display: block;
  border-radius: 6px;
  box-shadow: var(--shadow-sm);
  cursor: zoom-in;
}
.doc-body.image.fit img {
  max-width: 100%;
  max-height: calc(100vh - 160px);
  object-fit: contain;
}
.doc-body.image.full img {
  max-width: none;
  cursor: zoom-out;
}
.doc-body.text {
  padding: 18px var(--page-pad-x, 24px);
  background: var(--surface);
}
.text-content {
  margin: 0;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 4;
}
.doc-body.other {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-2);
  text-align: center;
}
.state,
.muted {
  color: var(--text-3);
  font-size: 13px;
}
html[data-layout='compact'] .doc-head {
  flex-wrap: wrap;
}
html[data-layout='compact'] .doc-title {
  flex-basis: calc(100% - 100px);
}
</style>
