<script setup lang="ts">
/**
 * Ícone de um link: o ícone do site (guardado em links/icons/) ou, enquanto não
 * houver, a inicial do domínio numa cor fixa para cada site.
 */
import { computed, ref, watch } from 'vue'
import { workspaceFileUrl } from '#shared/ipc'
import { PALETTE, paletteVar } from '~/lib/colors'
import { displayHost } from '~/lib/links/model'

const props = withDefaults(
  defineProps<{
    url: string
    /** Caminho do ícone no workspace (links/icons/…), ou null. */
    icon: string | null
    /** Muda quando um ícone é regravado (a imagem recarrega). */
    version?: number
    loading?: boolean
    size?: number
  }>(),
  { version: 0, loading: false, size: 20 },
)

const failed = ref(false)
watch(
  () => [props.icon, props.version],
  () => (failed.value = false),
)

const src = computed(() => (props.icon && !failed.value ? `${workspaceFileUrl(props.icon)}?v=${props.version}` : null))
/** Arquivo que carrega mas não é desenhado (ícone corrompido): mostra a inicial. */
const onLoad = (event: Event) => {
  if (!(event.target as HTMLImageElement).naturalWidth) failed.value = true
}
const host = computed(() => displayHost(props.url))
const initial = computed(() => Array.from(host.value)[0]?.toLocaleUpperCase('pt-BR') ?? '?')
/** Cor estável por site (a mesma sempre). */
const color = computed(() => {
  let hash = 0
  for (const char of host.value) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return paletteVar(PALETTE[hash % PALETTE.length]!)
})
</script>

<template>
  <span class="link-icon" :class="{ loading }" :style="{ '--size': `${size}px`, '--c': color }" aria-hidden="true">
    <img v-if="src" :src="src" alt="" draggable="false" @error="failed = true" @load="onLoad" />
    <span v-else class="initial">{{ initial }}</span>
  </span>
</template>

<style scoped>
.link-icon {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: var(--size);
  height: var(--size);
  border-radius: calc(var(--size) * 0.28);
}
.link-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: inherit;
}
.initial {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: color-mix(in srgb, var(--c) 18%, var(--surface));
  color: var(--c);
  font-size: calc(var(--size) * 0.55);
  font-weight: 700;
  line-height: 1;
}
/* Buscando o ícone/título: anel girando em volta */
.link-icon.loading::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: var(--primary);
  animation: spin 800ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
