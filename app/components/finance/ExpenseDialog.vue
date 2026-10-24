<script setup lang="ts">
/**
 * Ver e editar um lançamento (1.7.0; entradas e contas na 1.7.1): descrição ("#" escolhe
 * a categoria), valor, data, categoria, observações e "Me lembre de pagar".
 *
 * - Pendente: "Confirmar pagamento" (ou "Recebi"), com o dia em que foi pago; pago:
 *   mostra o dia e dá para voltar a pendente.
 * - Ocorrência de uma recorrência: mostra de qual, abre a recorrência e "Pular esta".
 * - Também: registrar de novo hoje, ver onde foi mencionado e excluir (com Desfazer).
 * Abre ao clicar num lançamento do histórico, das contas ou do painel (finance.state.editing).
 */
import { computed, nextTick, ref, watch } from 'vue'
import { formatDateBR, type ISODate } from '~/lib/dates'
import { formatAmountInput, formatMoney, parseAmount } from '~/lib/finance/format'
import { entryState, MAX_DESCRIPTION, stateLabel } from '~/lib/finance/model'
import { currentVersion, describeSchedule } from '~/lib/finance/recurrence'
import { expenseSubject, showMentionsOf } from '~/stores/mentions'
import { useFinanceStore } from '~/stores/finance'

const finance = useFinanceStore()
const expense = computed(() => finance.findExpense(finance.state.editing) ?? null)
const income = computed(() => expense.value?.kind === 'income')
const state = computed(() => (expense.value ? entryState(expense.value, finance.today.value) : 'done'))
const recurrence = computed(() => finance.findRecurrence(expense.value?.recurrenceId) ?? null)

const description = ref('')
const amountText = ref('')
const date = ref('')
const categoryId = ref<string | null>(null)
const notes = ref('')
const remind = ref(false)
const paidOn = ref<ISODate>(finance.today.value)
const error = ref<string | null>(null)
const descriptionInput = ref<{ focus: () => void }>()

watch(
  () => expense.value?.id,
  async (id) => {
    const current = expense.value
    if (!id || !current) return
    description.value = current.description
    amountText.value = formatAmountInput(current.amount)
    date.value = current.date
    categoryId.value = current.categoryId && finance.categoryById.value.has(current.categoryId) ? current.categoryId : null
    notes.value = current.notes
    remind.value = current.remind
    paidOn.value = finance.today.value
    error.value = null
    await nextTick()
    descriptionInput.value?.focus()
  },
  { immediate: true },
)

const parsed = computed(() => parseAmount(amountText.value))
const dirty = computed(() => {
  const current = expense.value
  if (!current) return false
  return (
    description.value.trim() !== current.description ||
    parsed.value !== current.amount ||
    date.value !== current.date ||
    categoryId.value !== (current.categoryId && finance.categoryById.value.has(current.categoryId) ? current.categoryId : null) ||
    notes.value !== current.notes ||
    remind.value !== current.remind
  )
})

/** Conta (algo que se paga num dia): pendente, com lembrete, de uma recorrência ou confirmada num dia. */
const isBill = computed(() => !!expense.value && (expense.value.status !== 'done' || expense.value.remind || !!expense.value.recurrenceId || !!expense.value.doneOn))
const dateLabel = computed(() => (isBill.value ? (income.value ? 'Previsão' : 'Vencimento') : 'Data'))
const title = computed(() => (income.value ? 'Entrada' : 'Gasto'))
const importedFrom = computed(() => finance.importName(expense.value?.importId ?? null))

function stamp(iso: string): string {
  const value = new Date(iso)
  return Number.isNaN(value.getTime()) ? '' : `${formatDateBR(iso.slice(0, 10))} às ${value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

function close() {
  finance.openExpense(null)
}

/** Grava o que mudou no formulário (false = algo inválido, com o aviso na tela). */
function apply(): boolean {
  const current = expense.value
  if (!current) return false
  const hashed = finance.takeHashCategory(description.value)
  if (hashed.categoryId) {
    description.value = hashed.text
    categoryId.value = hashed.categoryId
  }
  if (!description.value.trim()) {
    error.value = income.value ? 'Dê um nome à entrada.' : 'Dê um nome ao gasto.'
    return false
  }
  if (parsed.value === null) {
    error.value = 'Valor inválido. Exemplos: 52,30 ou 1.234,56.'
    return false
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) {
    error.value = `Escolha a data ${income.value ? 'da entrada' : 'do gasto'}.`
    return false
  }
  if (!dirty.value) return true
  // Ligar o lembrete num gasto pago: ele volta a ficar pendente até você confirmar
  if (remind.value && !current.remind && current.status === 'done' && !income.value) finance.unconfirmEntry(current.id)
  return finance.updateExpense(current.id, {
    description: description.value,
    amount: parsed.value,
    date: date.value,
    categoryId: categoryId.value,
    notes: notes.value,
    remind: remind.value,
  })
}

function save() {
  if (apply()) close()
}

function confirm() {
  const current = expense.value
  if (!current || !apply()) return
  if (finance.confirmEntry(current.id, paidOn.value || finance.today.value)) close()
}

function unconfirm() {
  const current = expense.value
  if (current) finance.unconfirmEntry(current.id)
}

function skip() {
  const current = expense.value
  if (!current || !apply()) return
  if (finance.skipEntry(current.id)) close()
}

function restore() {
  const current = expense.value
  if (current) finance.restoreEntry(current.id)
}

async function remove() {
  const current = expense.value
  if (!current) return
  if (await finance.requestDeleteExpense(current.id)) close()
}

function repeat() {
  const current = expense.value
  if (!current) return
  close()
  finance.repeatExpense(current.id)
}

function mentions() {
  const current = expense.value
  if (current) showMentionsOf(expenseSubject(current))
}

function openRecurrence() {
  const id = recurrence.value?.id
  if (!id) return
  close()
  finance.openRecurrence(id)
}
</script>

<template>
  <UiModal :open="!!expense" :width="490" :label="title" @close="close">
    <form v-if="expense" class="expense-dialog" :class="{ income }" data-expense-dialog @submit.prevent="save">
      <header class="head">
        <h2>
          {{ title }}
          <span class="state" :class="state" data-entry-state>{{ stateLabel(expense.kind, state) }}</span>
        </h2>
        <strong class="big-amount" data-expense-amount>{{ income ? '+' : '' }}{{ parsed !== null ? formatMoney(parsed) : formatMoney(expense.amount) }}</strong>
      </header>

      <label class="field-label" for="expense-description">Descrição</label>
      <FinanceTextInput
        ref="descriptionInput"
        input-id="expense-description"
        v-model="description"
        :maxlength="MAX_DESCRIPTION"
        :label="`Descrição ${income ? 'da entrada' : 'do gasto'}`"
        field="description"
        @category="(id) => (categoryId = id)"
        @input="error = null"
      />

      <div class="pair">
        <div>
          <label class="field-label gap" for="expense-amount">Valor</label>
          <div class="amount-box">
            <span class="currency">R$</span>
            <input id="expense-amount" v-model="amountText" class="amount-input" inputmode="decimal" autocomplete="off" data-field="amount" @input="error = null" />
          </div>
        </div>
        <div>
          <label class="field-label gap" for="expense-date">{{ dateLabel }}</label>
          <input id="expense-date" v-model="date" class="input" type="date" data-field="date" required />
        </div>
      </div>

      <span class="field-label gap">Categoria</span>
      <FinanceCategoryPicker v-model="categoryId" compact />

      <!-- Pagamento -->
      <div v-if="expense.status === 'pending'" class="payment" :class="state" data-payment>
        <div class="payment-text">
          <strong>{{ state === 'overdue' ? (income ? 'Atrasada' : 'Vencido') : income ? 'A receber' : 'Pendente' }}</strong>
          <span>{{ income ? 'Ainda não conta no saldo: confirme quando receber.' : 'Ainda não conta como pago: confirme quando pagar.' }}</span>
        </div>
        <div class="payment-actions">
          <label class="paid-on">
            <span>{{ income ? 'Recebido em' : 'Pago em' }}</span>
            <input v-model="paidOn" class="input" type="date" data-field="paid-on" />
          </label>
          <button type="button" class="btn btn-primary" data-action="confirm-payment" @click="confirm">
            <AppIcon name="check" :size="15" /> {{ income ? 'Recebi' : 'Confirmar pagamento' }}
          </button>
        </div>
      </div>
      <div v-else-if="expense.status === 'done' && isBill" class="payment done" data-payment>
        <div class="payment-text">
          <strong>{{ income ? 'Recebido' : 'Pago' }}{{ expense.doneOn ? ` em ${formatDateBR(expense.doneOn)}` : '' }}</strong>
          <span v-if="expense.doneOn && expense.doneOn !== expense.date">{{ dateLabel }}: {{ formatDateBR(expense.date) }}</span>
        </div>
        <button type="button" class="btn btn-sm btn-ghost" data-action="unconfirm" @click="unconfirm">{{ income ? 'Não recebi' : 'Não foi pago' }}</button>
      </div>
      <div v-else-if="expense.status === 'cancelled'" class="payment cancelled" data-payment>
        <div class="payment-text">
          <strong>Pulada</strong>
          <span>Esta ocorrência não conta nas contas nem nos saldos.</span>
        </div>
        <button type="button" class="btn btn-sm btn-ghost" data-action="restore" @click="restore">Voltar a pendente</button>
      </div>

      <label v-if="!income" class="option gap">
        <input v-model="remind" type="checkbox" data-field="remind" />
        <AppIcon name="bell" :size="14" /> Me lembre de pagar
        <span class="option-hint">{{ expense.status === 'done' && !expense.remind ? '(volta a ficar pendente)' : 'aviso quando vencer' }}</span>
      </label>

      <button v-if="recurrence" type="button" class="recurrence-link" data-action="open-recurrence" @click="openRecurrence">
        <AppIcon name="repeat" :size="14" />
        <span
          >Parte de <strong>{{ recurrence.description || title }}</strong> · {{ describeSchedule(currentVersion(recurrence, finance.today.value)) }}</span
        >
        <AppIcon name="chevron-right" :size="14" />
      </button>

      <div class="gap">
        <FinanceNotesField v-model="notes" :doc-key="`finance:${expense.id}`" />
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p class="stamps">
        Registrado em {{ stamp(expense.createdAt) }}<template v-if="expense.updatedAt !== expense.createdAt"> · alterado em {{ stamp(expense.updatedAt) }}</template>
        <template v-if="importedFrom"><br />Importado do extrato {{ importedFrom }}</template>
      </p>

      <div class="actions">
        <button type="button" class="btn btn-danger-ghost" data-action="delete-expense" @click="remove"><AppIcon name="trash" :size="15" /> Excluir</button>
        <div class="secondary">
          <button type="button" class="btn btn-ghost" data-action="expense-mentions" @click="mentions"><AppIcon name="backlink" :size="15" /> Ver menções</button>
          <button v-if="recurrence && expense.status === 'pending'" type="button" class="btn btn-ghost" data-action="skip-entry" data-tip="Não vai ser paga: sai das contas, fica no histórico" @click="skip">
            <AppIcon name="skip" :size="15" /> Pular esta
          </button>
          <button v-else-if="!recurrence" type="button" class="btn btn-ghost" data-action="repeat-expense" :data-tip="'Registra de novo com a data de hoje'" @click="repeat">
            <AppIcon name="repeat" :size="15" /> Repetir hoje
          </button>
        </div>
        <button type="button" class="btn btn-ghost" @click="close">Cancelar</button>
        <button type="submit" class="btn btn-primary" data-action="save-expense">Salvar</button>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.expense-dialog {
  padding: 22px;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.state {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-2);
  font-family: var(--font-ui, inherit);
  font-size: 11.5px;
  font-weight: 650;
}
.state.done {
  background: var(--success-soft);
  color: var(--success);
}
.state.pending {
  background: var(--primary-soft);
  color: var(--primary-text);
}
.state.overdue {
  background: var(--danger-soft);
  color: var(--danger);
}
.state.cancelled {
  text-decoration: line-through;
}
.big-amount {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.income .big-amount {
  color: var(--success);
}
.gap {
  margin-top: 14px;
}
.pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
.pair .input {
  height: 38px;
}
.payment {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: var(--r-lg);
  border: 1px solid color-mix(in srgb, var(--primary) 30%, var(--border));
  background: var(--primary-soft);
}
.payment.overdue {
  border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
  background: var(--danger-soft);
}
.payment.done {
  border-color: color-mix(in srgb, var(--success) 35%, var(--border));
  background: var(--success-soft);
}
.payment.cancelled {
  border-style: dashed;
  background: var(--surface-2);
}
.payment-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 12.5px;
  color: var(--text-2);
}
.payment-text strong {
  font-size: 13.5px;
  color: var(--text);
}
.payment-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
}
.paid-on {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11.5px;
  color: var(--text-3);
}
.paid-on .input {
  height: 34px;
}
.option {
  display: flex;
  align-items: center;
  gap: 6px;
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
.recurrence-link {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 12px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-2);
  color: var(--text-2);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.recurrence-link span {
  flex: 1;
  min-width: 0;
}
.recurrence-link:hover {
  border-color: var(--primary);
}
.error {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--danger);
}
.stamps {
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--text-3);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 18px;
}
.actions > .btn-danger-ghost {
  margin-right: auto;
  padding-left: 10px;
}
.secondary {
  display: flex;
  gap: 2px;
  margin-right: auto;
}
html[data-layout='compact'] .actions > .btn-danger-ghost,
html[data-layout='compact'] .secondary {
  margin-right: 0;
}
html[data-layout='compact'] .secondary {
  width: 100%;
  justify-content: flex-start;
}
html[data-layout='compact'] .payment-actions {
  width: 100%;
}
html[data-layout='compact'] .payment-actions .btn {
  flex: 1;
  justify-content: center;
}
</style>
