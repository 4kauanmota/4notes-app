/**
 * Categorias compartilhadas (1.7.0): uma lista só de categorias para o app inteiro.
 *
 * Fica em <workspace>/categories/categories.json:
 * {
 *   "app": "4notes", "version": 1,
 *   "categories": [{ "id": "estudo", "name": "Estudo", "color": "purple", "icon": "book",
 *                    "image": null, "createdAt": "…", "updatedAt": "…" }],
 *   "replaced": { "estudos-2": "estudo", "velha": null }
 * }
 *
 * - Esta lista é a fonte: nome, cor, ícone e foto de cada categoria.
 * - Os registros dos módulos (tarefas, links, sessões do Timer, gastos) guardam só o id.
 *   Cada módulo continua com a lista dele no próprio arquivo (as categorias que ele
 *   mostra, na ordem dele), com uma cópia do nome e da cor: assim o arquivo continua
 *   legível à mão e uma versão antiga do app (no outro aparelho) continua funcionando.
 * - Nas Notas a categoria continua sendo uma pasta (notes/<nome>/); o categorias.json
 *   ganha o id. Por isso o nome de uma categoria segue as regras de nomes de pasta.
 * - "replaced": categorias que deixaram de existir (juntadas a outra ou excluídas),
 *   para o que ainda apontar para elas (um arquivo de outro aparelho, um arquivo que
 *   estava com erro) ir para a categoria certa (ou ficar sem categoria) na próxima
 *   leitura, em vez de a categoria "voltar".
 *
 * Regras puras (sem Vue, sem disco): leitura tolerante, nomes, ids e a conciliação
 * entre esta lista e as listas dos módulos (`reconcile`), que também faz a passagem
 * da 1.6 (quando o arquivo ainda não existe).
 */
import { isCategoryIcon } from '../category-icons'
import { isPaletteColor, PALETTE, type PaletteColor } from '../colors'
import { nameKey } from '../files/filename'
import { categoryNameProblem } from '../notes/categories'

/** Os módulos com categorias, na ordem de prioridade da passagem da 1.6 (cor, ícone e foto vêm do primeiro). */
export const CATEGORY_MODULES = ['notes', 'links', 'tasks', 'timer', 'finance'] as const
export type CategoryModuleId = (typeof CATEGORY_MODULES)[number]

export const CATEGORY_MODULE_LABELS: Record<CategoryModuleId, string> = {
  notes: 'Notas',
  links: 'Links',
  tasks: 'Tarefas',
  timer: 'Timer',
  finance: 'Finanças',
}

export interface SharedCategory {
  id: string
  name: string
  color: PaletteColor
  /** Ícone pronto (lib/category-icons.ts) ou null (a inicial do nome). */
  icon: string | null
  /** Foto: imagem da biblioteca (attachments/…), ou null. Tem prioridade sobre o ícone. */
  image: string | null
  createdAt: string
  updatedAt: string
}

export interface CategoriesData {
  categories: SharedCategory[]
  /** Categorias que deixaram de existir → a que ficou no lugar (null = ficaram sem categoria). */
  replaced: Record<string, string | null>
}

export const MAX_SHARED_NAME = 40

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
/** Foto de categoria: só imagens da biblioteca (dentro do workspace). */
const LIBRARY_IMAGE = /^attachments\/[^\\]+\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i

export function emptyCategoriesData(): CategoriesData {
  return { categories: [], replaced: {} }
}

/** Mesmo nome (sem diferenciar maiúsculas, como as pastas do Windows). */
export const sameName = (a: string, b: string) => nameKey(a.trim()) === nameKey(b.trim())

/**
 * Problema no nome de uma categoria (ou null). Como qualquer categoria pode virar uma
 * pasta nas Notas, valem as regras de nomes de pasta. `others` = os nomes das outras.
 */
export function sharedNameProblem(name: string, others: string[]): string | null {
  return categoryNameProblem(name, others)
}

/** "Projetos Pessoais" → "projetos-pessoais" (ids legíveis no JSON). */
export function sharedIdFor(name: string, taken: (id: string) => boolean): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'categoria'
  if (!taken(slug)) return slug
  for (let i = 2; ; i++) if (!taken(`${slug}-${i}`)) return `${slug}-${i}`
}

/** Cor para uma categoria nova: a primeira da paleta que ainda não está em uso. */
export function suggestSharedColor(used: PaletteColor[]): PaletteColor {
  return PALETTE.find((color) => !used.includes(color)) ?? PALETTE[used.length % PALETTE.length]!
}

function normalizeCategory(raw: unknown, now: string): SharedCategory | null {
  if (!isObject(raw)) return null
  const id = str(raw.id).trim()
  const name = str(raw.name).trim()
  if (!id || !name) return null
  const image = str(raw.image)
  return {
    id,
    name: name.slice(0, MAX_SHARED_NAME * 2),
    color: isPaletteColor(raw.color) ? raw.color : 'gray',
    icon: isCategoryIcon(raw.icon) ? raw.icon : null,
    image: LIBRARY_IMAGE.test(image) && !image.split('/').includes('..') ? image : null,
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, str(raw.createdAt, now)),
  }
}

/** Lê o categories.json de forma tolerante (arquivo editado à mão, campos faltando…). */
export function normalizeCategoriesFile(raw: unknown, now = new Date().toISOString()): CategoriesData {
  if (!isObject(raw)) throw new Error('O arquivo não tem o formato esperado.')
  const categories: SharedCategory[] = []
  for (const item of Array.isArray(raw.categories) ? raw.categories : []) {
    const category = normalizeCategory(item, now)
    // Ids e nomes repetidos (cópia à mão, conflito de sincronização): fica o primeiro
    if (!category || categories.some((other) => other.id === category.id || sameName(other.name, category.name))) continue
    categories.push(category)
  }
  const replaced: Record<string, string | null> = {}
  if (isObject(raw.replaced)) {
    for (const [from, to] of Object.entries(raw.replaced)) {
      if (!from || categories.some((category) => category.id === from)) continue
      replaced[from] = typeof to === 'string' && to ? to : null
    }
  }
  return { categories, replaced }
}

export function serializeCategoriesFile(data: CategoriesData): string {
  const file = { app: '4notes', version: 1, categories: data.categories, replaced: data.replaced }
  return `${JSON.stringify(file, null, 2)}\n`
}

/**
 * Para onde foi uma categoria que não existe mais (segue as trocas em sequência:
 * A juntada a B, depois B juntada a C → C). undefined = o id nunca foi trocado;
 * null = ficou sem categoria.
 */
export function resolveReplaced(data: CategoriesData, id: string): string | null | undefined {
  if (!(id in data.replaced)) return undefined
  let current: string | null = id
  const seen = new Set<string>()
  while (current !== null && current in data.replaced && !seen.has(current)) {
    seen.add(current)
    current = data.replaced[current] ?? null
  }
  return current !== null && data.categories.some((category) => category.id === current) ? current : null
}

/** Marca `from` como trocada por `to` (e o que apontava para `from` passa a apontar para `to`). */
export function markReplaced(data: CategoriesData, from: string, to: string | null): void {
  for (const [key, value] of Object.entries(data.replaced)) if (value === from) data.replaced[key] = to
  data.replaced[from] = to
  if (to) delete data.replaced[to]
}

// ── Conciliação: a lista central × as listas dos módulos ────────────────────

/** Uma categoria na lista de um módulo (a cópia dele). Nas Notas, sem id até a 1.6. */
export interface ModuleMember {
  id: string | null
  name: string
  color: PaletteColor
  icon?: string | null
  image?: string | null
}

export interface ModuleMembers {
  module: CategoryModuleId
  members: ModuleMember[]
}

/** O que mudar numa lista de módulo: a categoria `from` passa a ser `to` (null = sai, sem categoria). */
export interface CategoryRemap {
  module: CategoryModuleId
  from: { id: string | null; name: string }
  to: string | null
}

export interface ReconcileResult {
  data: CategoriesData
  /** A lista central mudou (categorias novas). */
  changed: boolean
  remaps: CategoryRemap[]
  created: string[]
}

/**
 * Concilia a lista central com as listas dos módulos (na ordem de CATEGORY_MODULES):
 *  - categoria com um id da lista central → é ela (o nome e a cor da lista central valem);
 *  - id que foi juntado a outra ou excluído (`replaced`) → vai para a que ficou (ou sai);
 *  - id desconhecido (ou sem id, nas Notas) → a categoria da lista central com o mesmo
 *    nome, ou uma categoria nova com os dados do módulo.
 * Com a lista central vazia, isso é a passagem da 1.6: categorias com o mesmo nome em
 * módulos diferentes viram uma só, com a cor, o ícone e a foto do primeiro módulo.
 * Uma categoria criada nesta mesma conciliação só é reconhecida pelo id se o nome
 * também for o mesmo (ids iguais de módulos diferentes podem ser categorias diferentes).
 */
export function reconcile(current: CategoriesData, modules: ModuleMembers[], now = new Date().toISOString()): ReconcileResult {
  const data: CategoriesData = { categories: current.categories.map((category) => ({ ...category })), replaced: { ...current.replaced } }
  const created = new Set<string>()
  const remaps: CategoryRemap[] = []
  const byId = (id: string) => data.categories.find((category) => category.id === id)
  const taken = (id: string) => !!byId(id) || id in data.replaced

  const ordered = [...modules].sort((a, b) => CATEGORY_MODULES.indexOf(a.module) - CATEGORY_MODULES.indexOf(b.module))
  for (const { module, members } of ordered) {
    for (const member of members) {
      const name = member.name.trim()
      if (!name) continue
      let target: string | null | undefined
      if (member.id) {
        const known = byId(member.id)
        if (known && (!created.has(known.id) || sameName(known.name, name))) target = known.id
        else if (!known) target = resolveReplaced(data, member.id)
      }
      if (target === undefined) {
        const byName = data.categories.find((category) => sameName(category.name, name))
        if (byName) target = byName.id
      }
      if (target === undefined) {
        const id = member.id && !taken(member.id) ? member.id : sharedIdFor(name, taken)
        data.categories.push({
          id,
          name,
          color: member.color,
          icon: member.icon ?? null,
          image: member.image ?? null,
          createdAt: now,
          updatedAt: now,
        })
        created.add(id)
        target = id
      }
      if (target !== member.id) remaps.push({ module, from: { id: member.id, name }, to: target })
    }
  }
  return { data, changed: created.size > 0, remaps, created: [...created] }
}
