<script setup lang="ts">
/**
 * Painel lateral para criar/editar uma tarefa.
 * No modo edição, cada alteração é salva na hora (sem botão "Salvar").
 * A descrição usa o mesmo editor das notas (MarkdownEditor): negrito, listas,
 * checklists, código, imagens… — salva como Markdown no tasks.json ("notes").
 * Digitar "@" no título ou na descrição (ou usar "Mencionar") menciona um item de
 * qualquer módulo — nota, mapa, tarefa, link ou registro do Timer: ele vai para a lista
 * "Menções" da tarefa.
 * Clicar fora do painel o fecha (pages/tasks.vue).
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useMentionTrigger, type MentionPickerControls } from '~/composables/useMentionTrigger'
import { showToast } from '~/composables/useToasts'
import { addDays, formatDateBR, formatLongDate, formatShortDate, relativeDayLabel, toISODate, type ISODate } from '~/lib/dates'
import type { MentionHost } from '~/lib/editor/host'
import { DESCRIPTION_DIR } from '~/lib/tasks/description'
import { refKey, type MentionRef } from '~/lib/mentions/refs'
import { taskMentionPath } from '~/lib/notes/mention-links'
import { describeRecurrence, type Recurrence, type RecurrenceDraft } from '~/lib/tasks/recurrence'
import { describeMention, mentionRevision, openMentionPath, refFromTarget, savedLinkIcon, searchMentions } from '~/stores/mentions'
import { useTasksStore, withMention } from '~/stores/tasks'

const tasks = useTasksStore()
const today = tasks.today
const panel = ref<HTMLElement>()
const titleInput = ref<HTMLTextAreaElement>()
const mentionButton = ref<HTMLButtonElement>()
const picker = ref<MentionPickerControls>()
/** Lista aberta pelo botão "Mencionar". */
const pickerFromButton = ref(false)
const categoryDialogOpen = ref(false)
const shake = ref(false)

const DEFAULT_RULE: RecurrenceDraft = { interval: 1, unit: 'week', basis: 'schedule' }
const toDraft = (rule: Recurrence): RecurrenceDraft => ({ interval: rule.interval, unit: rule.unit, basis: rule.basis })

const mode = computed(() => tasks.state.drawer?.mode ?? null)
const task = computed(() => (tasks.state.drawer?.mode === 'edit' ? (tasks.findTask(tasks.state.drawer.id) ?? null) : null))
const open = computed(() => mode.value === 'create' || !!task.value)

const draft = reactive({
  notes: '',
  mentions: [] as MentionRef[],
  categoryId: null as string | null,
  date: null as ISODate | null,
  recurring: false,
  rule: { ...DEFAULT_RULE },
})
const titleText = ref('')
const lastRule = ref<RecurrenceDraft>({ ...DEFAULT_RULE })
/** Seção "Configurações avançadas" (data e recorrência). Fica como você deixou durante o uso. */
const advancedOpen = ref(false)
/** Cada "Nova tarefa" é um documento novo no editor da descrição (desfazer separado). */
let creations = 0
const creation = ref(0)

function autosize() {
  const el = titleInput.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// Cada abertura do painel cria um objeto novo em `drawer`: é isso que reinicia os campos.
watch(
  () => tasks.state.drawer,
  async (drawer, previous) => {
    if (drawer?.mode === 'create') {
      creation.value = ++creations
      const selection = tasks.state.selection
      const { prefill } = drawer
      Object.assign(draft, {
        notes: '',
        mentions: prefill.mentions ?? [],
        categoryId:
          prefill.categoryId !== undefined ? prefill.categoryId : selection.startsWith('cat:') && selection !== 'cat:none' ? selection.slice(4) : null,
        date: prefill.date ?? (selection === 'scheduled' ? addDays(today.value, 1) : null),
        recurring: selection === 'scheduled',
        rule: { ...DEFAULT_RULE },
      })
      titleText.value = prefill.title ?? ''
      if (draft.recurring) advancedOpen.value = true
      await nextTick()
      autosize()
      const input = titleInput.value
      input?.focus()
      input?.setSelectionRange(input.value.length, input.value.length)
    } else if (drawer?.mode === 'edit' && task.value && !(previous?.mode === 'edit' && previous.id === drawer.id)) {
      titleText.value = task.value.title
      if (task.value.recurrence) lastRule.value = toDraft(task.value.recurrence)
      await nextTick()
      autosize()
    }
  },
  { immediate: true },
)

// Campos unificados: no modo edição vão direto para o store; na criação, para o rascunho.
const notes = computed({
  get: () => (task.value ? task.value.notes : draft.notes),
  set: (value: string) => (task.value ? tasks.updateTask(task.value.id, { notes: value }) : (draft.notes = value)),
})
const mentions = computed({
  get: () => (task.value ? task.value.mentions : draft.mentions),
  set: (value: MentionRef[]) => (task.value ? tasks.updateTask(task.value.id, { mentions: value }) : (draft.mentions = value)),
})
const categoryId = computed({
  get: () => (task.value ? task.value.categoryId : draft.categoryId),
  set: (value: string | null) => (task.value ? tasks.updateTask(task.value.id, { categoryId: value }) : (draft.categoryId = value)),
})
const date = computed(() => (task.value ? task.value.date : draft.date))
const recurring = computed(() => (task.value ? !!task.value.recurrence : draft.recurring))
const rule = computed<RecurrenceDraft>(() => {
  if (task.value?.recurrence) return toDraft(task.value.recurrence)
  return task.value ? lastRule.value : draft.rule
})

function onTitleInput() {
  autosize()
  titleMention.onInput()
  if (task.value && titleText.value.trim()) tasks.updateTask(task.value.id, { title: titleText.value.replace(/\s*\n\s*/g, ' ') })
}

// ── Menções ─────────────────────────────────────────────────────────────────

/** Caminho de menção da própria tarefa (ela não aparece na lista para mencionar). */
const ownPath = computed(() => (task.value ? taskMentionPath(task.value.id) : null))

function addMention(mention: MentionRef) {
  mentions.value = withMention(mentions.value, mention)
}

function removeMention(mention: MentionRef) {
  mentions.value = mentions.value.filter((item) => refKey(item) !== refKey(mention))
}

const titleMention = useMentionTrigger({
  getText: () => titleText.value,
  setText: (value) => {
    titleText.value = value
    onTitleInput()
  },
  element: () => titleInput.value,
  onPick: addMention,
})
const titleQuery = titleMention.query

/**
 * Descrição: o "@" do editor lista itens de todos os módulos. O escolhido vira o título
 * no texto e vai para "Menções" — como no título da tarefa.
 */
const descriptionMentions: MentionHost = {
  search: (query) => searchMentions(query, { exclude: mentions.value, exceptPath: ownPath.value }),
  choose: (target) => {
    const ref = refFromTarget(target)
    if (ref) addMention(ref)
    return target.title
  },
  describe: describeMention,
  open: openMentionPath,
  revision: () => mentionRevision.value,
  linkIcon: savedLinkIcon,
}
/** Documento do editor da descrição: um por tarefa (o desfazer de cada uma fica guardado). */
const descriptionKey = computed(() => (task.value ? `task:${task.value.id}` : `task-new:${creation.value}`))
/** Pasta "da descrição" no workspace: base dos caminhos das imagens coladas nela. */
const descriptionBase = DESCRIPTION_DIR

function onTitleKeydown(event: KeyboardEvent) {
  if (titleMention.onKeydown(event, picker.value)) return
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
  event.preventDefault()
  if (mode.value === 'create') create()
  else (event.target as HTMLTextAreaElement).blur()
}

function onTitleBlur() {
  if (task.value && !titleText.value.trim()) titleText.value = task.value.title
}

function setDate(value: ISODate | null) {
  if (task.value) tasks.setTaskDate(task.value.id, value)
  else draft.date = value
}

function setRecurring(on: boolean) {
  if (task.value) {
    tasks.setRecurrence(task.value.id, on ? lastRule.value : null)
  } else {
    draft.recurring = on
    if (on && !draft.date) draft.date = today.value
  }
}

function setRule(value: RecurrenceDraft) {
  lastRule.value = value
  if (task.value) tasks.setRecurrence(task.value.id, value)
  else draft.rule = value
}

/** Resumo mostrado com a seção fechada, ex.: "Amanhã · A cada semana". */
const advancedSummary = computed(() => {
  const parts: string[] = []
  if (date.value) parts.push(relativeDayLabel(date.value, today.value))
  if (recurring.value) parts.push(describeRecurrence(rule.value))
  return parts.join(' · ')
})

const quickDates = computed(() => [
  { label: 'Hoje', value: today.value },
  { label: 'Amanhã', value: addDays(today.value, 1) },
  { label: 'Em 1 semana', value: addDays(today.value, 7) },
])

function create() {
  const title = titleText.value.replace(/\s*\n\s*/g, ' ').trim()
  if (!title) {
    shake.value = true
    setTimeout(() => (shake.value = false), 400)
    titleInput.value?.focus()
    return
  }
  const fromQuickAdd = tasks.state.drawer?.mode === 'create' && tasks.state.drawer.fromQuickAdd
  const created = tasks.addTask({
    title,
    notes: draft.notes,
    categoryId: draft.categoryId,
    date: draft.date,
    recurrence: draft.recurring ? draft.rule : null,
    mentions: draft.mentions,
  })
  if (fromQuickAdd) {
    // o texto da barra (e as menções feitas nela) viraram esta tarefa
    tasks.state.quickAddText = ''
    tasks.state.quickAddMentions = []
  }
  tasks.closeDrawer()
  const scheduled = created.recurrence && created.date && created.date > today.value
  showToast({
    message: scheduled ? `Tarefa agendada: aparece em ${formatShortDate(created.date!, today.value)}` : 'Tarefa criada',
    tone: 'success',
    icon: scheduled ? 'clock' : 'check',
  })
}

function completeTask() {
  if (!task.value) return
  tasks.complete(task.value.id)
  tasks.closeDrawer()
}

const createdOn = computed(() => (task.value ? formatDateBR(toISODate(new Date(task.value.createdAt))) : ''))
const timesDone = computed(() => task.value?.history.length ?? 0)

defineExpose({
  /** O elemento está dentro do painel? */
  contains: (node: Node | null) => !!node && !!panel.value?.contains(node),
  /** "Nova tarefa" já com algo escrito: clicar fora não descarta o rascunho. */
  hasDraft: () => mode.value === 'create' && !!(titleText.value.trim() || draft.notes.trim() || draft.mentions.length),
})
</script>

<template>
  <Transition name="drawer">
    <aside v-if="open" ref="panel" class="drawer" :aria-label="mode === 'create' ? 'Nova tarefa' : 'Editar tarefa'">
      <header class="drawer-head">
        <span class="drawer-kicker">
          <AppIcon :name="mode === 'create' ? 'plus' : recurring ? 'repeat' : 'tasks'" :size="15" />
          {{ mode === 'create' ? 'Nova tarefa' : recurring ? 'Tarefa recorrente' : task?.done ? 'Tarefa concluída' : 'Tarefa' }}
        </span>
        <button class="icon-btn" aria-label="Fechar painel" @click="tasks.closeDrawer()"><AppIcon name="x" /></button>
      </header>

      <div class="drawer-body">
        <textarea
          ref="titleInput"
          v-model="titleText"
          class="title-input"
          :class="{ shake }"
          rows="1"
          placeholder="O que precisa ser feito?"
          spellcheck="true"
          @input="onTitleInput"
          @blur="onTitleBlur"
          @keydown="onTitleKeydown"
        />
        <div class="notes-input" data-field="task-description">
          <MarkdownEditor
            v-model="notes"
            :doc-key="descriptionKey"
            :asset-base="descriptionBase"
            :mentions="descriptionMentions"
            placeholder="Detalhes, links, observações… (opcional — @ menciona notas, tarefas, links, registros…)"
            toolbar-overflow
          />
        </div>

        <div class="field mentions-field">
          <span v-if="mentions.length" class="field-label">Menções</span>
          <div class="mention-chips">
            <MentionChip v-for="item in mentions" :key="refKey(item)" :mention="item" removable @remove="removeMention(item)" />
            <button ref="mentionButton" type="button" class="cat-chip add" @click="pickerFromButton = !pickerFromButton">
              <AppIcon name="at" :size="12" /> Mencionar
            </button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">Categoria</span>
          <div class="cat-chips">
            <button type="button" class="cat-chip" :class="{ active: !categoryId }" @click="categoryId = null">
              <CategoryDot :color="null" :size="8" /> Sem categoria
            </button>
            <button
              v-for="category in tasks.state.categories"
              :key="category.id"
              type="button"
              class="cat-chip"
              :class="{ active: categoryId === category.id }"
              :style="{ '--c': `var(--cat-${category.color})` }"
              @click="categoryId = category.id"
            >
              <CategoryDot :color="category.color" :size="8" /> {{ category.name }}
            </button>
            <button type="button" class="cat-chip add" @click="categoryDialogOpen = true"><AppIcon name="plus" :size="12" /> Nova</button>
          </div>
        </div>

        <section class="advanced" :class="{ open: advancedOpen }">
          <button type="button" class="advanced-head" :aria-expanded="advancedOpen" @click="advancedOpen = !advancedOpen">
            <AppIcon name="chevron-right" :size="15" class="advanced-chevron" />
            <span class="advanced-title">Configurações avançadas</span>
            <span v-if="!advancedOpen" class="advanced-summary">{{ advancedSummary || 'Data e recorrência' }}</span>
          </button>
          <Transition name="expand">
            <div v-if="advancedOpen" class="advanced-body">
              <div class="field">
                <span class="field-label">{{ recurring ? 'Próxima ocorrência' : 'Data' }}</span>
                <div class="date-row">
                  <input
                    type="date"
                    class="input date-input"
                    :value="date ?? ''"
                    aria-label="Data"
                    @change="setDate(($event.target as HTMLInputElement).value || null)"
                  />
                  <button
                    v-for="quick in quickDates"
                    :key="quick.label"
                    type="button"
                    class="btn btn-sm"
                    :class="{ 'btn-primary': date === quick.value }"
                    @click="setDate(quick.value)"
                  >
                    {{ quick.label }}
                  </button>
                  <button v-if="date && !recurring" type="button" class="btn btn-sm btn-ghost" @click="setDate(null)">Limpar</button>
                </div>
                <p v-if="date" class="field-hint">
                  <AppIcon name="calendar" :size="13" /> {{ formatLongDate(date) }} de {{ date.slice(0, 4) }}
                  <template v-if="recurring && date > today"> — fica em “Agendadas” até lá</template>
                </p>
              </div>

              <RecurrenceEditor :enabled="recurring" :rule="rule" :date="date" :today="today" @update:enabled="setRecurring" @update:rule="setRule" />
            </div>
          </Transition>
        </section>

        <p v-if="task" class="drawer-meta">
          Criada em {{ createdOn }}<template v-if="timesDone"> · concluída {{ timesDone }} {{ timesDone === 1 ? 'vez' : 'vezes' }}</template>
        </p>
      </div>

      <footer class="drawer-foot">
        <template v-if="mode === 'create'">
          <button class="btn btn-ghost" @click="tasks.closeDrawer()">Cancelar</button>
          <span class="spacer" />
          <button class="btn btn-primary" @click="create"><AppIcon name="plus" :size="16" /> Criar tarefa</button>
        </template>
        <template v-else-if="task">
          <button class="btn btn-danger-ghost" @click="tasks.deleteTask(task.id)"><AppIcon name="trash" :size="15" /> Excluir</button>
          <span class="spacer" />
          <button v-if="task.recurrence" class="btn" @click="tasks.skip(task.id)"><AppIcon name="skip" :size="15" /> Pular</button>
          <button v-if="task.done" class="btn" @click="tasks.reopen(task.id)"><AppIcon name="undo" :size="15" /> Reabrir</button>
          <button v-else class="btn btn-primary" @click="completeTask"><AppIcon name="check" :size="16" /> Concluir tarefa</button>
        </template>
      </footer>
    </aside>
  </Transition>
  <CategoryDialog :open="categoryDialogOpen" @close="categoryDialogOpen = false" @saved="(category) => (categoryId = category.id)" />
  <MentionPicker
    v-if="open && titleQuery !== null && titleInput"
    ref="picker"
    :anchor="titleInput"
    :query="titleQuery"
    :exclude="mentions"
    :except-path="ownPath"
    @pick="titleMention.pick"
    @close="titleMention.close()"
  />
  <MentionPicker
    v-else-if="open && pickerFromButton && mentionButton"
    :anchor="mentionButton"
    with-search
    :exclude="mentions"
    :except-path="ownPath"
    @pick="(item) => ((pickerFromButton = false), addMention(item))"
    @close="pickerFromButton = false"
  />
</template>

<style scoped>
.mention-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.mentions-field {
  margin-top: -6px;
}
.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: min(420px, 100%);
  border-left: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
}
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 12px 0 20px;
  border-bottom: 1px solid var(--border);
}
.drawer-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--primary-text);
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px 20px 24px;
}
.drawer-body > * {
  flex-shrink: 0;
}
.title-input {
  width: 100%;
  min-height: 34px;
  padding: 2px 0;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  background: transparent;
  color: var(--text);
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 650;
  line-height: 1.35;
}
.title-input::placeholder {
  color: var(--text-3);
}
.title-input.shake {
  animation: shake 360ms var(--ease-out);
}
.notes-input {
  width: 100%;
  margin-top: -8px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
  /* O editor das notas, em tamanho de campo: cresce com o texto (o painel rola) */
  --editor-padding-x: 12px;
  --editor-padding-top: 9px;
  --editor-padding-bottom: 10px;
  --editor-font-size: 13.5px;
}
.notes-input:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}
.notes-input :deep(.markdown-editor),
.notes-input :deep(.editor-parent),
.notes-input :deep(.cm-editor) {
  height: auto;
}
.notes-input :deep(.cm-editor) {
  min-height: 96px;
}
.notes-input :deep(.cm-scroller) {
  min-height: 96px;
  overflow-y: visible;
}
.cat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition: all var(--t-fast);
}
.cat-chip:hover {
  border-color: var(--border-strong);
  color: var(--text);
}
.cat-chip.active {
  border-color: var(--c, var(--primary));
  background: color-mix(in srgb, var(--c, var(--primary)) 14%, var(--surface));
  color: var(--text);
}
.cat-chip.add {
  border-style: dashed;
  color: var(--text-3);
}
.date-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.date-input {
  width: 160px;
  min-height: 32px;
  padding: 4px 10px;
}
.field-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--text-3);
}
.advanced {
  border-top: 1px solid var(--border);
  padding-top: 6px;
}
.advanced-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 4px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}
.advanced-head:hover {
  background: var(--hover);
  color: var(--text);
}
.advanced-chevron {
  transition: transform var(--t-med) var(--ease-out);
}
.advanced.open .advanced-chevron {
  transform: rotate(90deg);
}
.advanced-summary {
  margin-left: auto;
  overflow: hidden;
  color: var(--text-3);
  font-weight: 500;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.advanced-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 10px 2px 2px;
}
.expand-enter-active,
.expand-leave-active {
  transition: opacity 200ms var(--ease-out), transform 240ms var(--ease-out);
}
.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.drawer-meta {
  font-size: 12px;
  color: var(--text-3);
}
.drawer-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}
.spacer {
  flex: 1;
}

.drawer-enter-active {
  transition: transform 320ms var(--ease-out), opacity 220ms var(--ease-out);
}
.drawer-leave-active {
  transition: transform 220ms ease, opacity 180ms ease;
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(40px);
  opacity: 0;
}
@keyframes shake {
  20%,
  60% {
    transform: translateX(-5px);
  }
  40%,
  80% {
    transform: translateX(5px);
  }
}
</style>
