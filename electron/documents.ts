/**
 * Documentos (1.7.3) no computador: grava os arquivos importados em
 * <workspace>/documents/arquivos/ e os lê de volta (o leitor de PDF recebe os bytes).
 *
 * Os nomes seguem shared/files.ts (iguais no celular). Nada sai da pasta documents/.
 */
import { shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { documentCandidate, documentFileName, DOCUMENT_FILES_DIR, MAX_DOCUMENT_BYTES } from '../shared/files'
import type { FileEntry } from '../shared/ipc'
import { AppError, isErrno, resolveInside } from './files'

const DOCUMENTS_ROOT = 'documents'

/** O caminho tem que ser de dentro de documents/ (e do workspace). */
function insideDocuments(root: string, relativePath: unknown): string {
  if (typeof relativePath !== 'string' || !/^documents\//.test(relativePath.replace(/\\/g, '/'))) throw new AppError('EACCES', 'Só arquivos dos Documentos.')
  const absolute = resolveInside(root, relativePath)
  const base = resolveInside(root, DOCUMENTS_ROOT)
  if (!absolute.startsWith(base + path.sep)) throw new AppError('EACCES', 'Só arquivos dos Documentos.')
  return absolute
}

export async function saveDocument(root: string, name: unknown, data: unknown): Promise<FileEntry> {
  if (typeof name !== 'string' || !name.trim()) throw new AppError('EINVAL', 'Nome inválido.')
  if (!(data instanceof Uint8Array)) throw new AppError('EINVAL', 'Arquivo inválido.')
  if (data.byteLength > MAX_DOCUMENT_BYTES) throw new AppError('EFBIG', 'O arquivo é grande demais (máximo de 200 MB).')
  const dir = resolveInside(root, DOCUMENT_FILES_DIR)
  await fs.mkdir(dir, { recursive: true })
  const { base, extension } = documentFileName(name)
  for (let attempt = 1; attempt < 1000; attempt++) {
    const file = documentCandidate(base, extension, attempt)
    try {
      await fs.writeFile(path.join(dir, file), data, { flag: 'wx' })
      const stat = await fs.stat(path.join(dir, file))
      return { path: `${DOCUMENT_FILES_DIR}/${file}`, name: file, size: stat.size, mtimeMs: stat.mtimeMs }
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error
    }
  }
  throw new AppError('EEXIST', 'Não foi possível criar um nome para o arquivo.')
}

export async function readDocument(root: string, relativePath: unknown): Promise<Uint8Array | null> {
  const absolute = insideDocuments(root, relativePath)
  try {
    const buffer = await fs.readFile(absolute)
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null
    throw error
  }
}

export async function openDocument(root: string, relativePath: unknown): Promise<void> {
  const absolute = insideDocuments(root, relativePath)
  const problem = await shell.openPath(absolute)
  if (problem) throw new AppError('EIO', `Não foi possível abrir: ${problem}`)
}
