<script setup lang="ts">
/** Marca do 4notes: um "4" amarelo sobre roxo cuja ponta é o canto dobrado de uma folha. */
import { useId } from 'vue'

withDefaults(defineProps<{ size?: number }>(), { size: 28 })
const id = useId()
const bg = `logo-bg-${id}`
const shine = `logo-shine-${id}`
const flap = `logo-flap-${id}`
</script>

<template>
  <svg class="app-logo" :width="size" :height="size" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient :id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8f72ff" />
        <stop offset="1" stop-color="#5a35e6" />
      </linearGradient>
      <linearGradient :id="shine" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".18" />
        <stop offset=".55" stop-color="#fff" stop-opacity="0" />
      </linearGradient>
      <linearGradient :id="flap" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#ffe9a0" />
        <stop offset="1" stop-color="#f5b700" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="16" :fill="`url(#${bg})`" />
    <rect width="64" height="64" rx="16" :fill="`url(#${shine})`" />
    <path
      d="M31 10h1.5L43 20.5v13h9v9h-9V53H31V42.5H11v-9zM31 21v12.5H20.5z"
      fill="#ffd03d"
      fill-rule="evenodd"
      stroke="#ffd03d"
      stroke-width="2"
      stroke-linejoin="round"
    />
    <path d="M32.5 20.5H43v2.8z" fill="#5c3500" opacity=".22" />
    <path d="M32.5 10 43 20.5H32.5z" :fill="`url(#${flap})`" :stroke="`url(#${flap})`" stroke-width="1.6" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.app-logo {
  flex: none;
  display: block;
}
</style>
