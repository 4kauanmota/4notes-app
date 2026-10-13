/** Largura de um elemento, acompanhando mudanças de tamanho (gráficos que se ajustam à tela). */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useElementWidth(target: Ref<HTMLElement | undefined>, fallback = 600): Ref<number> {
  const width = ref(fallback)
  let observer: ResizeObserver | null = null
  onMounted(() => {
    const el = target.value
    if (!el) return
    width.value = el.clientWidth || fallback
    if (typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0)
      if (next > 0 && next !== width.value) width.value = next
    })
    observer.observe(el)
  })
  onBeforeUnmount(() => observer?.disconnect())
  return width
}
