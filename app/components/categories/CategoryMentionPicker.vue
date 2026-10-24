<script setup lang="ts">
/**
 * Lista do "#" num campo de texto (1.7.1): as categorias do app, filtradas pelo texto
 * depois do "#", e "Criar categoria" quando o nome ainda não existe. A mesma busca do
 * "#" do editor das notas (stores/mentions.ts › categoryMentions).
 * ↑/↓ escolhem, Enter (ou Tab) confirma, Esc ou clique fora fecham.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MentionTarget } from '~/lib/editor/host'
import { foldText } from '~/lib/finance/model'
import { categoryMentions } from '~/stores/mentions'

const props = defineProps<{
  anchor: HTMLElement
  /** Texto digitado depois do #. */
  query: string
}>()

const emit = defineEmits<{ pick: [target: MentionTarget]; close: [] }>()

const root = ref<HTMLElement>()
const active = ref(0)
const position = ref<Record<string, string>>({})

const name = computed(() => props.query.trim())
const found = computed(() => categoryMentions.search(props.query))
/** "Criar" aparece quando o nome digitado ainda não é uma categoria. */
const canCreate = computed(() => !!name.value && !found.value.some((item) => foldText(item.title) === foldText(name.value)))
const count = computed(() => found.value.length + (canCreate.value ? 1 : 0))

watch(() => props.query, () => (active.value = 0))

function place(): void {
  const rect = props.anchor.getBoundingClientRect()
  const width = Math.max(260, Math.min(340, rect.width))
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
  const below = window.innerHeight - rect.bottom > 240 || rect.top < 240
  position.value = below
    ? { left: `${left}px`, top: `${rect.bottom + 6}px`, width: `${width}px` }
    : { left: `${left}px`, bottom: `${window.innerHeight - rect.top + 6}px`, width: `${width}px` }
}

function move(delta: number): void {
  if (!count.value) return
  active.value = (active.value + delta + count.value) % count.value
  void nextTick(() => root.value?.querySelector('.cp-item.active')?.scrollIntoView({ block: 'nearest' }))
}

function choose(index = active.value): void {
  if (index < found.value.length) {
    emit('pick', found.value[index]!)
    return
  }
  if (!canCreate.value) return
  const created = categoryMentions.create(name.value)
  if (created) emit('pick', created)
}

function onPointerDown(event: PointerEvent): void {
  const target = event.target as Node
  if (!root.value?.contains(target) && !props.anchor.contains(target)) emit('close')
}

onMounted(() => {
  place()
  window.addEventListener('resize', place)
  document.addEventListener('pointerdown', onPointerDown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', place)
  document.removeEventListener('pointerdown', onPointerDown, true)
})

defineExpose({ move, choose })
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="category-picker" :style="position" role="listbox" aria-label="Categorias" data-category-picker>
      <div class="cp-list" @mousedown.prevent>
        <div v-if="!count" class="cp-empty">Digite o nome da categoria</div>
        <button
          v-for="(item, index) in found"
          :key="item.path"
          type="button"
          class="cp-item"
          :class="{ active: index === active }"
          role="option"
          :aria-selected="index === active"
          :data-category-path="item.path"
          @mouseenter="active = index"
          @click="choose(index)"
        >
          <span class="cp-hash" :style="{ color: item.color }">#</span>
          <span class="cp-title">{{ item.title }}</span>
          <span class="cp-where">{{ item.where }}</span>
        </button>
        <button
          v-if="canCreate"
          type="button"
          class="cp-item create"
          :class="{ active: active === found.length }"
          role="option"
          :aria-selected="active === found.length"
          data-action="create-category"
          @mouseenter="active = found.length"
          @click="choose(found.length)"
        >
          <AppIcon name="plus" :size="14" class="cp-plus" />
          <span class="cp-title">Criar categoria “{{ name }}”</span>
        </button>
      </div>
      <div class="cp-hint">↑↓ escolher · Enter usar · Esc fechar</div>
    </div>
  </Teleport>
</template>

<style scoped>
.category-picker {
  position: fixed;
  z-index: 70;
  display: flex;
  flex-direction: column;
  max-height: 300px;
  border-radius: var(--r-lg, 12px);
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: cp-in 120ms var(--ease-out);
}
.cp-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}
.cp-item {
  display: flex;
  align-items: center;
  gap: 8px;
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
html[data-touch] .cp-item {
  min-height: 42px;
}
.cp-item.active {
  background: var(--primary-soft);
}
.cp-hash {
  flex: none;
  width: 14px;
  font-weight: 750;
  text-align: center;
}
.cp-plus {
  flex: none;
  color: var(--primary-text);
}
.cp-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.create .cp-title {
  color: var(--primary-text);
  font-weight: 600;
}
.cp-where {
  flex: none;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--text-3);
}
.cp-empty {
  padding: 12px;
  font-size: 13px;
  color: var(--text-3);
}
.cp-hint {
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-3);
}
html[data-touch] .cp-hint {
  display: none;
}
@keyframes cp-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
}
</style>
