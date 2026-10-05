<script setup lang="ts">
/**
 * Aparência de uma categoria (Notas) ou pasta (Links): a imagem dela, o ícone
 * pronto ou a inicial do nome — os dois últimos na cor da categoria.
 */
import { computed, ref, watch } from 'vue'
import { workspaceFileUrl } from '#shared/ipc'
import { paletteVar, type PaletteColor } from '~/lib/colors'

const props = withDefaults(
  defineProps<{
    name: string
    color: PaletteColor
    /** Caminho da imagem no workspace, ou uma URL pronta (prévia no diálogo). */
    image?: string | null
    /** Ícone pronto (lib/category-icons.ts). A imagem, se houver, tem prioridade. */
    icon?: string | null
    /** Muda quando a imagem é trocada (o arquivo tem o mesmo nome). */
    version?: number
    size?: number
  }>(),
  { image: null, icon: null, version: 0, size: 22 },
)

const failed = ref(false)
watch(
  () => [props.image, props.version],
  () => (failed.value = false),
)

const src = computed(() => {
  if (!props.image || failed.value) return null
  return /^(blob|data|workspace):/.test(props.image) ? props.image : `${workspaceFileUrl(props.image)}?v=${props.version}`
})
const initial = computed(() => Array.from(props.name.trim())[0]?.toLocaleUpperCase('pt-BR') ?? '?')
/** Traço um pouco mais grosso nos tamanhos pequenos, para o ícone não sumir. */
const stroke = computed(() => (props.size <= 24 ? 2.1 : 1.9))
</script>

<template>
  <span class="category-avatar" :style="{ '--c': paletteVar(color), '--size': `${size}px` }" aria-hidden="true">
    <img v-if="src" :src="src" alt="" draggable="false" @error="failed = true" />
    <AppIcon v-else-if="icon" :name="icon" :size="Math.round(size * 0.64)" :stroke="stroke" class="icon" />
    <span v-else class="initial">{{ initial }}</span>
  </span>
</template>

<style scoped>
.category-avatar {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: var(--size);
  height: var(--size);
  border-radius: calc(var(--size) * 0.3);
  background: color-mix(in srgb, var(--c) 18%, var(--surface));
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c) 55%, transparent);
  overflow: hidden;
}
.category-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* Anel na cor da categoria por cima da imagem */
.category-avatar:has(img)::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1.5px var(--c);
}
.initial {
  color: var(--c);
  font-size: calc(var(--size) * 0.5);
  font-weight: 700;
  line-height: 1;
}
.icon {
  color: var(--c);
}
</style>
