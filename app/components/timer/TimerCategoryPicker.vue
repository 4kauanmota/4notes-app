<script setup lang="ts">
/**
 * Categorias do Timer em "chips": escolher (ou nenhuma), criar uma nova e, no botão
 * direito (toque prolongado no celular), editar, mudar de lugar ou excluir.
 * Excluir uma categoria não apaga o histórico (as sessões ficam sem categoria).
 */
import { ref } from 'vue'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import type { ColorCategory } from '~/lib/category-source'
import { useTimerStore } from '~/stores/timer'

const model = defineModel<string | null>({ required: true })
const timer = useTimerStore()

const dialogOpen = ref(false)
const editing = ref<ColorCategory | null>(null)

function create() {
  editing.value = null
  dialogOpen.value = true
}

async function categoryMenu(category: ColorCategory) {
  const index = timer.state.categories.findIndex((item) => item.id === category.id)
  const choice = await showContextMenu([
    { id: 'edit', label: 'Editar…' },
    { id: 'left', label: 'Mover para a esquerda', enabled: index > 0 },
    { id: 'right', label: 'Mover para a direita', enabled: index < timer.state.categories.length - 1 },
    separator,
    { id: 'delete', label: 'Excluir…', danger: true },
  ])
  if (choice === 'edit') {
    editing.value = category
    dialogOpen.value = true
  } else if (choice === 'left' || choice === 'right') {
    timer.moveCategory(category.id, choice === 'left' ? -1 : 1)
  } else if (choice === 'delete') {
    if ((await timer.requestDeleteCategory(category.id)) && model.value === category.id) model.value = null
  }
}
</script>

<template>
  <div class="timer-cats" role="radiogroup" aria-label="Categoria">
    <button type="button" class="cat-chip" role="radio" :aria-checked="!model" :class="{ active: !model }" @click="model = null">
      <CategoryDot :color="null" :size="8" /> Sem categoria
    </button>
    <button
      v-for="category in timer.state.categories"
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
    <button type="button" class="cat-chip add" data-action="new-timer-category" @click="create">
      <AppIcon name="plus" :size="12" /> Nova
    </button>
  </div>
  <CategoryDialog
    :open="dialogOpen"
    :category="editing"
    :source="timer.categorySource"
    placeholder="Ex.: Estudo, Trabalho, Desenvolvimento de jogos"
    @close="dialogOpen = false"
    @saved="(category) => editing === null && (model = category.id)"
  />
</template>

<style scoped>
.timer-cats {
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
