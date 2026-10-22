<script setup lang="ts">
/**
 * Nas escolhas de categoria de um registro (tarefa, sessão do Timer, gasto): as
 * categorias do app que ainda não aparecem neste módulo, em chips tracejados (1.7.0).
 * Escolher uma a coloca no módulo e no registro. Com muitas, mostra as primeiras e
 * "+N" abre a lista completa.
 */
import { computed, ref } from 'vue'
import type { CategoryModuleId } from '~/lib/categories/model'
import { useCategoriesStore } from '~/stores/categories'

const props = withDefaults(defineProps<{ module: CategoryModuleId; limit?: number }>(), { limit: 4 })
const emit = defineEmits<{ pick: [id: string] }>()
const shared = useCategoriesStore()

const expanded = ref(false)
const available = computed(() => shared.availableFor(props.module))
// Esconder uma só não economiza nada: "+1" ocuparia o lugar dela
const collapsed = computed(() => !expanded.value && available.value.length > props.limit + 1)
const shown = computed(() => (collapsed.value ? available.value.slice(0, props.limit) : available.value))

function where(id: string): string {
  const places = shared.usage(id).filter((item) => item.member || item.records.length)
  return places.length ? `Categoria do app (em ${places.map((item) => item.label).join(', ')}): usar aqui` : 'Categoria do app: usar aqui'
}
</script>

<template>
  <template v-if="available.length">
    <button
      v-for="category in shown"
      :key="category.id"
      type="button"
      class="cat-chip other"
      :style="{ '--c': `var(--cat-${category.color})` }"
      :data-other-category="category.id"
      :data-tip="where(category.id)"
      @click="emit('pick', category.id)"
    >
      <CategoryDot :color="category.color" :size="8" /> {{ category.name }}
    </button>
    <button v-if="collapsed" type="button" class="cat-chip other more" :data-tip="`Mais ${available.length - limit} categorias do app`" @click="expanded = true">
      +{{ available.length - limit }}
    </button>
  </template>
</template>

<style scoped>
.cat-chip.other {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px dashed var(--border-strong);
  background: transparent;
  color: var(--text-3);
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition: all var(--t-fast);
}
html[data-touch] .cat-chip.other {
  height: 36px;
}
.cat-chip.other:hover {
  border-color: var(--c, var(--primary));
  color: var(--text);
}
.cat-chip.other.more {
  padding: 0 10px;
}
</style>
