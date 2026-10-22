<script setup lang="ts">
/**
 * No diálogo de editar categoria de um módulo (1.7.0): onde mais a categoria é usada
 * (o que você muda aqui vale em todos) e os atalhos para juntar com outra categoria e
 * para o "Ver categorias". `leave` avisa o diálogo para fechar antes de abrir outra janela.
 */
import { computed } from 'vue'
import { openCategoriesPanel, requestCategoryMerge } from '~/composables/useCategoryActions'
import type { CategoryModuleId } from '~/lib/categories/model'
import { useCategoriesStore } from '~/stores/categories'

const props = defineProps<{ id: string; module: CategoryModuleId }>()
const emit = defineEmits<{ leave: [] }>()
const shared = useCategoriesStore()

const elsewhere = computed(() =>
  shared
    .usage(props.id)
    .filter((item) => item.module !== props.module && (item.member || item.records.length))
    .map((item) => (item.records.length ? `${item.label} (${item.records.length})` : item.label)),
)
const canMerge = computed(() => shared.state.categories.length > 1)

function merge() {
  emit('leave')
  void requestCategoryMerge(props.id)
}

function viewAll() {
  emit('leave')
  openCategoriesPanel(props.id)
}
</script>

<template>
  <div class="share-info">
    <p class="where">
      <AppIcon name="tag" :size="13" />
      <span v-if="elsewhere.length">Também em {{ elsewhere.join(', ') }}: as mudanças valem em todos.</span>
      <span v-else>Categoria do app: dá para usar nos outros módulos também.</span>
    </p>
    <div class="links">
      <button v-if="canMerge" type="button" class="link-btn" data-action="merge-category" @click="merge">Juntar com outra categoria…</button>
      <button type="button" class="link-btn" data-action="view-categories" @click="viewAll">Ver em Categorias</button>
    </div>
  </div>
</template>

<style scoped>
.share-info {
  margin-top: 16px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-3);
}
.where {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.where :deep(.app-icon) {
  flex: none;
  margin-top: 2px;
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 4px 0 0 19px;
}
.link-btn {
  padding: 0;
  border: none;
  background: none;
  color: var(--primary-text);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}
</style>
