/**
 * Diálogos modais baseados em Promise:
 *   if (await confirmDialog({ title: 'Excluir?' })) …
 *   const nome = await promptDialog({ title: 'Nova nota' })
 */
import { reactive } from 'vue'

export interface DialogButton {
  id: string
  label: string
  variant?: 'primary' | 'danger' | 'ghost' | 'default'
}

export interface DialogInput {
  value?: string
  placeholder?: string
  label?: string
  /** Devolve uma mensagem de erro ou null se estiver válido. */
  validate?: (value: string) => string | null
}

export interface DialogRequest {
  id: number
  title: string
  message?: string
  icon?: string
  input?: DialogInput
  buttons: DialogButton[]
  /** Botão acionado pelo Enter. */
  defaultButton?: string
  resolve: (result: { button: string | null; value: string }) => void
}

const dialogs = reactive<DialogRequest[]>([])
let nextId = 1

export function openDialog(options: Omit<DialogRequest, 'id' | 'resolve'>): Promise<{ button: string | null; value: string }> {
  return new Promise((resolve) => {
    const id = nextId++
    dialogs.push({
      ...options,
      id,
      resolve: (result) => {
        const index = dialogs.findIndex((d) => d.id === id)
        if (index >= 0) dialogs.splice(index, 1)
        resolve(result)
      },
    })
  })
}

export async function confirmDialog(options: {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  icon?: string
}): Promise<boolean> {
  const { button } = await openDialog({
    title: options.title,
    message: options.message,
    icon: options.icon ?? (options.danger ? 'trash' : undefined),
    buttons: [
      { id: 'cancel', label: options.cancelLabel ?? 'Cancelar', variant: 'ghost' },
      { id: 'confirm', label: options.confirmLabel ?? 'Confirmar', variant: options.danger ? 'danger' : 'primary' },
    ],
    defaultButton: 'confirm',
  })
  return button === 'confirm'
}

export async function promptDialog(options: {
  title: string
  message?: string
  label?: string
  value?: string
  placeholder?: string
  confirmLabel?: string
  icon?: string
  validate?: (value: string) => string | null
}): Promise<string | null> {
  const { button, value } = await openDialog({
    title: options.title,
    message: options.message,
    icon: options.icon,
    input: { value: options.value, placeholder: options.placeholder, label: options.label, validate: options.validate },
    buttons: [
      { id: 'cancel', label: 'Cancelar', variant: 'ghost' },
      { id: 'confirm', label: options.confirmLabel ?? 'Confirmar', variant: 'primary' },
    ],
    defaultButton: 'confirm',
  })
  return button === 'confirm' ? value.trim() : null
}

export async function choiceDialog(options: {
  title: string
  message?: string
  icon?: string
  buttons: DialogButton[]
  defaultButton?: string
}): Promise<string | null> {
  const { button } = await openDialog(options)
  return button
}

export function useDialogs() {
  return { dialogs }
}
