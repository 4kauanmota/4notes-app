/**
 * Biblioteca de imagens (processo principal): todas as imagens enviadas ao 4notes,
 * para escolher de novo sem precisar enviar outra vez.
 *
 * As regras (o que aparece, o que está em uso, imagens repetidas) ficam em
 * shared/library.ts — as mesmas no app Android. Aqui fica só o acesso ao disco
 * (Node.js) e o seletor de arquivos do sistema.
 */
import { dialog, type BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PICKABLE_IMAGE_EXTENSIONS, type LibraryImage, type RemoveImageResult } from '../shared/ipc'
import * as library from '../shared/library'
import { AppError, listFiles, MAX_IMAGE_BYTES, resolveInside, trashFile, writeNewAttachment } from './files'

export { referencedFiles } from '../shared/library'

/** Acesso ao workspace `root` para as regras da biblioteca. */
function io(root: string): library.LibraryIo {
  return {
    list: (dir, options) => listFiles(root, dir, options),
    async readJson(relativePath) {
      try {
        return JSON.parse(await fs.readFile(resolveInside(root, relativePath), 'utf8'))
      } catch {
        return null
      }
    },
    async stat(relativePath) {
      try {
        const stat = await fs.stat(resolveInside(root, relativePath))
        return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null
      } catch {
        return null
      }
    },
    async readBytes(relativePath) {
      try {
        return new Uint8Array(await fs.readFile(resolveInside(root, relativePath)))
      } catch {
        return null
      }
    },
    sha1: async (data) => createHash('sha1').update(data).digest('hex'),
    writeNew: (base, extension, data) => writeNewAttachment(root, base, extension, data),
    trash: (relativePath) => trashFile(root, relativePath),
  }
}

/** Erros da biblioteca no formato dos outros erros do processo principal. */
async function run<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    if (error instanceof library.LibraryError) throw new AppError(error.code, error.message.replace(/^\[[A-Z]+\]\s*/, ''))
    throw error
  }
}

/** Imagens da biblioteca, das mais novas para as mais antigas, sem repetidas. */
export function listLibrary(root: string): Promise<LibraryImage[]> {
  return library.listLibrary(io(root))
}

/** Escolhe imagens no seletor do sistema e guarda na biblioteca. Devolve os caminhos ([] = cancelado). */
export async function uploadToLibrary(root: string, win: BrowserWindow | null): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    title: 'Enviar imagens para a biblioteca',
    buttonLabel: 'Enviar',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Imagens', extensions: [...PICKABLE_IMAGE_EXTENSIONS] }],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled) return []
  const files = result.filePaths.filter((file) => (PICKABLE_IMAGE_EXTENSIONS as readonly string[]).includes(path.extname(file).slice(1).toLowerCase()))
  if (!files.length && result.filePaths.length) throw new AppError('EINVAL', 'Escolha arquivos de imagem.')
  for (const file of files) {
    if ((await fs.stat(file)).size > MAX_IMAGE_BYTES) throw new AppError('EFBIG', `A imagem “${path.basename(file)}” é grande demais (máximo de 40 MB).`)
  }
  const stored: string[] = []
  for (const file of files) {
    const data = new Uint8Array(await fs.readFile(file))
    if (!data.byteLength) continue
    const saved = await library.storeInLibrary(io(root), path.basename(file), data)
    if (!stored.includes(saved)) stored.push(saved)
  }
  return stored
}

/**
 * Caminho da imagem dentro da biblioteca: se ela está em outro lugar do workspace
 * (a foto antiga de uma categoria das Notas), uma cópia vai para attachments/.
 */
export function adoptIntoLibrary(root: string, relativePath: unknown): Promise<string> {
  return run(() => library.adoptIntoLibrary(io(root), relativePath))
}

/** Exclui (Lixeira) uma imagem da biblioteca — e as cópias iguais a ela — se nada a usa. */
export function removeFromLibrary(root: string, relativePath: unknown): Promise<RemoveImageResult> {
  return run(() => library.removeFromLibrary(io(root), relativePath))
}
