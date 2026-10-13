/**
 * Descrição das tarefas: Markdown, com a mesma formatação das notas (o editor é o
 * mesmo — components/editor/MarkdownEditor.vue). Fica no tasks.json ("notes").
 */
import { noteToPlainText } from '../notes/export'
import { DATA_PATHS } from '../storage/paths'

/** Pasta "da descrição" no workspace (base dos caminhos relativos: imagens, links). */
export const DESCRIPTION_DIR = DATA_PATHS.tasksFile.split('/')[0]!

/**
 * A primeira linha com texto da descrição, como aparece no editor: sem a marcação
 * (**, <u>, endereço dos links), itens de lista com • / 1. / ☐, imagens fora.
 */
export function descriptionPreview(markdown: string, maxLength = 160): string {
  const text = noteToPlainText(markdown, DESCRIPTION_DIR)
  const line =
    text
      .split(/\r?\n/)
      .find((item) => item.trim())
      ?.trim() ?? ''
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line
}
