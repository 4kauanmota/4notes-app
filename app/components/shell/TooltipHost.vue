<script setup lang="ts">
/**
 * Dicas (tooltips) para qualquer elemento com o atributo data-tip="texto".
 * Usa um único elemento com position: fixed, então nunca afeta o layout nem
 * cria barras de rolagem. Posição opcional: data-tip-pos="top|right|left|bottom".
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const text = ref('')
const visible = ref(false)
const style = ref<Record<string, string>>({})
let timer: ReturnType<typeof setTimeout> | null = null
let current: HTMLElement | null = null

function place(el: HTMLElement, tip: HTMLElement) {
  const rect = el.getBoundingClientRect()
  const pos = el.dataset.tipPos ?? 'bottom'
  const { width, height } = tip.getBoundingClientRect()
  const gap = 8
  let x = rect.left + rect.width / 2 - width / 2
  let y = rect.bottom + gap
  if (pos === 'top') y = rect.top - height - gap
  if (pos === 'right') {
    x = rect.right + gap + 2
    y = rect.top + rect.height / 2 - height / 2
  }
  if (pos === 'left') {
    x = rect.left - width - gap - 2
    y = rect.top + rect.height / 2 - height / 2
  }
  x = Math.max(6, Math.min(window.innerWidth - width - 6, x))
  y = Math.max(6, Math.min(window.innerHeight - height - 6, y))
  style.value = { left: `${Math.round(x)}px`, top: `${Math.round(y)}px` }
}

const tipEl = ref<HTMLElement>()

function hide() {
  if (timer) clearTimeout(timer)
  timer = null
  current = null
  visible.value = false
}

function onOver(event: PointerEvent) {
  const el = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]')
  if (el === current) return
  hide()
  if (!el || !el.dataset.tip) return
  current = el
  timer = setTimeout(async () => {
    if (current !== el || !el.isConnected) return
    text.value = el.dataset.tip ?? ''
    style.value = { left: '-9999px', top: '-9999px' }
    visible.value = true
    await new Promise(requestAnimationFrame)
    if (tipEl.value && current === el) place(el, tipEl.value)
  }, 450)
}

onMounted(() => {
  document.addEventListener('pointerover', onOver)
  document.addEventListener('pointerdown', hide, true)
  window.addEventListener('blur', hide)
  window.addEventListener('wheel', hide, { passive: true })
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerover', onOver)
  document.removeEventListener('pointerdown', hide, true)
  window.removeEventListener('blur', hide)
  window.removeEventListener('wheel', hide)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" ref="tipEl" class="tooltip" role="tooltip" :style="style">{{ text }}</div>
  </Teleport>
</template>

<style scoped>
.tooltip {
  position: fixed;
  z-index: 2000;
  max-width: 280px;
  padding: 5px 9px;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--text) 92%, var(--purple-500));
  color: var(--surface);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  white-space: pre-line;
  pointer-events: none;
  box-shadow: var(--shadow-md);
  animation: tip-in 140ms var(--ease-out);
}
[data-theme='dark'] .tooltip {
  background: #3a3546;
  color: var(--text);
}
@keyframes tip-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
}
</style>
