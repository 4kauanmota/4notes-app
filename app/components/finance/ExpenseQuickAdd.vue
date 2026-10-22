<script setup lang="ts">
/**
 * Registrar um gasto (1.7.0): valor, descrição e Enter. A data começa em hoje; a
 * categoria e as observações são opcionais e ficam no próprio formulário (dá até para
 * criar uma categoria sem sair dele). Uma descrição já usada sugere a categoria dela.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { showToast } from '~/composables/useToasts'
import { formatMoney, parseAmount } from '~/lib/finance/format'
import { foldText, MAX_DESCRIPTION, MAX_NOTES, recentDescriptions } from '~/lib/finance/model'
import { useFinanceStore } from '~/stores/finance'

const finance = useFinanceStore()
const today = finance.today

const amountText = ref('')
const description = ref('')
const date = ref(today.value)
const categoryId = ref<string | null>(null)
const notes = ref('')
const notesOpen = ref(false)
const amountError = ref<string | null>(null)
const descriptionError = ref<string | null>(null)
/** A categoria foi escolhida à mão (a sugestão pela descrição não troca mais). */
let categoryTouched = false

const amountInput = ref<HTMLInputElement>()
const descriptionInput = ref<HTMLInputElement>()

const suggestions = computed(() => recentDescriptions(finance.state.expenses))
const parsed = computed(() => parseAmount(amountText.value))

// O dia virou com o app aberto: o formulário acompanha (se ainda estava em "hoje")
watch(today, (now, before) => {
  if (date.value === before) date.value = now
})

watch(categoryId, () => (categoryTouched = true))

// Descrição já usada: a categoria dela vem junto (se você ainda não escolheu outra)
watch(description, (text) => {
  descriptionError.value = null
  if (categoryTouched) return
  const key = foldText(text.trim())
  const match = key ? suggestions.value.find((item) => foldText(item.description.trim()) === key) : null
  if (match?.categoryId && finance.categoryById.value.has(match.categoryId)) {
    categoryId.value = match.categoryId
    void nextTick(() => (categoryTouched = false))
  }
})

function reset() {
  amountText.value = ''
  description.value = ''
  notes.value = ''
  notesOpen.value = false
  categoryId.value = null
  amountError.value = null
  descriptionError.value = null
  void nextTick(() => (categoryTouched = false))
}

function submit() {
  const amount = parsed.value
  if (amount === null) amountError.value = amountText.value.trim() ? 'Valor inválido. Exemplos: 52,30 ou 1.234,56.' : 'Digite o valor do gasto.'
  if (!description.value.trim()) descriptionError.value = 'Dê um nome ao gasto (ex.: Mercado, Uber, Cinema).'
  if (amount === null) return amountInput.value?.focus()
  if (descriptionError.value) return descriptionInput.value?.focus()
  const expense = finance.addExpense({
    description: description.value,
    amount,
    date: date.value || today.value,
    categoryId: categoryId.value,
    notes: notes.value,
  })
  if (!expense) return
  showToast({
    message: `Gasto registrado: ${finance.expenseLabel(expense)}${expense.date !== today.value ? ` (${expense.date.split('-').reverse().join('/')})` : ''}`,
    icon: 'check',
    tone: 'success',
    action: { label: 'Abrir', run: () => finance.openExpense(expense.id) },
  })
  reset()
  amountInput.value?.focus()
}

function focusAmount() {
  amountInput.value?.focus()
  amountInput.value?.select()
}

defineExpose({ focusAmount })
</script>

<template>
  <form class="quick-add" data-expense-form @submit.prevent="submit">
    <div class="row">
      <label class="field amount" :class="{ invalid: !!amountError }">
        <span class="field-name">Valor</span>
        <span class="amount-box">
          <span class="currency">R$</span>
          <input
            ref="amountInput"
            v-model="amountText"
            class="amount-input"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0,00"
            aria-label="Valor do gasto"
            data-field="amount"
            @input="amountError = null"
          />
        </span>
      </label>
      <label class="field description" :class="{ invalid: !!descriptionError }">
        <span class="field-name">Descrição</span>
        <input
          ref="descriptionInput"
          v-model="description"
          class="input"
          list="finance-descriptions"
          :maxlength="MAX_DESCRIPTION"
          placeholder="Ex.: Mercado, Uber, Cinema"
          aria-label="Descrição do gasto"
          data-field="description"
        />
        <datalist id="finance-descriptions">
          <option v-for="item in suggestions" :key="item.description" :value="item.description" />
        </datalist>
      </label>
      <label class="field date">
        <span class="field-name">Data</span>
        <input v-model="date" class="input" type="date" :max="'9999-12-31'" aria-label="Data do gasto" data-field="date" required />
      </label>
      <button type="submit" class="btn btn-primary submit" data-action="add-expense">
        <AppIcon name="plus" :size="15" /> Registrar
      </button>
    </div>
    <p v-if="amountError || descriptionError" class="error" role="alert">{{ amountError ?? descriptionError }}</p>
    <p v-else-if="parsed !== null" class="preview">{{ formatMoney(parsed) }}</p>

    <div class="extras">
      <FinanceCategoryPicker v-model="categoryId" compact />
      <button v-if="!notesOpen" type="button" class="notes-toggle" data-action="expense-notes" @click="notesOpen = true">
        <AppIcon name="edit" :size="13" /> Observações
      </button>
    </div>
    <textarea
      v-if="notesOpen"
      v-model="notes"
      class="input notes"
      rows="2"
      :maxlength="MAX_NOTES"
      placeholder="Observações (opcional)"
      aria-label="Observações do gasto"
      @keydown.enter.ctrl.prevent="submit"
      @keydown.enter.meta.prevent="submit"
    />
  </form>
</template>

<style scoped>
.quick-add {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
  background: var(--surface-2);
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
.invalid .input {
  border-color: var(--danger);
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
  font-size: 17px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.field .input {
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
.extras {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.notes-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 4px 6px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-3);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.notes-toggle:hover {
  color: var(--primary-text);
}
.notes {
  resize: vertical;
  min-height: 56px;
  font-size: 13.5px;
}
html[data-layout='compact'] .quick-add {
  padding: 14px 12px;
  border-radius: var(--r-lg);
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
html[data-touch] .field .input {
  height: 44px;
}
</style>
