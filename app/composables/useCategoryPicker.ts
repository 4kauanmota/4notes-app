/**
 * Seletor de categorias (1.7.2): o mesmo em todos os módulos, no lugar das fileiras de
 * chips, das listas (<select>) e dos submenus "Categoria" dos menus.
 *
 *   const result = await pickCategory({ module: 'finance', selected: [atual] })
 *   // result: [id] (ou [null] = sem categoria); null = fechou sem escolher
 *
 * Um seletor aberto por vez, desenhado pelo CategoryPickerHost.vue (app.vue): perto do
 * botão que o abriu (ou do ponto do clique) no computador, numa folha que sobe de baixo
 * no celular. A busca vem primeiro (lib/categories/search.ts); dá para criar uma categoria
 * pelo nome digitado sem abrir outra janela. Com `multiple` (os filtros), cada marcação
 * vale na hora (`onChange`) e o seletor fica aberto.
 *
 * As categorias são as do app (stores/categories.ts): as do módulo primeiro, na ordem
 * dele, e depois as outras do app. Escolher uma de fora a coloca no módulo (como o
 * "Usar categoria existente" da 1.7.0). Este arquivo liga o seletor aos stores dos
 * módulos (`pickerSource`); o seletor em si não conhece nenhum módulo.
 */
import { shallowRef } from 'vue'
import { requestDeleteCategory as requestDeleteNoteCategory } from '~/composables/useNoteCategories'
import { CATEGORY_MODULE_LABELS, suggestSharedColor, type CategoryModuleId } from '~/lib/categories/model'
import type { PaletteColor } from '~/lib/colors'
import { useCategoriesStore } from '~/stores/categories'
import { useFinanceStore } from '~/stores/finance'
import { useLinksStore } from '~/stores/links'
import { useNotesStore } from '~/stores/notes'
import { useTasksStore } from '~/stores/tasks'
import { useTimerStore } from '~/stores/timer'

/** Uma categoria como o seletor mostra. */
export interface PickerOption {
  id: string
  name: string
  color: PaletteColor
  icon: string | null
  image: string | null
}

/** De onde vêm as categorias de um módulo e o que o seletor pode fazer com elas. */
export interface PickerSource {
  module: CategoryModuleId
  /** As categorias que o módulo mostra, na ordem dele. */
  members(): PickerOption[]
  /** As outras categorias do app. */
  others(): PickerOption[]
  /** Põe uma categoria do app no módulo; devolve o id a guardar no registro (null = não deu). */
  attach(id: string): Promise<string | null>
  /** Cria uma categoria (no app) pelo nome e a põe no módulo. null = nome com problema (o aviso já apareceu). */
  create(name: string): Promise<string | null>
  /** Sobe (−1) ou desce (+1) uma categoria na lista do módulo; ausente = o módulo não tem ordem própria aqui. */
  move?(id: string, delta: number): void
  /** Exclui (pergunta o que fazer com os registros). true = excluiu. */
  remove(id: string): Promise<boolean>
}

export interface PickOptions {
  module: CategoryModuleId
  /** Selecionadas agora (null = "sem categoria"). */
  selected?: readonly (string | null)[]
  /** Várias de uma vez (filtros): cada mudança vai para `onChange` e o seletor fica aberto. */
  multiple?: boolean
  /** Mostra a opção "Sem categoria" (padrão: sim). */
  allowNone?: boolean
  noneLabel?: string
  /** Permite criar uma categoria pelo nome digitado (padrão: sim, menos nos filtros). */
  allowCreate?: boolean
  /** Só as categorias do módulo, sem as outras do app (padrão: só nos filtros). */
  onlyMembers?: boolean
  /** Perto de onde abrir: o botão que abriu (ou um ponto). Padrão: o último clique. */
  anchor?: Element | { x: number; y: number } | null
  /** Título curto (lido pelo leitor de tela e mostrado no celular). */
  title?: string
  onChange?(selected: (string | null)[]): void
}

export interface PickerRequest extends Required<Pick<PickOptions, 'multiple' | 'allowNone' | 'noneLabel' | 'allowCreate' | 'onlyMembers' | 'title'>> {
  source: PickerSource
  selected: (string | null)[]
  rect: { left: number; top: number; right: number; bottom: number }
  onChange?(selected: (string | null)[]): void
  /** Fecha devolvendo o resultado (null = sem escolha). */
  resolve(result: (string | null)[] | null): void
}

/** O seletor aberto agora (só um por vez). */
export const pickerRequest = shallowRef<PickerRequest | null>(null)

// Último ponto clicado (para abrir perto dele quando não há um botão)
let pointer = { x: 0, y: 0 }
if (typeof window !== 'undefined') {
  const track = (event: MouseEvent) => (pointer = { x: event.clientX, y: event.clientY })
  window.addEventListener('pointerdown', track, true)
  window.addEventListener('contextmenu', track, true)
}

function rectOf(anchor: PickOptions['anchor']): PickerRequest['rect'] {
  if (anchor && 'getBoundingClientRect' in anchor) {
    const rect = anchor.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  }
  const point = anchor ?? pointer
  return { left: point.x, top: point.y, right: point.x, bottom: point.y }
}

/** Abre o seletor. Resolve com as escolhidas ([null] = sem categoria) ou null (fechou sem escolher). */
export function pickCategory(options: PickOptions): Promise<(string | null)[] | null> {
  pickerRequest.value?.resolve(null)
  const multiple = options.multiple ?? false
  return new Promise((resolve) => {
    const request: PickerRequest = {
      source: pickerSource(options.module),
      selected: [...(options.selected ?? [])],
      multiple,
      allowNone: options.allowNone ?? true,
      noneLabel: options.noneLabel ?? 'Sem categoria',
      allowCreate: options.allowCreate ?? !multiple,
      onlyMembers: options.onlyMembers ?? multiple,
      title: options.title ?? (multiple ? 'Filtrar por categoria' : 'Categoria'),
      rect: rectOf(options.anchor),
      onChange: options.onChange,
      resolve(result) {
        if (pickerRequest.value === request) pickerRequest.value = null
        resolve(result)
      },
    }
    pickerRequest.value = request
  })
}

// Clicar no próprio botão com o seletor aberto: o clique de fora fecha e o botão não reabre
let closedBy: { target: EventTarget | null; at: number } = { target: null, at: 0 }

/** O host fechou o seletor por um clique de fora (em `target`). */
export function markPickerClosed(target: EventTarget | null): void {
  closedBy = { target, at: Date.now() }
}

/** O seletor acabou de ser fechado por um clique dentro de `element` (o botão que o abre)? */
export function pickerJustClosedFrom(element: Element | null | undefined): boolean {
  const target = closedBy.target as Node | null
  return !!element && !!target && Date.now() - closedBy.at < 400 && element.contains(target)
}

export function closeCategoryPicker(): void {
  const request = pickerRequest.value
  if (request) request.resolve(request.multiple ? request.selected : null)
}

// ── As categorias de cada módulo ────────────────────────────────────────────

/** Prefixo de uma pasta das Notas ainda sem id (de antes da conciliação): vale pelo nome. */
export const NOTE_NAME_PREFIX = 'name:'

function newColor(): PaletteColor {
  return suggestSharedColor(useCategoriesStore().state.categories.map((category) => category.color))
}

/** A aparência vem da lista central (ícone e foto); a cópia do módulo serve se ela ainda não tiver a categoria. */
function optionOf(member: { id?: string | null; name: string; color: PaletteColor; icon?: string | null; image?: string | null }): PickerOption {
  const shared = member.id ? useCategoriesStore().findCategory(member.id) : undefined
  return {
    id: member.id ?? `${NOTE_NAME_PREFIX}${member.name}`,
    name: shared?.name ?? member.name,
    color: shared?.color ?? member.color,
    icon: shared ? shared.icon : (member.icon ?? null),
    image: shared ? shared.image : null,
  }
}

function othersOf(module: CategoryModuleId): PickerOption[] {
  return useCategoriesStore()
    .availableFor(module)
    .map((category) => ({ id: category.id, name: category.name, color: category.color, icon: category.icon, image: category.image }))
}

export function pickerSource(module: CategoryModuleId): PickerSource {
  const others = () => othersOf(module)
  switch (module) {
    case 'tasks': {
      const tasks = useTasksStore()
      return {
        module,
        members: () => tasks.state.categories.map(optionOf),
        others,
        attach: async (id) => tasks.attachCategory(id)?.id ?? null,
        create: async (name) => tasks.addCategory(name, newColor())?.id ?? null,
        move(id, delta) {
          const from = tasks.state.categories.findIndex((category) => category.id === id)
          const to = from + delta
          if (from >= 0 && to >= 0 && to < tasks.state.categories.length) tasks.moveCategory(from, to)
        },
        remove: (id) => tasks.requestDeleteCategory(id),
      }
    }
    case 'timer': {
      const timer = useTimerStore()
      return {
        module,
        members: () => timer.state.categories.map(optionOf),
        others,
        attach: async (id) => timer.attachCategory(id)?.id ?? null,
        create: async (name) => timer.addCategory(name, newColor())?.id ?? null,
        move: (id, delta) => timer.moveCategory(id, delta),
        remove: (id) => timer.requestDeleteCategory(id),
      }
    }
    case 'finance': {
      const finance = useFinanceStore()
      return {
        module,
        members: () => finance.state.categories.map(optionOf),
        others,
        attach: async (id) => finance.attachCategory(id)?.id ?? null,
        create: async (name) => finance.addCategory(name, newColor())?.id ?? null,
        move: (id, delta) => finance.moveCategory(id, delta),
        remove: (id) => finance.requestDeleteCategory(id),
      }
    }
    case 'links': {
      const links = useLinksStore()
      return {
        module,
        members: () => links.state.folders.map(optionOf),
        others,
        attach: async (id) => links.attachFolder(id)?.id ?? null,
        create: async (name) => links.addFolder(name, newColor(), null)?.id ?? null,
        move(id, delta) {
          const from = links.state.folders.findIndex((folder) => folder.id === id)
          const to = from + delta
          if (from >= 0 && to >= 0 && to < links.state.folders.length) links.moveFolder(from, to)
        },
        remove: (id) => links.requestDeleteFolder(id),
      }
    }
    case 'notes': {
      const notes = useNotesStore()
      const nameOf = (id: string) =>
        id.startsWith(NOTE_NAME_PREFIX) ? id.slice(NOTE_NAME_PREFIX.length) : (notes.state.categories.find((category) => category.id === id)?.name ?? null)
      return {
        module,
        members: () => notes.state.categories.map(optionOf),
        others,
        attach: async (id) => (await notes.attachCategory(id))?.id ?? null,
        create: async (name) => {
          const category = await notes.createCategory({ name, color: newColor() })
          return category ? (category.id ?? `${NOTE_NAME_PREFIX}${category.name}`) : null
        },
        remove: (id) => {
          const name = nameOf(id)
          return name ? requestDeleteNoteCategory(name) : Promise.resolve(false)
        },
      }
    }
  }
}

/** Nome do módulo, para os títulos dos grupos do seletor ("Nas Finanças"). */
export function moduleGroupLabel(module: CategoryModuleId): string {
  const label = CATEGORY_MODULE_LABELS[module]
  if (module === 'links') return `Nos ${label}`
  return module === 'timer' ? `No ${label}` : `Nas ${label}`
}
