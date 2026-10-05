/**
 * Sistema de arquivos do 4notes (roda no processo principal, com Node.js).
 *
 * Toda operação recebe um caminho RELATIVO à pasta de dados (ex.: "notes/Ideias.md").
 * `resolveInside` garante que nenhum caminho escape da pasta de dados
 * (ex.: "../../Windows/arquivo" é recusado).
 */
import { shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PICKABLE_IMAGE_EXTENSIONS, type FileEntry, type ListOptions, type PickedImage, type RemoveImageResult } from '../shared/ipc'

export class AppError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

/** Remove o BOM (comum em arquivos do Bloco de Notas antigo) e padroniza quebras de linha (CRLF → LF). */
function normalizeText(text: string): string {
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, '\n')
}

function isErrno(error: unknown, ...codes: string[]): boolean {
  return !!error && typeof error === 'object' && codes.includes((error as NodeJS.ErrnoException).code ?? '')
}

/** Converte um caminho relativo em absoluto, recusando qualquer coisa fora da raiz. */
export function resolveInside(root: string, relativePath: unknown): string {
  if (typeof relativePath !== 'string' || relativePath.length > 1024 || relativePath.includes('\0')) {
    throw new AppError('EINVAL', 'Caminho inválido.')
  }
  const absolute = path.resolve(root, relativePath)
  const relative = path.relative(root, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('EACCES', 'Acesso negado: o caminho está fora da pasta de dados.')
  }
  return absolute
}

/** Renomeia tentando de novo quando o arquivo está temporariamente bloqueado
 *  (antivírus, OneDrive/Google Drive sincronizando etc. — comum no Windows). */
async function renameWithRetry(from: string, to: string, attempts = 6): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      if (attempt >= attempts || !isErrno(error, 'EPERM', 'EBUSY', 'EACCES')) throw error
      await sleep(40 * attempt)
    }
  }
}

async function exists(absolute: string): Promise<boolean> {
  try {
    await fs.access(absolute)
    return true
  } catch {
    return false
  }
}

async function entryFor(root: string, absolute: string, withContent: boolean): Promise<FileEntry> {
  const stat = await fs.stat(absolute)
  const entry: FileEntry = {
    path: toPosix(path.relative(root, absolute)),
    name: path.basename(absolute),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  }
  if (withContent) entry.content = normalizeText(await fs.readFile(absolute, 'utf8'))
  return entry
}

export async function listFiles(root: string, dir: string, options: ListOptions = {}): Promise<FileEntry[]> {
  const base = resolveInside(root, dir)
  const extensions = options.extensions?.map((ext) => ext.toLowerCase())
  const result: FileEntry[] = []

  async function walk(absoluteDir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true })
    } catch (error) {
      if (isErrno(error, 'ENOENT', 'ENOTDIR')) return
      throw error
    }
    for (const entry of entries) {
      // Itens ocultos (".4notes", ".obsidian", arquivos temporários) são ignorados.
      if (entry.name.startsWith('.')) continue
      const absolute = path.join(absoluteDir, entry.name)
      if (entry.isDirectory()) {
        if (options.recursive) await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      if (extensions && !extensions.includes(path.extname(entry.name).toLowerCase())) continue
      try {
        result.push(await entryFor(root, absolute, options.withContent === true))
      } catch (error) {
        // O arquivo pode ter sido apagado entre o readdir e o stat: apenas ignore.
        if (!isErrno(error, 'ENOENT')) throw error
      }
    }
  }

  await walk(base)
  return result
}

export async function readFile(root: string, relativePath: string): Promise<string | null> {
  const absolute = resolveInside(root, relativePath)
  try {
    return normalizeText(await fs.readFile(absolute, 'utf8'))
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null
    throw error
  }
}

/**
 * Escrita atômica: o conteúdo vai para um arquivo temporário oculto e só depois
 * substitui o original. Se o computador desligar no meio, o arquivo antigo continua
 * íntegro — você nunca fica com uma nota "pela metade".
 */
export async function writeFile(root: string, relativePath: string, content: string): Promise<FileEntry> {
  if (typeof content !== 'string') throw new AppError('EINVAL', 'Conteúdo inválido.')
  const absolute = resolveInside(root, relativePath)
  await writeAtomic(absolute, content)
  return entryFor(root, absolute, false)
}

async function writeAtomic(absolute: string, data: string | Uint8Array): Promise<void> {
  const dir = path.dirname(absolute)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(absolute)}.${process.pid}.${Date.now().toString(36)}.tmp`)
  await fs.writeFile(tmp, data)
  try {
    await renameWithRetry(tmp, absolute)
  } catch {
    // Último recurso (ex.: arquivo travado por outro programa): grava diretamente.
    try {
      await fs.writeFile(absolute, data)
    } finally {
      await fs.rm(tmp, { force: true })
    }
  }
}

/** Cria uma pasta dentro da pasta de dados (e as de cima, se faltarem). */
export async function makeDir(root: string, relativePath: string): Promise<void> {
  await fs.mkdir(resolveInside(root, relativePath), { recursive: true })
}

async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [statA, statB] = await Promise.all([fs.stat(a, { bigint: true }), fs.stat(b, { bigint: true })])
    return statA.ino !== 0n && statA.ino === statB.ino && statA.dev === statB.dev
  } catch {
    return false
  }
}

export async function renameFile(root: string, from: string, to: string): Promise<void> {
  const source = resolveInside(root, from)
  const target = resolveInside(root, to)
  if (source === target) return
  if (!(await exists(source))) throw new AppError('ENOENT', 'O arquivo original não existe mais.')

  // No Windows/macOS "nota.md" e "Nota.md" são o MESMO arquivo: renomear só a
  // capitalização é permitido; qualquer outro destino existente é um conflito.
  const caseOnly = source.toLowerCase() === target.toLowerCase() && (await sameFile(source, target))
  if (!caseOnly && (await exists(target))) {
    throw new AppError('EEXIST', 'Já existe um arquivo com esse nome.')
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  if (caseOnly) {
    const tmp = `${source}.${Date.now().toString(36)}.renaming`
    await renameWithRetry(source, tmp)
    await renameWithRetry(tmp, target)
  } else {
    await renameWithRetry(source, target)
  }
}

export async function fileExists(root: string, relativePath: string): Promise<boolean> {
  return exists(resolveInside(root, relativePath))
}

/** Envia para a Lixeira. Se o sistema não tiver lixeira disponível (ex.: unidade de rede),
 *  move para <pasta de dados>/.4notes/trash para que nada seja perdido. */
export async function trashFile(root: string, relativePath: string): Promise<void> {
  const absolute = resolveInside(root, relativePath)
  if (!(await exists(absolute))) return
  try {
    await shell.trashItem(absolute)
  } catch {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fallback = path.join(root, '.4notes', 'trash', `${stamp} ${path.basename(absolute)}`)
    await fs.mkdir(path.dirname(fallback), { recursive: true })
    await renameWithRetry(absolute, fallback)
  }
}

export function revealFile(root: string, relativePath: string): void {
  shell.showItemInFolder(resolveInside(root, relativePath))
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}
const MAX_IMAGE_BYTES = 40 * 1024 * 1024

/** Grava uma imagem colada em attachments/ com um nome único (imagem-AAAAMMDD-HHMMSS.png). */
export async function saveImage(root: string, data: unknown, mime: unknown): Promise<string> {
  const extension = typeof mime === 'string' ? IMAGE_EXTENSIONS[mime.toLowerCase()] : undefined
  if (!extension) throw new AppError('EINVAL', 'Formato de imagem não suportado.')
  if (!(data instanceof Uint8Array) || data.byteLength === 0) throw new AppError('EINVAL', 'Imagem vazia.')
  if (data.byteLength > MAX_IMAGE_BYTES) throw new AppError('EFBIG', 'A imagem é grande demais (máximo de 40 MB).')
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const dir = resolveInside(root, 'attachments')
  await fs.mkdir(dir, { recursive: true })
  for (let attempt = 1; attempt < 1000; attempt++) {
    const name = `imagem-${stamp}${attempt > 1 ? `-${attempt}` : ''}.${extension}`
    try {
      await fs.writeFile(path.join(dir, name), data, { flag: 'wx' })
      return `attachments/${name}`
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error
    }
  }
  throw new AppError('EEXIST', 'Não foi possível criar um nome para a imagem.')
}

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i
const MAX_PICKED_IMAGE_BYTES = 10 * 1024 * 1024

// ── Imagens escolhidas no seletor (ex.: imagem de uma categoria) ────────────

/** Lê a imagem escolhida pelo usuário no seletor de arquivos do sistema. */
export async function readPickedImage(absolute: string): Promise<PickedImage> {
  const extension = path.extname(absolute).slice(1).toLowerCase()
  if (!(PICKABLE_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) throw new AppError('EINVAL', 'Escolha um arquivo de imagem.')
  const stat = await fs.stat(absolute)
  if (stat.size > MAX_PICKED_IMAGE_BYTES) throw new AppError('EFBIG', 'A imagem é grande demais (máximo de 10 MB).')
  return { name: path.basename(absolute), extension, data: new Uint8Array(await fs.readFile(absolute)) }
}

/** Grava os bytes de uma imagem no workspace (substitui a anterior, com escrita atômica). */
export async function writeImage(root: string, relativePath: unknown, data: unknown): Promise<FileEntry> {
  if (typeof relativePath !== 'string' || !IMAGE_FILE.test(relativePath)) throw new AppError('EINVAL', 'Imagem inválida.')
  if (!(data instanceof Uint8Array) || data.byteLength === 0) throw new AppError('EINVAL', 'Imagem vazia.')
  if (data.byteLength > MAX_IMAGE_BYTES) throw new AppError('EFBIG', 'A imagem é grande demais (máximo de 40 MB).')
  const absolute = resolveInside(root, relativePath)
  await writeAtomic(absolute, data)
  return entryFor(root, absolute, false)
}

// ── Imagens removidas das notas ─────────────────────────────────────────────
/** Imagens apagadas nesta sessão, guardadas para o Desfazer conseguir devolvê-las. */
const removedImages = new Map<string, Buffer>()
const REMOVED_IMAGES_LIMIT = 200 * 1024 * 1024

function attachmentPath(root: string, relativePath: unknown): string {
  if (typeof relativePath !== 'string' || !relativePath.startsWith('attachments/') || !IMAGE_FILE.test(relativePath)) {
    throw new AppError('EINVAL', 'Imagem inválida.')
  }
  return resolveInside(root, relativePath)
}

function rememberRemoved(absolute: string, data: Buffer): void {
  removedImages.delete(absolute)
  removedImages.set(absolute, data)
  let total = 0
  for (const value of removedImages.values()) total += value.byteLength
  // Passou do limite: esquece as mais antigas (a última sempre fica)
  for (const [key, value] of removedImages) {
    if (total <= REMOVED_IMAGES_LIMIT || key === absolute) break
    removedImages.delete(key)
    total -= value.byteLength
  }
}

/** Alguma nota (.md em notes/ ou mindmap/), fora `exceptNote`, cita o arquivo `name`? */
async function imageInUse(root: string, name: string, exceptNote: string | null): Promise<boolean> {
  const needles = [...new Set([name, encodeURI(name), encodeURIComponent(name)])]
  const except = exceptNote?.toLowerCase()
  for (const dir of ['notes', 'mindmap']) {
    for (const file of await listFiles(root, dir, { recursive: true, extensions: ['.md'], withContent: true })) {
      if (file.path.toLowerCase() === except) continue
      if (needles.some((needle) => file.content!.includes(needle))) return true
    }
  }
  return false
}

/**
 * Apaga (vai para a Lixeira) uma imagem de attachments/ que foi removida de uma
 * nota — só se nenhuma outra nota usa a mesma imagem.
 * @param exceptNote nota de onde a imagem saiu (o arquivo dela ainda pode citar a imagem até ser salvo)
 */
export async function removeImage(root: string, relativePath: unknown, exceptNote: unknown): Promise<RemoveImageResult> {
  const absolute = attachmentPath(root, relativePath)
  if (!(await exists(absolute))) return 'missing'
  if (await imageInUse(root, path.basename(absolute), typeof exceptNote === 'string' ? exceptNote : null)) return 'in-use'
  rememberRemoved(absolute, await fs.readFile(absolute))
  await trashFile(root, relativePath as string)
  return 'removed'
}

/** Devolve uma imagem apagada nesta sessão (Desfazer). false = não há o que devolver. */
export async function restoreImage(root: string, relativePath: unknown): Promise<boolean> {
  const absolute = attachmentPath(root, relativePath)
  if (await exists(absolute)) return true
  const data = removedImages.get(absolute)
  if (!data) return false
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await fs.writeFile(absolute, data, { flag: 'wx' })
  removedImages.delete(absolute)
  return true
}
