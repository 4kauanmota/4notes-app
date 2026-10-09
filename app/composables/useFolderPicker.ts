/**
 * Escolher uma pasta no celular (o Android não tem um seletor de pastas que devolva
 * um caminho de verdade): a lista de pastas é do próprio 4notes
 * (components/shell/FolderPickerDialog.vue), a partir do armazenamento interno.
 *
 *   const pasta = await pickFolder({ title: 'Abrir workspace', … })
 */
import { reactive } from 'vue'

export interface FolderPickerOptions {
  title: string
  /** Texto do botão de confirmar ("Abrir workspace", "Criar aqui"…). */
  buttonLabel: string
  /** De onde não dá para subir (o armazenamento interno). */
  root: string
  rootLabel: string
  /** Onde começa (dentro de `root`). */
  start?: string | null
  /** Nomes das pastas dentro de `path`. */
  list(path: string): Promise<string[]>
  /** Cria a pasta `name` dentro de `path` e devolve o caminho dela. */
  create(path: string, name: string): Promise<string>
}

export interface FolderPickerRequest extends FolderPickerOptions {
  id: number
  resolve(path: string | null): void
}

const state = reactive({ request: null as FolderPickerRequest | null })
let nextId = 1

export function pickFolder(options: FolderPickerOptions): Promise<string | null> {
  // Um seletor de cada vez
  state.request?.resolve(null)
  return new Promise((resolve) => {
    const id = nextId++
    state.request = {
      ...options,
      id,
      resolve: (path) => {
        if (state.request?.id === id) state.request = null
        resolve(path)
      },
    }
  })
}

export function useFolderPicker() {
  return { state }
}
