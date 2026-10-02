/** Relógio reativo (atualiza a cada 30 s) para textos como "há 5 min". */
import { readonly, ref } from 'vue'

const now = ref(Date.now())
if (typeof window !== 'undefined') setInterval(() => (now.value = Date.now()), 30_000)

export function useNow() {
  return readonly(now)
}
