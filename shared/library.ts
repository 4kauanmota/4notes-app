/**
 * Biblioteca de imagens — as regras, iguais no computador (electron/library.ts) e no
 * celular (app/lib/mobile): cada plataforma só diz COMO ler e gravar (LibraryIo).
 *
 * - As imagens ficam em attachments/: as coladas nas notas, as enviadas pela
 *   biblioteca e as escolhidas como foto de uma categoria.
 * - As fotos das categorias das Notas ficam também na pasta da categoria
 *   (notes/<Categoria>/<Categoria>.png); as de antes da biblioteca aparecem nela do
 *   mesmo jeito. Imagens iguais (mesmo conteúdo) aparecem uma vez só.
 * - "Em uso" = citada numa nota (.md em notes/ ou mindmap/), na descrição de uma
 *   tarefa (tasks/tasks.json), nas observações de um lançamento ou recorrência das
 *   Finanças (finance/finance.json, 1.7.1) ou foto de uma categoria (Notas, Links ou a
 *   lista de categorias do app, categories/categories.json). Só imagens
 *   sem uso podem ser excluídas.
 */
import { ATTACHMENTS_DIR, IMAGE_FILE, libraryName, MAX_IMAGE_BYTES } from './files'
import type { FileEntry, LibraryImage, ListOptions, RemoveImageResult } from './ipc'

/** O que a biblioteca precisa da plataforma (caminhos relativos ao workspace). */
export interface LibraryIo {
  list(dir: string, options?: ListOptions): Promise<FileEntry[]>
  /** JSON de um arquivo (null se não existir ou tiver erro). */
  readJson(path: string): Promise<unknown>
  /** Tamanho e data de um ARQUIVO (null se não existir ou for uma pasta). */
  stat(path: string): Promise<{ size: number; mtimeMs: number } | null>
  /** Bytes de um arquivo (null se não existir). */
  readBytes(path: string): Promise<Uint8Array | null>
  sha1(data: Uint8Array): Promise<string>
  /** Grava uma imagem nova em attachments/ com um nome livre ("<base>.<ext>", "<base>-2.<ext>"…). */
  writeNew(base: string, extension: string, data: Uint8Array): Promise<string>
  trash(path: string): Promise<void>
}

/** Erro com código (o mesmo formato dos erros das plataformas: "[ENOENT] …"). */
export class LibraryError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(`[${code}] ${message}`)
  }
}

const NOTES_CATEGORIES_FILE = 'notes/categorias.json'
const LINKS_FILE = 'links/links.json'
/** Categorias compartilhadas por todos os módulos (1.7.0): a foto de cada uma. */
const SHARED_CATEGORIES_FILE = 'categories/categories.json'
/** As descrições das tarefas (Markdown, como as notas) também podem ter imagens. */
const TASKS_FILE = 'tasks/tasks.json'
/** E as observações das Finanças (1.7.1): lançamentos, entradas e recorrências. */
const FINANCE_FILE = 'finance/finance.json'
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
export const inLibrary = (relativePath: string) => relativePath.startsWith(`${ATTACHMENTS_DIR}/`)
const baseName = (relativePath: string) => relativePath.split('/').pop() ?? relativePath

/** Foto de uma categoria (Notas ou Links) e onde ela aparece. */
interface CategoryImage {
  path: string
  label: string
}

/** Fotos das categorias das Notas (notes/<Categoria>/<arquivo>) e dos Links (attachments/…). */
async function categoryImages(io: LibraryIo): Promise<CategoryImage[]> {
  const images: CategoryImage[] = []
  const notes = await io.readJson(NOTES_CATEGORIES_FILE)
  for (const item of isObject(notes) && Array.isArray(notes.categories) ? notes.categories : []) {
    if (!isObject(item) || typeof item.name !== 'string' || typeof item.image !== 'string') continue
    const name = item.name.trim()
    const image = item.image.trim()
    if (name && !/[/\\]/.test(name) && !/[/\\]/.test(image) && IMAGE_FILE.test(image)) images.push({ path: `notes/${name}/${image}`, label: `Categoria “${name}” (Notas)` })
  }
  const links = await io.readJson(LINKS_FILE)
  for (const item of isObject(links) && Array.isArray(links.folders) ? links.folders : []) {
    if (!isObject(item) || typeof item.name !== 'string' || typeof item.image !== 'string') continue
    if (inLibrary(item.image) && IMAGE_FILE.test(item.image)) images.push({ path: item.image, label: `Categoria “${item.name.trim()}” (Links)` })
  }
  const shared = await io.readJson(SHARED_CATEGORIES_FILE)
  for (const item of isObject(shared) && Array.isArray(shared.categories) ? shared.categories : []) {
    if (!isObject(item) || typeof item.name !== 'string' || typeof item.image !== 'string') continue
    if (inLibrary(item.image) && IMAGE_FILE.test(item.image)) images.push({ path: item.image, label: `Categoria “${item.name.trim()}”` })
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

/** Quem cita imagens: as notas de cada pasta, as descrições das tarefas e as observações das Finanças. */
const USERS = [...NOTE_DIRS, { one: 'tarefa', many: 'tarefas' }, { one: 'lançamento das Finanças', many: 'lançamentos das Finanças' }] as const
const TASKS_INDEX = NOTE_DIRS.length
const FINANCE_INDEX = NOTE_DIRS.length + 1

/** Quantas notas de cada pasta (e quantas tarefas) citam cada arquivo: caminho → contagem. */
async function noteReferences(io: LibraryIo): Promise<Map<string, number[]>> {
  const counts = new Map<string, number[]>()
  const count = (targets: string[], index: number) => {
    for (const target of new Set(targets.map(key))) {
      const list = counts.get(target) ?? USERS.map(() => 0)
      list[index]!++
      counts.set(target, list)
    }
  }
  for (const [index, { dir }] of NOTE_DIRS.entries()) {
    for (const file of await io.list(dir, { recursive: true, extensions: ['.md'], withContent: true })) count(referencedFiles(file.path, file.content ?? ''), index)
  }
  // Descrições das tarefas: os caminhos são relativos à pasta tasks/ (como os de uma nota ali)
  const tasks = await io.readJson(TASKS_FILE)
  for (const task of isObject(tasks) && Array.isArray(tasks.tasks) ? tasks.tasks : []) {
    if (isObject(task) && typeof task.notes === 'string' && task.notes) count(referencedFiles(TASKS_FILE, task.notes), TASKS_INDEX)
  }
  // Observações das Finanças: relativas à pasta finance/
  const finance = await io.readJson(FINANCE_FILE)
  if (isObject(finance)) {
    for (const list of [finance.expenses, finance.incomes, finance.recurrences]) {
      for (const item of Array.isArray(list) ? list : []) {
        if (isObject(item) && typeof item.notes === 'string' && item.notes) count(referencedFiles(FINANCE_FILE, item.notes), FINANCE_INDEX)
      }
    }
  }
  return counts
}

async function hashOf(io: LibraryIo, relativePath: string): Promise<string | null> {
  const data = await io.readBytes(relativePath).catch(() => null)
  return data ? io.sha1(data) : null
}

/** Imagens da biblioteca + fotos das categorias, agrupadas por conteúdo, com onde cada uma é usada. */
async function collect(io: LibraryIo): Promise<Group[]> {
  const [attachments, categories, references] = await Promise.all([io.list(ATTACHMENTS_DIR, { recursive: true }), categoryImages(io), noteReferences(io)])
  const candidates: Candidate[] = attachments
    .filter((file) => IMAGE_FILE.test(file.name))
    .map((file) => ({ path: file.path, name: file.name, size: file.size, mtimeMs: file.mtimeMs }))
  const known = new Set(candidates.map((file) => key(file.path)))
  // Fotos das categorias das Notas que estão só na pasta da categoria
  for (const image of categories) {
    if (known.has(key(image.path)) || inLibrary(image.path)) continue
    const stat = await io.stat(image.path).catch(() => null)
    if (!stat) continue
    candidates.push({ path: image.path, name: baseName(image.path), size: stat.size, mtimeMs: stat.mtimeMs })
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
      const hash = (await hashOf(io, file.path)) ?? `?${file.path}`
      byHash.set(hash, [...(byHash.get(hash) ?? []), file])
    }
    for (const files of byHash.values()) groups.push({ files, usage: [] })
  }

  for (const group of groups) {
    // Aparece pela cópia da biblioteca (attachments/), a mais antiga
    group.files.sort((a, b) => Number(inLibrary(b.path)) - Number(inLibrary(a.path)) || a.mtimeMs - b.mtimeMs)
    const totals = USERS.map(() => 0)
    const files = new Set(group.files.map((file) => key(file.path)))
    for (const file of files) references.get(file)?.forEach((count, index) => (totals[index]! += count))
    const notes = totals.flatMap((count, index) => (count ? [`${count} ${count === 1 ? USERS[index]!.one : USERS[index]!.many}`] : []))
    // Categorias na ordem dos módulos (Notas, depois Links)
    const labels = [...new Set(categories.filter((image) => files.has(key(image.path))).map((image) => image.label))]
    group.usage = [...notes, ...labels]
  }
  return groups
}

/** Imagens da biblioteca, das mais novas para as mais antigas, sem repetidas. */
export async function listLibrary(io: LibraryIo): Promise<LibraryImage[]> {
  const groups = await collect(io)
  return groups
    .map(({ files, usage }) => {
      const shown = files[0]!
      return { path: shown.path, name: shown.name, size: shown.size, mtimeMs: Math.max(...files.map((file) => file.mtimeMs)), usage }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name, 'pt-BR'))
}

/** Uma imagem igual (mesmo conteúdo) que já está em attachments/, se houver. */
async function sameInLibrary(io: LibraryIo, data: Uint8Array): Promise<string | null> {
  const same = (await io.list(ATTACHMENTS_DIR, { recursive: true })).filter((file) => file.size === data.byteLength && IMAGE_FILE.test(file.name))
  if (!same.length) return null
  const hash = await io.sha1(data)
  for (const file of same) if ((await hashOf(io, file.path)) === hash) return file.path
  return null
}

/** Guarda os bytes na biblioteca (ou devolve a imagem igual que já está lá). */
export async function storeInLibrary(io: LibraryIo, fileName: string, data: Uint8Array): Promise<string> {
  const existing = await sameInLibrary(io, data)
  if (existing) return existing
  const { base, extension } = libraryName(fileName)
  return io.writeNew(base, extension, data)
}

/**
 * Caminho da imagem dentro da biblioteca: se ela está em outro lugar do workspace
 * (a foto antiga de uma categoria das Notas), uma cópia vai para attachments/.
 */
export async function adoptIntoLibrary(io: LibraryIo, relativePath: unknown): Promise<string> {
  if (typeof relativePath !== 'string' || !IMAGE_FILE.test(relativePath)) throw new LibraryError('EINVAL', 'Imagem inválida.')
  const data = await io.readBytes(relativePath).catch(() => null)
  if (!data) throw new LibraryError('ENOENT', 'A imagem não existe mais.')
  if (inLibrary(relativePath)) return relativePath
  if (data.byteLength > MAX_IMAGE_BYTES) throw new LibraryError('EFBIG', 'A imagem é grande demais (máximo de 40 MB).')
  return storeInLibrary(io, baseName(relativePath), data)
}

/** Exclui (Lixeira) uma imagem da biblioteca — e as cópias iguais a ela — se nada a usa. */
export async function removeFromLibrary(io: LibraryIo, relativePath: unknown): Promise<RemoveImageResult> {
  if (typeof relativePath !== 'string' || !inLibrary(relativePath) || !IMAGE_FILE.test(relativePath)) throw new LibraryError('EINVAL', 'Imagem inválida.')
  // O caminho exato primeiro (no Linux, "Foto.png" e "foto.png" são arquivos diferentes)
  const groups = await collect(io)
  const group =
    groups.find(({ files }) => files.some((file) => file.path === relativePath)) ??
    groups.find(({ files }) => files.some((file) => key(file.path) === key(relativePath)))
  if (!group) return 'missing'
  if (group.usage.length) return 'in-use'
  for (const file of group.files) if (inLibrary(file.path)) await io.trash(file.path)
  return 'removed'
}
