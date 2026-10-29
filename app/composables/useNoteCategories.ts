/**
 * Categorias das Notas na interface: o diálogo de criar/editar (um só, mostrado
 * pela página das Notas) e o "Categoria…" do menu da aba e da lista lateral.
 */
import { reactive } from 'vue'
import { requestCategoryRemoval } from '~/composables/useCategoryActions'
import { NOTE_NAME_PREFIX, pickCategory } from '~/composables/useCategoryPicker'
import type { MenuItemSpec } from '~/composables/useContextMenu'
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

/**
 * "Categoria…" no menu de uma nota (aba e lista lateral): abre o seletor de categorias
 * (1.7.2: busca, criar pelo nome, as outras categorias do app) perto do menu.
 */
export function categorySubmenu(note: QuickNote): MenuItemSpec {
  const current = useNotesStore().categoryOf(note)
  return { id: 'category-pick', label: 'Categoria…', hint: current?.name }
}

/** Trata a escolha "Categoria…" do menu (true = era ela). */
export function handleCategoryChoice(choice: string | null, note: QuickNote): boolean {
  if (choice !== 'category-pick') return false
  void pickNoteCategory(note)
  return true
}

async function pickNoteCategory(note: QuickNote): Promise<void> {
  const notes = useNotesStore()
  const current = notes.categoryOf(note)
  const picked = await pickCategory({
    module: 'notes',
    selected: [current ? (current.id ?? `${NOTE_NAME_PREFIX}${current.name}`) : null],
    title: 'Categoria da nota',
  })
  if (!picked) return
  const id = picked[0] ?? null
  const name = id === null ? null : id.startsWith(NOTE_NAME_PREFIX) ? id.slice(NOTE_NAME_PREFIX.length) : (notes.state.categories.find((category) => category.id === id)?.name ?? null)
  if (id !== null && name === null) return
  if ((current?.name ?? null) !== name) await notes.moveToCategory(note.id, name)
}

/**
 * Excluir uma categoria das Notas: pergunta o que fazer com as notas (outra categoria
 * ou sem categoria) e se é só das Notas ou do app inteiro (components/categories/).
 */
export async function requestDeleteCategory(name: string): Promise<boolean> {
  const category = useNotesStore().findCategory(name)
  if (!category?.id) return false
  return requestCategoryRemoval(category.id, 'notes')
}

/** Começa a arrastar uma nota (para soltar numa categoria da lista lateral). */
export function startNoteDrag(event: DragEvent, noteId: string): void {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(NOTE_DRAG_TYPE, noteId)
  event.dataTransfer.effectAllowed = 'move'
}

/** O que está sendo arrastado é uma nota? */
export const isNoteDrag = (event: DragEvent) => !!event.dataTransfer?.types.includes(NOTE_DRAG_TYPE)
