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
  while (toasts.length > 4) toasts.shift()
  return toast.id
}

export function dismissToast(id: number): void {
  const index = toasts.findIndex((t) => t.id === id)
  if (index >= 0) toasts.splice(index, 1)
}

export function notifyError(message: string, error?: unknown): void {
  if (error) console.error('[4notes]', message, error)
  showToast({ message, tone: 'error', icon: 'alert', duration: 6000 })
}

export function useToasts() {
  return { toasts, showToast, dismissToast, notifyError }
}
