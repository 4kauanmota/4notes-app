<script setup lang="ts">
/**
 * Conteúdo do seletor de categorias (1.7.2): a busca (já com o foco), a lista e o
 * "Criar". O CategoryPickerHost.vue o mostra num balão (computador) ou numa folha
 * (celular). ↑ ↓ escolhem, Enter confirma, Esc fecha; no botão direito (toque prolongado)
 * de uma categoria: editar, mudar de lugar no módulo e excluir.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { openCategoriesPanel } from '~/composables/useCategoryActions'
import { moduleGroupLabel, type PickerOption, type PickerRequest } from '~/composables/useCategoryPicker'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import { foldCategoryName, hasExactName, rankCategories } from '~/lib/categories/search'
import { useCategoriesStore } from '~/stores/categories'

const props = defineProps<{ request: PickerRequest }>()
const emit = defineEmits<{ close: [] }>()
const shared = useCategoriesStore()

/** Linhas desenhadas de uma vez (o resto aparece digitando). */
const LIMIT = 200

const query = ref('')
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()
const active = ref(0)
const busy = ref(false)
const selected = ref<(string | null)[]>([...props.request.selected])
/** Muda quando o módulo muda algo que o Vue não vê na lista (mover, excluir). */
const revision = ref(0)

type Row =
  | { kind: 'none'; key: string }
  | { kind: 'option'; key: string; option: PickerOption; member: boolean }
  | { kind: 'create'; key: string; name: string; problem: string | null }

const members = computed(() => {
  void revision.value
  void shared.state.revision
  return props.request.source.members()
})
const others = computed(() => {
  void revision.value
  void shared.state.revision
  return props.request.onlyMembers ? [] : props.request.source.others()
})
const hasQuery = computed(() => !!foldCategoryName(query.value))
const rankedMembers = computed(() => rankCategories(members.value, query.value))
const rankedOthers = computed(() => rankCategories(others.value, query.value))
const total = computed(() => rankedMembers.value.length + rankedOthers.value.length)

const createRow = computed<Row | null>(() => {
  if (!props.request.allowCreate || !hasQuery.value) return null
  const name = query.value.trim()
  if (hasExactName([...members.value, ...others.value], name)) return null
  return { kind: 'create', key: 'create', name, problem: shared.nameProblem(name) }
})

/** As linhas que dá para escolher, na ordem da tela (para ↑ ↓). */
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const noneMatches = !hasQuery.value || foldCategoryName(props.request.noneLabel).includes(foldCategoryName(query.value))
  if (props.request.allowNone && noneMatches) out.push({ kind: 'none', key: 'none' })
  let budget = LIMIT
  for (const option of rankedMembers.value.slice(0, budget)) out.push({ kind: 'option', key: `m:${option.id}`, option, member: true })
  budget -= Math.min(budget, rankedMembers.value.length)
  for (const option of rankedOthers.value.slice(0, budget)) out.push({ kind: 'option', key: `o:${option.id}`, option, member: false })
  if (createRow.value) out.push(createRow.value)
  return out
})
const hidden = computed(() => Math.max(0, total.value - LIMIT))
const firstOther = computed(() => rows.value.findIndex((row) => row.kind === 'option' && !row.member))
const firstMember = computed(() => rows.value.findIndex((row) => row.kind === 'option' && row.member))

watch(query, () => {
  // Com texto, a primeira que combina (ou o "Criar", se nenhuma combina)
  const index = rows.value.findIndex((row) => row.kind !== 'none')
  active.value = hasQuery.value ? Math.max(0, index) : 0
  void nextTick(scrollActive)
})

function isSelected(row: Row): boolean {
  if (row.kind === 'none') return props.request.multiple ? selected.value.includes(null) : selected.value.length === 0 || selected.value[0] === null
  if (row.kind === 'option') return selected.value.includes(row.option.id)
  return false
}

function scrollActive() {
  list.value?.querySelector<HTMLElement>(`[data-row-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' })
}

function moveActive(delta: number) {
  const count = rows.value.length
  if (!count) return
  active.value = (active.value + delta + count) % count
  void nextTick(scrollActive)
}

/** O id guardado no registro: uma de fora entra no módulo antes. */
async function resolveId(row: Row): Promise<string | null | undefined> {
  if (row.kind === 'none') return null
  if (row.kind === 'option') return row.member ? row.option.id : ((await props.request.source.attach(row.option.id)) ?? undefined)
  if (row.problem) return undefined
  return (await props.request.source.create(row.name)) ?? undefined
}

async function choose(row: Row | undefined) {
  if (!row || busy.value) return
  if (row.kind === 'create' && row.problem) return
  if (props.request.multiple && row.kind !== 'create') {
    const value = row.kind === 'none' ? null : row.option.id
    const next = selected.value.includes(value) ? selected.value.filter((item) => item !== value) : [...selected.value, value]
    selected.value = next
    props.request.selected = next
    props.request.onChange?.(next)
    return
  }
  busy.value = true
  try {
    const id = await resolveId(row)
    if (id === undefined) return
    if (props.request.multiple) {
      const next = [...selected.value, id]
      selected.value = next
      props.request.selected = next
      props.request.onChange?.(next)
      query.value = ''
      return
    }
    props.request.resolve([id])
  } finally {
    busy.value = false
  }
}

function clearAll() {
  selected.value = []
  props.request.selected = []
  props.request.onChange?.([])
  input.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Home' && !query.value) {
    event.preventDefault()
    active.value = 0
    void nextTick(scrollActive)
  } else if (event.key === 'End' && !query.value) {
    event.preventDefault()
    active.value = rows.value.length - 1
    void nextTick(scrollActive)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    void choose(rows.value[active.value])
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  }
}

async function rowMenu(row: Row) {
  if (row.kind !== 'option') return
  const source = props.request.source
  const index = members.value.findIndex((option) => option.id === row.option.id)
  const canMove = row.member && !!source.move && !hasQuery.value
  const choice = await showContextMenu([
    { id: 'edit', label: 'Editar…' },
    ...(canMove
      ? [
          { id: 'up', label: 'Mover para cima', enabled: index > 0 },
          { id: 'down', label: 'Mover para baixo', enabled: index < members.value.length - 1 },
        ]
      : []),
    ...(row.member ? [separator, { id: 'delete', label: 'Excluir…', danger: true }] : []),
  ])
  if (choice === 'edit') {
    emit('close')
    openCategoriesPanel(row.option.id.startsWith('name:') ? null : row.option.id)
  } else if (choice === 'up' || choice === 'down') {
    source.move?.(row.option.id, choice === 'up' ? -1 : 1)
    revision.value++
  } else if (choice === 'delete') {
    if (await source.remove(row.option.id)) {
      selected.value = selected.value.filter((id) => id !== row.option.id)
      props.request.selected = selected.value
      if (props.request.multiple) props.request.onChange?.(selected.value)
      revision.value++
    }
  }
  input.value?.focus()
}

const summary = computed(() => {
  const count = selected.value.length
  return count ? `${count} ${count === 1 ? 'selecionada' : 'selecionadas'}` : 'Todas as categorias'
})

onMounted(() => {
  // A selecionada aparece com o foco (e na tela) ao abrir
  const current = props.request.multiple ? -1 : rows.value.findIndex((row) => isSelected(row))
  active.value = Math.max(0, current)
  void nextTick(() => {
    input.value?.focus({ preventScroll: true })
    scrollActive()
  })
})
</script>

<template>
  <div class="picker" :data-picker-module="request.source.module" :class="{ multiple: request.multiple }">
    <div class="search">
      <AppIcon name="search" :size="14" />
      <input
        ref="input"
        v-model="query"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="category-picker-list"
        :aria-activedescendant="rows[active] ? `picker-row-${active}` : undefined"
        :aria-label="request.title"
        :placeholder="request.allowCreate ? 'Buscar ou criar categoria' : 'Buscar categoria'"
        spellcheck="false"
        autocomplete="off"
        data-picker-search
        @keydown="onKeydown"
      />
      <button v-if="query" type="button" class="icon-btn sm" aria-label="Limpar busca" @click="query = ''; input?.focus()">
        <AppIcon name="x" :size="13" />
      </button>
    </div>

    <ul id="category-picker-list" ref="list" class="rows" role="listbox" :aria-multiselectable="request.multiple || undefined">
      <template v-for="(row, index) in rows" :key="row.key">
        <li v-if="index === firstMember && !hasQuery" class="group" role="presentation">{{ moduleGroupLabel(request.source.module) }}</li>
        <li v-if="index === firstOther" class="group" role="presentation">{{ hasQuery || firstMember >= 0 ? 'Outras do app' : 'Categorias do app' }}</li>
        <li
          :id="`picker-row-${index}`"
          class="row"
          role="option"
          :data-row-index="index"
          :data-picker-row="row.kind === 'option' ? row.option.id : row.kind"
          :aria-selected="isSelected(row)"
          :aria-disabled="row.kind === 'create' && !!row.problem ? true : undefined"
          :class="[row.kind, { active: index === active, selected: isSelected(row), other: row.kind === 'option' && !row.member, disabled: row.kind === 'create' && !!row.problem }]"
          @pointermove="active = index"
          @mousedown.prevent
          @click="choose(row)"
          @contextmenu.prevent.stop="rowMenu(row)"
        >
          <span v-if="request.multiple && row.kind !== 'create'" class="check" aria-hidden="true">
            <AppIcon v-if="isSelected(row)" name="check" :size="11" />
          </span>
          <template v-if="row.kind === 'none'">
            <span class="avatar none-avatar" aria-hidden="true" />
            <span class="name muted">{{ request.noneLabel }}</span>
          </template>
          <template v-else-if="row.kind === 'option'">
            <CategoryAvatar :name="row.option.name" :color="row.option.color" :icon="row.option.icon" :image="row.option.image" :size="20" />
            <span class="name">{{ row.option.name }}</span>
            <span v-if="!row.member" class="hint">usar aqui</span>
          </template>
          <template v-else>
            <span class="avatar plus"><AppIcon name="plus" :size="13" /></span>
            <span class="name">
              <template v-if="row.problem">{{ row.problem }}</template>
              <template v-else>Criar “<b>{{ row.name }}</b>”</template>
            </span>
          </template>
          <AppIcon v-if="!request.multiple && isSelected(row)" class="tick" name="check" :size="14" />
        </li>
      </template>
      <li v-if="!rows.length" class="empty" role="presentation">Nenhuma categoria com “{{ query.trim() }}”.</li>
      <li v-else-if="hidden" class="empty" role="presentation">Mais {{ hidden }}: continue digitando para achar.</li>
    </ul>

    <div v-if="request.multiple" class="foot">
      <span class="summary">{{ summary }}</span>
      <button type="button" class="btn btn-sm btn-ghost" :disabled="!selected.length" data-picker-clear @click="clearAll">Limpar</button>
      <button type="button" class="btn btn-sm btn-primary" data-picker-done @click="emit('close')">Pronto</button>
    </div>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: inherit;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  height: 40px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-3);
}
.search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13.5px;
}
.search input::placeholder {
  color: var(--text-3);
}
.rows {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
}
.group {
  padding: 8px 8px 4px;
  color: var(--text-3);
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 32px;
  padding: 0 8px;
  border-radius: var(--r-sm);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
html[data-touch] .row {
  min-height: 44px;
  font-size: 14.5px;
}
.row.active {
  background: var(--hover);
}
.row.selected {
  color: var(--primary-text);
}
.row.selected .name {
  font-weight: 600;
}
.row.disabled {
  cursor: default;
  color: var(--danger);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name.muted {
  color: var(--text-2);
}
.hint {
  flex-shrink: 0;
  color: var(--text-3);
  font-size: 11px;
  opacity: 0;
  transition: opacity var(--t-fast);
}
.row.active .hint,
html[data-touch] .hint {
  opacity: 1;
}
.avatar {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 6px;
}
.none-avatar {
  width: 18px;
  height: 18px;
  margin: 1px;
  border: 1.5px dashed var(--border-strong);
  border-radius: 6px;
}
.plus {
  background: var(--primary-soft);
  color: var(--primary-text);
}
.row.disabled .plus {
  background: var(--danger-soft);
  color: var(--danger);
}
.tick {
  flex-shrink: 0;
  color: var(--primary);
}
.check {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--border-strong);
  border-radius: 4px;
  color: var(--on-primary);
  transition: all var(--t-fast);
}
.row.selected .check {
  border-color: var(--primary);
  background: var(--primary);
}
.empty {
  padding: 10px 10px 12px;
  color: var(--text-3);
  font-size: 12.5px;
}
.foot {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 8px 8px 8px 12px;
  border-top: 1px solid var(--border);
}
.summary {
  flex: 1;
  min-width: 0;
  color: var(--text-3);
  font-size: 12px;
}
</style>
