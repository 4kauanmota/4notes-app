<script setup lang="ts">
/**
 * Categorias das Finanças em "chips" (1.7.0): escolher (ou nenhuma), criar uma nova ou
 * usar uma que já existe no app (o mesmo diálogo dos outros módulos) sem sair do
 * formulário e, no botão direito (toque prolongado no celular), editar, mudar de lugar
 * ou excluir. Excluir uma categoria não apaga gastos.
 */
import { ref } from 'vue'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import type { ColorCategory } from '~/lib/category-source'
import { useFinanceStore } from '~/stores/finance'

const model = defineModel<string | null>({ required: true })
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const finance = useFinanceStore()

const dialogOpen = ref(false)
const editing = ref<ColorCategory | null>(null)

function create() {
  editing.value = null
  dialogOpen.value = true
}

async function categoryMenu(category: ColorCategory) {
  const index = finance.state.categories.findIndex((item) => item.id === category.id)
  const choice = await showContextMenu([
    { id: 'edit', label: 'Editar…' },
    { id: 'left', label: 'Mover para a esquerda', enabled: index > 0 },
    { id: 'right', label: 'Mover para a direita', enabled: index < finance.state.categories.length - 1 },
    separator,
    { id: 'delete', label: 'Excluir…', danger: true },
  ])
  if (choice === 'edit') {
    editing.value = category
    dialogOpen.value = true
  } else if (choice === 'left' || choice === 'right') {
    finance.moveCategory(category.id, choice === 'left' ? -1 : 1)
  } else if (choice === 'delete') {
    if ((await finance.requestDeleteCategory(category.id)) && model.value === category.id) model.value = null
  }
}
</script>

<template>
  <div class="finance-cats" :class="{ compact: props.compact }" role="radiogroup" aria-label="Categoria do gasto">
    <button type="button" class="cat-chip" role="radio" :aria-checked="!model" :class="{ active: !model }" @click="model = null">
      <CategoryDot :color="null" :size="8" /> Sem categoria
    </button>
    <button
      v-for="category in finance.state.categories"
      :key="category.id"
      type="button"
      class="cat-chip"
      role="radio"
      :aria-checked="model === category.id"
      :class="{ active: model === category.id }"
      :style="{ '--c': `var(--cat-${category.color})` }"
      :data-category="category.id"
      @click="model = category.id"
      @contextmenu.prevent.stop="categoryMenu(category)"
    >
      <CategoryDot :color="category.color" :size="8" /> {{ category.name }}
    </button>
    <OtherCategoryChips module="finance" :limit="props.compact ? 3 : 4" @pick="(id) => (model = finance.attachCategory(id)?.id ?? model)" />
    <button type="button" class="cat-chip add" data-action="new-finance-category" @click="create">
      <AppIcon name="plus" :size="12" /> Nova
    </button>
  </div>
  <CategoryDialog
    :open="dialogOpen"
    :category="editing"
    :source="finance.categorySource"
    placeholder="Ex.: Mercado, Transporte, Lazer"
    @close="dialogOpen = false"
    @saved="(category) => editing === null && (model = category.id)"
  />
</template>

<style scoped>
.finance-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition: all var(--t-fast);
}
.compact .cat-chip {
  height: 28px;
  padding: 0 10px;
}
html[data-touch] .cat-chip {
  height: 36px;
}
.cat-chip:hover {
  border-color: var(--border-strong);
  color: var(--text);
}
.cat-chip.active {
  border-color: var(--c, var(--primary));
  background: color-mix(in srgb, var(--c, var(--primary)) 14%, var(--surface));
  color: var(--text);
}
.cat-chip.add {
  border-style: dashed;
  color: var(--text-3);
}
</style>
