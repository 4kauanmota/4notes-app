/** Avisos rápidos no rodapé ("Tarefa concluída · Desfazer"). */
import { reactive } from 'vue'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastAction {
  label: string
  run: () => void | Promise<void>
}

export interface Toast {
  id: number
  message: string
  tone: ToastTone
  icon?: string
  action?: ToastAction
  duration: number
  /** Quando o aviso sai da tela (o tempo acabou, o botão foi usado ou ele foi empurrado por outros). */
  onClose?: () => void
}

const toasts = reactive<Toast[]>([])
let nextId = 1

export function showToast(options: Omit<Partial<Toast>, 'id'> & { message: string }): number {
  const toast: Toast = {
    id: nextId++,
    tone: 'info',
    duration: options.action ? 6000 : 3500,
    ...options,
  }
  toasts.push(toast)
  // Evita uma pilha enorme de avisos
  while (toasts.length > 4) closed(toasts.shift())
  return toast.id
}

function closed(toast: Toast | undefined): void {
  try {
    toast?.onClose?.()
  } catch (error) {
    console.warn('[4notes] Falha ao fechar um aviso:', error)
  }
}

export function dismissToast(id: number): void {
  const index = toasts.findIndex((t) => t.id === id)
  if (index >= 0) closed(toasts.splice(index, 1)[0])
}

export function notifyError(message: string, error?: unknown): void {
  if (error) console.error('[4notes]', message, error)
  showToast({ message, tone: 'error', icon: 'alert', duration: 6000 })
}

export function useToasts() {
  return { toasts, showToast, dismissToast, notifyError }
}
