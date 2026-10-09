/**
 * O plugin nativo do 4notes no Android (android/app/src/main/java/…/FourNotesPlugin.java):
 * o que o Capacitor não traz pronto.
 *
 *  - storageInfo / requestStorageAccess: a permissão "Acesso a todos os arquivos"
 *    (MANAGE_EXTERNAL_STORAGE), necessária para o workspace ficar numa pasta escolhida
 *    por você (que o Google Drive / Autosync / FolderSync podem sincronizar);
 *  - printHtml: imprimir a nota pelo Android — a impressora "Salvar como PDF" gera o PDF;
 *  - openUrl: abrir um link no navegador.
 */
import { registerPlugin } from '@capacitor/core'

export interface StorageInfo {
  /** Raiz do armazenamento interno (ex.: "/storage/emulated/0"). */
  root: string
  /** O app pode ler e gravar em qualquer pasta do armazenamento interno. */
  granted: boolean
}

export interface FourNotesNative {
  storageInfo(): Promise<StorageInfo>
  /** Abre a tela do Android para permitir o acesso; devolve se ficou permitido. */
  requestStorageAccess(): Promise<{ granted: boolean }>
  /** Abre a impressão do Android com o HTML (as imagens já embutidas). */
  printHtml(options: { name: string; html: string }): Promise<void>
  openUrl(options: { url: string }): Promise<void>
}

/** O plugin de verdade (só existe dentro do app Android). */
export const FourNotesNativePlugin = registerPlugin<FourNotesNative>('FourNotes')

/** Para os testes automatizados (no navegador): sem permissões a pedir, nada a imprimir. */
export function fakeNative(root = '/storage/emulated/0'): FourNotesNative & { printed: { name: string; html: string }[]; opened: string[] } {
  const printed: { name: string; html: string }[] = []
  const opened: string[] = []
  return {
    printed,
    opened,
    storageInfo: async () => ({ root, granted: true }),
    requestStorageAccess: async () => ({ granted: true }),
    printHtml: async (options) => void printed.push(options),
    openUrl: async ({ url }) => void opened.push(url),
  }
}
