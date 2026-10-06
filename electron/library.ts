/**
 * Biblioteca de imagens (processo principal): todas as imagens enviadas ao 4notes,
 * para escolher de novo sem precisar enviar outra vez.
 *
 * - As imagens ficam em attachments/: as coladas nas notas, as enviadas pela
 *   biblioteca e as escolhidas como foto de uma categoria.
 * - As fotos das categorias das Notas ficam também na pasta da categoria
 *   (notes/<Categoria>/<Categoria>.png); as de antes da biblioteca aparecem nela do
 *   mesmo jeito. Imagens iguais (mesmo conteúdo) aparecem uma vez só.
 * - "Em uso" = citada numa nota (.md em notes/ ou mindmap/) ou foto de uma
 *   categoria (Notas ou Links). Só imagens sem uso podem ser excluídas.
 */
import { dialog, type BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PICKABLE_IMAGE_EXTENSIONS, type LibraryImage, type RemoveImageResult } from '../shared/ipc'
import { AppError, ATTACHMENTS_DIR, IMAGE_FILE, listFiles, MAX_IMAGE_BYTES, resolveInside, trashFile, writeNewAttachment } from './files'

const NOTES_CATEGORIES_FILE = 'notes/categorias.json'
const LINKS_FILE = 'links/links.json'
/** Pastas com notas (.md) que podem citar imagens. */
const NOTE_DIRS = [
  { dir: 'notes', one: 'nota', many: 'notas' },
  { dir: 'mindmap', one: 'nota do mapa mental', many: 'notas do mapa mental' },
] as const

interface Candidate {
  path: string
  name: string
  size: number
  mtimeMs: number
}

/** Imagens com o mesmo conteúdo (a primeira é a que aparece na biblioteca). */
interface Group {
  files: Candidate[]
  usage: string[]
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const key = (relativePath: string) => relativePath.normalize('NFC').toLowerCase()
const inLibrary = (relativePath: string) => relativePath.startsWith(`${ATTACHMENTS_DIR}/`)

async function readJson(root: string, relativePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(resolveInside(root, relativePath), 'utf8'))
  } catch {
    return null
  }
}

/** Foto de uma categoria (Notas ou Links) e onde ela aparece. */
interface CategoryImage {
  path: string
  label: string
}

/** Fotos das categorias das Notas (notes/<Categoria>/<arquivo>) e dos Links (attachments/…). */
async function categoryImages(root: string): Promise<CategoryImage[]> {
  const images: CategoryImage[] = []
  const notes = await readJson(root, NOTES_CATEGORIES_FILE)
  for (const item of isObject(notes) && Array.isArray(notes.categories) ? notes.categories : []) {
    if (!isObject(item) || typeof item.name !== 'string' || typeof item.image !== 'string') continue
    const name = item.name.trim()
    const image = item.image.trim()
    if (name && !/[/\\]/.test(name) && !/[/\\]/.test(image) && IMAGE_FILE.test(image)) images.push({ path: `notes/${name}/${image}`, label: `Categoria “${name}” (Notas)` })
  }
  const links = await readJson(root, LINKS_FILE)
  for (const item of isObject(links) && Array.isArray(links.folders) ? links.folders : []) {
    if (!isObject(item) || typeof item.name !== 'string' || typeof item.image !== 'string') continue
    if (inLibrary(item.image) && IMAGE_FILE.test(item.image)) images.push({ path: item.image, label: `Categoria “${item.name.trim()}” (Links)` })
  }
  return images
}

function decodePart(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/**
 * Destino de um link Markdown que começa em `start` (logo depois do "]("): <entre sinais>
 * ou um endereço sem espaços — parênteses equilibrados fazem parte dele, como no editor
 * ("foto (1).png" escrito à mão: ![](foto%20(1).png)).
 */
function linkDestination(content: string, start: number): string | null {
  let i = start
  while (content[i] === ' ' || content[i] === '\t') i++
  if (content[i] === '<') {
    const end = content.indexOf('>', i + 1)
    const newline = content.indexOf('\n', i + 1)
    return end < 0 || (newline >= 0 && newline < end) ? null : content.slice(i + 1, end)
  }
  let depth = 0
  let end = i
  for (; end < content.length; end++) {
    const char = content[end]!
    if (char === '\\') {
      end++
      continue
    }
    if (/\s/.test(char)) break
    if (char === '(') depth++
    else if (char === ')') {
      if (!depth) break
      depth--
    }
  }
  return end > i ? content.slice(i, end) : null
}

/** Arquivos do workspace citados numa nota: ![](../attachments/x.png), [texto](…), <img src="…">. */
export function referencedFiles(notePath: string, content: string): string[] {
  const dir = notePath.split('/').slice(0, -1)
  const found: string[] = []
  const re = /\]\(|<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi
  for (let match = re.exec(content); match; match = re.exec(content)) {
    const raw = match[1] ?? linkDestination(content, match.index + 2)?.replace(/\\([!-/:-@[-`{-~])/g, '$1') ?? ''
    const target = raw.split('#')[0]!.split('?')[0]!
    if (!target || /^[a-z][\w+.-]*:/i.test(target) || target.startsWith('/')) continue
    const parts: string[] = []
    let valid = true
    for (const part of [...dir, ...target.split('/').map(decodePart)]) {
      if (!part || part === '.') continue
      if (part === '..') {
        if (!parts.length) valid = false
        parts.pop()
      } else {
        parts.push(part)
      }
    }
    if (valid && parts.length) found.push(parts.join('/'))
  }
  return found
}

/** Quantas notas de cada pasta citam cada arquivo: caminho → contagem por pasta. */
async function noteReferences(root: string): Promise<Map<string, number[]>> {
  const counts = new Map<string, number[]>()
  for (const [index, { dir }] of NOTE_DIRS.entries()) {
    for (const file of await listFiles(root, dir, { recursive: true, extensions: ['.md'], withContent: true })) {
      for (const target of new Set(referencedFiles(file.path, file.content ?? '').map(key))) {
        const list = counts.get(target) ?? NOTE_DIRS.map(() => 0)
        list[index]!++
        counts.set(target, list)
      }
    }
  }
  return counts
}

async function hashOf(root: string, relativePath: string): Promise<string | null> {
  try {
    return createHash('sha1')
      .update(await fs.readFile(resolveInside(root, relativePath)))
      .digest('hex')
  } catch {
    return null
  }
}

async function statCandidate(root: string, relativePath: string): Promise<Candidate | null> {
  try {
    const stat = await fs.stat(resolveInside(root, relativePath))
    return stat.isFile() ? { path: relativePath, name: path.posix.basename(relativePath), size: stat.size, mtimeMs: stat.mtimeMs } : null
  } catch {
    return null
  }
}

/** Imagens da biblioteca + fotos das categorias, agrupadas por conteúdo, com onde cada uma é usada. */
async function collect(root: string): Promise<Group[]> {
  const [attachments, categories, references] = await Promise.all([
    listFiles(root, ATTACHMENTS_DIR, { recursive: true }),
    categoryImages(root),
    noteReferences(root),
  ])
  const candidates: Candidate[] = attachments
    .filter((file) => IMAGE_FILE.test(file.name))
    .map((file) => ({ path: file.path, name: file.name, size: file.size, mtimeMs: file.mtimeMs }))
  const known = new Set(candidates.map((file) => key(file.path)))
  // Fotos das categorias das Notas que estão só na pasta da categoria
  for (const image of categories) {
    if (known.has(key(image.path)) || inLibrary(image.path)) continue
    const candidate = await statCandidate(root, image.path)
    if (!candidate) continue
    candidates.push(candidate)
    known.add(key(image.path))
  }
  // Mesmo tamanho → compara o conteúdo (só nesses casos lê os arquivos)
  const bySize = new Map<number, Candidate[]>()
  for (const file of candidates) bySize.set(file.size, [...(bySize.get(file.size) ?? []), file])
  const groups: Group[] = []
  for (const same of bySize.values()) {
    if (same.length === 1) {
      groups.push({ files: same, usage: [] })
      continue
    }
    const byHash = new Map<string, Candidate[]>()
    for (const file of same) {
      const hash = (await hashOf(root, file.path)) ?? `?${file.path}`
      byHash.set(hash, [...(byHash.get(hash) ?? []), file])
    }
    for (const files of byHash.values()) groups.push({ files, usage: [] })
  }

  for (const group of groups) {
    // Aparece pela cópia da biblioteca (attachments/), a mais antiga
    group.files.sort((a, b) => Number(inLibrary(b.path)) - Number(inLibrary(a.path)) || a.mtimeMs - b.mtimeMs)
    const totals = NOTE_DIRS.map(() => 0)
    const files = new Set(group.files.map((file) => key(file.path)))
    for (const file of files) references.get(file)?.forEach((count, index) => (totals[index]! += count))
    const notes = totals.flatMap((count, index) => (count ? [`${count} ${count === 1 ? NOTE_DIRS[index]!.one : NOTE_DIRS[index]!.many}`] : []))
    // Categorias na ordem dos módulos (Notas, depois Links)
    const labels = [...new Set(categories.filter((image) => files.has(key(image.path))).map((image) => image.label))]
    group.usage = [...notes, ...labels]
  }
  return groups
}

/** Imagens da biblioteca, das mais novas para as mais antigas, sem repetidas. */
export async function listLibrary(root: string): Promise<LibraryImage[]> {
  const groups = await collect(root)
  return groups
    .map(({ files, usage }) => {
      const shown = files[0]!
      return { path: shown.path, name: shown.name, size: shown.size, mtimeMs: Math.max(...files.map((file) => file.mtimeMs)), usage }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name, 'pt-BR'))
}

/** Uma imagem igual (mesmo conteúdo) que já está em attachments/, se houver. */
async function sameInLibrary(root: string, data: Uint8Array): Promise<string | null> {
  const same = (await listFiles(root, ATTACHMENTS_DIR, { recursive: true })).filter((file) => file.size === data.byteLength && IMAGE_FILE.test(file.name))
  if (!same.length) return null
  const hash = createHash('sha1').update(data).digest('hex')
  for (const file of same) if ((await hashOf(root, file.path)) === hash) return file.path
  return null
}

/** Nome do arquivo na biblioteca a partir do nome original ("Minha foto!.PNG" → "Minha foto!", "png"). */
function libraryName(fileName: string): { base: string; extension: string } {
  const extension = path.extname(fileName).slice(1).toLowerCase()
  const base =
    path
      .basename(fileName, path.extname(fileName))
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f#%]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 60)
      .replace(/[. ]+$/, '') || 'imagem'
  return { base: /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base) ? `${base}_` : base, extension: extension === 'jpeg' ? 'jpg' : extension }
}

/** Guarda os bytes na biblioteca (ou devolve a imagem igual que já está lá). */
async function store(root: string, fileName: string, data: Uint8Array): Promise<string> {
  const existing = await sameInLibrary(root, data)
  if (existing) return existing
  const { base, extension } = libraryName(fileName)
  return writeNewAttachment(root, base, extension, data)
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
    const saved = await store(root, path.basename(file), data)
    if (!stored.includes(saved)) stored.push(saved)
  }
  return stored
}

/**
 * Caminho da imagem dentro da biblioteca: se ela está em outro lugar do workspace
 * (a foto antiga de uma categoria das Notas), uma cópia vai para attachments/.
 */
export async function adoptIntoLibrary(root: string, relativePath: unknown): Promise<string> {
  if (typeof relativePath !== 'string' || !IMAGE_FILE.test(relativePath)) throw new AppError('EINVAL', 'Imagem inválida.')
  const absolute = resolveInside(root, relativePath)
  let data: Uint8Array
  try {
    data = new Uint8Array(await fs.readFile(absolute))
  } catch {
    throw new AppError('ENOENT', 'A imagem não existe mais.')
  }
  if (inLibrary(relativePath)) return relativePath
  if (data.byteLength > MAX_IMAGE_BYTES) throw new AppError('EFBIG', 'A imagem é grande demais (máximo de 40 MB).')
  return store(root, path.posix.basename(relativePath), data)
}

/** Exclui (Lixeira) uma imagem da biblioteca — e as cópias iguais a ela — se nada a usa. */
export async function removeFromLibrary(root: string, relativePath: unknown): Promise<RemoveImageResult> {
  if (typeof relativePath !== 'string' || !inLibrary(relativePath) || !IMAGE_FILE.test(relativePath)) throw new AppError('EINVAL', 'Imagem inválida.')
  // O caminho exato primeiro (no Linux, "Foto.png" e "foto.png" são arquivos diferentes)
  const groups = await collect(root)
  const group =
    groups.find(({ files }) => files.some((file) => file.path === relativePath)) ??
    groups.find(({ files }) => files.some((file) => key(file.path) === key(relativePath)))
  if (!group) return 'missing'
  if (group.usage.length) return 'in-use'
  for (const file of group.files) if (inLibrary(file.path)) await trashFile(root, file.path)
  return 'removed'
}
