<script setup lang="ts">
defineProps<{ icon: string; title: string; text?: string; celebrate?: boolean }>()
</script>

<template>
  <div class="tasks-empty" :class="{ celebrate }">
    <div class="art" aria-hidden="true">
      <span class="ring" />
      <span class="icon"><AppIcon :name="icon" :size="26" /></span>
      <template v-if="celebrate">
        <i v-for="n in 6" :key="n" class="spark" :style="{ '--a': `${n * 60}deg`, '--d': `${n * 0.2}s` }" />
      </template>
    </div>
    <h3>{{ title }}</h3>
    <p v-if="text">{{ text }}</p>
    <slot />
  </div>
</template>

<style scoped>
.tasks-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56px 24px 40px;
  text-align: center;
  animation: rise 420ms var(--ease-out) both;
}
.art {
  position: relative;
  display: grid;
  place-items: center;
  width: 76px;
  height: 76px;
  margin-bottom: 16px;
}
.ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, var(--primary-soft-2), var(--primary-soft));
}
.celebrate .ring {
  background: radial-gradient(circle at 30% 30%, var(--accent), var(--accent-soft));
}
.icon {
  position: relative;
  color: var(--primary-text);
}
.celebrate .icon {
  color: var(--on-accent);
}
.spark {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 6px;
  height: 6px;
  margin: -3px;
  border-radius: 50%;
  background: var(--primary);
  transform: rotate(var(--a)) translateY(-48px);
  animation: twinkle 2.4s ease-in-out infinite;
  animation-delay: var(--d);
}
h3 {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
p {
  max-width: 380px;
  margin-top: 6px;
  color: var(--text-3);
  font-size: 13.5px;
  line-height: 1.55;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@keyframes twinkle {
  50% {
    opacity: 0.25;
    transform: rotate(var(--a)) translateY(-42px) scale(0.6);
  }
}
</style>
