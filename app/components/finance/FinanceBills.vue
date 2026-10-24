<script setup lang="ts">
/**
 * Finanças › contas (1.7.1): o que ainda vai sair e entrar, e as recorrências.
 *
 * - Vencidas (pendentes com a data já passada) e próximas (até a data escolhida: as já
 *   lançadas e as previstas pelas recorrências), com "Pagar"/"Recebi" na linha. Pagar
 *   uma prevista adianta o pagamento (ela passa a existir já paga).
 * - Recorrências: as ativas (com a próxima data) e as encerradas; "Nova conta" e "Nova
 *   entrada" recorrentes.
 * - Pagamentos: o histórico das contas confirmadas, com o dia de cada pagamento.
 * Uma conta recorrente nunca é considerada paga só porque a data chegou.
 */
import { computed, ref } from 'vue'
import { showContextMenu } from '~/composables/useContextMenu'
import { paletteVar } from '~/lib/colors'
import { formatDateBR, relativeDayLabel, type ISODate } from '~/lib/dates'
import { formatMoney } from '~/lib/finance/format'
import { cashDate } from '~/lib/finance/model'
import type { UpcomingItem } from '~/lib/finance/bills'
import { currentVersion, describeSchedule, type Recurrence } from '~/lib/finance/recurrence'
import { useFinanceStore, type ForecastHorizon } from '~/stores/finance'

const finance = useFinanceStore()
const today = finance.today

const horizon = computed({
  get: () => finance.state.horizon,
  set: (value: ForecastHorizon) => finance.setHorizon(value),
})
const HORIZONS = [
  { value: 'month' as const, label: 'Fim do mês' },
  { value: '30' as const, label: '30 dias' },
  { value: '90' as const, label: '90 dias' },
]

const items = computed(() => finance.upcomingUntil(finance.horizonEnd.value))
const overdue = computed(() => items.value.filter((item) => item.date < today.value))
const next = computed(() => items.value.filter((item) => item.date >= today.value))
const sum = (list: UpcomingItem[], kind: 'expense' | 'income') => list.filter((item) => item.kind === kind).reduce((total, item) => total + item.amount, 0)

const recurrences = computed(() => {
  const list = finance.state.recurrences.map((recurrence) => ({ recurrence, next: finance.nextOccurrence(recurrence) }))
  const active = list.filter((item) => !!item.next).sort((a, b) => a.next!.occurrence.localeCompare(b.next!.occurrence))
  const ended = list.filter((item) => !item.next)
  return { active, ended }
})
const showEnded = ref(false)

/** Pagamentos confirmados (contas: pendentes que foram pagas, com lembrete ou de recorrência), o mais recente primeiro. */
const payments = computed(() =>
  finance.state.expenses
    .filter((entry) => entry.status === 'done' && (entry.doneOn || entry.remind || entry.recurrenceId))
    .sort((a, b) => cashDate(b).localeCompare(cashDate(a)) || b.updatedAt.localeCompare(a.updatedAt)),
)
const paymentLimit = ref(10)

const empty = computed(() => !items.value.length && !finance.state.recurrences.length && !payments.value.length)

function dayText(day: ISODate): string {
  return relativeDayLabel(day, today.value)
}

function color(categoryId: string | null): string {
  const category = categoryId ? finance.categoryById.value.get(categoryId) : null
  return category ? paletteVar(category.color) : 'var(--surface-3)'
}

function open(item: UpcomingItem) {
  if (item.stored) finance.openExpense(item.id)
  else finance.openRecurrence(item.recurrenceId)
}

function pay(item: UpcomingItem) {
  finance.confirmUpcoming(item)
}

async function itemMenu(item: UpcomingItem) {
  const income = item.kind === 'income'
  const choice = await showContextMenu([
    { id: 'pay', label: income ? 'Recebi (hoje)' : 'Paguei (hoje)' },
    ...(item.stored ? [{ id: 'open', label: 'Abrir (pagar em outra data, editar)' }] : []),
    ...(item.recurrenceId ? [{ id: 'skip', label: 'Pular esta' }, { id: 'recurrence', label: 'Abrir a recorrência' }] : []),
  ])
  if (choice === 'pay') finance.confirmUpcoming(item)
  else if (choice === 'open') finance.openExpense(item.id)
  else if (choice === 'skip') finance.skipUpcoming(item)
  else if (choice === 'recurrence') finance.openRecurrence(item.recurrenceId)
}

function schedule(recurrence: Recurrence) {
  return describeSchedule(currentVersion(recurrence, today.value))
}
</script>

<template>
  <div class="bills" data-finance-bills>
    <div class="bills-top">
      <div class="figures">
        <div class="figure danger" :class="{ zero: !overdue.length }" data-bills="overdue">
          <span class="fig-label">Vencidas</span>
          <strong>{{ formatMoney(sum(overdue, 'expense')) }}</strong>
          <span class="fig-sub">{{ overdue.filter((item) => item.kind === 'expense').length }} {{ overdue.filter((item) => item.kind === 'expense').length === 1 ? 'conta' : 'contas' }}</span>
        </div>
        <div class="figure" data-bills="pending">
          <span class="fig-label">A pagar</span>
          <strong>{{ formatMoney(sum(next, 'expense')) }}</strong>
          <span class="fig-sub">até {{ formatDateBR(finance.horizonEnd.value) }}</span>
        </div>
        <div class="figure positive" data-bills="income">
          <span class="fig-label">A receber</span>
          <strong>{{ formatMoney(sum(items, 'income')) }}</strong>
          <span class="fig-sub">até {{ formatDateBR(finance.horizonEnd.value) }}</span>
        </div>
      </div>
      <UiSegmented v-model="horizon" :options="HORIZONS" size="sm" aria-label="Até quando" data-field="horizon" />
    </div>

    <div v-if="empty" class="bills-empty">
      <AppIcon name="calendar" :size="30" />
      <h3>Nenhuma conta ainda</h3>
      <p>
        Contas a pagar aparecem aqui: um gasto com “Me lembre de pagar” ou uma recorrência (aluguel, assinaturas, salário). Cada uma fica pendente até você
        confirmar o pagamento.
      </p>
      <div class="empty-actions">
        <button type="button" class="btn btn-primary" data-action="new-recurring-expense" @click="finance.openRecurrence('new:expense')">
          <AppIcon name="repeat" :size="15" /> Nova conta recorrente
        </button>
        <button type="button" class="btn" data-action="new-recurring-income" @click="finance.openRecurrence('new:income')">
          <AppIcon name="money-in" :size="15" /> Nova entrada recorrente
        </button>
      </div>
    </div>

    <template v-else>
      <!-- Vencidas -->
      <section v-if="overdue.length" class="card overdue-card" data-section="overdue">
        <h3 class="card-title"><AppIcon name="alert" :size="15" /> Vencidas</h3>
        <ul class="list">
          <li v-for="item in overdue" :key="item.id">
            <div role="button" tabindex="0" class="bill" :class="{ income: item.kind === 'income' }" :data-bill="item.id" @click="open(item)" @keydown.enter.prevent="open(item)" @contextmenu.prevent="itemMenu(item)">
              <span class="mark" :style="{ '--c': color(item.categoryId) }"><AppIcon :name="item.kind === 'income' ? 'money-in' : item.recurrenceId ? 'repeat' : 'wallet'" :size="14" /></span>
              <span class="main">
                <span class="name">{{ item.description || finance.kindNoun(item.kind) }}</span>
                <span class="meta">
                  <span class="late">{{ item.kind === 'income' ? 'atrasada' : 'venceu' }} {{ dayText(item.date).toLowerCase() }}</span>
                  <span>{{ finance.categoryName(item.categoryId) }}</span>
                  <AppIcon v-if="item.remind" name="bell" :size="12" />
                </span>
              </span>
              <span class="value" :class="{ positive: item.kind === 'income' }">{{ item.kind === 'income' ? '+' : '' }}{{ formatMoney(item.amount) }}</span>
              <span class="bill-actions">
                <button type="button" class="btn btn-sm btn-primary pay" data-action="pay-bill" @click.stop="pay(item)">
                  <AppIcon name="check" :size="13" /> {{ item.kind === 'income' ? 'Recebi' : 'Pagar' }}
                </button>
                <button type="button" class="icon-btn sm more" aria-label="Mais opções" @click.stop="itemMenu(item)"><AppIcon name="more" :size="15" /></button>
              </span>
            </div>
          </li>
        </ul>
      </section>

      <!-- Próximas -->
      <section class="card" data-section="upcoming">
        <h3 class="card-title"><AppIcon name="calendar" :size="15" /> Próximas <span class="muted">até {{ formatDateBR(finance.horizonEnd.value) }}</span></h3>
        <p v-if="!next.length" class="card-empty">Nada para pagar ou receber até lá.</p>
        <ul v-else class="list">
          <li v-for="item in next" :key="item.id">
            <div
              role="button"
              tabindex="0"
              class="bill"
              :class="{ income: item.kind === 'income', virtual: !item.stored, today: item.date === today }"
              :data-bill="item.id"
              :data-stored="item.stored"
              @click="open(item)"
              @keydown.enter.prevent="open(item)"
              @contextmenu.prevent="itemMenu(item)"
            >
              <span class="mark" :style="{ '--c': color(item.categoryId) }"><AppIcon :name="item.kind === 'income' ? 'money-in' : item.recurrenceId ? 'repeat' : 'wallet'" :size="14" /></span>
              <span class="main">
                <span class="name">{{ item.description || finance.kindNoun(item.kind) }}</span>
                <span class="meta">
                  <span class="when">{{ dayText(item.date) }}<template v-if="!/\d/.test(dayText(item.date))">, {{ formatDateBR(item.date).slice(0, 5) }}</template></span>
                  <span>{{ finance.categoryName(item.categoryId) }}</span>
                  <span v-if="!item.stored" class="tag">prevista</span>
                  <AppIcon v-if="item.remind" name="bell" :size="12" />
                </span>
              </span>
              <span class="value" :class="{ positive: item.kind === 'income' }">{{ item.kind === 'income' ? '+' : '' }}{{ formatMoney(item.amount) }}</span>
              <span class="bill-actions">
                <button type="button" class="btn btn-sm pay" :class="{ 'btn-primary': item.date === today }" data-action="pay-bill" :data-tip="item.date > today ? 'Paga adiantado (hoje)' : undefined" @click.stop="pay(item)">
                  <AppIcon name="check" :size="13" /> {{ item.kind === 'income' ? 'Recebi' : 'Pagar' }}
                </button>
                <button type="button" class="icon-btn sm more" aria-label="Mais opções" @click.stop="itemMenu(item)"><AppIcon name="more" :size="15" /></button>
              </span>
            </div>
          </li>
        </ul>
      </section>

      <!-- Recorrências -->
      <section class="card" data-section="recurrences">
        <header class="card-head">
          <h3 class="card-title"><AppIcon name="repeat" :size="15" /> Recorrências</h3>
          <div class="head-actions">
            <button type="button" class="btn btn-sm" data-action="new-recurring-expense" @click="finance.openRecurrence('new:expense')"><AppIcon name="plus" :size="13" /> Conta</button>
            <button type="button" class="btn btn-sm" data-action="new-recurring-income" @click="finance.openRecurrence('new:income')"><AppIcon name="plus" :size="13" /> Entrada</button>
          </div>
        </header>
        <p v-if="!finance.state.recurrences.length" class="card-empty">Aluguel, assinaturas, salário: crie uma vez e elas aparecem todo mês (ou semana, dia, ano).</p>
        <ul v-else class="list">
          <li v-for="{ recurrence, next: upcoming } in recurrences.active" :key="recurrence.id">
            <button type="button" class="bill rec" :class="{ income: recurrence.kind === 'income' }" :data-recurrence="recurrence.id" @click="finance.openRecurrence(recurrence.id)">
              <span class="mark" :style="{ '--c': color(recurrence.categoryId) }"><AppIcon :name="recurrence.kind === 'income' ? 'money-in' : 'repeat'" :size="14" /></span>
              <span class="main">
                <span class="name">{{ recurrence.description || finance.kindNoun(recurrence.kind) }}</span>
                <span class="meta">
                  <span>{{ schedule(recurrence) }}</span>
                  <span>próxima {{ dayText(upcoming!.entry?.date ?? upcoming!.occurrence).toLowerCase() }}</span>
                  <span v-if="recurrence.endDate">até {{ formatDateBR(recurrence.endDate) }}</span>
                  <AppIcon v-if="recurrence.remind" name="bell" :size="12" />
                </span>
              </span>
              <span class="value" :class="{ positive: recurrence.kind === 'income' }">{{ recurrence.kind === 'income' ? '+' : '' }}{{ formatMoney(upcoming!.entry?.amount ?? upcoming!.amount) }}</span>
              <AppIcon name="chevron-right" :size="15" class="go" />
            </button>
          </li>
        </ul>
        <button v-if="recurrences.ended.length" type="button" class="link-btn" :aria-expanded="showEnded" @click="showEnded = !showEnded">
          {{ showEnded ? 'Esconder' : 'Ver' }} encerradas ({{ recurrences.ended.length }})
        </button>
        <ul v-if="showEnded" class="list ended">
          <li v-for="{ recurrence } in recurrences.ended" :key="recurrence.id">
            <button type="button" class="bill rec" :data-recurrence="recurrence.id" @click="finance.openRecurrence(recurrence.id)">
              <span class="mark" :style="{ '--c': color(recurrence.categoryId) }"><AppIcon name="repeat" :size="14" /></span>
              <span class="main">
                <span class="name">{{ recurrence.description || finance.kindNoun(recurrence.kind) }}</span>
                <span class="meta"><span>{{ recurrence.endDate ? `encerrada em ${formatDateBR(recurrence.endDate)}` : 'encerrada' }}</span></span>
              </span>
              <AppIcon name="chevron-right" :size="15" class="go" />
            </button>
          </li>
        </ul>
      </section>

      <!-- Pagamentos -->
      <section class="card" data-section="payments">
        <h3 class="card-title"><AppIcon name="history" :size="15" /> Pagamentos</h3>
        <p v-if="!payments.length" class="card-empty">As contas que você confirmar aparecem aqui, com o dia do pagamento.</p>
        <ul v-else class="list">
          <li v-for="entry in payments.slice(0, paymentLimit)" :key="entry.id">
            <button type="button" class="bill paid" :class="{ income: entry.kind === 'income' }" :data-payment="entry.id" @click="finance.openExpense(entry.id)">
              <span class="mark done"><AppIcon name="check" :size="14" /></span>
              <span class="main">
                <span class="name">{{ entry.description || finance.kindNoun(entry.kind) }}</span>
                <span class="meta">
                  <span>{{ entry.kind === 'income' ? 'recebido' : 'pago' }} em {{ formatDateBR(cashDate(entry)) }}</span>
                  <span v-if="entry.doneOn && entry.doneOn !== entry.date">venc. {{ formatDateBR(entry.date) }}</span>
                </span>
              </span>
              <span class="value" :class="{ positive: entry.kind === 'income' }">{{ entry.kind === 'income' ? '+' : '' }}{{ formatMoney(entry.amount) }}</span>
            </button>
          </li>
        </ul>
        <button v-if="payments.length > paymentLimit" type="button" class="link-btn" @click="paymentLimit += 30">Mostrar mais ({{ payments.length - paymentLimit }})</button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.bills {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.bills-top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
}
.figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 10px;
  flex: 1 1 420px;
}
.figure {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-2);
}
.figure strong {
  font-size: 19px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.figure.danger:not(.zero) {
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
  background: var(--danger-soft);
}
.figure.danger:not(.zero) strong {
  color: var(--danger);
}
.figure.positive strong {
  color: var(--success);
}
.fig-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
}
.fig-sub {
  font-size: 11.5px;
  color: var(--text-3);
}
.card {
  padding: 12px 12px 10px;
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
  background: var(--surface);
}
.overdue-card {
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
}
.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 2px 4px 8px;
  font-size: 13.5px;
  font-weight: 650;
}
.overdue-card .card-title {
  color: var(--danger);
}
.head-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.muted {
  font-weight: 500;
  color: var(--text-3);
}
.card-empty {
  padding: 6px 6px 8px;
  font-size: 13px;
  color: var(--text-3);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.bill {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 46px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--r-lg);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
html[data-touch] .bill {
  min-height: 54px;
}
.bill:hover,
.bill:focus-visible {
  background: var(--hover);
}
.bill.today {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--c) 18%, var(--surface-2));
  color: color-mix(in srgb, var(--c) 70%, var(--text-2));
}
.virtual .mark {
  background: transparent;
  border: 1px dashed color-mix(in srgb, var(--c) 60%, var(--border-strong));
}
.mark.done {
  background: var(--success-soft);
  color: var(--success);
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 10px;
  font-size: 11.5px;
  color: var(--text-3);
}
.late {
  color: var(--danger);
  font-weight: 600;
}
.tag {
  padding: 0 6px;
  border-radius: 999px;
  border: 1px dashed var(--border-strong);
  line-height: 16px;
}
.value {
  flex: none;
  font-size: 13.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.positive {
  color: var(--success);
}
.pay {
  flex: none;
  height: 28px;
}
html[data-touch] .pay {
  height: 36px;
}
.bill-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}
.go {
  flex: none;
  color: var(--text-3);
}
.link-btn {
  margin: 6px 0 0 6px;
  padding: 0;
  border: none;
  background: none;
  color: var(--primary-text);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.ended .bill {
  opacity: 0.75;
}
.bills-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
  text-align: center;
  color: var(--text-3);
}
.bills-empty h3 {
  color: var(--text);
  font-size: 15px;
}
.bills-empty p {
  max-width: 460px;
  font-size: 13px;
}
.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 6px;
}
/* Celular: uma linha por número (rótulo e período à esquerda, valor à direita) */
html[data-layout='compact'] .figures {
  grid-template-columns: 1fr;
  gap: 6px;
}
html[data-layout='compact'] .figure {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'label value'
    'sub value';
  align-items: center;
  column-gap: 10px;
  padding: 8px 12px;
}
html[data-layout='compact'] .fig-label {
  grid-area: label;
}
html[data-layout='compact'] .fig-sub {
  grid-area: sub;
}
html[data-layout='compact'] .figure strong {
  grid-area: value;
  font-size: 16px;
  white-space: nowrap;
}
html[data-layout='compact'] .bills-top :deep(.segmented) {
  width: 100%;
  display: flex;
}
html[data-layout='compact'] .bills-top :deep(.segmented > *) {
  flex: 1;
  justify-content: center;
}
html[data-layout='compact'] .bill {
  flex-wrap: wrap;
}
html[data-layout='compact'] .bill-actions {
  flex-basis: 100%;
  justify-content: flex-end;
  padding-left: 40px;
}
</style>
