<script setup lang="ts">
/**
 * Importar extrato (1.7.1): CSV ou OFX do banco → prévia → revisar → importar.
 *
 * - O arquivo é lido só aqui, no aparelho: nada vai para a internet e ele não é copiado
 *   para o workspace (cada lançamento guarda de qual importação veio).
 * - CSV: as colunas, o formato das datas e o separador dos centavos são descobertos
 *   sozinhos; dá para trocar em "Colunas".
 * - Gasto ou entrada vem do sinal do valor, conforme o tipo do extrato (conta: negativo
 *   = gasto; fatura do cartão: positivo = gasto), e dá para trocar em cada linha.
 * - Categoria automática (1.7.2, lib/finance/categorize.ts): pelo que você já fez, por um
 *   dicionário de estabelecimentos ou a categoria padrão; aparece marcada e dá para trocar.
 * - Possíveis duplicados (mesmo id do banco, ou mesmo valor em data próxima) ficam
 *   desmarcados para você decidir; uma conta pendente que aparece no extrato é
 *   confirmada como paga em vez de virar outro lançamento.
 */
import { computed, ref, watch } from 'vue'
import { notifyError } from '~/composables/useToasts'
import { formatDateBR, isISODate, type ISODate } from '~/lib/dates'
import { formatAmountInput, formatMoney, parseAmount } from '~/lib/finance/format'
import { MAX_DESCRIPTION, type EntryKind } from '~/lib/finance/model'
import {
  csvTable,
  DATE_ORDERS,
  decodeStatement,
  detectCsvMapping,
  detectFormat,
  duplicateFinder,
  guessSign,
  kindOf,
  parseCsv,
  parseOfx,
  statementRange,
  suspiciousDate,
  type CsvMapping,
  type SignConvention,
  type StatementFormat,
  type StatementRow,
} from '~/lib/finance/statement'
import { pickFiles } from '~/lib/mobile/pick-files'
import { useFinanceStore, type ImportRow } from '~/stores/finance'

const finance = useFinanceStore()
const today = finance.today
const MAX_BYTES = 20 * 1024 * 1024
const PAGE = 100

interface PreviewRow {
  key: string
  line: number
  include: boolean
  date: string
  description: string
  amountText: string
  kind: EntryKind
  categoryId: string | null
  /** A categoria veio da categoria automática (e ainda não foi trocada): "automática" ou "padrão". */
  suggested: 'auto' | 'default' | null
  externalId: string | null
  duplicate: { id: string; label: string; certain: boolean; pending: boolean } | null
  /** Confirmar o pagamento da conta pendente em vez de criar outro lançamento. */
  confirms: boolean
}

const open = computed(() => finance.state.importOpen)
const fileName = ref('')
const format = ref<StatementFormat>('csv')
const text = ref('')
const mapping = ref<CsvMapping | null>(null)
const creditCard = ref(false)
const sign = ref<SignConvention>('account')
const rows = ref<PreviewRow[]>([])
const limit = ref(PAGE)
const loading = ref(false)
const problem = ref<string | null>(null)
const showMapping = ref(false)

watch(open, (value) => {
  if (!value) reset()
})

function reset() {
  fileName.value = ''
  text.value = ''
  mapping.value = null
  rows.value = []
  problem.value = null
  showMapping.value = false
  limit.value = PAGE
}

function close() {
  finance.state.importOpen = false
}

async function choose() {
  problem.value = null
  const [file] = await pickFiles({ accept: '.csv,.ofx,.qfx,.txt,text/csv,application/x-ofx' })
  if (!file) return
  if (file.size > MAX_BYTES) {
    problem.value = 'O arquivo é grande demais (máximo de 20 MB).'
    return
  }
  loading.value = true
  try {
    const decoded = decodeStatement(new Uint8Array(await file.arrayBuffer()))
    fileName.value = file.name
    text.value = decoded
    format.value = detectFormat(decoded, file.name)
    if (format.value === 'csv') {
      mapping.value = detectCsvMapping(decoded)
      creditCard.value = false
    } else {
      mapping.value = null
    }
    const parsed = parse()
    sign.value = guessSign(parsed, creditCard.value)
    build(parsed)
    if (!rows.value.length) problem.value = format.value === 'ofx' ? 'Nenhuma transação encontrada nesse OFX.' : 'Nenhuma transação encontrada. Confira as colunas abaixo.'
    if (format.value === 'csv' && (!rows.value.length || mapping.value?.date === -1 || (mapping.value?.amount === -1 && mapping.value.credit === -1))) showMapping.value = true
  } catch (error) {
    notifyError('Não foi possível ler esse arquivo.', error)
    reset()
  } finally {
    loading.value = false
  }
}

function parse(): StatementRow[] {
  if (format.value === 'ofx') {
    const result = parseOfx(text.value)
    creditCard.value = result.creditCard
    return result.rows
  }
  return mapping.value ? parseCsv(text.value, mapping.value) : []
}

/** Monta a prévia: gasto/entrada pelo sinal, categoria sugerida e duplicados. */
function build(parsed: StatementRow[]) {
  const findDuplicate = duplicateFinder(finance.state.expenses)
  rows.value = parsed.map((row, index) => {
    const amount = row.amount
    const kind = amount !== null ? kindOf(amount, sign.value) : 'expense'
    const absolute = amount !== null ? Math.abs(amount) : null
    const suggestion = finance.suggestCategory({ description: row.description, kind })
    const categoryId = suggestion?.id ?? null
    const match = row.date && absolute ? findDuplicate({ date: row.date, amount: absolute, kind, externalId: row.externalId, description: row.description }) : null
    const pending = !!match && match.entry.status === 'pending'
    const valid = !!row.date && !!absolute
    return {
      key: `${row.line}:${index}`,
      line: row.line,
      include: valid && (!match || (pending && !match.certain)),
      date: row.date ?? '',
      description: row.description.slice(0, MAX_DESCRIPTION),
      amountText: absolute ? formatAmountInput(absolute) : '',
      kind,
      categoryId,
      suggested: suggestion ? (suggestion.source === 'default' ? 'default' : 'auto') : null,
      externalId: row.externalId,
      duplicate: match
        ? {
            id: match.entry.id,
            label: `${match.entry.description || finance.kindNoun(match.entry.kind)} · ${formatDateBR(match.entry.date)} · ${formatMoney(match.entry.amount)}`,
            certain: match.certain,
            pending,
          }
        : null,
      confirms: pending && !match?.certain,
    }
  })
  limit.value = PAGE
}

function rebuild() {
  build(parse())
}

watch(sign, (value, before) => {
  if (before && rows.value.length) rebuild()
})

// ── Colunas do CSV ──────────────────────────────────────────────────────────

const table = computed(() => (format.value === 'csv' && mapping.value ? csvTable(text.value, mapping.value) : null))
const columnOptions = computed(() => [{ value: -1, label: '(nenhuma)' }, ...(table.value?.columns ?? []).map((label, index) => ({ value: index, label: `${index + 1}. ${label}` }))])

function setMapping(patch: Partial<CsvMapping>) {
  if (!mapping.value) return
  mapping.value = { ...mapping.value, ...patch }
  rebuild()
}

const amountMode = computed({
  get: () => (mapping.value && mapping.value.amount < 0 && (mapping.value.credit >= 0 || mapping.value.debit >= 0) ? 'split' : 'single'),
  set: (value: 'single' | 'split') => {
    if (!mapping.value) return
    if (value === 'single') setMapping({ amount: mapping.value.amount >= 0 ? mapping.value.amount : Math.max(0, mapping.value.credit), credit: -1, debit: -1 })
    else setMapping({ amount: -1, credit: mapping.value.credit >= 0 ? mapping.value.credit : 0, debit: mapping.value.debit >= 0 ? mapping.value.debit : 0 })
  },
})

// ── Prévia ──────────────────────────────────────────────────────────────────

const SIGNS = [
  { value: 'account' as const, label: 'Extrato da conta' },
  { value: 'card' as const, label: 'Fatura do cartão' },
]

const amountOf = (row: PreviewRow) => parseAmount(row.amountText)
function rowError(row: PreviewRow): string | null {
  if (!isISODate(row.date)) return 'Data inválida'
  if (amountOf(row) === null) return 'Valor inválido'
  return null
}
function rowWarning(row: PreviewRow): string | null {
  return isISODate(row.date) && suspiciousDate(row.date as ISODate, today.value) ? 'Data no futuro: confira o formato das datas' : null
}

const selected = computed(() => rows.value.filter((row) => row.include && !rowError(row)))
const totals = computed(() => {
  const result = { expense: 0, income: 0, confirm: 0 }
  for (const row of selected.value) {
    if (row.confirms) result.confirm++
    else result[row.kind] += amountOf(row) ?? 0
  }
  return result
})
const duplicates = computed(() => rows.value.filter((row) => row.duplicate && !row.duplicate.pending).length)
const range = computed(() => statementRange(rows.value.map((row) => ({ date: isISODate(row.date) ? row.date : null }))))
const allChecked = computed(() => rows.value.length > 0 && rows.value.every((row) => row.include || !!rowError(row)))

function toggleAll(value: boolean) {
  for (const row of rows.value) row.include = value && !rowError(row)
}

function setCategory(row: PreviewRow, value: string | null) {
  row.categoryId = value || null
  row.suggested = null
}

function flipKind(row: PreviewRow) {
  row.kind = row.kind === 'expense' ? 'income' : 'expense'
  row.confirms = false
}

function submit() {
  const list: ImportRow[] = selected.value.map((row) => ({
    kind: row.kind,
    date: row.date as ISODate,
    description: row.description,
    amount: amountOf(row)!,
    // Uma categoria do app sugerida que ainda não está nas Finanças entra nelas
    categoryId: finance.ensureCategory(row.categoryId),
    externalId: row.externalId,
    confirms: row.confirms && row.duplicate?.pending ? row.duplicate.id : null,
  }))
  if (!list.length) return
  const result = finance.importEntries(list, { file: fileName.value || 'extrato', format: format.value })
  if (result) close()
}
</script>

<template>
  <UiModal :open="open" :width="980" label="Importar extrato" full-on-compact @close="close">
    <div class="import" data-import-dialog>
      <header class="head">
        <h2>Importar extrato</h2>
        <button type="button" class="icon-btn" aria-label="Fechar" @click="close"><AppIcon name="x" /></button>
      </header>

      <!-- Escolher o arquivo -->
      <div v-if="!rows.length && !mapping" class="pick">
        <AppIcon name="upload" :size="30" />
        <p>Escolha o extrato que você baixou do banco, em <strong>CSV</strong> ou <strong>OFX</strong>. Você confere tudo antes de importar.</p>
        <button type="button" class="btn btn-primary" :disabled="loading" data-action="pick-statement" @click="choose">
          <AppIcon name="folder-open" :size="15" /> {{ loading ? 'Lendo…' : 'Escolher arquivo…' }}
        </button>
        <p class="privacy"><AppIcon name="lock" :size="13" /> O arquivo é lido só aqui, no seu aparelho: nada é enviado para a internet, e ele não é copiado para o workspace.</p>
        <p v-if="problem" class="problem" role="alert">{{ problem }}</p>
      </div>

      <template v-else>
        <div class="file-row">
          <span class="file" data-import-file><AppIcon name="file-plus" :size="14" /> {{ fileName }} <span class="muted">· {{ format.toUpperCase() }}</span></span>
          <span v-if="range" class="muted">{{ formatDateBR(range.from) }} a {{ formatDateBR(range.to) }} · {{ rows.length }} {{ rows.length === 1 ? 'transação' : 'transações' }}</span>
          <button type="button" class="btn btn-sm btn-ghost" @click="choose"><AppIcon name="refresh" :size="13" /> Outro arquivo</button>
        </div>

        <div class="settings-row">
          <div class="setting">
            <span class="setting-label">Tipo do extrato</span>
            <UiSegmented v-model="sign" :options="SIGNS" size="sm" aria-label="Tipo do extrato" data-field="sign" />
            <span class="setting-help">{{ sign === 'account' ? 'Negativo = gasto, positivo = entrada.' : 'Positivo = gasto (compra), negativo = entrada (pagamento, estorno).' }}</span>
          </div>
          <button v-if="format === 'csv'" type="button" class="btn btn-sm btn-ghost" :aria-expanded="showMapping" data-action="csv-columns" @click="showMapping = !showMapping">
            <AppIcon name="sliders" :size="14" /> Colunas
          </button>
        </div>

        <!-- Colunas do CSV -->
        <div v-if="showMapping && mapping" class="mapping" data-csv-mapping>
          <label>
            <span>Data</span>
            <select class="select sm" :value="mapping.date" data-map="date" @change="setMapping({ date: Number(($event.target as HTMLSelectElement).value) })">
              <option v-for="option in columnOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label>
            <span>Descrição</span>
            <select class="select sm" :value="mapping.description[0] ?? -1" data-map="description" @change="setMapping({ description: [Number(($event.target as HTMLSelectElement).value)].filter((value) => value >= 0) })">
              <option v-for="option in columnOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label>
            <span>Valores</span>
            <select v-model="amountMode" class="select sm" data-map="amount-mode">
              <option value="single">Uma coluna (com sinal)</option>
              <option value="split">Crédito e débito separados</option>
            </select>
          </label>
          <label v-if="amountMode === 'single'">
            <span>Valor</span>
            <select class="select sm" :value="mapping.amount" data-map="amount" @change="setMapping({ amount: Number(($event.target as HTMLSelectElement).value) })">
              <option v-for="option in columnOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <template v-else>
            <label>
              <span>Crédito</span>
              <select class="select sm" :value="mapping.credit" data-map="credit" @change="setMapping({ credit: Number(($event.target as HTMLSelectElement).value) })">
                <option v-for="option in columnOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label>
              <span>Débito</span>
              <select class="select sm" :value="mapping.debit" data-map="debit" @change="setMapping({ debit: Number(($event.target as HTMLSelectElement).value) })">
                <option v-for="option in columnOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
          </template>
          <label>
            <span>Coluna D/C</span>
            <select class="select sm" :value="mapping.type" data-map="type" @change="setMapping({ type: Number(($event.target as HTMLSelectElement).value) })">
              <option v-for="option in columnOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label>
            <span>Datas</span>
            <select class="select sm" :value="mapping.dateOrder" data-map="date-order" @change="setMapping({ dateOrder: ($event.target as HTMLSelectElement).value as CsvMapping['dateOrder'] })">
              <option v-for="option in DATE_ORDERS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label>
            <span>Centavos</span>
            <select class="select sm" :value="mapping.decimal" data-map="decimal" @change="setMapping({ decimal: ($event.target as HTMLSelectElement).value as CsvMapping['decimal'] })">
              <option value=",">Vírgula (1.234,56)</option>
              <option value=".">Ponto (1,234.56)</option>
            </select>
          </label>
        </div>

        <p v-if="problem && !rows.length" class="problem" role="alert">{{ problem }}</p>
        <p v-if="duplicates" class="note"><AppIcon name="info" :size="13" /> {{ duplicates }} {{ duplicates === 1 ? 'possível duplicado ficou desmarcado' : 'possíveis duplicados ficaram desmarcados' }}: confira antes de importar.</p>

        <!-- Prévia -->
        <div v-if="rows.length" class="preview" role="table" aria-label="Prévia das transações">
          <div class="prow phead" role="row">
            <label class="check" role="columnheader"><input type="checkbox" :checked="allChecked" aria-label="Marcar todas" @change="toggleAll(($event.target as HTMLInputElement).checked)" /></label>
            <span class="all-label" aria-hidden="true">Marcar todas</span>
            <span role="columnheader">Data</span>
            <span role="columnheader">Descrição</span>
            <span role="columnheader">Valor</span>
            <span role="columnheader">Categoria</span>
          </div>
          <div
            v-for="row in rows.slice(0, limit)"
            :key="row.key"
            class="prow"
            :class="{ off: !row.include, error: !!rowError(row), income: row.kind === 'income', dup: !!row.duplicate && !row.duplicate.pending }"
            role="row"
            :data-import-row="row.line"
          >
            <label class="check"><input v-model="row.include" type="checkbox" :disabled="!!rowError(row)" :aria-label="`Importar ${row.description}`" /></label>
            <input v-model="row.date" class="input cell-date" type="date" aria-label="Data" />
            <div class="cell-desc">
              <FinanceTextInput v-model="row.description" :maxlength="MAX_DESCRIPTION" label="Descrição" input-class="input" @category="(id) => setCategory(row, id)" />
              <span v-if="rowError(row)" class="flag bad">{{ rowError(row) }}</span>
              <span v-else-if="rowWarning(row)" class="flag warn">{{ rowWarning(row) }}</span>
              <span v-if="row.duplicate && row.duplicate.pending" class="flag pay">
                <label><input v-model="row.confirms" type="checkbox" /> Paga a conta pendente: {{ row.duplicate.label }}</label>
              </span>
              <span v-else-if="row.duplicate" class="flag dup">{{ row.duplicate.certain ? 'Já importado' : 'Possível duplicado' }}: {{ row.duplicate.label }}</span>
            </div>
            <div class="cell-amount">
              <button type="button" class="kind" :class="row.kind" :data-tip="row.kind === 'income' ? 'Entrada (clique para virar gasto)' : 'Gasto (clique para virar entrada)'" data-action="flip-kind" @click="flipKind(row)">
                {{ row.kind === 'income' ? '+' : '−' }}
              </button>
              <input v-model="row.amountText" class="input amount" inputmode="decimal" aria-label="Valor" />
            </div>
            <div class="cell-cat">
              <CategorySelect
                :model-value="row.categoryId"
                module="finance"
                size="sm"
                class="row-category"
                label="Categoria"
                :tag="row.suggested && row.categoryId ? (row.suggested === 'default' ? 'padrão' : 'automática') : null"
                @update:model-value="(value) => setCategory(row, value as string | null)"
              />
            </div>
          </div>
          <button v-if="rows.length > limit" type="button" class="btn btn-sm more" @click="limit += PAGE">Mostrar mais ({{ rows.length - limit }})</button>
        </div>

        <footer v-if="rows.length" class="foot">
          <span class="summary" data-import-summary>
            {{ selected.length }} de {{ rows.length }} selecionadas
            <template v-if="totals.expense"> · gastos {{ formatMoney(totals.expense) }}</template>
            <template v-if="totals.income"> · entradas <span class="positive">+{{ formatMoney(totals.income) }}</span></template>
            <template v-if="totals.confirm"> · {{ totals.confirm }} {{ totals.confirm === 1 ? 'conta confirmada' : 'contas confirmadas' }}</template>
          </span>
          <button type="button" class="btn btn-ghost" @click="close">Cancelar</button>
          <button type="button" class="btn btn-primary" :disabled="!selected.length" data-action="confirm-import" @click="submit">Importar {{ selected.length }}</button>
        </footer>
      </template>
    </div>
  </UiModal>
</template>

<style scoped>
.import {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: min(86vh, 900px);
  padding: 18px 22px 18px;
}
html[data-layout='compact'] .import {
  max-height: none;
  height: 100%;
  padding: 14px 14px calc(14px + var(--safe-bottom, 0px));
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h2 {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 650;
}
.pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 30px 12px 26px;
  text-align: center;
  color: var(--text-2);
}
.pick p {
  max-width: 460px;
  font-size: 13.5px;
}
.privacy {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px !important;
  color: var(--text-3);
}
.problem {
  font-size: 13px;
  color: var(--danger);
}
.file-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  font-size: 13px;
}
.file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.muted {
  color: var(--text-3);
  font-weight: 400;
}
.settings-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
}
.setting {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}
.setting-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
}
.setting-help {
  font-size: 12px;
  color: var(--text-3);
}
.mapping {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-2);
}
.mapping label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11.5px;
  color: var(--text-3);
}
.select.sm {
  width: auto;
  min-height: 32px;
  padding-top: 4px;
  padding-bottom: 4px;
  font-size: 12.5px;
}
.note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-2);
}
.preview {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
}
.prow {
  display: grid;
  grid-template-columns: 34px 140px minmax(0, 1fr) 150px 170px;
  align-items: start;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}
.all-label {
  display: none;
}
.phead {
  position: sticky;
  top: 0;
  z-index: 1;
  align-items: center;
  background: var(--elevated);
  font-size: 11.5px;
  font-weight: 650;
  color: var(--text-3);
}
.prow.off:not(.phead) {
  opacity: 0.55;
}
.prow.error {
  background: var(--danger-soft);
}
.check {
  display: grid;
  place-items: center;
  height: 32px;
}
.check input,
.flag input {
  accent-color: var(--primary);
}
.prow :deep(.input),
.prow .input {
  height: 32px;
  font-size: 12.5px;
}
.cell-date {
  width: 100%;
}
.cell-desc {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.cell-amount {
  display: flex;
  gap: 4px;
}
.amount {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.kind {
  flex: none;
  width: 30px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--text-2);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}
.kind.income {
  border-color: color-mix(in srgb, var(--success) 40%, var(--border));
  color: var(--success);
}
.cell-cat {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.cell-cat .select {
  width: 100%;
}
.flag {
  font-size: 11.5px;
  line-height: 1.35;
}
.flag.bad {
  color: var(--danger);
}
.flag.warn,
.flag.dup {
  color: color-mix(in srgb, var(--accent-strong, #b88700) 85%, var(--text));
}
.flag.pay {
  color: var(--primary-text);
}
.flag.pay label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}
.row-category {
  width: 100%;
}
.flag.suggested {
  align-self: flex-start;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary-text);
}
.more {
  margin: 8px auto;
  display: block;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.summary {
  margin-right: auto;
  font-size: 13px;
  color: var(--text-2);
}
.positive {
  color: var(--success);
}
html[data-layout='compact'] .prow:not(.phead),
html[data-layout='medium'] .prow:not(.phead) {
  grid-template-columns: 30px minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas:
    'check desc desc'
    '. date amount'
    '. cat cat';
}
html[data-layout='compact'] .phead,
html[data-layout='medium'] .phead {
  grid-template-columns: 30px 1fr;
}
html[data-layout='compact'] .phead > span,
html[data-layout='medium'] .phead > span {
  display: none;
}
html[data-layout='compact'] .phead > .all-label,
html[data-layout='medium'] .phead > .all-label {
  display: block;
}
html[data-layout='compact'] .prow:not(.phead) > .check,
html[data-layout='medium'] .prow:not(.phead) > .check {
  grid-area: check;
}
html[data-layout='compact'] .prow:not(.phead) > .cell-desc,
html[data-layout='medium'] .prow:not(.phead) > .cell-desc {
  grid-area: desc;
}
html[data-layout='compact'] .prow:not(.phead) > .cell-date,
html[data-layout='medium'] .prow:not(.phead) > .cell-date {
  grid-area: date;
}
html[data-layout='compact'] .prow:not(.phead) > .cell-amount,
html[data-layout='medium'] .prow:not(.phead) > .cell-amount {
  grid-area: amount;
}
html[data-layout='compact'] .prow:not(.phead) > .cell-cat,
html[data-layout='medium'] .prow:not(.phead) > .cell-cat {
  grid-area: cat;
}
html[data-touch] .prow :deep(.input),
html[data-touch] .prow .input,
html[data-touch] .kind {
  height: 40px;
}
</style>
