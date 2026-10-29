/**
 * "Hoje" reativo. Se o app ficar aberto durante a virada do dia, as tarefas
 * recorrentes que vencem no novo dia aparecem sozinhas.
 */
import { computed, readonly, ref } from 'vue'
import { addDays, todayISO } from '~/lib/dates'
import { desktop, hasDesktopApi } from '~/lib/platform'

/**
 * Data simulada dos testes automatizados. Lida a cada vez: no celular, a plataforma é
 * instalada depois que este arquivo já foi carregado (1.7.2: antes, a data simulada
 * só valia no computador).
 */
const fakeToday = () => (hasDesktopApi() ? desktop().bootstrap.fakeToday : null)
const today = ref(fakeToday() ?? todayISO())
const tomorrow = computed(() => addDays(today.value, 1))

function check() {
  const now = fakeToday() ?? todayISO()
  if (now !== today.value) today.value = now
}

/** Confere o dia agora (ao abrir o workspace). */
export const syncToday = check

if (typeof window !== 'undefined') {
  setInterval(check, 30_000)
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', check)
}

export function useToday() {
  return { today: readonly(today), tomorrow }
}
