/**
 * Categorias compartilhadas (1.7.0): a lista central (categories/categories.json) e a
 * ponte com os módulos que usam categorias (Notas, Links, Tarefas, Timer, Finanças).
 *
 * - Esta lista é a fonte do nome, da cor, do ícone e da foto de cada categoria.
 * - Cada módulo continua com a lista dele (as categorias que ele mostra, na ordem dele,
 *   com uma cópia do nome e da cor) e os registros dele guardam o id. O módulo se
 *   apresenta aqui com um `CategoryProvider` (registerCategoryModule): este store não
 *   importa nenhum módulo: eles é que o importam.
 * - Renomear, trocar a cor, juntar e excluir acontecem aqui e são repassados a todos os
 *   módulos (nas Notas, renomear renomeia a pasta da categoria).
 * - Ao abrir o workspace (e ao reler os arquivos), a lista central é conciliada com as
 *   listas dos módulos (lib/categories/model.ts › reconcile). Na primeira vez (sem o
 *   categories.json), isso é a passagem da 1.6: categorias com o mesmo nome viram uma só.
 */
import { computed, reactive } from 'vue'
import { errorMessage } from '#shared/ipc'
import { notifyError, showToast } from '~/composables/useToasts'
import {
  CATEGORY_MODULE_LABELS,
  CATEGORY_MODULES,
  markReplaced,
  normalizeCategoriesFile,
  reconcile,
  sameName,
  sharedIdFor,
  sharedNameProblem,
  type CategoriesData,
  type CategoryModuleId,
  type ModuleMember,
  type SharedCategory,
} from '~/lib/categories/model'
import { categoriesRepository as repo } from '~/lib/categories/repository'
import type { PaletteColor } from '~/lib/colors'
import { desktop, hasDesktopApi } from '~/lib/platform'
import { debounce, SerialQueue } from '~/lib/utils/async'

export type { CategoryModuleId, SharedCategory } from '~/lib/categories/model'

/** Uma categoria de um módulo, como o módulo a guarda (nas Notas, pelo nome da pasta). */
export interface MemberRef {
  id: string | null
  name: string
}

/** Um registro de um módulo que usa uma categoria (para o "Ver categorias"). */
export interface CategoryRecord {
  id: string
  title: string
  /** Segunda linha: data, valor, situação… */
  detail?: string
  /** Caminho de menção do registro (abre pelo stores/mentions.ts › openMentionPath). */
  path: string
  /** Riscado (tarefa concluída). */
  done?: boolean
}

/** Como um módulo se apresenta às categorias compartilhadas. */
export interface CategoryProvider {
  id: CategoryModuleId
  /** Pode gravar agora? (carregado e com o arquivo lido sem erro) */
  ready(): boolean
  /** As categorias que o módulo mostra (a cópia dele), na ordem dele. */
  members(): ModuleMember[]
  /** Os registros do módulo com essa categoria. */
  records(id: string): CategoryRecord[]
  /** Copia nome, cor, ícone e foto da lista central (se a categoria estiver no módulo). false = falhou. */
  sync(category: SharedCategory): Promise<boolean> | boolean
  /** Passa a mostrar a categoria (o "Usar categoria existente"). */
  attach(category: SharedCategory): Promise<boolean> | boolean
  /** Os registros (e o lugar na lista) de `from` passam para `to`. */
  remap(from: MemberRef, to: SharedCategory): Promise<boolean> | boolean
  /** A categoria sai do módulo: os registros dela ficam sem categoria. */
  detach(from: MemberRef): Promise<boolean> | boolean
  /**
   * Problema para os registros de `from` irem para `to` (ou null). Nas Notas, por
   * exemplo, `to` vira o nome de uma pasta.
   */
  acceptProblem?(from: MemberRef, to: SharedCategory): string | null
}

export interface CategoryInput {
  name: string
  color: PaletteColor
  icon?: string | null
  image?: string | null
}

export interface CategoryUsage {
  module: CategoryModuleId
  label: string
  /** A categoria está na lista do módulo. */
  member: boolean
  records: CategoryRecord[]
}

const state = reactive({
  loaded: false,
  /** categories.json com erro: nada é gravado nem conciliado até resolver. */
  error: null as string | null,
  categories: [] as SharedCategory[],
  replaced: {} as Record<string, string | null>,
  /** Muda quando algo muda nos módulos de um jeito que o Vue não vê (para recalcular o uso). */
  revision: 0,
})

const providers = new Map<CategoryModuleId, CategoryProvider>()
const queue = new SerialQueue()
let lastRaw: string | null = null

/** Um módulo se apresenta (chamado quando o store do módulo é carregado). */
export function registerCategoryModule(provider: CategoryProvider): void {
  providers.set(provider.id, provider)
}

function orderedProviders(): CategoryProvider[] {
  return CATEGORY_MODULES.map((id) => providers.get(id)).filter((provider): provider is CategoryProvider => !!provider)
}

const readyProviders = () => orderedProviders().filter((provider) => provider.ready())

// ── Consultas ───────────────────────────────────────────────────────────────

const byId = computed(() => new Map(state.categories.map((category) => [category.id, category])))

function findCategory(id: string | null | undefined): SharedCategory | undefined {
  return id ? byId.value.get(id) : undefined
}

function findByName(name: string): SharedCategory | undefined {
  return state.categories.find((category) => sameName(category.name, name))
}

/** Problema no nome (ou null). `exceptId` = a categoria sendo editada. */
function nameProblem(name: string, exceptId?: string | null): string | null {
  return sharedNameProblem(
    name,
    state.categories.filter((category) => category.id !== exceptId).map((category) => category.name),
  )
}

/** Ids das categorias que um módulo mostra. */
function memberIds(module: CategoryModuleId): Set<string> {
  void state.revision
  const provider = providers.get(module)
  return new Set((provider?.members() ?? []).map((member) => member.id).filter((id): id is string => !!id))
}

/** As categorias do app que o módulo ainda não mostra (para "Usar categoria existente"). */
function availableFor(module: CategoryModuleId): SharedCategory[] {
  const members = memberIds(module)
  return state.categories.filter((category) => !members.has(category.id))
}

/** Onde a categoria é usada: em cada módulo, se ela está na lista e os registros dela. */
function usage(id: string): CategoryUsage[] {
  void state.revision
  return orderedProviders().map((provider) => ({
    module: provider.id,
    label: CATEGORY_MODULE_LABELS[provider.id],
    member: provider.members().some((member) => member.id === id),
    records: provider.records(id),
  }))
}

function recordCount(id: string): number {
  return usage(id).reduce((sum, item) => sum + item.records.length, 0)
}

// ── Gravação ────────────────────────────────────────────────────────────────

const data = (): CategoriesData => ({ categories: state.categories, replaced: state.replaced })

function adopt(next: CategoriesData): void {
  state.categories = next.categories
  state.replaced = next.replaced
}

function persist(): Promise<void> {
  return queue
    .run('file', async () => {
      if (state.error) return
      // Sem nenhuma categoria (e sem arquivo ainda): nada a guardar
      if (!state.categories.length && !Object.keys(state.replaced).length && lastRaw === null) return
      const raw = await repo.save(data())
      lastRaw = raw
    })
    .catch((error) => notifyError(`Não foi possível salvar as categorias: ${errorMessage(error)}`, error))
}

const scheduleSave = debounce(() => void persist(), 250)

async function flush(): Promise<void> {
  scheduleSave.flush()
  await queue.idle()
}

const now = () => new Date().toISOString()

// ── Conciliação com os módulos ──────────────────────────────────────────────

/** Fotos que ainda não estão na biblioteca (vindas da pasta de uma categoria das Notas) ganham uma cópia lá. */
async function adoptImages(): Promise<boolean> {
  let changed = false
  for (const category of state.categories) {
    if (!category.image || category.image.startsWith('attachments/') || !hasDesktopApi()) continue
    try {
      category.image = await desktop().library.adopt(category.image)
    } catch (error) {
      console.warn('[4notes] Não foi possível guardar a foto da categoria na biblioteca:', error)
      category.image = null
    }
    changed = true
  }
  return changed
}

/**
 * Concilia a lista central com as listas dos módulos (ver lib/categories/model.ts ›
 * reconcile) e copia nome, cor, ícone e foto para os módulos. `migrating` = o
 * categories.json ainda não existia (passagem da 1.6): antes, uma cópia dos arquivos.
 */
function reconcileModules(migrating = false): Promise<void> {
  return queue.run('ops', async () => {
    if (state.error) return
    const ready = readyProviders()
    const modules = ready.map((provider) => ({ module: provider.id, members: provider.members() }))
    const result = reconcile(data(), modules)
    if (migrating && modules.some((module) => module.members.length)) {
      await repo.backupBeforeMigration().catch((error) => console.warn('[4notes] Não foi possível copiar os arquivos antes da passagem das categorias:', error))
    }
    adopt(result.data)
    for (const remap of result.remaps) {
      const provider = providers.get(remap.module)
      if (!provider) continue
      const target = findCategory(remap.to)
      try {
        await (target ? provider.remap(remap.from, target) : provider.detach(remap.from))
      } catch (error) {
        console.warn('[4notes] Falha ao ajustar uma categoria de um módulo:', error)
      }
    }
    const images = await adoptImages()
    for (const provider of ready) {
      for (const category of state.categories) await provider.sync(category)
    }
    state.revision++
    if (result.changed || images || (migrating && state.categories.length)) await persist()
  })
}

async function load(): Promise<void> {
  try {
    const result = await repo.load()
    if (result.status === 'invalid') {
      state.error = result.error
      lastRaw = result.raw
      const backup = await repo.backupBroken(result.raw).catch(() => null)
      showToast({
        message: `O categories.json está com erro e não será alterado até ser corrigido${backup ? ` (cópia em ${backup})` : ''}. As categorias de cada módulo continuam funcionando.`,
        icon: 'alert',
        tone: 'error',
        duration: 10000,
      })
      state.loaded = true
      return
    }
    if (result.status === 'ok') {
      adopt(result.data)
      lastRaw = result.raw
    }
    state.error = null
    state.loaded = true
    await reconcileModules(result.status === 'missing')
  } catch (error) {
    state.error = errorMessage(error)
    state.loaded = true
  }
}

/** Relê o categories.json (outro aparelho, edição à mão) e concilia de novo com os módulos. */
async function refreshFromDisk(): Promise<void> {
  if (!state.loaded || scheduleSave.pending()) return
  await queue.idle()
  const raw = await repo.readRaw().catch(() => undefined)
  if (raw === undefined) return
  if (raw === null) {
    // Apagado fora do app: grava de novo o que está na memória
    if (!state.error && lastRaw !== null) {
      lastRaw = null
      void persist()
    }
  } else if (raw !== lastRaw) {
    try {
      adopt(normalizeCategoriesFile(JSON.parse(raw)))
      lastRaw = raw
      state.error = null
    } catch (error) {
      state.error = `O arquivo categories.json foi alterado fora do app e agora contém um erro (${errorMessage(error)}).`
      return
    }
  }
  await reconcileModules(false)
}

// ── Ações ───────────────────────────────────────────────────────────────────

function blocked(): boolean {
  if (!state.error) return false
  notifyError(`As categorias não podem ser alteradas enquanto o categories.json estiver com erro: ${state.error}`)
  return true
}

/**
 * Cria uma categoria (ainda sem estar em nenhum módulo: quem cria a coloca no módulo
 * dele com `attach`). null = nome com problema (o aviso já apareceu).
 */
function createCategory(input: CategoryInput): SharedCategory | null {
  if (blocked()) return null
  const name = input.name.trim()
  const problem = nameProblem(name)
  if (problem) {
    notifyError(problem)
    return null
  }
  const stamp = now()
  const taken = (id: string) => byId.value.has(id) || id in state.replaced
  state.categories.push({
    id: sharedIdFor(name, taken),
    name,
    color: input.color,
    icon: input.image ? null : (input.icon ?? null),
    image: input.image ?? null,
    createdAt: stamp,
    updatedAt: stamp,
  })
  scheduleSave()
  return state.categories.at(-1)!
}

/** Coloca a categoria na lista de um módulo (o "Usar categoria existente"). */
async function attach(module: CategoryModuleId, id: string): Promise<boolean> {
  const category = findCategory(id)
  const provider = providers.get(module)
  if (!category || !provider) return false
  const ok = await provider.attach(category)
  state.revision++
  return ok
}

/**
 * Muda nome, cor, ícone e/ou foto e repassa a todos os módulos (nas Notas, renomeia a
 * pasta). Se um módulo não conseguir renomear (ex.: já existe uma pasta com esse nome
 * nas Notas), nada muda.
 */
function updateCategory(id: string, patch: Partial<CategoryInput>): Promise<boolean> {
  if (blocked()) return Promise.resolve(false)
  return queue.run('ops', async () => {
    const category = findCategory(id)
    if (!category) return false
    if (patch.name !== undefined) {
      const problem = nameProblem(patch.name, id)
      if (problem) {
        notifyError(problem)
        return false
      }
    }
    // A foto é sempre uma imagem da biblioteca (attachments/)
    const image = patch.image ? await libraryImage(patch.image) : patch.image
    if (patch.image && !image) return false
    const before = { ...category }
    if (patch.name !== undefined) category.name = patch.name.trim()
    if (patch.color) category.color = patch.color
    if (patch.icon !== undefined) category.icon = patch.icon
    if (patch.image !== undefined) category.image = image ?? null
    if (category.image) category.icon = null // a foto tem prioridade: o ícone não fica guardado à toa
    category.updatedAt = now()
    let ok = true
    for (const provider of readyProviders()) ok = (await provider.sync(category)) && ok
    if (!ok && before.name !== category.name) {
      Object.assign(category, before)
      for (const provider of readyProviders()) await provider.sync(category)
      state.revision++
      return false
    }
    state.revision++
    await persist()
    return true
  })
}

/** Algum módulo não aceita os registros de `from` irem para `to`? */
function transferProblem(from: SharedCategory, to: SharedCategory, modules: CategoryProvider[]): string | null {
  for (const provider of modules) {
    const problem = provider.acceptProblem?.({ id: from.id, name: from.name }, to)
    if (problem) return problem
  }
  return null
}

/**
 * Junta `fromId` a `toId`: em todos os módulos, os registros de uma passam para a outra
 * (sem duplicar), e `fromId` deixa de existir. O que ainda apontar para ela (um arquivo
 * de outro aparelho) vai para `toId` na próxima leitura.
 */
function mergeCategories(fromId: string, toId: string): Promise<boolean> {
  if (blocked()) return Promise.resolve(false)
  return queue.run('ops', async () => {
    const from = findCategory(fromId)
    const to = findCategory(toId)
    if (!from || !to || from === to) return false
    const problem = transferProblem(from, to, readyProviders())
    if (problem) {
      notifyError(problem)
      return false
    }
    const ref = { id: from.id, name: from.name }
    for (const provider of readyProviders()) await provider.remap(ref, to)
    state.categories = state.categories.filter((category) => category.id !== from.id)
    markReplaced(state, from.id, to.id)
    state.revision++
    await persist()
    showToast({ message: `“${from.name}” foi juntada a “${to.name}”`, icon: 'folder' })
    return true
  })
}

/**
 * Exclui a categoria do app: os registros dela (em todos os módulos) vão para
 * `transferTo` ou, com null, ficam sem categoria. Nenhum registro é apagado.
 */
function deleteCategory(id: string, transferTo: string | null): Promise<boolean> {
  if (blocked()) return Promise.resolve(false)
  return queue.run('ops', async () => {
    const category = findCategory(id)
    const target = transferTo ? findCategory(transferTo) : null
    if (!category || (transferTo && (!target || target === category))) return false
    if (target) {
      const problem = transferProblem(category, target, readyProviders())
      if (problem) {
        notifyError(problem)
        return false
      }
    }
    const ref = { id: category.id, name: category.name }
    for (const provider of readyProviders()) await (target ? provider.remap(ref, target) : provider.detach(ref))
    state.categories = state.categories.filter((item) => item.id !== category.id)
    markReplaced(state, category.id, target?.id ?? null)
    state.revision++
    await persist()
    showToast({
      message: target ? `Categoria “${category.name}” excluída: os registros foram para “${target.name}”` : `Categoria “${category.name}” excluída: os registros ficaram sem categoria`,
      icon: 'trash',
    })
    return true
  })
}

/**
 * Tira a categoria de um módulo só (ela continua no app e nos outros módulos): os
 * registros desse módulo vão para `transferTo` ou ficam sem categoria.
 */
function removeFromModule(module: CategoryModuleId, id: string, transferTo: string | null): Promise<boolean> {
  return queue.run('ops', async () => {
    const provider = providers.get(module)
    const category = findCategory(id)
    const target = transferTo ? findCategory(transferTo) : null
    if (!provider || !category || (transferTo && (!target || target === category))) return false
    if (target) {
      const problem = transferProblem(category, target, [provider])
      if (problem) {
        notifyError(problem)
        return false
      }
    }
    const ref = { id: category.id, name: category.name }
    const ok = await (target ? provider.remap(ref, target) : provider.detach(ref))
    state.revision++
    if (ok) {
      showToast({
        message: `“${category.name}” saiu de ${CATEGORY_MODULE_LABELS[module]}${target ? `: os registros foram para “${target.name}”` : ''}`,
        icon: 'folder',
      })
    }
    return ok
  })
}

/**
 * Foto para uma categoria: a imagem escolhida na biblioteca, sempre de dentro de
 * attachments/ (uma foto de categoria das Notas ganha uma cópia lá). null = erro.
 */
async function libraryImage(path: string): Promise<string | null> {
  if (path.startsWith('attachments/')) return path
  try {
    return await desktop().library.adopt(path)
  } catch (error) {
    notifyError(`Não foi possível usar a imagem: ${errorMessage(error)}`, error)
    return null
  }
}

/** Algo mudou nos registros de um módulo (para o "Ver categorias" recalcular). */
function touch(): void {
  state.revision++
}

export function useCategoriesStore() {
  return {
    state,
    byId,
    findCategory,
    findByName,
    nameProblem,
    memberIds,
    availableFor,
    usage,
    recordCount,
    load,
    flush,
    refreshFromDisk,
    reconcile: reconcileModules,
    createCategory,
    attach,
    updateCategory,
    mergeCategories,
    deleteCategory,
    removeFromModule,
    touch,
    libraryImage,
    reveal: () => repo.reveal(),
    moduleLabel: (module: CategoryModuleId) => CATEGORY_MODULE_LABELS[module],
  }
}
