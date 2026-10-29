<script setup lang="ts">
/**
 * Categoria de um lançamento: o seletor de categorias do app (1.7.2), com busca, criar
 * pelo nome e, no botão direito de uma categoria, editar, mudar de lugar ou excluir.
 * `tag` marca uma categoria escolhida pelo app ("automática", "padrão"); `picked` avisa
 * quando você escolhe à mão. Excluir uma categoria não apaga lançamentos.
 */
const model = defineModel<string | null>({ required: true })
withDefaults(defineProps<{ compact?: boolean; tag?: string | null; label?: string }>(), { compact: false, tag: null, label: 'Categoria do lançamento' })
const emit = defineEmits<{ picked: [id: string | null] }>()
</script>

<template>
  <CategorySelect
    v-model="model"
    module="finance"
    class="finance-category"
    :size="compact ? 'sm' : 'md'"
    :tag="tag"
    :label="label"
    @picked="(id) => emit('picked', id)"
  />
</template>

<style scoped>
.finance-category {
  min-width: 190px;
}
</style>
