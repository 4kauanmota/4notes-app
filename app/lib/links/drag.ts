/**
 * Arrastar links: dentro do 4notes (uma linha da lista até uma pasta, para mover) e
 * vindos de fora (um link arrastado do navegador, para salvar).
 */

/** Tipo em que uma linha da lista leva o id do link ao ser arrastada. */
export const LINK_DRAG_TYPE = 'application/x-4notes-link'

/** Arrastando uma linha da própria lista de links? */
export const isLinkDrag = (event: DragEvent) => !!event.dataTransfer?.types.includes(LINK_DRAG_TYPE)

/** Arrastando um link (ou texto) vindo de fora — do navegador, de outro programa. */
export function isExternalLinkDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types ?? []
  return !types.includes(LINK_DRAG_TYPE) && (types.includes('text/uri-list') || types.includes('text/plain'))
}

/** O endereço solto: a primeira linha do text/uri-list ou, sem ela, o texto. */
export function droppedText(data: DataTransfer | null): string {
  const fromList = (data?.getData('text/uri-list') ?? '').split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#'))
  return (fromList ?? data?.getData('text/plain') ?? '').trim()
}
