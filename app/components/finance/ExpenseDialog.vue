<script setup lang="ts">
/**
 * Ver e editar um gasto (1.7.0): descrição, valor, data, categoria e observações.
 * Também: registrar de novo hoje, ver onde ele foi mencionado e excluir (com Desfazer).
 * Abre ao clicar num gasto do histórico ou do painel (finance.state.editing).
 */
import { computed, nextTick, ref, watch } from 'vue'
import { formatDateBR } from '~/lib/dates'
import { formatAmountInput, formatMoney, parseAmount } from '~/lib/finance/format'
import { MAX_DESCRIPTION, MAX_NOTES } from '~/lib/finance/model'
import { expenseSubject, showMentionsOf } from '~/stores/mentions'
import { useFinanceStore } from '~/stores/finance'

const finance = useFinanceStore()
const expense = computed(() => finance.findExpense(finance.state.editing) ?? null)

const description = ref('')
const amountText = ref('')
const date = ref('')
const categoryId = ref<string | null>(null)
const notes = ref('')
const error = ref<string | null>(null)
const descriptionInput = ref<HTMLInputElement>()

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
    notes.value !== current.notes
  )
})

function stamp(iso: string): string {
  const value = new Date(iso)
  return Number.isNaN(value.getTime()) ? '' : `${formatDateBR(iso.slice(0, 10))} às ${value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

function close() {
  finance.openExpense(null)
}

function save() {
  const current = expense.value
  if (!current) return
  if (!description.value.trim()) {
    error.value = 'Dê um nome ao gasto.'
    return
  }
  if (parsed.value === null) {
    error.value = 'Valor inválido. Exemplos: 52,30 ou 1.234,56.'
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) {
    error.value = 'Escolha a data do gasto.'
    return
  }
  if (dirty.value) finance.updateExpense(current.id, { description: description.value, amount: parsed.value, date: date.value, categoryId: categoryId.value, notes: notes.value })
  close()
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
</script>

<template>
  <UiModal :open="!!expense" :width="470" label="Gasto" @close="close">
    <form v-if="expense" class="expense-dialog" data-expense-dialog @submit.prevent="save">
      <header class="head">
        <h2>Gasto</h2>
        <strong class="big-amount" data-expense-amount>{{ parsed !== null ? formatMoney(parsed) : formatMoney(expense.amount) }}</strong>
      </header>

      <label class="field-label" for="expense-description">Descrição</label>
      <input
        id="expense-description"
        ref="descriptionInput"
        v-model="description"
        class="input"
        :maxlength="MAX_DESCRIPTION"
        data-field="description"
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
          <label class="field-label gap" for="expense-date">Data</label>
          <input id="expense-date" v-model="date" class="input" type="date" data-field="date" required />
        </div>
      </div>

      <span class="field-label gap">Categoria</span>
      <FinanceCategoryPicker v-model="categoryId" compact />

      <label class="field-label gap" for="expense-notes">Observações</label>
      <textarea id="expense-notes" v-model="notes" class="input notes" rows="3" :maxlength="MAX_NOTES" placeholder="Opcional" />

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p class="stamps">
        Registrado em {{ stamp(expense.createdAt) }}<template v-if="expense.updatedAt !== expense.createdAt"> · alterado em {{ stamp(expense.updatedAt) }}</template>
      </p>

      <div class="actions">
        <button type="button" class="btn btn-danger-ghost" data-action="delete-expense" @click="remove"><AppIcon name="trash" :size="15" /> Excluir</button>
        <div class="secondary">
          <button type="button" class="btn btn-ghost" data-action="expense-mentions" @click="mentions"><AppIcon name="backlink" :size="15" /> Ver menções</button>
          <button type="button" class="btn btn-ghost" data-action="repeat-expense" :data-tip="'Registra o mesmo gasto com a data de hoje'" @click="repeat">
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
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.big-amount {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text);
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
.notes {
  resize: vertical;
  min-height: 64px;
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
</style>
