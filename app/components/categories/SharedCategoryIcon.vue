<script setup lang="ts">
/**
 * O ícone de uma categoria (1.7.1): a foto, o ícone ou a inicial, como estão no registro
 * central (stores/categories.ts). Trocar o ícone de uma categoria (em qualquer módulo ou
 * em Configurações › Categorias) aparece aqui na hora. Sem categoria: o círculo vazio.
 * Usado nas Tarefas (lista, painel, chips e menu lateral).
 */
import { computed } from 'vue'
import type { PaletteColor } from '~/lib/colors'
import { useCategoriesStore } from '~/stores/categories'

const props = withDefaults(defineProps<{ id: string | null; color?: PaletteColor | null; name?: string; size?: number }>(), { color: null, name: '', size: 16 })

const shared = useCategoriesStore()
const category = computed(() => (props.id ? (shared.findCategory(props.id) ?? null) : null))
</script>

<template>
  <CategoryAvatar
    v-if="id && (category || color)"
    class="shared-category-icon"
    :name="category?.name ?? name"
    :color="category?.color ?? color!"
    :icon="category?.icon ?? null"
    :image="category?.image ?? null"
    :size="size"
    :data-category-icon="category?.icon ?? (category?.image ? 'image' : 'initial')"
  />
  <CategoryDot v-else :color="null" :size="Math.max(7, Math.round(size * 0.55))" />
</template>
