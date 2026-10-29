<script setup lang="ts">
/**
 * Registrar um lançamento (1.7.0; entradas, contas e recorrências na 1.7.1): gasto ou
 * entrada, valor, descrição e Enter. A data começa em hoje; a categoria e as observações
 * são opcionais.
 *
 * - "#" na descrição escolhe (ou cria) a categoria: "Feira #Mercado" → "Feira", Mercado.
 * - "Me lembre de pagar": o gasto fica pendente até você confirmar o pagamento.
 * - "Repetir": vira uma recorrência (frequência e fim: até você encerrar ou até uma data);
 *   cada ocorrência fica pendente até você confirmar.
 * A categoria é automática (1.7.2, lib/finance/categorize.ts): sai do que você já fez,
 * de um dicionário de estabelecimentos ("iFood" → a sua categoria de alimentação) ou da
 * categoria padrão; escolher uma à mão (ou com "#") vale até o próximo registro.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { showToast } from '~/composables/useToasts'
import { addDays, formatDateBR, type ISODate } from '~/lib/dates'
import { formatMoney, parseAmount } from '~/lib/finance/format'
import { MAX_DESCRIPTION, recentDescriptions, type EntryKind } from '~/lib/finance/model'
import { FREQUENCIES, occurrencesBetween, type Frequency } from '~/lib/finance/recurrence'
import { useFinanceStore } from '~/stores/finance'

const finance = useFinanceStore()
const today = finance.today

const kind = ref<EntryKind>('expense')
const amountText = ref('')
const description = ref('')
const date = ref(today.value)
const categoryId = ref<string | null>(null)
const notes = ref('')
/** Gasto: "Me lembre de pagar"; entrada: "Ainda vou receber". */
const pending = ref(false)
const repeat = ref(false)
const frequency = ref<Frequency>('monthly')
const endMode = ref<'never' | 'date'>('never')
const endDate = ref('')
const pastAsDone = ref(true)
const amountError = ref<string | null>(null)
const descriptionError = ref<string | null>(null)
/** Muda a cada registro: o editor das observações começa vazio. */
const formKey = ref(0)
/** A categoria foi escolhida à mão (ou com "#"): a automática não troca mais. */
const manual = ref(false)

const amountInput = ref<HTMLInputElement>()
const descriptionInput = ref<{ focus: () => void }>()

const income = computed(() => kind.value === 'income')
const suggestions = computed(() => recentDescriptions(finance.state.expenses, 30, kind.value))
const parsed = computed(() => parseAmount(amountText.value))
const KINDS = [
  { value: 'expense' as const, label: 'Gasto', icon: 'money-out' },
  { value: 'income' as const, label: 'Entrada', icon: 'money-in' },
]
const ENDS = [
  { value: 'never' as const, label: 'Até eu remover' },
  { value: 'date' as const, label: 'Até uma data' },
]

/** Recorrência começando no passado: quantas ocorrências já passaram. */
const pastCount = computed(() => {
  if (!repeat.value || !date.value || date.value >= today.value) return 0
  const draft = {
    id: 'draft',
    versions: [{ from: date.value, amount: 1, frequency: frequency.value, anchor: date.value }],
    endDate: endMode.value === 'date' && endDate.value ? endDate.value : null,
  }
  return occurrencesBetween(draft as never, date.value, addDays(today.value, -1), 1000).length
})

// O dia virou com o app aberto: o formulário acompanha (se ainda estava em "hoje")
watch(today, (now, before) => {
  if (date.value === before) date.value = now
})

watch(kind, () => (pending.value = false))
watch(description, () => (descriptionError.value = null))

/** A categoria que o app escolheria agora (histórico, dicionário, padrão). */
const suggestion = computed(() => finance.suggestCategory({ description: description.value.replace(/(^|\s)#\S*/g, ' '), kind: kind.value }))
watch(
  suggestion,
  (next) => {
    if (!manual.value) categoryId.value = next?.id ?? null
  },
  { immediate: true },
)
const categoryTag = computed(() => (manual.value || !suggestion.value || categoryId.value !== suggestion.value.id ? null : suggestion.value.source === 'default' ? 'padrão' : 'automática'))

function chooseCategory(id: string | null) {
  manual.value = true
  categoryId.value = id
}

function reset() {
  amountText.value = ''
  description.value = ''
  notes.value = ''
  manual.value = false
  categoryId.value = suggestion.value?.id ?? null
  pending.value = false
  repeat.value = false
  endMode.value = 'never'
  endDate.value = ''
  pastAsDone.value = true
  amountError.value = null
  descriptionError.value = null
  formKey.value++
}

const shortDate = (iso: ISODate) => (iso === today.value ? '' : ` (${formatDateBR(iso)})`)

function submit() {
  const amount = parsed.value
  // "#Mercado" digitado sem escolher na lista: vira a categoria
  const hashed = finance.takeHashCategory(description.value)
  if (hashed.categoryId) {
    description.value = hashed.text
    if (!manual.value) chooseCategory(hashed.categoryId)
  }
  // Uma categoria do app sugerida que ainda não está nas Finanças entra nelas
  const category = finance.ensureCategory(categoryId.value)
  if (amount === null) amountError.value = amountText.value.trim() ? 'Valor inválido. Exemplos: 52,30 ou 1.234,56.' : `Digite o valor ${income.value ? 'da entrada' : 'do gasto'}.`
  if (!description.value.trim()) descriptionError.value = income.value ? 'Dê um nome à entrada (ex.: Salário, Freela).' : 'Dê um nome ao gasto (ex.: Mercado, Uber, Cinema).'
  else if (repeat.value && endMode.value === 'date' && (!endDate.value || endDate.value < date.value)) descriptionError.value = 'Escolha a data final (depois da primeira).'
  if (amount === null) return amountInput.value?.focus()
  if (descriptionError.value) return descriptionInput.value?.focus()
  const day = date.value || today.value

  if (repeat.value) {
    const recurrence = finance.addRecurrence({
      kind: kind.value,
      description: description.value,
      amount,
      categoryId: category,
      notes: notes.value,
      remind: !income.value && pending.value,
      frequency: frequency.value,
      firstDate: day,
      endDate: endMode.value === 'date' ? endDate.value : null,
      pastAsDone: pastCount.value > 0 && pastAsDone.value,
    })
    if (!recurrence) return
    showToast({
      message: `Recorrência criada: ${description.value.trim()} · ${formatMoney(amount)}, ${FREQUENCIES.find((item) => item.value === frequency.value)!.every.toLowerCase()}`,
      icon: 'repeat',
      tone: 'success',
      action: { label: 'Ver', run: () => finance.openRecurrence(recurrence.id) },
    })
  } else {
    const entry = finance.addExpense({
      kind: kind.value,
      description: description.value,
      amount,
      date: day,
      categoryId: category,
      notes: notes.value,
      remind: !income.value && pending.value,
      pending: pending.value,
    })
    if (!entry) return
    const what = income.value ? (entry.status === 'pending' ? 'Entrada a receber' : 'Entrada registrada') : entry.status === 'pending' ? 'Conta a pagar' : 'Gasto registrado'
    showToast({
      message: `${what}: ${finance.expenseLabel(entry)}${shortDate(entry.date)}`,
      icon: 'check',
      tone: 'success',
      action: { label: 'Abrir', run: () => finance.openExpense(entry.id) },
    })
  }
  reset()
  amountInput.value?.focus()
}

function onDescriptionKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    submit()
  }
}

function focusAmount() {
  amountInput.value?.focus()
  amountInput.value?.select()
}

/** Abre o formulário já como entrada ou gasto (ex.: "Nova entrada" vindo das contas). */
function start(next: EntryKind, recurring = false) {
  kind.value = next
  repeat.value = recurring
  void nextTick(focusAmount)
}

defineExpose({ focusAmount, start })
</script>

<template>
  <form class="quick-add" :class="{ income }" data-expense-form @submit.prevent="submit">
    <div class="top">
      <UiSegmented v-model="kind" :options="KINDS" size="sm" aria-label="Gasto ou entrada" data-field="kind" />
    </div>
    <div class="row">
      <label class="field amount" :class="{ invalid: !!amountError }">
        <span class="field-name">Valor</span>
        <span class="amount-box">
          <span class="currency">{{ income ? '+ R$' : 'R$' }}</span>
          <input
            ref="amountInput"
            v-model="amountText"
            class="amount-input"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0,00"
            :aria-label="income ? 'Valor da entrada' : 'Valor do gasto'"
            data-field="amount"
            @input="amountError = null"
          />
        </span>
      </label>
      <label class="field description" :class="{ invalid: !!descriptionError }">
        <span class="field-name">Descrição</span>
        <FinanceTextInput
          ref="descriptionInput"
          v-model="description"
          list="finance-descriptions"
          :maxlength="MAX_DESCRIPTION"
          :placeholder="income ? 'Ex.: Salário, Freela  (# categoria)' : 'Ex.: Mercado, Uber  (# categoria)'"
          :label="income ? 'Descrição da entrada' : 'Descrição do gasto'"
          field="description"
          @category="chooseCategory"
          @keydown="onDescriptionKeydown"
        />
        <datalist id="finance-descriptions">
          <option v-for="item in suggestions" :key="item.description" :value="item.description" />
        </datalist>
      </label>
      <label class="field date">
        <span class="field-name">{{ repeat ? (income ? 'Primeiro recebimento' : 'Primeiro pagamento') : pending ? (income ? 'Previsão' : 'Vencimento') : 'Data' }}</span>
        <input v-model="date" class="input" type="date" :max="'9999-12-31'" :aria-label="repeat ? 'Data da primeira' : 'Data'" data-field="date" required />
      </label>
      <button type="submit" class="btn btn-primary submit" data-action="add-expense">
        <AppIcon :name="repeat ? 'repeat' : 'plus'" :size="15" /> {{ repeat ? 'Criar recorrência' : 'Registrar' }}
      </button>
    </div>
    <p v-if="amountError || descriptionError" class="error" role="alert">{{ amountError ?? descriptionError }}</p>
    <p v-else-if="parsed !== null" class="preview">{{ formatMoney(parsed) }}</p>

    <div class="options">
      <FinanceCategoryPicker v-model="categoryId" compact :tag="categoryTag" @picked="chooseCategory" />
      <label v-if="!(income && repeat)" class="option" :data-tip="income ? 'Fica como prevista até você confirmar que recebeu' : 'Fica pendente até você confirmar o pagamento, com aviso no dia'">
        <input v-model="pending" type="checkbox" data-field="remind" />
        <AppIcon :name="income ? 'clock' : 'bell'" :size="14" />
        {{ income ? 'Ainda vou receber' : 'Me lembre de pagar' }}
      </label>
      <label class="option" data-tip="Assinaturas, contas, salário: repete sozinho">
        <input v-model="repeat" type="checkbox" data-field="repeat" />
        <AppIcon name="repeat" :size="14" />
        Repetir
      </label>
    </div>

    <Transition name="fade">
      <div v-if="repeat" class="recurrence" data-recurrence-options>
        <label class="mini-field">
          <span class="field-name">Frequência</span>
          <select v-model="frequency" class="select sm" aria-label="Frequência" data-field="frequency">
            <option v-for="item in FREQUENCIES" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <div class="mini-field">
          <span class="field-name">Termina</span>
          <UiSegmented v-model="endMode" :options="ENDS" size="sm" aria-label="Quando termina" data-field="end-mode" />
        </div>
        <label v-if="endMode === 'date'" class="mini-field">
          <span class="field-name">Última data</span>
          <input v-model="endDate" class="input sm-input" type="date" :min="date" aria-label="Data final" data-field="end-date" />
        </label>
        <p class="recurrence-note">
          {{ income ? 'Cada recebimento fica “a receber” até você confirmar.' : 'Cada ocorrência fica pendente até você confirmar o pagamento.' }}
          <template v-if="!income && pending"> Com aviso no dia.</template>
        </p>
        <label v-if="pastCount" class="option past">
          <input v-model="pastAsDone" type="checkbox" data-field="past-as-done" />
          {{ pastCount === 1 ? 'A que já passou' : `As ${pastCount} que já passaram` }} {{ income ? (pastCount === 1 ? 'já foi recebida' : 'já foram recebidas') : pastCount === 1 ? 'já foi paga' : 'já foram pagas' }}
        </label>
      </div>
    </Transition>

    <FinanceNotesField :key="formKey" v-model="notes" :doc-key="`finance-new:${formKey}`" />
  </form>
</template>

<style scoped>
.quick-add {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 18px 12px;
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
  background: var(--surface-2);
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.field-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
}
.amount {
  flex: 0 1 170px;
}
.description {
  flex: 1 1 240px;
}
.date {
  flex: 0 1 160px;
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
  transition:
    border-color var(--t-fast),
    box-shadow var(--t-fast);
}
.amount-box:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}
.invalid .amount-box,
.invalid :deep(.input) {
  border-color: var(--danger);
}
.currency {
  flex: none;
  color: var(--text-3);
  font-weight: 650;
}
.income .currency {
  color: var(--success);
}
.amount-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 17px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.field :deep(.input) {
  height: 38px;
}
.submit {
  height: 38px;
}
.error {
  font-size: 12.5px;
  color: var(--danger);
}
.preview {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}
.option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
}
html[data-touch] .option {
  min-height: 40px;
}
.option input {
  accent-color: var(--primary);
}
.recurrence {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 14px;
  padding: 10px 12px;
  border-radius: var(--r-lg);
  border: 1px dashed var(--border-strong);
  background: var(--surface);
}
.mini-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sm-input {
  height: 32px;
  font-size: 13px;
}
.recurrence-note {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--text-3);
}
.past {
  flex-basis: 100%;
}
html[data-layout='compact'] .quick-add {
  padding: 12px;
  border-radius: var(--r-lg);
}
html[data-layout='compact'] .top :deep(.segmented) {
  width: 100%;
  display: flex;
}
html[data-layout='compact'] .top :deep(.segmented > *) {
  flex: 1;
  justify-content: center;
}
html[data-layout='compact'] .amount,
html[data-layout='compact'] .date {
  flex: 1 1 130px;
}
html[data-layout='compact'] .description {
  flex-basis: 100%;
  order: 3;
}
html[data-layout='compact'] .submit {
  flex: 1 1 100%;
  order: 4;
  height: 42px;
  justify-content: center;
}
html[data-touch] .amount-box,
html[data-touch] .field :deep(.input) {
  height: 44px;
}
</style>
