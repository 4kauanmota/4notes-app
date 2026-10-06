/**
 * Biblioteca de imagens: todas as imagens enviadas ao 4notes, para escolher de
 * novo sem enviar outra vez (ImageLibraryDialog.vue, aberto pelo app.vue).
 *
 *   const path = await pickLibraryImage({ title: 'Foto da categoria' })
 *   // "attachments/foto.png" (caminho no workspace) ou null se cancelado
 */
import { reactive } from 'vue'

export type LibraryMode = 'pick' | 'manage'

const state = reactive({
  open: false,
  /** pick = escolher uma imagem para usar; manage = só ver, enviar e excluir. */
  mode: 'pick' as LibraryMode,
  title: '',
  confirmLabel: '',
})

let resolver: ((path: string | null) => void) | null = null

function settle(path: string | null): void {
  const resolve = resolver
  resolver = null
  resolve?.(path)
}

/** Abre a biblioteca para escolher uma imagem. Devolve o caminho dela no workspace (null = cancelado). */
export function pickLibraryImage(options: { title?: string; confirmLabel?: string } = {}): Promise<string | null> {
  settle(null)
  Object.assign(state, { open: true, mode: 'pick', title: options.title ?? 'Escolher imagem', confirmLabel: options.confirmLabel ?? 'Usar imagem' })
  return new Promise((resolve) => (resolver = resolve))
}

/** Abre a biblioteca só para ver, enviar e excluir imagens (Configurações). */
export function openImageLibrary(): void {
  settle(null)
  Object.assign(state, { open: true, mode: 'manage', title: 'Biblioteca de imagens', confirmLabel: '' })
}

/** Fecha a biblioteca; no modo de escolher, `path` é a imagem escolhida. */
export function closeImageLibrary(path: string | null = null): void {
  state.open = false
  settle(state.mode === 'pick' ? path : null)
}

export function useImageLibrary() {
  return { state, pickLibraryImage, openImageLibrary, closeImageLibrary }
}
