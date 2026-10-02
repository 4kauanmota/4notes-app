<script setup lang="ts">
// Página de erro do Nuxt (rota inexistente ou erro inesperado na interface).
import type { NuxtError } from '#app'

defineProps<{ error: NuxtError }>()
const goHome = () => clearError({ redirect: '/' })
</script>

<template>
  <div class="error-page">
    <AppLogo :size="44" />
    <h1>Algo saiu do lugar</h1>
    <p class="selectable">{{ error.statusCode === 404 ? 'Esta tela não existe.' : error.message }}</p>
    <button class="btn btn-primary" @click="goHome">Voltar ao 4notes</button>
  </div>
</template>

<style scoped>
.error-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100vh;
  background: var(--surface);
  color: var(--text);
  text-align: center;
}
h1 {
  font-family: var(--font-display);
  font-size: 22px;
}
p {
  color: var(--text-2);
}
</style>
