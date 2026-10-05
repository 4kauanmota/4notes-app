/**
 * Categorias das Notas.
 *
 * Cada categoria é uma PASTA dentro de notes/ — as notas dela ficam lá dentro:
 *
 *   notes/
 *   ├── Lista de compras.md        (sem categoria)
 *   ├── categorias.json            (ordem, cor, ícone e imagem de cada categoria)
 *   └── Trabalho/
 *       ├── Trabalho.png           (imagem da categoria: nome da categoria + extensão)
 *       └── Reunião.md
 *
 * O nome da categoria é o nome da pasta. Uma pasta criada fora do app (com notas)
 * também aparece como categoria; uma categoria sem notas existe só no categorias.json.
 */
import { isCategoryIcon } from '../category-icons'
import { PALETTE, isPaletteColor, type PaletteColor } from '../colors'
import { nameKey } from '../files/filename'
import { DATA_PATHS } from '../storage/paths'

export interface NoteCategory {
  name: string
  color: PaletteColor
  /** Arquivo da imagem dentro da pasta da categoria (ex.: "Trabalho.png"), ou null. */
  image: string | null
  /** Ícone pronto (lib/category-icons.ts), ou null. A imagem, se houver, tem prioridade. */
  icon: string | null
}

export const CATEGORIES_FILE = `${DATA_PATHS.notesDir}/categorias.json`
export const MAX_CATEGORY_NAME = 40

/** Pasta da categoria no workspace ("notes/Trabalho"); null = sem categoria ("notes"). */
export const categoryDir = (name: string | null) => (name ? `${DATA_PATHS.notesDir}/${name}` : DATA_PATHS.notesDir)

/** Categoria de uma pasta: "notes/Trabalho" → "Trabalho"; "notes" → null. */
export function categoryOfDir(dir: string): string | null {
  const parts = dir.split('/')
  return parts.length === 2 && parts[0] === DATA_PATHS.notesDir && parts[1] ? parts[1] : null
}

/** Categoria de uma nota: "notes/Trabalho/Reunião.md" → "Trabalho"; "notes/Ideias.md" → null. */
export function categoryOfPath(path: string): string | null {
  return categoryOfDir(path.split('/').slice(0, -1).join('/'))
}

/** Pasta de uma nota: "notes/Trabalho/Reunião.md" → "notes/Trabalho". */
export const noteDirOf = (path: string) => path.split('/').slice(0, -1).join('/') || DATA_PATHS.notesDir

/** Caminho da imagem da categoria no workspace (ou null). */
export const categoryImagePath = (category: NoteCategory) => (category.image ? `${categoryDir(category.name)}/${category.image}` : null)

/** Nome do arquivo da imagem: o nome da categoria com a extensão da imagem. */
export const categoryImageName = (name: string, extension: string) => `${name}.${extension.toLowerCase().replace(/^\./, '')}`

/** Problema no nome (ele vira o nome de uma pasta) ou null se serve. */
export function categoryNameProblem(raw: string, others: string[]): string | null {
  const name = raw.trim()
  if (!name) return 'Dê um nome à categoria.'
  if (Array.from(name).length > MAX_CATEGORY_NAME) return `Use um nome com até ${MAX_CATEGORY_NAME} caracteres.`
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) return 'O nome não pode ter estes caracteres: < > : " / \\ | ? *'
  if (name.startsWith('.')) return 'O nome não pode começar com ponto.'
  if (/[. ]$/.test(name)) return 'O nome não pode terminar com ponto.'
  if (/^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) return 'Esse nome é reservado pelo Windows. Escolha outro.'
  if (others.some((other) => nameKey(other) === nameKey(name))) return 'Já existe uma categoria com esse nome.'
  return null
}

/** Cor para uma categoria nova: a primeira da paleta que ainda não está em uso. */
export function suggestCategoryColor(used: PaletteColor[]): PaletteColor {
  return PALETTE.find((color) => !used.includes(color)) ?? PALETTE[used.length % PALETTE.length]!
}

/** Cor estável para uma pasta criada fora do app (ainda sem cor no categorias.json). */
function colorForFolder(name: string): PaletteColor {
  let hash = 0
  for (const char of nameKey(name)) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return PALETTE[hash % PALETTE.length]!
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Lê o categorias.json de forma tolerante (arquivo editado à mão, campos faltando…). */
export function normalizeCategories(raw: unknown): NoteCategory[] {
  const list = isObject(raw) && Array.isArray(raw.categories) ? raw.categories : []
  const result: NoteCategory[] = []
  for (const item of list) {
    if (!isObject(item) || typeof item.name !== 'string') continue
    const name = item.name.trim()
    if (categoryNameProblem(name, result.map((category) => category.name))) continue
    const image = typeof item.image === 'string' && item.image.trim() && !/[/\\]/.test(item.image) ? item.image.trim() : null
    const icon = isCategoryIcon(item.icon) ? item.icon : null
    result.push({ name, color: isPaletteColor(item.color) ? item.color : colorForFolder(name), image, icon })
  }
  return result
}

export function serializeCategories(categories: NoteCategory[]): string {
  const data = { app: '4notes', version: 1, categories: categories.map(({ name, color, icon, image }) => ({ name, color, icon, image })) }
  return `${JSON.stringify(data, null, 2)}\n`
}

/**
 * Categorias = as do categorias.json (na ordem dele) + pastas com notas que ainda
 * não estão lá (criadas fora do app), em ordem alfabética. O nome mostrado é o da
 * pasta no disco.
 */
export function mergeWithFolders(saved: NoteCategory[], folders: string[]): NoteCategory[] {
  const byKey = new Map(folders.map((folder) => [nameKey(folder), folder]))
  const result = saved.map((category) => ({ ...category, name: byKey.get(nameKey(category.name)) ?? category.name }))
  const known = new Set(result.map((category) => nameKey(category.name)))
  const extra = folders
    .filter((folder) => !known.has(nameKey(folder)) && !categoryNameProblem(folder, []))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  for (const folder of extra) {
    known.add(nameKey(folder))
    result.push({ name: folder, color: colorForFolder(folder), image: null, icon: null })
  }
  return result
}
