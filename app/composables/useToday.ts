/**
 * "Hoje" reativo. Se o app ficar aberto durante a virada do dia, as tarefas
 * recorrentes que vencem no novo dia aparecem sozinhas.
 */
import { computed, readonly, ref } from 'vue'
import { addDays, todayISO } from '~/lib/dates'
import { desktop, hasDesktopApi } from '~/lib/platform'

const fake = hasDesktopApi() ? desktop().bootstrap.fakeToday : null
const today = ref(fake ?? todayISO())
const tomorrow = computed(() => addDays(today.value, 1))

function check() {
  if (fake) return
  const now = todayISO()
  if (now !== today.value) today.value = now
}

if (typeof window !== 'undefined') {
  setInterval(check, 30_000)
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', check)
}

export function useToday() {
  return { today: readonly(today), tomorrow }
}
