<script setup lang="ts">
/**
 * Biblioteca de imagens (composables/useImageLibrary.ts): todas as imagens já
 * enviadas ao 4notes — coladas nas notas, enviadas por aqui, fotos de categorias.
 * Escolha uma para usar de novo (dois cliques ou Enter), envie imagens novas do
 * computador ou exclua as que não estão em uso (vão para a Lixeira).
 */
import { computed, nextTick, ref, watch } from 'vue'
import { errorMessage, workspaceFileUrl, type LibraryImage } from '#shared/ipc'
import { confirmDialog } from '~/composables/useDialog'
import { closeImageLibrary, useImageLibrary } from '~/composables/useImageLibrary'
import { notifyError, showToast } from '~/composables/useToasts'
import { desktop, isAndroid, trashPlace } from '~/lib/platform'
import { flushEverything } from '~/stores/app'

/** Para onde vai a imagem excluída (a Lixeira; no celular, a do workspace). */
const trash = trashPlace()
const device = isAndroid() ? 'celular' : 'computador'
const { state } = useImageLibrary()
/** null = carregando. */
const images = ref<LibraryImage[] | null>(null)
const selected = ref<string | null>(null)
const uploading = ref(false)
const grid = ref<HTMLElement>()

const picking = computed(() => state.mode === 'pick')
const count = computed(() => images.value?.length ?? 0)

async function refresh(select?: string | null): Promise<void> {
  try {
    // Notas com alterações ainda não gravadas: grava antes (o "em uso" fica certo)
    await flushEverything()
    images.value = await desktop().library.list()
  } catch (error) {
    notifyError(`Não foi possível abrir a biblioteca de imagens: ${errorMessage(error)}`, error)
    images.value = []
  }
  if (select !== undefined) selected.value = select
  if (selected.value && !images.value.some((image) => image.path === selected.value)) selected.value = null
}

watch(
  () => state.open,
  (open) => {
    if (!open) return
    images.value = null
    selected.value = null
    void refresh()
  },
  { immediate: true },
)

const imageUrl = (image: LibraryImage) => `${workspaceFileUrl(image.path)}?v=${Math.round(image.mtimeMs)}`

function usageLabel(image: LibraryImage): string {
  if (!image.usage.length) return 'Sem uso'
  return image.usage.length > 1 ? `${image.usage[0]} +${image.usage.length - 1}` : image.usage[0]!
}

const usageTip = (image: LibraryImage) => (image.usage.length ? `Em uso: ${image.usage.join(' · ')}` : 'Sem uso — pode ser excluída')

function use(path: string | null = selected.value) {
  if (picking.value && path) closeImageLibrary(path)
}

async function upload() {
  if (uploading.value) return
  uploading.value = true
  try {
    const known = new Set(images.value?.map((image) => image.path))
    const paths = await desktop().library.upload()
    if (!paths.length) return
    await refresh(paths[0]!)
    // Imagem igual a uma que já estava na biblioteca: não vira outra cópia
    const added = paths.filter((path) => !known.has(path)).length
    const message = !added
      ? paths.length === 1
        ? 'Essa imagem já estava na biblioteca'
        : 'Essas imagens já estavam na biblioteca'
      : added === 1
        ? 'Imagem enviada para a biblioteca'
        : `${added} imagens enviadas para a biblioteca`
    showToast({ message, icon: 'image', tone: added ? 'success' : 'info' })
    await nextTick()
    grid.value?.querySelector('.tile.selected')?.scrollIntoView({ block: 'nearest' })
  } catch (error) {
    notifyError(errorMessage(error), error)
  } finally {
    uploading.value = false
  }
}

async function remove(image: LibraryImage) {
  if (image.usage.length) return
  const ok = await confirmDialog({
    title: 'Excluir esta imagem?',
    message: `“${image.name}” vai para ${trashPlace()}. Nenhuma nota ou categoria usa esta imagem.`,
    confirmLabel: 'Excluir',
    danger: true,
    icon: 'trash',
  })
  if (!ok) return
  try {
    const result = await desktop().library.remove(image.path)
    if (result === 'removed') showToast({ message: `Imagem excluída (foi para ${trashPlace()})`, icon: 'trash' })
    else if (result === 'in-use') showToast({ message: 'Essa imagem passou a ser usada e não foi excluída.', icon: 'info' })
  } catch (error) {
    notifyError(`Não foi possível excluir a imagem: ${errorMessage(error)}`, error)
  }
  await refresh()
}

/** Na grade: ← → ↑ ↓ escolhem, Enter usa, Delete exclui (só imagens sem uso). */
function onKeydown(event: KeyboardEvent) {
  const list = images.value ?? []
  // Teclas nos botões (Cancelar, Enviar…) continuam sendo dos botões
  if (!list.length || !grid.value?.contains(event.target as Node)) return
  const index = list.findIndex((image) => image.path === selected.value)
  const tile = grid.value?.querySelector<HTMLElement>('.tile')
  const columns = tile && grid.value ? Math.max(1, Math.round(grid.value.clientWidth / (tile.offsetWidth + 10))) : 1
  const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }
  if (event.key in steps) {
    event.preventDefault()
    const next = index < 0 ? 0 : Math.min(list.length - 1, Math.max(0, index + steps[event.key]!))
    selected.value = list[next]!.path
    void nextTick(() => grid.value?.querySelector('.tile.selected')?.scrollIntoView({ block: 'nearest' }))
  } else if (event.key === 'Enter' && index >= 0) {
    event.preventDefault()
    if (picking.value) use()
  } else if (event.key === 'Delete' && index >= 0) {
    event.preventDefault()
    void remove(list[index]!)
  }
}
</script>

<template>
  <UiModal :open="state.open" :width="720" :label="state.title" full-on-compact @close="closeImageLibrary()">
    <div class="library">
      <header class="library-head">
        <div class="head-text">
          <h2>{{ state.title }}</h2>
          <p>
            {{ picking ? 'Escolha uma imagem já enviada ao 4notes ou envie uma nova.' : 'Todas as imagens enviadas ao 4notes. As que não estão em uso podem ser excluídas.' }}
          </p>
        </div>
        <button type="button" class="icon-btn" aria-label="Fechar" @click="closeImageLibrary()"><AppIcon name="x" /></button>
      </header>

      <div class="library-bar">
        <button type="button" class="btn btn-sm" :disabled="uploading" @click="upload">
          <AppIcon name="upload" :size="15" /> {{ uploading ? 'Enviando…' : 'Enviar imagens…' }}
        </button>
        <span v-if="images" class="library-count">{{ count }} {{ count === 1 ? 'imagem' : 'imagens' }}</span>
      </div>

      <div v-if="images === null" class="library-state"><span class="spinner" /> Carregando imagens…</div>
      <div v-else-if="!images.length" class="library-state empty">
        <AppIcon name="image" :size="30" />
        <strong>Nenhuma imagem ainda</strong>
        <span>Envie imagens do {{ device }} ou cole uma imagem numa nota: ela aparece aqui.</span>
      </div>
      <div v-else ref="grid" class="library-grid" role="listbox" :aria-label="state.title" tabindex="0" @keydown="onKeydown">
        <button
          v-for="image in images"
          :key="image.path"
          type="button"
          class="tile"
          role="option"
          :aria-selected="selected === image.path"
          :class="{ selected: selected === image.path }"
          :data-path="image.path"
          @click="selected = image.path"
          @dblclick="use(image.path)"
        >
          <span class="thumb"><img :src="imageUrl(image)" alt="" loading="lazy" decoding="async" draggable="false" /></span>
          <span class="tile-name" :title="image.name">{{ image.name }}</span>
          <span class="tile-usage" :class="{ unused: !image.usage.length }" :data-tip="usageTip(image)" data-tip-pos="top">{{ usageLabel(image) }}</span>
          <span
            v-if="!image.usage.length"
            class="tile-delete icon-btn sm danger"
            role="button"
            :data-tip="`Excluir (vai para ${trash})`"
            aria-label="Excluir imagem"
            @click.stop="remove(image)"
            @dblclick.stop
          >
            <AppIcon name="trash" :size="13" />
          </span>
        </button>
      </div>

      <footer class="library-actions">
        <template v-if="picking">
          <button type="button" class="btn btn-ghost" @click="closeImageLibrary()">Cancelar</button>
          <button type="button" class="btn btn-primary" :disabled="!selected" @click="use()">{{ state.confirmLabel }}</button>
        </template>
        <button v-else type="button" class="btn" @click="closeImageLibrary()">Fechar</button>
      </footer>
    </div>
  </UiModal>
</template>

<style scoped>
.library {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 48px);
  padding: 20px 22px 18px;
}
.library-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.library-head h2 {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.library-head p {
  margin-top: 3px;
  color: var(--text-3);
  font-size: 12.5px;
}
.library-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0 10px;
}
.library-count {
  color: var(--text-3);
  font-size: 12px;
}
.library-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 200px;
  color: var(--text-3);
  font-size: 13px;
}
.library-state.empty {
  flex-direction: column;
  gap: 6px;
  text-align: center;
}
.library-state.empty strong {
  color: var(--text-2);
  font-size: 14px;
}
/* O foco do teclado aparece na imagem escolhida, não em volta da grade */
.library-grid:focus-visible {
  outline: none;
  box-shadow: none;
}
.library-grid:focus-visible .tile.selected {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 45%, transparent);
}
.library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  gap: 10px;
  min-height: 200px;
  max-height: min(440px, calc(100vh - 260px));
  overflow-y: auto;
  padding: 4px;
  margin: 0 -4px;
  outline: none;
}
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 6px 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--t-fast), box-shadow var(--t-fast), background var(--t-fast);
}
.tile:hover {
  border-color: var(--border-strong);
  background: var(--surface);
}
.tile.selected {
  border-color: var(--primary);
  background: var(--surface);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 35%, transparent);
}
.thumb {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: var(--r-md);
  /* Xadrez discreto atrás de imagens transparentes */
  background: repeating-conic-gradient(var(--surface-3) 0% 25%, var(--surface) 0% 50%) 50% / 16px 16px;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tile-name {
  overflow: hidden;
  padding: 0 2px;
  font-size: 12px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tile-usage {
  align-self: flex-start;
  max-width: 100%;
  overflow: hidden;
  padding: 0 2px;
  color: var(--text-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tile-usage.unused {
  color: var(--text-3);
  font-style: italic;
}
.tile-delete {
  position: absolute;
  top: 10px;
  right: 10px;
  display: none;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--elevated) 92%, transparent);
  box-shadow: var(--shadow-sm);
}
.tile:hover .tile-delete,
.tile.selected .tile-delete {
  display: grid;
}
.library-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.spinner {
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
</style>
