<script setup lang="ts">
/** Mensagem da lista de links vazia (sem links, categoria vazia, busca sem resultado). */
defineProps<{ icon: string; title: string; text?: string }>()
</script>

<template>
  <div class="links-empty">
    <span class="art" aria-hidden="true"><AppIcon :name="icon" :size="24" /></span>
    <h3>{{ title }}</h3>
    <p v-if="text">{{ text }}</p>
    <div v-if="$slots.default" class="extra"><slot /></div>
  </div>
</template>

<style scoped>
.links-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 52px 24px 40px;
  text-align: center;
  animation: rise 380ms var(--ease-out) both;
}
.art {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: 14px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, var(--primary-soft-2), var(--primary-soft));
  color: var(--primary-text);
}
h3 {
  max-width: 520px;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: 16.5px;
  font-weight: 650;
}
p {
  max-width: 420px;
  margin-top: 6px;
  color: var(--text-3);
  font-size: 13.5px;
  line-height: 1.55;
}
.extra {
  margin-top: 16px;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
</style>
