<script setup lang="ts">
/**
 * Importar favoritos do navegador, em dois passos:
 *  1. de onde: um navegador encontrado neste computador (Brave, Opera GX, Chrome,
 *     Edge, Firefox, Zen…) ou um arquivo HTML de favoritos — que qualquer navegador exporta;
 *  2. o quê e para onde: a árvore de favoritos com caixas de seleção (tudo marcado
 *     no começo) e onde os links ficam — uma categoria para cada pasta do navegador,
 *     ou tudo numa categoria só. Links que já estão salvos não são repetidos.
 * Nada é alterado no navegador.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import type { BookmarkFolder, BookmarkNode, BrowserSource } from '#shared/ipc'
import { showToast } from '~/composables/useToasts'
import { flattenBookmarks, planImport, type ImportCandidate, type ImportMode } from '~/lib/links/import'
import { displayHost, normalizeUrl, urlKey } from '~/lib/links/model'
import { useLinksStore, type LinkSelection } from '~/stores/links'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; done: [selection: LinkSelection] }>()
const links = useLinksStore()

/** Links mostrados de uma vez numa pasta grande (o resto aparece em "mostrar mais"). */
const FOLDER_PREVIEW = 150

const step = ref<'source' | 'pick'>('source')
/** null = procurando os navegadores. */
const sources = ref<BrowserSource[] | null>(null)
/** Fonte sendo lida (id do navegador ou 'file'). */
const reading = ref<string | null>(null)
const sourceLabel = ref('')
const roots = shallowRef<BookmarkFolder[]>([])
const candidates = shallowRef<ImportCandidate[]>([])
/** Chaves dos links marcados (trocado inteiro a cada mudança). */
const selected = shallowRef(new Set<string>())
const expanded = shallowRef(new Set<string>())
const showAll = shallowRef(new Set<string>())
const modeKind = ref<'folders' | 'single'>('folders')
/** Categoria do modo "tudo numa categoria" ('' = sem categoria). */
const singleFolder = ref('')
const importing = ref(false)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    step.value = 'source'
    sources.value = null
    reading.value = null
    roots.value = []
    candidates.value = []
    selected.value = new Set()
    expanded.value = new Set()
    showAll.value = new Set()
    modeKind.value = 'folders'
    singleFolder.value = links.selectedFolder.value?.id ?? ''
    importing.value = false
    try {
      sources.value = await links.browsers()
    } catch (error) {
      console.warn('[4notes] Não foi possível procurar os navegadores:', error)
      sources.value = []
    }
  },
)

// ── Passo 1: de onde ─────────────────────────────────────────────────────────

async function choose(source: BrowserSource | 'file') {
  if (reading.value) return
  reading.value = source === 'file' ? 'file' : source.id
  const result = await links.readBookmarks(source === 'file' ? 'file' : { id: source.id })
  reading.value = null
  if (!result || !props.open) return
  const all = flattenBookmarks(result)
  if (!all.length) {
    showToast({ message: 'Nenhum link encontrado nesses favoritos.', icon: 'info' })
    return
  }
  roots.value = result
  candidates.value = all
  sourceLabel.value = source === 'file' ? 'Arquivo de favoritos' : `${source.browser}${source.profile ? ` · ${source.profile}` : ''}`
  selected.value = new Set(all.map((candidate) => candidate.key))
  // As raízes (barra de favoritos, outros favoritos…) começam abertas
  expanded.value = new Set(result.map((_root, index) => `${index}`))
  showAll.value = new Set()
  step.value = 'pick'
}

// ── Passo 2: a árvore ───────────────────────────────────────────────────────

/** Chaves dos links dentro de cada pasta (a chave de um link começa com a da pasta: "0/3" → "0/3/1"). */
const folderLinks = computed(() => {
  const map = new Map<string, string[]>()
  for (const candidate of candidates.value) {
    const parts = candidate.key.split('/')
    for (let i = 1; i < parts.length; i++) {
      const folderKey = parts.slice(0, i).join('/')
      let keys = map.get(folderKey)
      if (!keys) map.set(folderKey, (keys = []))
      keys.push(candidate.key)
    }
  }
  return map
})

/** Links que já estão salvos no 4notes (não serão repetidos). */
const savedKeys = computed(() => {
  const known = new Set(links.state.links.map((link) => urlKey(link.url)))
  const keys = new Set<string>()
  for (const candidate of candidates.value) {
    const url = normalizeUrl(candidate.url)
    if (url && known.has(urlKey(url))) keys.add(candidate.key)
  }
  return keys
})

type TreeRow =
  | { kind: 'folder'; key: string; title: string; depth: number; count: number; open: boolean }
  | { kind: 'link'; key: string; title: string; host: string; depth: number; saved: boolean }
  | { kind: 'more'; key: string; depth: number; hidden: number }

const rows = computed(() => {
  const out: TreeRow[] = []
  const folder = (key: string, title: string, children: BookmarkNode[], depth: number) => {
    const count = folderLinks.value.get(key)?.length ?? 0
    if (!count) return // pastas sem links não aparecem
    const open = expanded.value.has(key)
    out.push({ kind: 'folder', key, title, depth, count, open })
    if (!open) return
    const limit = showAll.value.has(key) ? Infinity : FOLDER_PREVIEW
    let shownLinks = 0
    let hidden = 0
    children.forEach((node, index) => {
      const childKey = `${key}/${index}`
      if (node.kind === 'folder') return folder(childKey, node.title, node.children, depth + 1)
      if (shownLinks >= limit) {
        hidden++
        return
      }
      shownLinks++
      out.push({ kind: 'link', key: childKey, title: node.title, host: displayHost(node.url), depth: depth + 1, saved: savedKeys.value.has(childKey) })
    })
    if (hidden) out.push({ kind: 'more', key, depth: depth + 1, hidden })
  }
  roots.value.forEach((root, index) => folder(`${index}`, root.title, root.children, 0))
  return out
})

function folderState(key: string): 'all' | 'some' | 'none' {
  const keys = folderLinks.value.get(key) ?? []
  let count = 0
  for (const linkKey of keys) if (selected.value.has(linkKey)) count++
  return count === 0 ? 'none' : count === keys.length ? 'all' : 'some'
}

function toggleLink(key: string) {
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

function toggleFolder(key: string) {
  const keys = folderLinks.value.get(key) ?? []
  const select = folderState(key) !== 'all'
  const next = new Set(selected.value)
  for (const linkKey of keys) {
    if (select) next.add(linkKey)
    else next.delete(linkKey)
  }
  selected.value = next
}

function toggleOpen(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function revealAll(key: string) {
  showAll.value = new Set([...showAll.value, key])
}

function selectAll(on: boolean) {
  selected.value = on ? new Set(candidates.value.map((candidate) => candidate.key)) : new Set()
}

// ── Para onde ────────────────────────────────────────────────────────────────

const mode = computed<ImportMode>(() => (modeKind.value === 'folders' ? { kind: 'folders' } : { kind: 'single', folderId: singleFolder.value || null }))
const chosen = computed(() => candidates.value.filter((candidate) => selected.value.has(candidate.key)))
const plan = computed(() => planImport(chosen.value, { folders: links.state.folders, links: links.state.links }, mode.value))

const newFoldersLabel = computed(() => {
  const names = plan.value.newFolders
  if (!names.length) return ''
  const shown = names.slice(0, 4).join(', ')
  return names.length > 4 ? `${shown} e mais ${names.length - 4}` : shown
})

const count = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`

async function runImport() {
  if (!plan.value.links.length || importing.value) return
  importing.value = true
  try {
    const result = await links.importLinks(chosen.value, mode.value)
    const parts = [count(result.added, 'link importado', 'links importados')]
    if (result.skipped) parts.push(`${result.skipped.toLocaleString('pt-BR')} já ${result.skipped === 1 ? 'estava salvo' : 'estavam salvos'}`)
    showToast({ message: parts.join(' · '), icon: 'download', tone: 'success' })
    const target = mode.value.kind === 'single' ? mode.value.folderId : null
    emit('done', target ? `folder:${target}` : 'all')
    emit('close')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <UiModal :open="open" :width="step === 'pick' ? 620 : 480" label="Importar do navegador" @close="emit('close')">
    <!-- Passo 1: de onde -->
    <div v-if="step === 'source'" class="import-dialog">
      <h2>Importar do navegador</h2>
      <p class="lead">Escolha de onde vêm os links. Nada é alterado no navegador.</p>

      <div class="sources">
        <p v-if="sources === null" class="searching"><span class="spinner" /> Procurando navegadores…</p>
        <template v-else>
          <button
            v-for="source in sources"
            :key="source.id"
            type="button"
            class="source"
            :class="{ busy: reading === source.id }"
            :disabled="!!reading"
            :data-source="source.browser"
            @click="choose(source)"
          >
            <span class="source-icon"><AppIcon name="globe" :size="18" /></span>
            <span class="source-text">
              <strong>{{ source.browser }}</strong>
              <span v-if="source.profile">{{ source.profile }}</span>
            </span>
            <span class="source-count">{{ count(source.count, 'link', 'links') }}</span>
            <span v-if="reading === source.id" class="spinner" />
            <AppIcon v-else name="chevron-right" :size="15" class="source-arrow" />
          </button>
          <p v-if="!sources.length" class="none">Nenhum navegador com favoritos foi encontrado neste computador.</p>
        </template>

        <button type="button" class="source file" :class="{ busy: reading === 'file' }" :disabled="!!reading" @click="choose('file')">
          <span class="source-icon"><AppIcon name="bookmark" :size="18" /></span>
          <span class="source-text">
            <strong>Arquivo de favoritos (.html)…</strong>
            <span>Exportado por qualquer navegador</span>
          </span>
          <span v-if="reading === 'file'" class="spinner" />
          <AppIcon v-else name="chevron-right" :size="15" class="source-arrow" />
        </button>
      </div>
      <p class="hint">
        <AppIcon name="info" :size="13" />
        <span>Para criar o arquivo: no navegador, abra o gerenciador de favoritos e use “Exportar favoritos”.</span>
      </p>

      <div class="actions">
        <button type="button" class="btn btn-ghost" @click="emit('close')">Cancelar</button>
      </div>
    </div>

    <!-- Passo 2: o quê e para onde -->
    <div v-else class="import-dialog">
      <div class="pick-head">
        <button type="button" class="icon-btn" data-tip="Voltar" aria-label="Voltar" @click="step = 'source'"><AppIcon name="arrow-left" :size="16" /></button>
        <div class="pick-title">
          <h2>Escolha os links</h2>
          <span>{{ sourceLabel }} · {{ count(candidates.length, 'link', 'links') }}</span>
        </div>
        <div class="bulk">
          <button type="button" class="btn btn-sm btn-ghost" @click="selectAll(true)">Marcar todos</button>
          <button type="button" class="btn btn-sm btn-ghost" @click="selectAll(false)">Desmarcar</button>
        </div>
      </div>

      <div class="tree" role="tree" aria-label="Favoritos">
        <template v-for="row in rows" :key="`${row.kind}:${row.key}`">
          <div v-if="row.kind === 'folder'" class="tree-row folder" role="treeitem" :aria-expanded="row.open" :style="{ '--depth': row.depth }">
            <button type="button" class="twisty" :aria-label="row.open ? 'Fechar pasta' : 'Abrir pasta'" @click="toggleOpen(row.key)">
              <AppIcon name="chevron-right" :size="13" :class="{ open: row.open }" />
            </button>
            <label class="check-label">
              <input
                type="checkbox"
                :checked="folderState(row.key) === 'all'"
                :indeterminate.prop="folderState(row.key) === 'some'"
                @change="toggleFolder(row.key)"
              />
              <AppIcon :name="row.open ? 'folder-open' : 'folder'" :size="15" class="folder-icon" />
              <span class="row-title">{{ row.title }}</span>
            </label>
            <span class="row-count">{{ row.count.toLocaleString('pt-BR') }}</span>
          </div>
          <div v-else-if="row.kind === 'link'" class="tree-row link" role="treeitem" :class="{ saved: row.saved }" :style="{ '--depth': row.depth }">
            <label class="check-label">
              <input type="checkbox" :checked="selected.has(row.key)" @change="toggleLink(row.key)" />
              <span class="row-title">{{ row.title }}</span>
              <span class="row-host">{{ row.host }}</span>
            </label>
            <span v-if="row.saved" class="saved-tag">já salvo</span>
          </div>
          <div v-else class="tree-row more" :style="{ '--depth': row.depth }">
            <button type="button" class="more-btn" @click="revealAll(row.key)">Mostrar mais {{ count(row.hidden, 'link', 'links') }}</button>
          </div>
        </template>
      </div>

      <div class="mode">
        <span class="field-label">Onde os links ficam</span>
        <label class="radio">
          <input v-model="modeKind" type="radio" value="folders" />
          <span>
            <strong>Uma categoria para cada pasta do navegador</strong>
            <small>Pastas com o mesmo nome se juntam (inclusive com as categorias que você já tem). Links fora de pastas ficam sem categoria.</small>
          </span>
        </label>
        <label class="radio">
          <input v-model="modeKind" type="radio" value="single" />
          <span class="single">
            <strong>Tudo em</strong>
            <select v-model="singleFolder" class="select select-sm" aria-label="Categoria de destino" @focus="modeKind = 'single'" @change="modeKind = 'single'">
              <option value="">Sem categoria</option>
              <option v-for="folder in links.state.folders" :key="folder.id" :value="folder.id">{{ folder.name }}</option>
            </select>
          </span>
        </label>
      </div>

      <p class="summary">
        <template v-if="plan.newFolders.length">Novas categorias: {{ newFoldersLabel }}. </template>
        <template v-if="plan.skipped">{{ count(plan.skipped, 'link já está salvo', 'links já estão salvos') }} e não {{ plan.skipped === 1 ? 'será repetido' : 'serão repetidos' }}.</template>
      </p>

      <div class="actions">
        <button type="button" class="btn btn-ghost" @click="emit('close')">Cancelar</button>
        <button type="button" class="btn btn-primary" :disabled="!plan.links.length || importing" @click="runImport">
          <AppIcon name="download" :size="15" />
          {{ importing ? 'Importando…' : plan.links.length ? `Importar ${count(plan.links.length, 'link', 'links')}` : 'Nada para importar' }}
        </button>
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
.import-dialog {
  padding: 22px;
}
h2 {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.lead {
  margin-top: 4px;
  color: var(--text-3);
  font-size: 13px;
}
.sources {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 16px;
}
.searching,
.none {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  color: var(--text-3);
  font-size: 13px;
}
.source {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--t-fast), background var(--t-fast), box-shadow var(--t-fast);
}
.source:hover:not(:disabled) {
  border-color: var(--primary);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.source:disabled:not(.busy) {
  opacity: 0.55;
  cursor: default;
}
.source.file {
  border-style: dashed;
  background: transparent;
}
.source-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary-text);
}
.source-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.source-text strong {
  font-size: 13.5px;
  font-weight: 600;
}
.source-text span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3);
  font-size: 12px;
}
.source-count {
  flex: none;
  color: var(--text-2);
  font-size: 12.5px;
}
.source-arrow {
  color: var(--text-3);
}
.spinner {
  flex: none;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 800ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 14px;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.5;
}
.hint :deep(.app-icon) {
  flex: none;
  margin-top: 2px;
}
.pick-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -4px 0 12px -6px;
}
.pick-title {
  flex: 1;
  min-width: 0;
}
.pick-title span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3);
  font-size: 12.5px;
}
.bulk {
  display: flex;
  gap: 2px;
}
.tree {
  height: min(340px, 42vh);
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface-2);
}
.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding-left: calc(var(--depth) * 18px);
  border-radius: var(--r-sm);
}
.tree-row:hover {
  background: var(--hover);
}
.tree-row.link {
  padding-left: calc(var(--depth) * 18px + 4px);
}
.twisty {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.twisty:hover {
  color: var(--text);
}
.twisty :deep(.app-icon) {
  transition: transform var(--t-fast) var(--ease-out);
}
.twisty :deep(.app-icon.open) {
  transform: rotate(90deg);
}
.check-label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 4px 6px 4px 0;
  cursor: pointer;
}
.check-label input {
  flex: none;
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}
.folder-icon {
  flex: none;
  color: var(--primary-text);
}
.row-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.folder .row-title {
  font-weight: 600;
}
.row-host {
  flex: 1 1 0;
  min-width: 40px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3);
  font-size: 12px;
}
.row-count {
  flex: none;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 11px;
  line-height: 18px;
}
.saved-tag {
  flex: none;
  margin-right: 6px;
  color: var(--text-3);
  font-size: 11.5px;
  font-style: italic;
}
.tree-row.saved .row-title {
  color: var(--text-3);
}
.more-btn {
  margin-left: 26px;
  padding: 4px 0;
  border: none;
  background: none;
  color: var(--primary-text);
  font-size: 12.5px;
  cursor: pointer;
}
.more-btn:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.mode {
  margin-top: 16px;
}
.radio {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 2px;
  cursor: pointer;
}
.radio input {
  flex: none;
  margin: 3px 0 0;
  accent-color: var(--primary);
  cursor: pointer;
}
.radio strong {
  font-size: 13.5px;
  font-weight: 600;
}
.radio small {
  display: block;
  margin-top: 2px;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.45;
}
.single {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: -6px;
}
.select-sm {
  width: auto;
  min-width: 180px;
  min-height: 30px;
  padding-top: 4px;
  padding-bottom: 4px;
  background-position: calc(100% - 16px) 12px, calc(100% - 11px) 12px;
}
.summary {
  min-height: 18px;
  margin-top: 10px;
  color: var(--text-2);
  font-size: 12.5px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
