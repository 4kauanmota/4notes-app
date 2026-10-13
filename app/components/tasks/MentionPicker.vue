<script setup lang="ts">
/**
 * Lista do que dá para mencionar numa tarefa: itens de todos os módulos (notas, notas
 * dos mapas, mapas, tarefas, links salvos e registros do Timer) — stores/mentions.ts.
 *
 * Abre embaixo do campo onde você digitou "@" (o texto depois do @ filtra) ou pelo
 * botão "Mencionar" (aí com campo de busca próprio). Cada item mostra de onde é
 * (módulo, categoria, data…), para diferenciar nomes parecidos.
 * ↑/↓ escolhem, Enter confirma, Esc ou clique fora fecham.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MENTION_KINDS } from '~/lib/mentions/catalog'
import type { MentionRef } from '~/lib/mentions/refs'
import { mentionKind } from '~/lib/notes/mention-links'
import { isAvailable, mentionItems, rankMentionItems, refFromTarget, type MentionItem } from '~/stores/mentions'

const props = defineProps<{
  anchor: HTMLElement
  /** Texto digitado depois do @ (quando aberto pelo @). */
  query?: string
  /** Mostra um campo de busca (quando aberto pelo botão). */
  withSearch?: boolean
  /** Já mencionados (ficam de fora da lista). */
  exclude?: MentionRef[]
  /** O próprio item (uma tarefa não menciona a si mesma). */
  exceptPath?: string | null
}>()

const emit = defineEmits<{ pick: [ref: MentionRef, title: string]; close: [] }>()

const root = ref<HTMLElement>()
const search = ref<HTMLInputElement>()
const ownQuery = ref('')
const all = ref<MentionItem[] | null>(null)
const active = ref(0)
const position = ref<Record<string, string>>({})

const items = computed(() => {
  if (!all.value) return []
  const options = { exclude: props.exclude, exceptPath: props.exceptPath }
  const available = all.value.filter((item) => isAvailable(item, options))
  return rankMentionItems(available, props.withSearch ? ownQuery.value : (props.query ?? ''), 40)
})

watch(items, () => (active.value = 0))

function place(): void {
  const rect = props.anchor.getBoundingClientRect()
  const width = Math.max(300, Math.min(400, rect.width))
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
  void nextTick(() => root.value?.querySelector('.mp-item.active')?.scrollIntoView({ block: 'nearest' }))
}

function choose(index = active.value): void {
  const item = items.value[index]
  const ref = item && refFromTarget(item)
  if (item && ref) emit('pick', ref, item.title)
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
  all.value = await mentionItems()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', place)
  document.removeEventListener('pointerdown', onPointerDown, true)
})

defineExpose({ move, choose })
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="mention-picker" :style="position" role="listbox" aria-label="Mencionar">
      <div v-if="withSearch" class="mp-search-row">
        <AppIcon name="search" :size="14" />
        <input
          ref="search"
          v-model="ownQuery"
          class="mp-search"
          placeholder="Buscar notas, tarefas, links, registros…"
          aria-label="Buscar o que mencionar"
          @keydown="onSearchKeydown"
        />
      </div>
      <div class="mp-list" @mousedown.prevent>
        <div v-if="!all" class="mp-empty">Carregando…</div>
        <div v-else-if="!items.length" class="mp-empty">Nada encontrado</div>
        <button
          v-for="(item, index) in items"
          :key="item.path"
          type="button"
          class="mp-item"
          :class="[{ active: index === active }, `mp-${mentionKind(item.path)}`]"
          role="option"
          :aria-selected="index === active"
          :data-mention-path="item.path"
          @mouseenter="active = index"
          @click="choose(index)"
        >
          <AppIcon :name="MENTION_KINDS[mentionKind(item.path)].icon" :size="15" class="mp-icon" />
          <span class="mp-title">{{ item.title }}</span>
          <span class="mp-where">{{ item.where }}</span>
        </button>
      </div>
      <div class="mp-hint">↑↓ escolher · Enter mencionar · Esc fechar</div>
    </div>
  </Teleport>
</template>

<style scoped>
.mention-picker {
  position: fixed;
  z-index: 70;
  display: flex;
  flex-direction: column;
  max-height: 340px;
  border-radius: var(--r-lg, 12px);
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: mp-in 120ms var(--ease-out);
}
.mp-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-3);
}
.mp-search {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13.5px;
}
.mp-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}
.mp-item {
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
.mp-item.active {
  background: var(--primary-soft);
}
.mp-icon {
  flex: none;
  color: var(--primary-text);
}
.mp-item.mp-task .mp-icon,
.mp-item.mp-timer .mp-icon {
  color: var(--accent-text);
}
.mp-item.mp-link .mp-icon {
  color: var(--text-3);
}
.mp-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-where {
  flex: none;
  max-width: 52%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--text-3);
}
.mp-empty {
  padding: 14px 12px;
  font-size: 13px;
  color: var(--text-3);
}
.mp-hint {
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-3);
}
@keyframes mp-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
}
</style>
