<script setup lang="ts">
/**
 * "Ou use uma categoria que já existe": as categorias do app que ainda não aparecem
 * neste módulo (1.7.0, categorias compartilhadas). Fica no diálogo de nova categoria
 * de cada módulo; o nome digitado filtra a lista.
 */
import { computed } from 'vue'
import type { CategoryModuleId } from '~/lib/categories/model'
import { useCategoriesStore } from '~/stores/categories'

const props = defineProps<{ module: CategoryModuleId; query?: string }>()
const emit = defineEmits<{ pick: [id: string] }>()
const shared = useCategoriesStore()

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()

const available = computed(() => shared.availableFor(props.module))
const shown = computed(() => {
  const query = fold(props.query ?? '')
  const list = query ? available.value.filter((category) => fold(category.name).includes(query)) : available.value
  return list.slice(0, 18)
})

/** Onde a categoria já aparece (para diferenciar e lembrar de onde ela é). */
function where(id: string): string {
  const places = shared.usage(id).filter((item) => item.member || item.records.length)
  return places.length ? `Em ${places.map((item) => item.label).join(', ')}` : 'Ainda sem uso'
}
</script>

<template>
  <div v-if="available.length" class="existing" data-existing-categories>
    <span class="field-label">Ou use uma categoria que já existe no app</span>
    <div class="chips" role="list">
      <button
        v-for="category in shown"
        :key="category.id"
        type="button"
        class="chip"
        role="listitem"
        :data-category-id="category.id"
        :data-tip="where(category.id)"
        @click="emit('pick', category.id)"
      >
        <CategoryAvatar :name="category.name" :color="category.color" :icon="category.icon" :image="category.image" :size="18" />
        <span class="chip-name">{{ category.name }}</span>
      </button>
      <span v-if="!shown.length" class="none">Nenhuma outra com “{{ query?.trim() }}”.</span>
    </div>
  </div>
</template>

<style scoped>
.existing {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--border-strong);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 112px;
  overflow-y: auto;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  height: 30px;
  padding: 0 11px 0 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition:
    background var(--t-fast),
    border-color var(--t-fast);
}
html[data-touch] .chip {
  height: 38px;
  font-size: 14px;
}
.chip:hover,
.chip:focus-visible {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.none {
  font-size: 12.5px;
  color: var(--text-3);
}
</style>
