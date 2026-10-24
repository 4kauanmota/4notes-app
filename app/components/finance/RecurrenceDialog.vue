<script setup lang="ts">
/**
 * Recorrência das Finanças (1.7.1): conta, assinatura ou salário que se repete.
 *
 * Criar: gasto ou entrada, descrição ("#" escolhe a categoria), valor, frequência, a data
 * do primeiro pagamento e até quando (até eu encerrar ou até uma data).
 * Editar: mudar o valor, a frequência ou a data da próxima pergunta se vale só para a
 * próxima ou também para as futuras (as já pagas nunca mudam); o histórico mostra cada
 * ocorrência com a situação e o dia do pagamento. "Encerrar" para de gerar e mantém
 * tudo; "Excluir" tira a recorrência (as pagas ficam no histórico).
 * Abre por finance.state.editingRecurrence ('new:expense', 'new:income' ou o id).
 */
import { computed, nextTick, ref, watch } from 'vue'
import { choiceDialog } from '~/composables/useDialog'
import { addDays, formatDateBR, type ISODate } from '~/lib/dates'
import { formatAmountInput, formatMoney, parseAmount } from '~/lib/finance/format'
import { entryState, MAX_DESCRIPTION, stateLabel, type EntryKind } from '~/lib/finance/model'
import { currentVersion, describeSchedule, FREQUENCIES, occurrencesBetween, type Frequency } from '~/lib/finance/recurrence'
import { useFinanceStore } from '~/stores/finance'

const finance = useFinanceStore()
const today = finance.today

const target = computed(() => finance.state.editingRecurrence)
const creating = computed(() => !!target.value?.startsWith('new:'))
const recurrence = computed(() => (target.value && !creating.value ? (finance.findRecurrence(target.value) ?? null) : null))
const open = computed(() => creating.value || !!recurrence.value)

const kind = ref<EntryKind>('expense')
const description = ref('')
const amountText = ref('')
const categoryId = ref<string | null>(null)
const frequency = ref<Frequency>('monthly')
const date = ref<ISODate>(today.value)
const endMode = ref<'never' | 'date'>('never')
const endDate = ref('')
const remind = ref(false)
const notes = ref('')
const pastAsDone = ref(true)
const error = ref<string | null>(null)
const showAll = ref(false)
const descriptionInput = ref<{ focus: () => void }>()

const income = computed(() => kind.value === 'income')
const next = computed(() => (recurrence.value ? finance.nextOccurrence(recurrence.value) : null))
const version = computed(() => (recurrence.value ? currentVersion(recurrence.value, today.value) : null))
const ended = computed(() => !!recurrence.value?.endDate && recurrence.value.endDate < today.value)
const KINDS = [
  { value: 'expense' as const, label: 'Gasto', icon: 'money-out' },
  { value: 'income' as const, label: 'Entrada', icon: 'money-in' },
]
const ENDS = [
  { value: 'never' as const, label: 'Até eu remover' },
  { value: 'date' as const, label: 'Até uma data' },
]

watch(
  () => target.value,
  async () => {
    error.value = null
    showAll.value = false
    if (creating.value) {
      kind.value = target.value === 'new:income' ? 'income' : 'expense'
      description.value = ''
      amountText.value = ''
      categoryId.value = null
      frequency.value = 'monthly'
      date.value = today.value
      endMode.value = 'never'
      endDate.value = ''
      remind.value = kind.value === 'expense'
      notes.value = ''
      pastAsDone.value = true
    } else if (recurrence.value && version.value) {
      const current = recurrence.value
      kind.value = current.kind
      description.value = current.description
      amountText.value = formatAmountInput(next.value?.entry?.amount ?? next.value?.amount ?? version.value.amount)
      categoryId.value = current.categoryId && finance.categoryById.value.has(current.categoryId) ? current.categoryId : null
      frequency.value = version.value.frequency
      date.value = next.value?.entry?.date ?? next.value?.occurrence ?? today.value
      endMode.value = current.endDate ? 'date' : 'never'
      endDate.value = current.endDate ?? ''
      remind.value = current.remind
      notes.value = current.notes
    } else return
    await nextTick()
    descriptionInput.value?.focus()
  },
  { immediate: true },
)

const parsed = computed(() => parseAmount(amountText.value))

/** Começando no passado: quantas já passaram (podem entrar como pagas). */
const pastCount = computed(() => {
  if (!creating.value || !date.value || date.value >= today.value) return 0
  const draft = { versions: [{ from: date.value, amount: 1, frequency: frequency.value, anchor: date.value }], endDate: endMode.value === 'date' && endDate.value ? endDate.value : null }
  return occurrencesBetween(draft as never, date.value, addDays(today.value, -1), 1000).length
})

/** Cada ocorrência que já virou lançamento (a mais recente primeiro). */
const history = computed(() => {
  const id = recurrence.value?.id
  if (!id) return []
  return finance.state.expenses.filter((entry) => entry.recurrenceId === id).sort((a, b) => (b.occurrence ?? b.date).localeCompare(a.occurrence ?? a.date))
})
const shownHistory = computed(() => (showAll.value ? history.value : history.value.slice(0, 6)))
const paidTotal = computed(() => history.value.filter((entry) => entry.status === 'done').reduce((sum, entry) => sum + entry.amount, 0))

function close() {
  finance.openRecurrence(null)
}

function validate(): boolean {
  const hashed = finance.takeHashCategory(description.value)
  if (hashed.categoryId) {
    description.value = hashed.text
    categoryId.value = hashed.categoryId
  }
  if (parsed.value === null) error.value = 'Valor inválido. Exemplos: 52,30 ou 1.234,56.'
  else if (!description.value.trim()) error.value = income.value ? 'Dê um nome (ex.: Salário).' : 'Dê um nome (ex.: Aluguel, Netflix).'
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) error.value = creating.value ? 'Escolha a data da primeira.' : 'Escolha a data da próxima.'
  else if (endMode.value === 'date' && (!endDate.value || endDate.value < (creating.value ? date.value : (recurrence.value?.versions[0]?.anchor ?? date.value))))
    error.value = 'Escolha a data final (depois da primeira).'
  else error.value = null
  return !error.value
}

async function save() {
  if (!validate()) return
  const amount = parsed.value!
  const end = endMode.value === 'date' ? endDate.value : null
  if (creating.value) {
    const created = finance.addRecurrence({
      kind: kind.value,
      description: description.value,
      amount,
      categoryId: categoryId.value,
      notes: notes.value,
      remind: !income.value && remind.value,
      frequency: frequency.value,
      firstDate: date.value,
      endDate: end,
      pastAsDone: pastCount.value > 0 && pastAsDone.value,
    })
    if (created) close()
    return
  }
  const current = recurrence.value
  if (!current || !version.value) return
  const nextAmount = next.value?.entry?.amount ?? next.value?.amount ?? version.value.amount
  const nextDate = next.value?.entry?.date ?? next.value?.occurrence ?? null
  const scheduleChanged = amount !== nextAmount || frequency.value !== version.value.frequency || (nextDate !== null && date.value !== nextDate)
  let scope: 'next' | 'future' = 'future'
  if (scheduleChanged && next.value) {
    const choice = await choiceDialog({
      title: 'Aplicar a mudança a quais?',
      message: `A próxima é em ${formatDateBR(nextDate ?? next.value.occurrence)}. As já pagas não mudam.`,
      icon: 'repeat',
      buttons: [
        { id: 'cancel', label: 'Cancelar', variant: 'ghost' },
        { id: 'next', label: 'Só a próxima', variant: 'default' },
        { id: 'future', label: 'A próxima e as futuras', variant: 'primary' },
      ],
      defaultButton: 'future',
    })
    if (choice !== 'next' && choice !== 'future') return
    scope = choice
  }
  const ok = finance.updateRecurrence(
    current.id,
    {
      description: description.value,
      categoryId: categoryId.value,
      notes: notes.value,
      remind: remind.value,
      endDate: end,
      ...(scheduleChanged
        ? {
            amount: amount !== nextAmount ? amount : undefined,
            frequency: frequency.value !== version.value.frequency ? frequency.value : undefined,
            nextDate: nextDate !== null && date.value !== nextDate ? date.value : undefined,
          }
        : {}),
    },
    scope,
  )
  if (ok) close()
  else error.value = 'Não foi possível salvar. Confira as datas.'
}

function stop() {
  const current = recurrence.value
  if (current && finance.stopRecurrence(current.id)) close()
}

async function remove() {
  const current = recurrence.value
  if (current && (await finance.requestDeleteRecurrence(current.id))) close()
}

function openEntry(id: string) {
  close()
  finance.openExpense(id)
}
</script>

<template>
  <UiModal :open="open" :width="520" :label="creating ? 'Nova recorrência' : 'Recorrência'" @close="close">
    <form v-if="open" class="recurrence-dialog" :class="{ income }" data-recurrence-dialog @submit.prevent="save">
      <header class="head">
        <h2>{{ creating ? (income ? 'Nova entrada recorrente' : 'Nova conta recorrente') : income ? 'Entrada recorrente' : 'Conta recorrente' }}</h2>
        <UiSegmented v-if="creating" v-model="kind" :options="KINDS" size="sm" aria-label="Gasto ou entrada" />
        <span v-else-if="ended" class="ended">Encerrada em {{ formatDateBR(recurrence!.endDate!) }}</span>
      </header>
      <p v-if="recurrence && version" class="summary">
        {{ describeSchedule(version) }}
        <template v-if="next"> · próxima em <strong>{{ formatDateBR(next.entry?.date ?? next.occurrence) }}</strong> ({{ formatMoney(next.entry?.amount ?? next.amount) }})</template>
        <template v-else> · nenhuma próxima</template>
      </p>

      <label class="field-label" for="recurrence-description">Descrição</label>
      <FinanceTextInput
        ref="descriptionInput"
        v-model="description"
        input-id="recurrence-description"
        :maxlength="MAX_DESCRIPTION"
        :placeholder="income ? 'Ex.: Salário  (# categoria)' : 'Ex.: Aluguel, Netflix, Academia  (# categoria)'"
        label="Descrição"
        field="recurrence-description"
        @category="(id) => (categoryId = id)"
        @input="error = null"
      />

      <div class="grid">
        <div>
          <label class="field-label gap" for="recurrence-amount">{{ creating ? 'Valor de cada uma' : 'Valor' }}</label>
          <div class="amount-box">
            <span class="currency">R$</span>
            <input id="recurrence-amount" v-model="amountText" class="amount-input" inputmode="decimal" autocomplete="off" data-field="recurrence-amount" @input="error = null" />
          </div>
        </div>
        <div>
          <label class="field-label gap" for="recurrence-frequency">Frequência</label>
          <select id="recurrence-frequency" v-model="frequency" class="select" data-field="recurrence-frequency">
            <option v-for="item in FREQUENCIES" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>
        <div>
          <label class="field-label gap" for="recurrence-date">{{ creating ? (income ? 'Primeiro recebimento' : 'Primeiro pagamento') : 'Próxima' }}</label>
          <input id="recurrence-date" v-model="date" class="input" type="date" data-field="recurrence-date" />
        </div>
      </div>

      <span class="field-label gap">Termina</span>
      <div class="end-row">
        <UiSegmented v-model="endMode" :options="ENDS" size="sm" aria-label="Quando termina" data-field="recurrence-end-mode" />
        <input v-if="endMode === 'date'" v-model="endDate" class="input end-date" type="date" aria-label="Última data" data-field="recurrence-end-date" />
      </div>
      <p v-if="endMode === 'date'" class="hint">Nenhuma ocorrência depois dessa data.</p>

      <span class="field-label gap">Categoria</span>
      <FinanceCategoryPicker v-model="categoryId" compact />

      <label v-if="!income" class="option gap">
        <input v-model="remind" type="checkbox" data-field="recurrence-remind" />
        <AppIcon name="bell" :size="14" /> Me lembre de pagar
        <span class="option-hint">aviso no dia de cada uma</span>
      </label>
      <p class="hint">{{ income ? 'Cada recebimento fica “a receber” até você confirmar.' : 'Cada ocorrência fica pendente até você confirmar o pagamento.' }}</p>
      <label v-if="pastCount" class="option">
        <input v-model="pastAsDone" type="checkbox" data-field="recurrence-past" />
        {{ pastCount === 1 ? 'A que já passou' : `As ${pastCount} que já passaram` }} {{ income ? (pastCount === 1 ? 'já foi recebida' : 'já foram recebidas') : pastCount === 1 ? 'já foi paga' : 'já foram pagas' }}
      </label>

      <div class="gap">
        <FinanceNotesField v-model="notes" :doc-key="`finance-recurrence:${target}`" />
      </div>

      <!-- Histórico das ocorrências -->
      <section v-if="recurrence" class="history" data-recurrence-history>
        <h3>
          Histórico
          <span v-if="paidTotal" class="muted">· {{ formatMoney(paidTotal) }} {{ income ? 'recebidos' : 'pagos' }}</span>
        </h3>
        <p v-if="!history.length" class="hint">Nenhuma ocorrência ainda.</p>
        <ul v-else class="occurrences">
          <li v-for="entry in shownHistory" :key="entry.id">
            <button type="button" class="occurrence" :data-occurrence="entry.occurrence" @click="openEntry(entry.id)">
              <span class="occ-date">{{ formatDateBR(entry.date) }}</span>
              <span class="occ-state" :class="entryState(entry, today)">{{ stateLabel(entry.kind, entryState(entry, today)) }}</span>
              <span class="occ-paid">{{ entry.status === 'done' && entry.doneOn ? `em ${formatDateBR(entry.doneOn)}` : '' }}</span>
              <span class="occ-amount">{{ formatMoney(entry.amount) }}</span>
            </button>
          </li>
        </ul>
        <button v-if="history.length > shownHistory.length" type="button" class="link-btn" @click="showAll = true">Mostrar todas ({{ history.length }})</button>
      </section>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="actions">
        <template v-if="recurrence">
          <button type="button" class="btn btn-danger-ghost" data-action="delete-recurrence" @click="remove"><AppIcon name="trash" :size="15" /> Excluir</button>
          <button v-if="!ended" type="button" class="btn btn-ghost" data-action="stop-recurrence" data-tip="Para de gerar; o histórico continua" @click="stop">
            <AppIcon name="stop" :size="14" /> Encerrar
          </button>
        </template>
        <span class="spacer" />
        <button type="button" class="btn btn-ghost" @click="close">Cancelar</button>
        <button type="submit" class="btn btn-primary" data-action="save-recurrence">{{ creating ? 'Criar' : 'Salvar' }}</button>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.recurrence-dialog {
  padding: 22px;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
h2 {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.ended {
  font-size: 12px;
  color: var(--text-3);
}
.summary {
  margin-bottom: 14px;
  font-size: 12.5px;
  color: var(--text-2);
}
.gap {
  margin-top: 14px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.amount-box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
}
.amount-box:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}
.currency {
  color: var(--text-3);
  font-weight: 650;
}
.amount-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 15px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.grid .input,
.grid .select {
  height: 38px;
  width: 100%;
}
.end-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.end-date {
  width: auto;
  height: 32px;
}
.hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-3);
}
.option {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
}
.option input {
  accent-color: var(--primary);
}
.option-hint {
  font-size: 11.5px;
  color: var(--text-3);
}
.history {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.history h3 {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 650;
}
.muted {
  color: var(--text-3);
  font-weight: 500;
}
.occurrences {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.occurrence {
  display: grid;
  grid-template-columns: 88px auto 1fr auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 32px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
html[data-touch] .occurrence {
  min-height: 42px;
}
.occurrence:hover {
  background: var(--hover);
}
.occ-date,
.occ-amount {
  font-variant-numeric: tabular-nums;
}
.occ-state {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--surface-3);
  font-size: 11px;
  font-weight: 650;
  color: var(--text-2);
}
.occ-state.done {
  background: var(--success-soft);
  color: var(--success);
}
.occ-state.pending {
  background: var(--primary-soft);
  color: var(--primary-text);
}
.occ-state.overdue {
  background: var(--danger-soft);
  color: var(--danger);
}
.occ-state.cancelled {
  text-decoration: line-through;
}
.occ-paid {
  font-size: 11.5px;
  color: var(--text-3);
}
.link-btn {
  margin-top: 4px;
  padding: 0 8px;
  border: none;
  background: none;
  color: var(--primary-text);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.error {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--danger);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 18px;
}
.spacer {
  flex: 1;
}
html[data-layout='compact'] .grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
html[data-layout='compact'] .grid > :first-child {
  grid-column: 1 / -1;
}
</style>
