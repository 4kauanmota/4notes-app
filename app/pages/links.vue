<script setup lang="ts">
/**
 * Módulo LINKS: categorias à esquerda; à direita, o campo para salvar um link e a lista.
 *
 * Salvar é rápido: cole o endereço no campo (ou Ctrl+V em qualquer lugar desta tela)
 * ou arraste um link do navegador para cá — o título e o ícone do site chegam
 * sozinhos. Clique abre o link no navegador; ↑ ↓ Enter, Delete e F2 funcionam na lista.
 */
import { computed, nextTick, onActivated, onDeactivated, onUnmounted, reactive, ref, watch } from 'vue'
import LinkQuickAdd from '~/components/links/LinkQuickAdd.vue'
import LinksSidebar from '~/components/links/LinksSidebar.vue'
import { pickCategory } from '~/composables/useCategoryPicker'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import { useLayoutSize } from '~/composables/useLayoutSize'
import { useShortcuts } from '~/composables/useShortcuts'
import { droppedText, isExternalLinkDrag } from '~/lib/links/drag'
import type { LinkSort, SavedLink } from '~/lib/links/model'
import { canReveal, modKeyLabel } from '~/lib/platform'
import { useLinksStore, type LinkSelection } from '~/stores/links'
import { savedLinkSubject, showMentionsOf } from '~/stores/mentions'

const links = useLinksStore()
const mod = modKeyLabel()
const quickAdd = ref<InstanceType<typeof LinkQuickAdd>>()
const sidebar = ref<InstanceType<typeof LinksSidebar>>()
const scroller = ref<HTMLElement>()
const list = ref<HTMLElement>()
const sentinel = ref<HTMLElement>()
/** Link selecionado na lista (teclado e menu). */
const activeId = ref<string | null>(null)

/** Celular (layout compact): as categorias ficam numa gaveta. */
const { isCompact } = useLayoutSize()
const foldersOpen = ref(false)
const reveal = canReveal()

const folderDialog = reactive({ open: false, id: null as string | null, assignLink: null as string | null })
const editDialog = reactive({ open: false, id: null as string | null })
const importOpen = ref(false)

const searching = computed(() => !!links.state.search.trim())
const folder = computed(() => links.selectedFolder.value)
const shown = computed(() => links.visibleLinks.value)
/** A categoria de cada link aparece na lista quando ela mistura categorias. */
const showFolder = computed(() => searching.value || links.state.selection === 'all')

const header = computed(() => {
  const count = shown.value.length
  const countLabel = `${count} ${count === 1 ? 'link' : 'links'}`
  if (searching.value) return { title: 'Busca', subtitle: count ? `${count} ${count === 1 ? 'resultado' : 'resultados'} em todas as categorias` : 'Nenhum resultado' }
  if (folder.value) return { title: folder.value.name, subtitle: count ? countLabel : 'Categoria vazia' }
  if (links.state.selection === 'none') return { title: 'Sem categoria', subtitle: count ? countLabel : 'Nenhum link sem categoria' }
  return { title: 'Todos os links', subtitle: count ? countLabel : 'Nenhum link salvo ainda' }
})

const SORT_OPTIONS: { value: LinkSort; label: string }[] = [
  { value: 'recent', label: 'Recentes' },
  { value: 'name', label: 'A–Z' },
  { value: 'url', label: 'URL' },
]
const sort = computed({ get: () => links.state.sort, set: (value: LinkSort) => links.setSort(value) })

// ── Lista grande (milhares de favoritos importados): desenha aos poucos ─────

/** Linhas desenhadas de começo; ao rolar perto do fim, vêm mais. */
const PAGE = 150
const limit = ref(PAGE)
const rendered = computed(() => (shown.value.length > limit.value ? shown.value.slice(0, limit.value) : shown.value))
const listKey = computed(() => `${links.state.selection}|${links.state.search.trim()}|${links.state.sort}`)
const animated = computed(() => shown.value.length <= 300)
watch([() => links.state.selection, () => links.state.search, () => links.state.sort], () => {
  limit.value = PAGE
  scroller.value?.scrollTo({ top: 0 })
})

/** Garante que a linha do link está desenhada (teclado, link recém-salvo). */
function ensureRendered(id: string) {
  const index = shown.value.findIndex((link) => link.id === id)
  if (index >= limit.value) limit.value = index + PAGE
}

let observer: IntersectionObserver | null = null
function observeSentinel() {
  if (!sentinel.value || !scroller.value) return
  if (observer?.root !== scroller.value) {
    observer?.disconnect()
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) limit.value += PAGE * 2
    }, { root: scroller.value, rootMargin: '0px 0px 800px 0px' })
  }
  // Observar de novo confere na hora se o fim ainda está à vista (janela alta)
  observer.disconnect()
  observer.observe(sentinel.value)
}
watch([sentinel, limit], () => void nextTick(observeSentinel))

/** Ícones sendo buscados em segundo plano (depois de importar, por exemplo). */
const iconProgress = computed(() => {
  const jobs = links.state.iconJobs
  return jobs.total >= 3 && jobs.done < jobs.total ? jobs : null
})

// ── Lista: seleção e teclado ────────────────────────────────────────────────

function scrollToRow(id: string) {
  ensureRendered(id)
  void nextTick(() => list.value?.querySelector(`[data-link="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }))
}

function focusRow(id: string | null, scroll = true) {
  activeId.value = id
  if (id && scroll) scrollToRow(id)
}

/** Vai do campo de link para a lista (↓): a primeira linha fica selecionada. */
function enterList() {
  if (!shown.value.length) return
  list.value?.focus()
  focusRow(shown.value[0]!.id)
}

function onListKeydown(event: KeyboardEvent) {
  const items = shown.value
  if (!items.length) return
  const index = items.findIndex((link) => link.id === activeId.value)
  const current = index >= 0 ? items[index]! : null
  const withMod = event.ctrlKey || event.metaKey
  if (event.key === 'ArrowDown') {
    focusRow(items[Math.min(index + 1, items.length - 1)]!.id)
  } else if (event.key === 'ArrowUp') {
    if (index <= 0) {
      activeId.value = null
      quickAdd.value?.focus()
    } else focusRow(items[index - 1]!.id)
  } else if (event.key === 'Home') {
    focusRow(items[0]!.id)
  } else if (event.key === 'End') {
    focusRow(items.at(-1)!.id)
  } else if (event.key === 'Enter' && current) {
    links.openLink(current.id)
  } else if (event.key === 'Delete' && current) {
    const next = items[index + 1] ?? items[index - 1] ?? null
    links.deleteLink(current.id)
    focusRow(next?.id ?? null)
  } else if (event.key === 'F2' && current) {
    openEdit(current.id)
  } else if (withMod && event.code === 'KeyC' && current && !window.getSelection()?.toString()) {
    void links.copyLink(current.id)
  } else {
    return
  }
  event.preventDefault()
}

// A seleção some quando o link sai da lista (outra categoria, busca…)
watch(shown, (items) => {
  if (activeId.value && !items.some((link) => link.id === activeId.value)) activeId.value = null
})

// Link recém-salvo (ou que já existia): rola até ele; o destaque some sozinho
let highlightTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => links.state.highlight,
  (id) => {
    if (!id) return
    scrollToRow(id)
    if (highlightTimer) clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => {
      if (links.state.highlight === id) links.state.highlight = null
    }, 1800)
  },
)

// ── Menu do link ────────────────────────────────────────────────────────────

async function linkMenu(link: SavedLink, event: MouseEvent) {
  focusRow(link.id, false)
  // Pelo botão "⋯": o menu abre embaixo dele; pelo clique direito: onde está o mouse
  const anchor = event.type === 'click' ? (event.currentTarget as Element | null) : null
  const current = links.folderOf(link)
  const choice = await showContextMenu(
    [
      { id: 'open', label: 'Abrir no navegador', hint: 'Enter' },
      { id: 'copy', label: 'Copiar endereço', hint: `${mod}+C` },
      { id: 'edit', label: 'Editar…', hint: 'F2' },
      { id: 'move', label: 'Categoria…', hint: current?.name },
      { id: 'mentions', label: 'Ver menções' },
      { id: 'refresh', label: 'Atualizar título e ícone', enabled: !links.state.fetching.has(link.id) },
      separator,
      { id: 'delete', label: 'Excluir', danger: true, hint: 'Del' },
    ],
    anchor,
  )
  if (!choice) return
  if (choice === 'open') links.openLink(link.id)
  else if (choice === 'copy') void links.copyLink(link.id)
  else if (choice === 'edit') openEdit(link.id)
  else if (choice === 'mentions') showMentionsOf(savedLinkSubject(link))
  else if (choice === 'refresh') links.refreshLink(link.id)
  else if (choice === 'delete') links.deleteLink(link.id)
  else if (choice === 'move') {
    // O seletor de categorias (1.7.2), perto de onde o menu estava
    const picked = await pickCategory({ module: 'links', selected: [current?.id ?? null], title: 'Categoria do link' })
    if (picked) links.moveLink(link.id, picked[0] ?? null)
  }
}

// ── Diálogos ────────────────────────────────────────────────────────────────

function openEdit(id: string) {
  editDialog.id = id
  editDialog.open = true
}

function openFolderDialog(id: string | null, assignLink: string | null = null) {
  Object.assign(folderDialog, { open: true, id, assignLink })
}

function onFolderSaved(id: string) {
  const created = !folderDialog.id
  if (folderDialog.assignLink) links.moveLink(folderDialog.assignLink, id)
  else if (created) links.select(`folder:${id}`)
}

function onImported(selection: LinkSelection) {
  links.state.search = ''
  links.select(selection)
}

// ── Colar e arrastar para salvar ────────────────────────────────────────────

const dropping = ref(false)
let dragDepth = 0

const isField = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || !!el.closest?.('input, textarea, select'))
}
const modalOpen = () => !!document.querySelector('[aria-modal="true"]')

/** Um link vindo de fora (navegador, outro programa), fora dos campos de texto. */
const isExternalDrag = (event: DragEvent) => isExternalLinkDrag(event) && !isField(event.target)

function onDragEnter(event: DragEvent) {
  if (!isExternalLinkDrag(event)) return
  dragDepth++
  dropping.value = true
}

function onDragOver(event: DragEvent) {
  if (!isExternalDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(event: DragEvent) {
  if (!dropping.value || !isExternalLinkDrag(event)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dropping.value = false
}

function onDrop(event: DragEvent) {
  dragDepth = 0
  dropping.value = false
  if (!isExternalDrag(event)) return
  event.preventDefault()
  const text = droppedText(event.dataTransfer)
  if (text) quickAdd.value?.add(text)
}

/** Ctrl+V fora de um campo: salva o endereço colado. */
function onPaste(event: ClipboardEvent) {
  if (event.defaultPrevented || isField(event.target) || isField(document.activeElement) || modalOpen()) return
  const text = event.clipboardData?.getData('text/plain').trim()
  if (!text) return
  event.preventDefault()
  quickAdd.value?.add(text)
}

let listening = false
function bind() {
  if (!listening) window.addEventListener('paste', onPaste)
  listening = true
  // Ícones que faltam (links importados, sites que estavam fora do ar…)
  links.ensureIcons()
}
function unbind() {
  window.removeEventListener('paste', onPaste)
  listening = false
}
onActivated(bind)
onDeactivated(unbind)
onUnmounted(() => {
  unbind()
  observer?.disconnect()
  if (highlightTimer) clearTimeout(highlightTimer)
})

useShortcuts({
  'mod+n': () => quickAdd.value?.focus(),
  'mod+f': () => {
    // No celular a busca fica na gaveta das categorias
    if (isCompact.value) foldersOpen.value = true
    void nextTick(() => sidebar.value?.focusSearch())
  },
})
</script>

<template>
  <div class="links-page">
    <MobileDrawer v-model:open="foldersOpen" label="Categorias de links">
      <LinksSidebar
        ref="sidebar"
        @import="(foldersOpen = false), (importOpen = true)"
        @search-done="foldersOpen = false"
        @new-folder="openFolderDialog(null)"
        @edit-folder="openFolderDialog"
      />
    </MobileDrawer>
    <section
      class="links-main"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div v-if="links.state.error" class="links-error">
        <AppIcon name="alert" :size="34" />
        <h2>Não foi possível ler o arquivo de links</h2>
        <p class="selectable">{{ links.state.error }}</p>
        <p class="muted">Nada foi sobrescrito. Corrija o arquivo <code>links/links.json</code> (ou restaure um backup de <code>.4notes/backups</code>) e tente de novo.</p>
        <div class="error-actions">
          <button class="btn btn-primary" @click="links.retry()">Tentar novamente</button>
          <button v-if="reveal" class="btn" @click="links.revealFile()">Mostrar arquivo</button>
        </div>
      </div>

      <div v-else ref="scroller" class="links-scroll">
        <div class="links-content module-content">
          <header class="links-header">
            <button v-if="isCompact" class="icon-btn folders-toggle" aria-label="Categorias" data-action="link-folders" @click="foldersOpen = true">
              <AppIcon name="sidebar" :size="19" />
            </button>
            <div class="title-block">
              <h1>
                <CategoryAvatar v-if="folder && !searching" :name="folder.name" :color="folder.color" :icon="folder.icon" :image="folder.image" :size="28" />
                <span class="title-text">{{ header.title }}</span>
              </h1>
              <p>
                {{ header.subtitle }}
                <span v-if="iconProgress" class="icon-progress">
                  · Buscando ícones dos sites… {{ iconProgress.done }}/{{ iconProgress.total }}
                </span>
              </p>
            </div>
            <div class="header-side">
              <UiSegmented v-if="shown.length > 1" v-model="sort" :options="SORT_OPTIONS" size="sm" aria-label="Ordem dos links" />
              <button v-if="folder && !searching" class="btn btn-sm btn-ghost" @click="openFolderDialog(folder.id)"><AppIcon name="edit" :size="14" /> Editar</button>
            </div>
          </header>

          <LinkQuickAdd ref="quickAdd" :folder-id="folder?.id ?? null" class="quick-add-slot" @down="enterList" />

          <div
            v-if="shown.length"
            ref="list"
            class="link-list"
            tabindex="0"
            aria-label="Links salvos"
            @keydown="onListKeydown"
          >
            <!-- Trocar de categoria, buscar ou ordenar troca a lista inteira (sem animar cada linha);
                 listas grandes não animam (a animação mede todas as linhas a cada mudança) -->
            <TransitionGroup v-if="animated" :key="listKey" name="link">
              <LinkRow
                v-for="link in rendered"
                :key="link.id"
                :link="link"
                :show-folder="showFolder"
                :active="activeId === link.id"
                @focus="focusRow(link.id, false)"
                @edit="openEdit(link.id)"
                @menu="(event) => linkMenu(link, event)"
              />
            </TransitionGroup>
            <template v-else>
              <LinkRow
                v-for="link in rendered"
                :key="link.id"
                :link="link"
                :show-folder="showFolder"
                :active="activeId === link.id"
                @focus="focusRow(link.id, false)"
                @edit="openEdit(link.id)"
                @menu="(event) => linkMenu(link, event)"
              />
            </template>
            <div v-if="rendered.length < shown.length" ref="sentinel" class="more-rows">Carregando mais links…</div>
          </div>

          <!-- Vazio -->
          <LinksEmpty
            v-else-if="searching"
            icon="search"
            :title="`Nada encontrado para “${links.state.search.trim()}”`"
            text="A busca procura no título e no endereço dos links, em todas as categorias."
          />
          <LinksEmpty
            v-else-if="!links.state.links.length"
            icon="link"
            title="Seus links ficam aqui"
            :text="`Cole um endereço no campo acima e aperte Enter — o título e o ícone do site aparecem sozinhos. Também dá para colar com ${mod}+V em qualquer lugar desta tela ou arrastar um link do navegador para cá.`"
          >
            <button class="btn btn-sm" @click="importOpen = true"><AppIcon name="download" :size="14" /> Importar do navegador</button>
          </LinksEmpty>
          <LinksEmpty
            v-else-if="folder"
            icon="folder-open"
            title="Categoria vazia"
            text="Cole um link acima: ele já entra nesta categoria. Para trazer links que já estão salvos, arraste-os até a categoria na lista lateral."
          />
          <LinksEmpty v-else icon="check" title="Tudo organizado" text="Todos os links estão em categorias." />
        </div>
      </div>

      <Transition name="fade">
        <div v-if="dropping" class="drop-overlay" aria-hidden="true">
          <div class="drop-card">
            <AppIcon name="link" :size="22" />
            <span>Solte para salvar o link<template v-if="folder && !searching"> em {{ folder.name }}</template></span>
          </div>
        </div>
      </Transition>
    </section>

    <LinkFolderDialog :open="folderDialog.open" :folder-id="folderDialog.id" @close="folderDialog.open = false" @saved="onFolderSaved" />
    <LinkEditDialog :open="editDialog.open" :link-id="editDialog.id" @close="editDialog.open = false" />
    <LinkImportDialog :open="importOpen" @close="importOpen = false" @done="onImported" />
  </div>
</template>

<style scoped>
.links-page {
  display: flex;
  height: 100%;
}
.links-main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.links-scroll {
  flex: 1;
  overflow-y: auto;
}
.links-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.title-block {
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
.icon-progress {
  color: var(--primary-text);
}
.header-side {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  padding-top: 4px;
}
.quick-add-slot {
  margin-bottom: 18px;
}
.link-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1px;
  outline: none;
}
.more-rows {
  padding: 14px 12px;
  color: var(--text-3);
  font-size: 12.5px;
}
.link-list:focus-visible {
  border-radius: var(--r-md);
  box-shadow: 0 0 0 2px var(--primary-soft-2);
}
.links-error {
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
.links-error > :deep(.app-icon) {
  color: var(--danger);
}
.links-error h2 {
  color: var(--text);
  font-family: var(--font-display);
  font-size: 19px;
}
.links-error code {
  font-family: var(--font-mono);
  font-size: 0.9em;
}
.error-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

/* Arrastar um link do navegador para cá */
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

/* Animações da lista */
.link-enter-active {
  transition: opacity 240ms var(--ease-out), transform 280ms var(--ease-spring);
}
.link-leave-active {
  transition: opacity 180ms ease, transform 220ms var(--ease-out);
  position: absolute;
  left: 0;
  right: 0;
}
.link-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.link-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
.link-move {
  transition: transform 260ms var(--ease-out);
}

/* ── Celular ── */
.folders-toggle {
  flex: none;
  margin: 0 -2px 0 -8px;
}
html[data-layout='compact'] .links-header {
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  margin-bottom: 14px;
}
html[data-layout='compact'] .title-block {
  flex: 1;
}
html[data-layout='compact'] .title-block h1 {
  font-size: 22px;
}
/* A ordem (Recentes / A–Z / URL) desce para a linha de baixo, inteira */
html[data-layout='compact'] .header-side {
  width: 100%;
  padding-top: 0;
}
</style>
