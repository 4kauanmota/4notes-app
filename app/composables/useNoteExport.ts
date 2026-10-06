/**
 * "Exportar" no menu de uma nota (aba e lista lateral): TXT (só o texto) ou PDF
 * (com a formatação). O arquivo vai para onde você escolher; a nota não muda.
 */
import { errorMessage } from '#shared/ipc'
import type { MenuItemSpec } from '~/composables/useContextMenu'
import { notifyError, showToast } from '~/composables/useToasts'
import { noteToPdfHtml, noteToPlainText } from '~/lib/notes/export'
import { desktop } from '~/lib/platform'
import { noteTitle, useNotesStore, type QuickNote } from '~/stores/notes'

export type ExportFormat = 'txt' | 'pdf'

/** Submenu "Exportar" de uma nota. */
export function exportSubmenu(note: QuickNote): MenuItemSpec {
  return {
    label: 'Exportar',
    enabled: !useNotesStore().isBlank(note),
    submenu: [
      { id: 'export:txt', label: 'TXT', hint: 'só o texto' },
      { id: 'export:pdf', label: 'PDF', hint: 'com a formatação' },
    ],
  }
}

/** Trata a escolha feita no submenu "Exportar" (true = era uma escolha dele). */
export function handleExportChoice(choice: string | null, note: QuickNote): boolean {
  if (choice !== 'export:txt' && choice !== 'export:pdf') return false
  void exportNote(note, choice === 'export:txt' ? 'txt' : 'pdf')
  return true
}

export async function exportNote(note: QuickNote, format: ExportFormat): Promise<string | null> {
  const title = noteTitle(note)
  try {
    const api = desktop().exports
    const path =
      format === 'txt'
        ? await api.saveText(title, noteToPlainText(note.content, note.dir))
        : await api.savePdf(title, await noteToPdfHtml(note.content, note.dir, title))
    if (!path) return null
    const file = path.split(/[\\/]/).pop() ?? path
    showToast({
      message: `Nota exportada: “${file}”`,
      icon: 'export',
      tone: 'success',
      action: { label: 'Mostrar', run: () => void api.reveal(path) },
    })
    return path
  } catch (error) {
    notifyError(`Não foi possível exportar a nota: ${errorMessage(error)}`, error)
    return null
  }
}
