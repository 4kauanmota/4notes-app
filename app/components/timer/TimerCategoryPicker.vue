<script setup lang="ts">
/**
 * Categoria de uma sessão do Timer: o seletor de categorias do app (1.7.2), com busca,
 * criar pelo nome e, no botão direito de uma categoria, editar, mudar de lugar ou excluir.
 * Excluir uma categoria não apaga o histórico (as sessões ficam sem categoria).
 */
const model = defineModel<string | null>({ required: true })
</script>

<template>
  <CategorySelect v-model="model" module="timer" class="timer-category" label="Categoria da sessão" />
</template>

<style scoped>
.timer-category {
  min-width: 200px;
}
</style>
