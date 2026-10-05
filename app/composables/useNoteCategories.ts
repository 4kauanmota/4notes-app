/**
 * Categorias das Notas na interface: o diálogo de criar/editar (um só, mostrado
 * pela página das Notas) e o submenu "Categoria" usado na aba e na lista lateral.
 */
import { reactive } from 'vue'
import { separator, type MenuItemSpec } from '~/composables/useContextMenu'
import { confirmDialog } from '~/composables/useDialog'
import { paletteVar } from '~/lib/colors'
import { useNotesStore, type QuickNote } from '~/stores/notes'

/** Arrastar uma nota (aba ou item da lista) leva o id dela neste tipo. */
export const NOTE_DRAG_TYPE = 'application/x-4notes-note'

const dialog = reactive({
  open: false,
  /** Categoria sendo editada (null = criar uma nova). */
  category: null as string | null,
  /** Nota que vai para a categoria criada (quando o diálogo veio do submenu "Categoria"). */
  assignNote: null as string | null,
})

export function useCategoryDialog() {
  return {
    dialog,
    openCreate: (assignNote: string | null = null) => Object.assign(dialog, { open: true, category: null, assignNote }),
    openEdit: (category: string) => Object.assign(dialog, { open: true, category, assignNote: null }),
    close: () => (dialog.open = false),
  }
}

/** Submenu "Categoria" de uma nota: escolher, tirar ou criar uma categoria nova. */
export function categorySubmenu(note: QuickNote): MenuItemSpec {
  const notes = useNotesStore()
  const current = notes.categoryOf(note)
  return {
    label: 'Categoria',
    submenu: [
      { id: 'category:', label: 'Sem categoria', type: 'radio', checked: !current },
      ...notes.state.categories.map((category) => ({
        id: `category:${category.name}`,
        label: category.name,
        type: 'radio' as const,
        checked: current === category,
        swatch: paletteVar(category.color),
      })),
      separator,
      { id: 'category-new', label: 'Nova categoria…' },
    ],
  }
}

/** Trata a escolha feita no submenu "Categoria" (true = era uma escolha dele). */
export function handleCategoryChoice(choice: string | null, note: QuickNote): boolean {
  if (choice === 'category-new') {
    useCategoryDialog().openCreate(note.id)
    return true
  }
  if (!choice?.startsWith('category:')) return false
  const name = choice.slice('category:'.length)
  void useNotesStore().moveToCategory(note.id, name || null)
  return true
}

/** Pede confirmação e exclui a categoria (as notas dela ficam sem categoria). */
export async function requestDeleteCategory(name: string): Promise<boolean> {
  const notes = useNotesStore()
  const category = notes.findCategory(name)
  if (!category) return false
  const count = notes.state.notes.filter((note) => notes.categoryOf(note) === category && !notes.isBlank(note)).length
  const ok = await confirmDialog({
    title: `Excluir a categoria “${category.name}”?`,
    message: count
      ? `${count} ${count === 1 ? 'nota volta' : 'notas voltam'} para Notas, sem categoria. Nenhuma nota é apagada; a pasta da categoria vai para a Lixeira.`
      : 'A pasta da categoria vai para a Lixeira.',
    confirmLabel: 'Excluir categoria',
    danger: true,
  })
  return ok ? notes.deleteCategory(category.name) : false
}

/** Começa a arrastar uma nota (para soltar numa categoria da lista lateral). */
export function startNoteDrag(event: DragEvent, noteId: string): void {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(NOTE_DRAG_TYPE, noteId)
  event.dataTransfer.effectAllowed = 'move'
}

/** O que está sendo arrastado é uma nota? */
export const isNoteDrag = (event: DragEvent) => !!event.dataTransfer?.types.includes(NOTE_DRAG_TYPE)
