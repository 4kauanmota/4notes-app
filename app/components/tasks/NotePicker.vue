<script setup lang="ts">
/**
 * Lista de notas para mencionar numa tarefa (Notas e todos os mapas).
 *
 * Abre embaixo do campo onde você digitou "@" (o texto depois do @ filtra) ou pelo
 * botão "Mencionar nota" (aí com campo de busca próprio).
 * ↑/↓ escolhem, Enter confirma, Esc ou clique fora fecham.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { refKey, type NoteRef } from '~/lib/tasks/mentions'
import { filterCandidates, mentionCandidates, type MentionCandidate } from '~/stores/mentions'

const props = defineProps<{
  anchor: HTMLElement
  /** Texto digitado depois do @ (quando aberto pelo @). */
  query?: string
  /** Mostra um campo de busca (quando aberto pelo botão). */
  withSearch?: boolean
  /** Notas já mencionadas (ficam de fora da lista). */
  exclude?: NoteRef[]
}>()

const emit = defineEmits<{ pick: [ref: NoteRef, title: string]; close: [] }>()

const root = ref<HTMLElement>()
const search = ref<HTMLInputElement>()
const ownQuery = ref('')
const all = ref<MentionCandidate[] | null>(null)
const active = ref(0)
const position = ref<Record<string, string>>({})

const items = computed(() => {
  if (!all.value) return []
  const exclude = new Set((props.exclude ?? []).map(refKey))
  const available = all.value.filter((item) => !exclude.has(refKey(item.ref)))
  return filterCandidates(available, props.withSearch ? ownQuery.value : (props.query ?? ''), 40)
})

watch(items, () => (active.value = 0))

function place(): void {
  const rect = props.anchor.getBoundingClientRect()
  const width = Math.max(280, Math.min(360, rect.width))
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
  const below = window.innerHeight - rect.bottom > 260 || rect.top < 260
  position.value = below
    ? { left: `${left}px`, top: `${rect.bottom + 6}px`, width: `${width}px` }
    : { left: `${left}px`, bottom: `${window.innerHeight - rect.top + 6}px`, width: `${width}px` }
}

function move(delta: number): void {
  const count = items.value.length
  if (!count) return
  active.value = (active.value + delta + count) % count
  void nextTick(() => root.value?.querySelector('.np-item.active')?.scrollIntoView({ block: 'nearest' }))
}

function choose(index = active.value): void {
  const item = items.value[index]
  if (item) emit('pick', item.ref, item.title)
}

function onPointerDown(event: PointerEvent): void {
  const target = event.target as Node
  if (!root.value?.contains(target) && !props.anchor.contains(target)) emit('close')
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') move(1)
  else if (event.key === 'ArrowUp') move(-1)
  else if (event.key === 'Enter') choose()
  else if (event.key === 'Escape') emit('close')
  else return
  event.preventDefault()
  event.stopPropagation()
}

onMounted(async () => {
  place()
  window.addEventListener('resize', place)
  document.addEventListener('pointerdown', onPointerDown, true)
  if (props.withSearch) void nextTick(() => search.value?.focus())
  all.value = await mentionCandidates()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', place)
  document.removeEventListener('pointerdown', onPointerDown, true)
})

defineExpose({ move, choose })
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="note-picker" :style="position" role="listbox" aria-label="Mencionar nota">
      <div v-if="withSearch" class="np-search-row">
        <AppIcon name="search" :size="14" />
        <input ref="search" v-model="ownQuery" class="np-search" placeholder="Buscar nota…" aria-label="Buscar nota" @keydown="onSearchKeydown" />
      </div>
      <div class="np-list" @mousedown.prevent>
        <div v-if="!all" class="np-empty">Carregando notas…</div>
        <div v-else-if="!items.length" class="np-empty">Nenhuma nota encontrada</div>
        <button
          v-for="(item, index) in items"
          :key="refKey(item.ref)"
          type="button"
          class="np-item"
          :class="{ active: index === active }"
          role="option"
          :aria-selected="index === active"
          @mouseenter="active = index"
          @click="choose(index)"
        >
          <AppIcon :name="item.ref.kind === 'map' ? 'graph' : 'notes'" :size="15" class="np-icon" />
          <span class="np-title">{{ item.title }}</span>
          <span class="np-where">{{ item.where }}</span>
        </button>
      </div>
      <div class="np-hint">↑↓ escolher · Enter mencionar · Esc fechar</div>
    </div>
  </Teleport>
</template>

<style scoped>
.note-picker {
  position: fixed;
  z-index: 70;
  display: flex;
  flex-direction: column;
  max-height: 320px;
  border-radius: var(--r-lg, 12px);
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: np-in 120ms var(--ease-out);
}
.np-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-3);
}
.np-search {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13.5px;
}
.np-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}
.np-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font: inherit;
  font-size: 13.5px;
  cursor: pointer;
}
.np-item.active {
  background: var(--primary-soft);
}
.np-icon {
  color: var(--primary-text);
}
.np-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.np-where {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--text-3);
}
.np-empty {
  padding: 14px 12px;
  font-size: 13px;
  color: var(--text-3);
}
.np-hint {
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-3);
}
@keyframes np-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
}
</style>
