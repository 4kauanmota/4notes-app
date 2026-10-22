<script setup lang="ts">
/**
 * "Ver categorias" (1.7.0): todas as categorias do app, de qualquer módulo.
 * À esquerda a lista; à direita a categoria escolhida: editar nome, cor, ícone e foto
 * (vale em todos os módulos), onde ela é usada (os registros de cada módulo, que abrem
 * direto), usar em outro módulo, juntar com outra e excluir.
 * Abre pelo botão de categorias do menu lateral (no celular, em "Mais"), pelas
 * Configurações e pelos diálogos de categoria dos módulos.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { closeCategoriesPanel, requestCategoryMerge, requestCategoryRemoval, useCategoryUi } from '~/composables/useCategoryActions'
import { pickLibraryImage } from '~/composables/useImageLibrary'
import { useLayoutSize } from '~/composables/useLayoutSize'
import { CATEGORY_MODULES, MAX_SHARED_NAME, suggestSharedColor, type CategoryModuleId } from '~/lib/categories/model'
import type { PaletteColor } from '~/lib/colors'
import { moduleById } from '~/lib/modules'
import { openMentionPath } from '~/stores/mentions'
import { useCategoriesStore, type CategoryRecord } from '~/stores/categories'
import { useLinksStore } from '~/stores/links'
import { useModulesStore } from '~/stores/modules'

const ui = useCategoryUi()
const shared = useCategoriesStore()
const modules = useModulesStore()
const links = useLinksStore()
const { isCompact } = useLayoutSize()

const search = ref('')
const searchInput = ref<HTMLInputElement>()

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()

const sorted = computed(() => [...shared.state.categories].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true })))
const list = computed(() => {
  const query = fold(search.value)
  return query ? sorted.value.filter((category) => fold(category.name).includes(query)) : sorted.value
})

/** Em quais módulos cada categoria aparece (para os ícones da lista) e quantos registros. */
function summaryOf(id: string): { modules: CategoryModuleId[]; total: number } {
  const usage = shared.usage(id)
  return {
    modules: usage.filter((item) => item.member || item.records.length).map((item) => item.module),
    total: usage.reduce((sum, item) => sum + item.records.length, 0),
  }
}

const selected = computed(() => (ui.panel.selected ? (shared.findCategory(ui.panel.selected) ?? null) : null))
const usage = computed(() => (selected.value ? shared.usage(selected.value.id) : []))
const used = computed(() => usage.value.filter((item) => item.member || item.records.length))
const unused = computed(() => usage.value.filter((item) => !item.member && !item.records.length))

function select(id: string | null) {
  ui.panel.selected = id
}

// Abriu: volta para o topo da lista e foca a busca (no computador)
watch(
  () => ui.panel.open,
  async (open) => {
    if (!open) return
    search.value = ''
    creating.value = false
    await nextTick()
    if (!isCompact.value && !ui.panel.selected) searchInput.value?.focus()
  },
)

// ── Editar ──────────────────────────────────────────────────────────────────

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
  const picked = await pickLibraryImage({ title: 'Foto da categoria', confirmLabel: 'Usar foto' })
  const path = picked ? await shared.libraryImage(picked) : null
  if (!path || !ui.panel.open) return
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
  select(category.id)
}

// ── Onde é usada ────────────────────────────────────────────────────────────

const RECORD_LIMIT = 8
const expanded = ref(new Set<CategoryModuleId>())
watch(
  () => selected.value?.id,
  () => (expanded.value = new Set()),
)

function recordsShown(module: CategoryModuleId, records: CategoryRecord[]): CategoryRecord[] {
  return expanded.value.has(module) ? records : records.slice(0, RECORD_LIMIT)
}

function expand(module: CategoryModuleId) {
  expanded.value = new Set([...expanded.value, module])
}

const NOUNS: Record<CategoryModuleId, [string, string]> = {
  notes: ['nota', 'notas'],
  links: ['link', 'links'],
  tasks: ['tarefa', 'tarefas'],
  timer: ['sessão', 'sessões'],
  finance: ['gasto', 'gastos'],
}
const countLabel = (module: CategoryModuleId, count: number) => `${count} ${NOUNS[module][count === 1 ? 0 : 1]}`
const moduleIcon = (module: CategoryModuleId) => moduleById(module).icon
const RECORD_ICONS: Record<CategoryModuleId, string> = { notes: 'notes', links: 'link', tasks: 'task-open', timer: 'timer', finance: 'wallet' }

/** Abre o registro no módulo dele (pelas menções: o mesmo caminho que um clique numa menção). */
function openRecord(module: CategoryModuleId, record: CategoryRecord) {
  closeCategoriesPanel()
  if (module !== 'links') return openMentionPath(record.path)
  // Um link salvo é mostrado na lista dos Links (a menção abriria o site)
  const show = async () => {
    await navigateTo('/links')
    links.reveal(record.id)
  }
  if (modules.requireModule('links', () => void show())) void show()
}

async function useIn(module: CategoryModuleId) {
  if (!selected.value) return
  const id = selected.value.id
  const go = () => void shared.attach(module, id)
  if (modules.requireModule(module, go)) go()
}

async function remove() {
  if (!selected.value) return
  if (await requestCategoryRemoval(selected.value.id, null)) select(null)
}

async function merge() {
  if (!selected.value) return
  if (await requestCategoryMerge(selected.value.id)) select(null)
}

const created = computed(() => (selected.value ? new Date(selected.value.createdAt).toLocaleDateString('pt-BR') : ''))
</script>

<template>
  <UiModal :open="ui.panel.open" :width="920" label="Categorias" full-on-compact @close="closeCategoriesPanel">
    <div class="panel" :class="{ 'show-detail': isCompact && !!selected }" data-categories-panel>
      <aside class="side">
        <header class="side-head">
          <h2>Categorias</h2>
          <span class="total">{{ shared.state.categories.length }}</span>
          <button class="icon-btn close" aria-label="Fechar" @click="closeCategoriesPanel"><AppIcon name="x" :size="16" /></button>
        </header>
        <label class="search">
          <AppIcon name="search" :size="14" />
          <input ref="searchInput" v-model="search" placeholder="Buscar categoria…" spellcheck="false" aria-label="Buscar categoria" />
        </label>

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
          <div class="new-actions">
            <button type="button" class="btn btn-ghost btn-sm" @click="creating = false">Cancelar</button>
            <button type="submit" class="btn btn-primary btn-sm">Criar</button>
          </div>
          <p v-if="newError" class="error">{{ newError }}</p>
        </form>
        <button v-else class="new-btn" data-action="new-shared-category" @click="startCreate"><AppIcon name="plus" :size="14" /> Nova categoria</button>

        <div class="items" role="listbox" aria-label="Categorias">
          <button
            v-for="category in list"
            :key="category.id"
            class="item"
            :class="{ active: selected?.id === category.id }"
            role="option"
            :aria-selected="selected?.id === category.id"
            :data-category-id="category.id"
            @click="select(category.id)"
          >
            <CategoryAvatar :name="category.name" :color="category.color" :icon="category.icon" :image="category.image" :size="24" />
            <span class="item-text">
              <span class="item-name">{{ category.name }}</span>
              <span class="item-modules">
                <template v-if="summaryOf(category.id).modules.length">
                  <AppIcon v-for="module in summaryOf(category.id).modules" :key="module" :name="moduleIcon(module)" :size="12" :data-tip="shared.moduleLabel(module)" />
                </template>
                <span v-else class="muted">Sem uso</span>
              </span>
            </span>
            <span class="count">{{ summaryOf(category.id).total }}</span>
          </button>
          <p v-if="!shared.state.categories.length" class="empty">Nenhuma categoria ainda. Crie uma aqui ou nas listas de cada módulo.</p>
          <p v-else-if="!list.length" class="empty">Nada encontrado para “{{ search }}”.</p>
        </div>
      </aside>

      <section v-if="selected" class="detail" :aria-label="`Categoria ${selected.name}`">
        <header class="detail-head">
          <button v-if="isCompact" class="icon-btn" aria-label="Voltar para a lista" @click="select(null)"><AppIcon name="chevron-left" :size="18" /></button>
          <CategoryAvatar :name="form.name || selected.name" :color="form.color" :icon="form.icon" :image="form.image" :size="44" />
          <div class="title">
            <h3>{{ selected.name }}</h3>
            <span class="meta">Criada em {{ created }}</span>
          </div>
          <button v-if="!isCompact" class="icon-btn close" aria-label="Fechar" @click="closeCategoriesPanel"><AppIcon name="x" :size="16" /></button>
        </header>

        <div class="detail-body">
          <form class="edit" @submit.prevent="save">
            <label class="field-label" for="shared-cat-name">Nome</label>
            <div class="name-row">
              <input
                id="shared-cat-name"
                v-model="form.name"
                class="input"
                :maxlength="MAX_SHARED_NAME"
                spellcheck="false"
                data-field="category-name"
                @input="error = null"
              />
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
          <p v-if="!used.length" class="empty">Ainda não está em nenhum módulo.</p>
          <section v-for="item in used" :key="item.module" class="usage" :data-usage-module="item.module">
            <div class="usage-head">
              <AppIcon :name="moduleIcon(item.module)" :size="15" />
              <strong>{{ item.label }}</strong>
              <span class="muted">{{ item.records.length ? countLabel(item.module, item.records.length) : 'na lista, sem registros' }}</span>
            </div>
            <ul v-if="item.records.length" class="records">
              <li v-for="record in recordsShown(item.module, item.records)" :key="record.id">
                <button class="record" :class="{ done: record.done }" :data-record="record.id" @click="openRecord(item.module, record)">
                  <AppIcon :name="RECORD_ICONS[item.module]" :size="14" class="record-icon" />
                  <span class="record-title">{{ record.title || 'Sem título' }}</span>
                  <span v-if="record.detail" class="record-detail">{{ record.detail }}</span>
                  <AppIcon name="arrow-right" :size="13" class="record-go" />
                </button>
              </li>
            </ul>
            <button v-if="item.records.length > RECORD_LIMIT && !expanded.has(item.module)" class="more" @click="expand(item.module)">
              Mostrar todos ({{ item.records.length }})
            </button>
          </section>

          <div v-if="unused.length" class="use-in">
            <span class="muted">Usar também em:</span>
            <button v-for="item in unused" :key="item.module" class="chip" :data-use-in="item.module" @click="useIn(item.module)">
              <AppIcon :name="moduleIcon(item.module)" :size="13" /> {{ item.label }}
            </button>
          </div>

          <footer class="detail-actions">
            <button v-if="shared.state.categories.length > 1" class="btn btn-sm" data-action="merge-category" @click="merge">Juntar com outra…</button>
            <button class="btn btn-danger-ghost btn-sm" data-action="delete-shared-category" @click="remove"><AppIcon name="trash" :size="14" /> Excluir…</button>
          </footer>
        </div>
      </section>
      <section v-else class="detail placeholder">
        <button v-if="!isCompact" class="icon-btn close floating" aria-label="Fechar" @click="closeCategoriesPanel"><AppIcon name="x" :size="16" /></button>
        <AppIcon name="tag" :size="34" />
        <p>Escolha uma categoria para ver onde ela é usada, editar, juntar com outra ou excluir.</p>
        <p class="muted">As categorias valem para o app inteiro: Notas, Links, Tarefas, Timer e Finanças.</p>
      </section>
    </div>
  </UiModal>
</template>

<style scoped>
.panel {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  height: min(640px, calc(100vh - 120px));
  height: min(640px, calc(100dvh - 120px));
}
.side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
}
.side-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 12px 10px 16px;
}
.side-head h2 {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.side-head .close {
  display: none;
  margin-left: auto;
}
.total,
.count {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 11.5px;
  font-weight: 650;
  line-height: 18px;
  text-align: center;
}
.search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  margin: 0 12px;
  padding: 0 10px;
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
  font-size: 13px;
}
.new-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 12px 4px;
  padding: 6px 8px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-3);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.new-btn:hover {
  color: var(--primary-text);
  border-color: var(--primary);
}
.new-form {
  margin: 8px 12px 4px;
}
.new-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}
.items {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 8px 12px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
html[data-touch] .item {
  min-height: 52px;
}
.item:hover {
  background: var(--hover);
}
.item.active {
  background: var(--surface);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
}
.item-text {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
  font-weight: 600;
}
.item-modules {
  display: flex;
  gap: 5px;
  color: var(--text-3);
  font-size: 11.5px;
}
.muted {
  color: var(--text-3);
}
.empty {
  padding: 12px 10px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-3);
}
.detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 16px 12px 22px;
  border-bottom: 1px solid var(--border);
}
.title {
  flex: 1;
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
.detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 22px 20px;
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
.error {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--danger);
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
  margin: 22px 0 8px;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-3);
}
.usage {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
}
.usage-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
}
.usage-head .muted {
  font-size: 12.5px;
}
.records {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 8px 0 0;
  padding: 0;
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
.record-go {
  flex: none;
  color: var(--text-3);
  opacity: 0;
}
.record:hover .record-go,
.record:focus-visible .record-go {
  opacity: 1;
}
/* Pouco espaço (celular, Fold): a data e o valor vão para a linha de baixo, inteiros */
@container (max-width: 460px) {
  .record {
    flex-wrap: wrap;
    row-gap: 1px;
    padding-block: 6px;
  }
  .record-detail {
    order: 3;
    flex-basis: 100%;
    max-width: none;
    padding-left: 22px;
  }
  .record-go {
    display: none;
  }
}
.more {
  margin: 4px 0 0 8px;
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
  margin-top: 4px;
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
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.placeholder {
  position: relative;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
  color: var(--text-2);
  font-size: 13.5px;
  line-height: 1.55;
}
.placeholder :deep(.app-icon) {
  color: var(--primary-text);
}
.floating {
  position: absolute;
  top: 14px;
  right: 14px;
}
.placeholder p {
  max-width: 360px;
}

/* ── Celular: a lista ou a categoria ── */
html[data-layout='compact'] .panel {
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
}
html[data-layout='compact'] .side-head .close {
  display: grid;
}
html[data-layout='compact'] .side {
  border-right: none;
}
html[data-layout='compact'] .panel .detail,
html[data-layout='compact'] .panel.show-detail .side {
  display: none;
}
html[data-layout='compact'] .panel.show-detail .detail {
  display: flex;
}
html[data-layout='compact'] .detail-head {
  padding-left: 10px;
}
html[data-layout='compact'] .detail-body {
  padding: 14px 16px 20px;
}
</style>
