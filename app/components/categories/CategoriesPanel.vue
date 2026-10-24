<script setup lang="ts">
/**
 * Configurações › Categorias (1.7.1): todas as categorias do app, de qualquer módulo,
 * pensadas para centenas delas.
 *
 * - Lista compacta (uma linha por categoria) com busca enquanto digita (sem diferenciar
 *   acentos) e filtro por módulo; Enter na busca abre a primeira.
 * - Ao abrir uma categoria (a lista dá lugar aos detalhes, com "voltar"): editar nome,
 *   cor, ícone e foto (vale em todos os módulos), onde ela é usada (cada módulo abre a
 *   lista dos registros só quando você pede), as menções "#" a ela, usar em outro
 *   módulo, juntar com outra e excluir.
 * A categoria aberta fica em composables/useCategoryActions.ts (openCategoriesPanel abre
 * as Configurações já nela: o clique num "#Estudo" de uma nota, os diálogos dos módulos).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { requestCategoryMerge, requestCategoryRemoval, useCategoryUi } from '~/composables/useCategoryActions'
import { pickLibraryImage } from '~/composables/useImageLibrary'
import { useLayoutSize } from '~/composables/useLayoutSize'
import { CATEGORY_MODULE_LABELS, CATEGORY_MODULES, MAX_SHARED_NAME, suggestSharedColor, type CategoryModuleId } from '~/lib/categories/model'
import type { PaletteColor } from '~/lib/colors'
import { moduleById } from '~/lib/modules'
import { useAppStore } from '~/stores/app'
import { useCategoriesStore, type CategoryRecord } from '~/stores/categories'
import { useLinksStore } from '~/stores/links'
import { categorySubject, findMentionPlaces, openMentionPath, type MentionPlace } from '~/stores/mentions'
import { useModulesStore } from '~/stores/modules'

const ui = useCategoryUi()
const shared = useCategoriesStore()
const modules = useModulesStore()
const links = useLinksStore()
const app = useAppStore()
const { isCompact } = useLayoutSize()

// ── Lista ───────────────────────────────────────────────────────────────────

const search = ref('')
const moduleFilter = ref<CategoryModuleId | 'all' | 'unused'>('all')
const searchInput = ref<HTMLInputElement>()
const PAGE = 150
const limit = ref(PAGE)

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()

const sorted = computed(() => [...shared.state.categories].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true })))
const filtered = computed(() => {
  const query = fold(search.value)
  const summaries = shared.summaries.value
  return sorted.value.filter((category) => {
    if (query && !fold(category.name).includes(query)) return false
    const summary = summaries.get(category.id)
    if (moduleFilter.value === 'unused') return !summary?.modules.length
    if (moduleFilter.value !== 'all') return !!summary?.modules.includes(moduleFilter.value)
    return true
  })
})
/** Quem começa com o texto vem antes de quem só o contém. */
const ranked = computed(() => {
  const query = fold(search.value)
  if (!query) return filtered.value
  return [...filtered.value].sort((a, b) => Number(!fold(a.name).startsWith(query)) - Number(!fold(b.name).startsWith(query)))
})
const shown = computed(() => ranked.value.slice(0, limit.value))
watch([search, moduleFilter], () => (limit.value = PAGE))

const FILTERS = computed(() => [
  { value: 'all' as const, label: 'Todos os módulos' },
  ...CATEGORY_MODULES.map((module) => ({ value: module, label: CATEGORY_MODULE_LABELS[module] })),
  { value: 'unused' as const, label: 'Sem uso' },
])

const summaryOf = (id: string) => shared.summaries.value.get(id) ?? { modules: [], total: 0 }
const moduleIcon = (module: CategoryModuleId) => moduleById(module).icon

// Abrir uma categoria leva ao topo; voltar devolve a lista onde estava
const root = ref<HTMLElement>()
let listScroll = 0
const scroller = () => root.value?.closest<HTMLElement>('.settings-body') ?? null

async function select(id: string | null) {
  const back = !id && !!ui.panel.selected
  if (id && !ui.panel.selected) listScroll = scroller()?.scrollTop ?? 0
  ui.panel.selected = id
  await nextTick()
  scroller()?.scrollTo({ top: back ? listScroll : 0 })
}

function openFirst() {
  const first = ranked.value[0]
  if (first) void select(first.id)
}

onMounted(() => {
  if (!isCompact.value && !ui.panel.selected) searchInput.value?.focus()
})

// ── Nova categoria (ainda sem estar em nenhum módulo) ───────────────────────

const creating = ref(false)
const newName = ref('')
const newError = ref<string | null>(null)
const newInput = ref<HTMLInputElement>()

async function startCreate() {
  creating.value = true
  newName.value = search.value.trim()
  newError.value = null
  await nextTick()
  newInput.value?.focus()
}

function create() {
  const problem = shared.nameProblem(newName.value)
  if (problem) {
    newError.value = problem
    return
  }
  const category = shared.createCategory({ name: newName.value, color: suggestSharedColor(shared.state.categories.map((item) => item.color)) })
  if (!category) return
  creating.value = false
  search.value = ''
  void select(category.id)
}

// ── Categoria aberta ────────────────────────────────────────────────────────

const selected = computed(() => (ui.panel.selected ? (shared.findCategory(ui.panel.selected) ?? null) : null))

// A categoria aberta deixou de existir (juntada, excluída em outro aparelho): volta para a lista
watch(selected, (current) => {
  if (!current && ui.panel.selected) ui.panel.selected = null
})

const form = ref({ name: '', color: 'purple' as PaletteColor, icon: null as string | null, image: null as string | null })
const error = ref<string | null>(null)
const saving = ref(false)

function resetForm() {
  const category = selected.value
  if (!category) return
  form.value = { name: category.name, color: category.color, icon: category.icon, image: category.image }
  error.value = null
}
watch(
  () => [selected.value?.id, selected.value?.updatedAt],
  () => resetForm(),
  { immediate: true },
)

const dirty = computed(() => {
  const category = selected.value
  if (!category) return false
  return form.value.name.trim() !== category.name || form.value.color !== category.color || form.value.icon !== category.icon || form.value.image !== category.image
})

async function chooseImage() {
  const id = selected.value?.id
  const picked = await pickLibraryImage({ title: 'Foto da categoria', confirmLabel: 'Usar foto' })
  const path = picked ? await shared.libraryImage(picked) : null
  if (!path || selected.value?.id !== id) return
  form.value.image = path
  form.value.icon = null
}

function chooseIcon(value: string | null) {
  form.value.icon = value
  form.value.image = null
}

async function save() {
  const category = selected.value
  if (!category || !dirty.value) return
  const problem = shared.nameProblem(form.value.name, category.id)
  if (problem) {
    error.value = problem
    return
  }
  saving.value = true
  await shared.updateCategory(category.id, { ...form.value, name: form.value.name.trim() })
  saving.value = false
}

const created = computed(() => (selected.value ? new Date(selected.value.createdAt).toLocaleDateString('pt-BR') : ''))

// ── Onde é usada (cada módulo abre só quando você pede) ─────────────────────

const usage = computed(() => (selected.value ? shared.usage(selected.value.id) : []))
const used = computed(() => usage.value.filter((item) => item.member || item.records.length))
const unused = computed(() => usage.value.filter((item) => !item.member && !item.records.length))

const RECORD_LIMIT = 8
const open = ref(new Set<CategoryModuleId>())
const showAll = ref(new Set<CategoryModuleId>())
watch(
  () => selected.value?.id,
  () => {
    open.value = new Set()
    showAll.value = new Set()
    mentionPlaces.value = null
    mentionsOpen.value = false
  },
)

function toggleModule(module: CategoryModuleId) {
  const next = new Set(open.value)
  if (next.has(module)) next.delete(module)
  else next.add(module)
  open.value = next
}

function recordsShown(module: CategoryModuleId, records: CategoryRecord[]): CategoryRecord[] {
  return showAll.value.has(module) ? records : records.slice(0, RECORD_LIMIT)
}

const NOUNS: Record<CategoryModuleId, [string, string]> = {
  notes: ['nota', 'notas'],
  links: ['link', 'links'],
  tasks: ['tarefa', 'tarefas'],
  timer: ['sessão', 'sessões'],
  finance: ['lançamento', 'lançamentos'],
}
const countLabel = (module: CategoryModuleId, count: number) => `${count} ${NOUNS[module][count === 1 ? 0 : 1]}`
const RECORD_ICONS: Record<CategoryModuleId, string> = { notes: 'notes', links: 'link', tasks: 'task-open', timer: 'timer', finance: 'wallet' }

/** Abre o registro no módulo dele (as Configurações fecham). */
function openRecord(module: CategoryModuleId, record: CategoryRecord) {
  app.closeSettings()
  if (module !== 'links') return openMentionPath(record.path)
  // Um link salvo é mostrado na lista dos Links (a menção abriria o site)
  const show = async () => {
    await navigateTo('/links')
    links.reveal(record.id)
  }
  if (modules.requireModule('links', () => void show())) void show()
}

function useIn(module: CategoryModuleId) {
  if (!selected.value) return
  const id = selected.value.id
  const go = () => void shared.attach(module, id)
  if (modules.requireModule(module, go)) go()
}

// ── Menções "#" ─────────────────────────────────────────────────────────────

const mentionsOpen = ref(false)
const mentionPlaces = ref<MentionPlace[] | null>(null)
const mentionsLoading = ref(false)

async function toggleMentions() {
  mentionsOpen.value = !mentionsOpen.value
  if (!mentionsOpen.value || !selected.value) return
  mentionsLoading.value = true
  const id = selected.value.id
  try {
    const places = await findMentionPlaces(categorySubject(selected.value))
    if (selected.value?.id === id) mentionPlaces.value = places
  } finally {
    mentionsLoading.value = false
  }
}

function openPlace(place: MentionPlace) {
  app.closeSettings()
  openMentionPath(place.path)
}

const PLACE_ICONS: Record<string, string> = { note: 'notes', map: 'graph', task: 'task-open', expense: 'wallet' }

// ── Juntar e excluir ────────────────────────────────────────────────────────

async function remove() {
  if (!selected.value) return
  if (await requestCategoryRemoval(selected.value.id, null)) void select(null)
}

async function merge() {
  if (!selected.value) return
  if (await requestCategoryMerge(selected.value.id)) void select(null)
}
</script>

<template>
  <div ref="root" class="manager" data-categories-panel>
    <!-- Lista -->
    <div v-if="!selected" class="list-view">
      <div class="toolbar">
        <label class="search">
          <AppIcon name="search" :size="14" />
          <input
            ref="searchInput"
            v-model="search"
            placeholder="Buscar categoria…"
            spellcheck="false"
            aria-label="Buscar categoria"
            data-field="category-search"
            @keydown.enter.prevent="openFirst"
          />
          <button v-if="search" type="button" class="icon-btn sm" aria-label="Limpar busca" @click="search = ''"><AppIcon name="x" :size="13" /></button>
        </label>
        <select v-model="moduleFilter" class="select filter" aria-label="Filtrar por módulo" data-filter="category-module">
          <option v-for="item in FILTERS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <button v-if="!creating" type="button" class="btn btn-sm new-btn" data-action="new-shared-category" @click="startCreate">
          <AppIcon name="plus" :size="14" /> Nova
        </button>
      </div>

      <form v-if="creating" class="new-form" @submit.prevent="create">
        <input
          ref="newInput"
          v-model="newName"
          class="input"
          placeholder="Nome da categoria"
          :maxlength="MAX_SHARED_NAME"
          aria-label="Nome da nova categoria"
          @input="newError = null"
          @keydown.esc.stop.prevent="creating = false"
        />
        <button type="button" class="btn btn-ghost btn-sm" @click="creating = false">Cancelar</button>
        <button type="submit" class="btn btn-primary btn-sm">Criar</button>
        <p v-if="newError" class="error">{{ newError }}</p>
      </form>

      <p class="count" data-category-count>
        <template v-if="filtered.length !== shared.state.categories.length">{{ filtered.length }} de </template>{{ shared.state.categories.length }}
        {{ shared.state.categories.length === 1 ? 'categoria' : 'categorias' }}
      </p>

      <ul v-if="shown.length" class="rows" role="listbox" aria-label="Categorias">
        <li v-for="category in shown" :key="category.id">
          <button type="button" class="row" role="option" :aria-selected="false" :data-category-id="category.id" @click="select(category.id)">
            <CategoryAvatar :name="category.name" :color="category.color" :icon="category.icon" :image="category.image" :size="22" />
            <span class="row-name">{{ category.name }}</span>
            <span class="row-modules">
              <AppIcon
                v-for="module in summaryOf(category.id).modules"
                :key="module"
                :name="moduleIcon(module)"
                :size="13"
                :data-tip="CATEGORY_MODULE_LABELS[module]"
              />
            </span>
            <span class="row-count" :data-tip="`${summaryOf(category.id).total} registros`">{{ summaryOf(category.id).total }}</span>
            <AppIcon name="chevron-right" :size="15" class="row-go" />
          </button>
        </li>
      </ul>
      <button v-if="ranked.length > shown.length" type="button" class="btn btn-sm more" @click="limit += PAGE">
        Mostrar mais ({{ ranked.length - shown.length }})
      </button>

      <div v-if="!shared.state.categories.length" class="empty">
        <AppIcon name="tag" :size="28" />
        <p>Nenhuma categoria ainda.</p>
        <p class="muted">Crie aqui, nas listas de cada módulo ou com “#” numa nota. A mesma categoria vale em todos os módulos.</p>
      </div>
      <div v-else-if="!filtered.length" class="empty">
        <AppIcon name="search" :size="24" />
        <p>Nenhuma categoria {{ search.trim() ? `com “${search.trim()}”` : 'com esse filtro' }}.</p>
        <button v-if="search.trim()" type="button" class="btn btn-sm" @click="startCreate"><AppIcon name="plus" :size="14" /> Criar “{{ search.trim() }}”</button>
      </div>
    </div>

    <!-- Categoria aberta -->
    <div v-else class="detail" :aria-label="`Categoria ${selected.name}`">
      <button type="button" class="back" data-action="categories-back" @click="select(null)">
        <AppIcon name="chevron-left" :size="16" /> Categorias
      </button>

      <header class="detail-head">
        <CategoryAvatar :name="form.name || selected.name" :color="form.color" :icon="form.icon" :image="form.image" :size="40" />
        <div class="title">
          <h3>{{ selected.name }}</h3>
          <span class="meta">Criada em {{ created }} · {{ summaryOf(selected.id).total }} {{ summaryOf(selected.id).total === 1 ? 'registro' : 'registros' }}</span>
        </div>
      </header>

      <form class="edit" @submit.prevent="save">
        <label class="field-label" for="shared-cat-name">Nome</label>
        <div class="name-row">
          <input id="shared-cat-name" v-model="form.name" class="input" :maxlength="MAX_SHARED_NAME" spellcheck="false" data-field="category-name" @input="error = null" />
          <button type="button" class="btn btn-sm" @click="chooseImage"><AppIcon name="image" :size="14" /> {{ form.image ? 'Trocar foto…' : 'Foto…' }}</button>
          <button v-if="form.image" type="button" class="btn btn-ghost btn-sm" @click="form.image = null">Tirar foto</button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <span class="field-label gap">Cor</span>
        <ColorSwatches :model-value="form.color" label="Cor da categoria" @update:model-value="(value) => value && (form.color = value)" />
        <span class="field-label gap">Ícone</span>
        <IconPicker :model-value="form.image ? '' : form.icon" :color="form.color" :name="form.name" label="Ícone da categoria" @update:model-value="chooseIcon" />
        <Transition name="fade">
          <div v-if="dirty" class="save-row">
            <span class="save-hint">Vale em todos os módulos que usam esta categoria.</span>
            <button type="button" class="btn btn-ghost btn-sm" @click="resetForm">Descartar</button>
            <button type="submit" class="btn btn-primary btn-sm" :disabled="saving" data-action="save-shared-category">{{ saving ? 'Salvando…' : 'Salvar' }}</button>
          </div>
        </Transition>
      </form>

      <h4 class="section-title">Onde é usada</h4>
      <p v-if="!used.length" class="muted small">Ainda não está em nenhum módulo.</p>
      <div v-for="item in used" :key="item.module" class="usage" :data-usage-module="item.module">
        <button type="button" class="usage-head" :aria-expanded="open.has(item.module)" :disabled="!item.records.length" @click="toggleModule(item.module)">
          <AppIcon :name="moduleIcon(item.module)" :size="15" />
          <strong>{{ item.label }}</strong>
          <span class="muted">{{ item.records.length ? countLabel(item.module, item.records.length) : 'na lista, sem registros' }}</span>
          <AppIcon v-if="item.records.length" :name="open.has(item.module) ? 'chevron-up' : 'chevron-down'" :size="15" class="usage-chevron" />
        </button>
        <ul v-if="open.has(item.module)" class="records">
          <li v-for="record in recordsShown(item.module, item.records)" :key="record.id">
            <button type="button" class="record" :class="{ done: record.done }" :data-record="record.id" @click="openRecord(item.module, record)">
              <AppIcon :name="RECORD_ICONS[item.module]" :size="14" class="record-icon" />
              <span class="record-title">{{ record.title || 'Sem título' }}</span>
              <span v-if="record.detail" class="record-detail">{{ record.detail }}</span>
            </button>
          </li>
          <li v-if="item.records.length > RECORD_LIMIT && !showAll.has(item.module)">
            <button type="button" class="more-link" @click="showAll = new Set([...showAll, item.module])">Mostrar todos ({{ item.records.length }})</button>
          </li>
        </ul>
      </div>

      <div class="usage" data-usage-module="mentions">
        <button type="button" class="usage-head" :aria-expanded="mentionsOpen" data-action="category-mentions" @click="toggleMentions">
          <span class="hash">#</span>
          <strong>Menções</strong>
          <span class="muted">{{ mentionPlaces ? `${mentionPlaces.length} ${mentionPlaces.length === 1 ? 'lugar' : 'lugares'}` : 'notas, tarefas e lançamentos que citam' }}</span>
          <AppIcon :name="mentionsOpen ? 'chevron-up' : 'chevron-down'" :size="15" class="usage-chevron" />
        </button>
        <ul v-if="mentionsOpen" class="records">
          <li v-if="mentionsLoading" class="muted small pad">Procurando…</li>
          <li v-else-if="mentionPlaces && !mentionPlaces.length" class="muted small pad">Nenhuma menção. Digite “#{{ selected.name }}” numa nota para mencionar.</li>
          <li v-for="place in mentionPlaces ?? []" :key="place.path">
            <button type="button" class="record" :data-place="place.path" @click="openPlace(place)">
              <AppIcon :name="PLACE_ICONS[place.kind] ?? 'notes'" :size="14" class="record-icon" />
              <span class="record-title">{{ place.title || 'Sem título' }}</span>
              <span class="record-detail">{{ place.where }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div v-if="unused.length" class="use-in">
        <span class="muted">Usar também em:</span>
        <button v-for="item in unused" :key="item.module" type="button" class="chip" :data-use-in="item.module" @click="useIn(item.module)">
          <AppIcon :name="moduleIcon(item.module)" :size="13" /> {{ item.label }}
        </button>
      </div>

      <footer class="detail-actions">
        <button v-if="shared.state.categories.length > 1" type="button" class="btn btn-sm" data-action="merge-category" @click="merge">Juntar com outra…</button>
        <button type="button" class="btn btn-danger-ghost btn-sm" data-action="delete-shared-category" @click="remove"><AppIcon name="trash" :size="14" /> Excluir…</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.manager {
  padding: 14px 0 4px;
}
.toolbar {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 0 8px;
  background: var(--elevated, var(--surface));
}
.search {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1 1 220px;
  min-width: 0;
  height: 34px;
  padding: 0 6px 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--text-3);
}
.search:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}
.search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13.5px;
}
.filter {
  width: auto;
  min-height: 34px;
  padding-top: 5px;
  padding-bottom: 5px;
  font-size: 13px;
}
.new-btn {
  height: 34px;
}
.new-form {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.new-form .input {
  flex: 1 1 200px;
  min-width: 0;
}
.count {
  margin: 2px 2px 6px;
  font-size: 12px;
  color: var(--text-3);
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 38px;
  padding: 3px 8px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
html[data-touch] .row {
  min-height: 48px;
}
.row:hover,
.row:focus-visible {
  background: var(--hover);
}
.row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
  font-weight: 560;
}
.row-modules {
  display: flex;
  flex: none;
  gap: 5px;
  color: var(--text-3);
}
.row-count {
  flex: none;
  min-width: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 11.5px;
  font-weight: 650;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.row-go {
  flex: none;
  color: var(--text-3);
}
.more {
  display: block;
  margin: 8px auto 0;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 12px;
  text-align: center;
  color: var(--text-2);
  font-size: 13.5px;
}
.muted {
  color: var(--text-3);
}
.small {
  font-size: 12.5px;
}
.pad {
  padding: 6px 8px;
}
.error {
  flex-basis: 100%;
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--danger);
}

/* ── Detalhes ── */
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 10px -6px;
  padding: 4px 8px 4px 4px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--primary-text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.back:hover {
  background: var(--hover);
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.title {
  min-width: 0;
}
.title h3 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 650;
}
.meta {
  font-size: 12px;
  color: var(--text-3);
}
.name-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.name-row .input {
  flex: 1 1 200px;
  min-width: 0;
}
.gap {
  margin-top: 14px;
}
.save-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--primary-soft);
}
.save-hint {
  margin-right: auto;
  font-size: 12px;
  color: var(--text-2);
}
.section-title {
  margin: 20px 0 8px;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-3);
}
.usage {
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
}
.usage-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 6px 12px;
  border: none;
  border-radius: var(--r-lg);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}
.usage-head:disabled {
  cursor: default;
}
.usage-head:not(:disabled):hover {
  background: var(--hover);
}
.usage-head .muted {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}
.usage-chevron {
  flex: none;
  color: var(--text-3);
}
.hash {
  width: 15px;
  font-weight: 700;
  text-align: center;
  color: var(--text-2);
}
.records {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0 6px 6px;
  list-style: none;
  container-type: inline-size;
}
.record {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
html[data-touch] .record {
  min-height: 42px;
}
.record:hover,
.record:focus-visible {
  background: var(--hover);
}
.record-icon {
  flex: none;
  color: var(--text-3);
}
.record-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record.done .record-title {
  text-decoration: line-through;
  color: var(--text-3);
}
.record-detail {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
@container (max-width: 420px) {
  .record {
    flex-wrap: wrap;
    row-gap: 1px;
  }
  .record-detail {
    order: 3;
    flex-basis: 100%;
    max-width: none;
    padding-left: 22px;
  }
}
.more-link {
  margin: 2px 0 0 8px;
  padding: 0;
  border: none;
  background: none;
  color: var(--primary-text);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.use-in {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12.5px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-2);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.chip:hover {
  border-color: var(--primary);
  color: var(--primary-text);
}
.detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
html[data-layout='compact'] .filter {
  flex: 1 1 auto;
}
</style>
