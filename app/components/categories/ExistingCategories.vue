<script setup lang="ts">
/**
 * No diálogo de nova categoria de cada módulo: as categorias do app que ainda não estão
 * neste módulo e combinam com o nome digitado (1.7.2: a mesma busca do seletor de
 * categorias, lib/categories/search.ts). Usar uma delas evita criar outra parecida.
 */
import { computed } from 'vue'
import type { CategoryModuleId } from '~/lib/categories/model'
import { foldCategoryName, rankCategories } from '~/lib/categories/search'
import { useCategoriesStore } from '~/stores/categories'

const props = defineProps<{ module: CategoryModuleId; query?: string }>()
const emit = defineEmits<{ pick: [id: string] }>()
const shared = useCategoriesStore()

const SHOWN = 6

const available = computed(() => shared.availableFor(props.module))
const hasQuery = computed(() => !!foldCategoryName(props.query ?? ''))
const matches = computed(() => rankCategories(available.value, props.query ?? ''))
const shown = computed(() => matches.value.slice(0, SHOWN))

/** Onde a categoria já aparece (para diferenciar e lembrar de onde ela é). */
function where(id: string): string {
  const places = shared.usage(id).filter((item) => item.member || item.records.length)
  return places.length ? `em ${places.map((item) => item.label).join(', ')}` : 'ainda sem uso'
}
</script>

<template>
  <div v-if="available.length" class="existing" data-existing-categories>
    <span class="field-label">{{ hasQuery ? 'Já existem no app' : 'Ou use uma categoria que já existe no app' }}</span>
    <ul v-if="shown.length" class="list" role="list">
      <li v-for="category in shown" :key="category.id">
        <button type="button" class="item" :data-category-id="category.id" @click="emit('pick', category.id)">
          <CategoryAvatar :name="category.name" :color="category.color" :icon="category.icon" :image="category.image" :size="20" />
          <span class="name">{{ category.name }}</span>
          <span class="where">{{ where(category.id) }}</span>
          <span class="use">Usar</span>
        </button>
      </li>
    </ul>
    <p v-if="matches.length > SHOWN" class="none">Mais {{ matches.length - SHOWN }}: {{ hasQuery ? 'continue digitando' : 'digite o nome para buscar' }}.</p>
    <p v-else-if="!shown.length" class="none">Nenhuma outra com “{{ query?.trim() }}”: será criada uma nova.</p>
  </div>
</template>

<style scoped>
.existing {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--border-strong);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 34px;
  padding: 0 8px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
html[data-touch] .item {
  min-height: 44px;
  font-size: 14.5px;
}
.item:hover,
.item:focus-visible {
  background: var(--hover);
  outline: none;
}
.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 550;
}
.where {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3);
  font-size: 11.5px;
}
.use {
  flex-shrink: 0;
  color: var(--primary-text);
  font-size: 12px;
  font-weight: 600;
  opacity: 0;
  transition: opacity var(--t-fast);
}
.item:hover .use,
.item:focus-visible .use,
html[data-touch] .use {
  opacity: 1;
}
.none {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--text-3);
}
</style>
