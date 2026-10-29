<script setup lang="ts">
/**
 * Timer › Histórico: todas as sessões registradas, por data, categoria ou atividade.
 * Período (com ‹ › para o anterior e o próximo), busca, filtro de categoria e de
 * situação (concluídas, interrompidas, canceladas) e ordem. Clique num registro para
 * editar; botão direito: editar, ver menções ou excluir.
 * Abrir uma menção a um registro (stores/mentions.ts) traz ele para a tela e o destaca.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { separator, showContextMenu } from '~/composables/useContextMenu'
import { useToday } from '~/composables/useToday'
import type { PaletteColor } from '~/lib/colors'
import { formatDateBR, relativeDayLabel, toISODate, type ISODate } from '~/lib/dates'
import { formatDuration, formatTimeOfDay } from '~/lib/timer/format'
import { activityKey, MODE_ICONS, MODE_LABELS, STATUS_LABELS, type SessionStatus, type TimerSession } from '~/lib/timer/model'
import {
  containsDay,
  matchesCategory,
  periodBounds,
  periodOf,
  sessionDay,
  sessionInRange,
  weekdayName,
  type CategoryFilter,
  type Period,
} from '~/lib/timer/stats'
import { showMentionsOf, timerSessionSubject } from '~/stores/mentions'
import { useTimerStore } from '~/stores/timer'

const emit = defineEmits<{ session: [] }>()
const timer = useTimerStore()
const { today } = useToday()

const period = ref<Period | null>(periodOf('month', today.value, timer.state.settings.weekStart))
const search = ref('')
const categoryChoice = ref<(string | null)[]>([])
const status = ref<'all' | SessionStatus>('all')
const groupBy = ref<'day' | 'category' | 'activity'>('day')
const sort = ref<'recent' | 'oldest' | 'longest'>('recent')
const editing = ref<string | null>(null)
const limit = ref(150)

const GROUPS = [
  { value: 'day' as const, label: 'Data' },
  { value: 'category' as const, label: 'Categoria' },
  { value: 'activity' as const, label: 'Atividade' },
]

const categoryFilter = computed<CategoryFilter>(() => categoryChoice.value)
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR')

const filtered = computed(() => {
  const range = period.value ? periodBounds(period.value) : null
  const query = fold(search.value.trim())
  const known = timer.knownCategoryIds.value
  return timer.state.sessions.filter((session) => {
    if (range && !sessionInRange(session, range)) return false
    if (status.value !== 'all' && session.status !== status.value) return false
    if (!matchesCategory(session, categoryFilter.value, known)) return false
    if (!query) return true
    return fold(`${session.activity} ${session.notes} ${timer.categoryName(session.categoryId)}`).includes(query)
  })
})

function compareSessions(a: TimerSession, b: TimerSession): number {
  if (sort.value === 'oldest') return a.start - b.start
  if (sort.value === 'longest') return b.duration - a.duration || b.start - a.start
  return b.start - a.start
}

interface Group {
  key: string
  label: string
  detail?: string
  color?: PaletteColor | null
  total: number
  sessions: TimerSession[]
}

function dayLabel(day: ISODate): { label: string; detail: string } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const relative = relativeDayLabel(day, today.value)
  const named = relative === 'Hoje' || relative === 'Ontem'
  return { label: named ? relative : `${weekdayName(weekday)}, ${formatDateBR(day)}`, detail: named ? formatDateBR(day) : '' }
}

const groups = computed<Group[]>(() => {
  const map = new Map<string, Group>()
  const rows = [...filtered.value].sort(compareSessions)
  for (const session of rows) {
    let key: string
    let make: () => Omit<Group, 'total' | 'sessions'>
    if (groupBy.value === 'day') {
      key = sessionDay(session)
      make = () => ({ key, ...dayLabel(key) })
    } else if (groupBy.value === 'category') {
      const id = session.categoryId && timer.categoryById.value.has(session.categoryId) ? session.categoryId : null
      key = id ?? ''
      make = () => ({ key, label: timer.categoryName(id), color: id ? (timer.categoryById.value.get(id)?.color ?? null) : null })
    } else {
      key = activityKey(session.activity)
      make = () => ({ key, label: session.activity || 'Sem atividade' })
    }
    let group = map.get(key)
    if (!group) {
      group = { ...make(), total: 0, sessions: [] }
      map.set(key, group)
    }
    group.total += session.duration * 1000
    group.sessions.push(session)
  }
  const list = [...map.values()]
  if (groupBy.value !== 'day' || sort.value === 'longest') list.sort((a, b) => b.total - a.total)
  return list
})

/** Desenha aos poucos (históricos grandes): as primeiras N sessões e "Mostrar mais". */
const visibleGroups = computed(() => {
  let left = limit.value
  const result: Group[] = []
  for (const group of groups.value) {
    if (left <= 0) break
    result.push(left >= group.sessions.length ? group : { ...group, sessions: group.sessions.slice(0, left) })
    left -= group.sessions.length
  }
  return result
})

watch([period, search, categoryChoice, status, groupBy, sort], () => (limit.value = 150))

const totals = computed(() => ({
  count: filtered.value.length,
  ms: filtered.value.reduce((sum, session) => sum + session.duration * 1000, 0),
}))
const hasFilters = computed(() => !!search.value.trim() || categoryChoice.value.length > 0 || status.value !== 'all')

function clearFilters() {
  search.value = ''
  categoryChoice.value = []
  status.value = 'all'
}

function timeRange(session: TimerSession): string {
  const sameDay = toISODate(new Date(session.start)) === toISODate(new Date(session.end))
  const range = `${formatTimeOfDay(session.start)} – ${formatTimeOfDay(session.end)}${sameDay ? '' : ' (+1)'}`
  return groupBy.value === 'day' ? range : `${formatDateBR(sessionDay(session)).slice(0, 5)} · ${range}`
}

async function rowMenu(session: TimerSession) {
  const choice = await showContextMenu([
    { id: 'edit', label: 'Editar…' },
    { id: 'mentions', label: 'Ver menções' },
    separator,
    { id: 'delete', label: 'Excluir', danger: true },
  ])
  if (choice === 'edit') editing.value = session.id
  else if (choice === 'mentions') showMentionsOf(timerSessionSubject(session))
  else if (choice === 'delete') timer.deleteSession(session.id)
}

// ── Abrir um registro mencionado ────────────────────────────────────────────

/** Registro destacado (veio de uma menção). */
const flashId = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Mostra o registro pedido (timer.revealSession): tira os filtros que o escondem, vai
 * para o período dele (do mesmo tipo do que estava escolhido), rola até ele e o destaca.
 */
async function revealRequested(): Promise<void> {
  const request = timer.state.reveal
  if (!request) return
  timer.state.reveal = null
  const session = timer.findSession(request.id)
  if (!session) return
  clearFilters()
  const day = sessionDay(session)
  if (period.value && !containsDay(period.value, day)) {
    const kind = period.value.kind === 'custom' ? 'month' : period.value.kind
    period.value = periodOf(kind, day, timer.state.settings.weekStart)
  }
  await nextTick()
  // Desenhado aos poucos: garante que o registro está entre os mostrados
  let index = 0
  for (const group of groups.value) {
    const at = group.sessions.findIndex((item) => item.id === session.id)
    if (at >= 0) {
      index += at
      break
    }
    index += group.sessions.length
  }
  if (index >= limit.value) limit.value = index + 50
  await nextTick()
  document.querySelector(`.history [data-session="${CSS.escape(session.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  flashId.value = session.id
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flashId.value = null), 1800)
}
watch(() => timer.state.reveal?.seq, () => void revealRequested(), { immediate: true })

const navRef = ref<{ shift: (delta: number) => void }>()
defineExpose({ shiftPeriod: (delta: number) => navRef.value?.shift(delta) })
</script>

<template>
  <div class="history">
    <div class="toolbar">
      <PeriodNav ref="navRef" v-model="period" :week-start="timer.state.settings.weekStart" :today="today" allow-all />
      <div class="filters">
        <label class="search">
          <AppIcon name="search" :size="15" />
          <input v-model="search" class="search-input" placeholder="Buscar atividade ou observação" aria-label="Buscar no histórico" />
        </label>
        <CategorySelect v-model="categoryChoice" module="timer" multiple size="sm" label="Filtrar por categoria" data-filter="category" />
        <select v-model="status" class="select sm" aria-label="Situação">
          <option value="all">Todas as situações</option>
          <option value="completed">Concluídas</option>
          <option value="interrupted">Interrompidas</option>
          <option value="canceled">Canceladas</option>
        </select>
        <select v-model="sort" class="select sm" aria-label="Ordem">
          <option value="recent">Mais recentes</option>
          <option value="oldest">Mais antigas</option>
          <option value="longest">Mais longas</option>
        </select>
        <UiSegmented v-model="groupBy" :options="GROUPS" size="sm" aria-label="Agrupar por" />
      </div>
    </div>

    <div v-if="!timer.state.sessions.length" class="history-empty">
      <AppIcon name="history" :size="30" />
      <h3>Nenhuma sessão registrada ainda</h3>
      <p>Quando você finalizar uma sessão, ela aparece aqui — com a atividade, a categoria, a duração e os horários.</p>
      <button type="button" class="btn btn-primary" @click="emit('session')"><AppIcon name="play" :size="15" /> Começar uma sessão</button>
    </div>
    <div v-else-if="!filtered.length" class="history-empty">
      <AppIcon name="search" :size="28" />
      <h3>Nenhuma sessão {{ hasFilters ? 'com esses filtros' : 'neste período' }}</h3>
      <button v-if="hasFilters" type="button" class="btn btn-sm" @click="clearFilters">Limpar filtros</button>
    </div>
    <template v-else>
      <p class="summary">
        <strong>{{ formatDuration(totals.ms, { seconds: false }) }}</strong> válidos em {{ totals.count }}
        {{ totals.count === 1 ? 'sessão' : 'sessões' }}
      </p>
      <section v-for="group in visibleGroups" :key="group.key" class="group">
        <h3 class="group-head">
          <CategoryDot v-if="groupBy === 'category'" :color="group.color ?? null" :size="9" />
          <span class="group-label">{{ group.label }}</span>
          <span v-if="group.detail" class="group-detail">{{ group.detail }}</span>
          <span class="group-total">{{ formatDuration(group.total, { seconds: false }) }}</span>
        </h3>
        <ul class="rows">
          <li v-for="session in group.sessions" :key="session.id">
            <button
              type="button"
              class="row"
              :class="[session.status, { flash: flashId === session.id }]"
              :data-session="session.id"
              @click="editing = session.id"
              @contextmenu.prevent="rowMenu(session)"
            >
              <span class="mode-icon" :data-tip="MODE_LABELS[session.mode]"><AppIcon :name="MODE_ICONS[session.mode]" :size="16" /></span>
              <span class="main">
                <span class="activity" :class="{ unnamed: !session.activity }">{{ session.activity || 'Sem atividade' }}</span>
                <span class="meta">
                  <span class="time">{{ timeRange(session) }}</span>
                  <span v-if="groupBy !== 'category'" class="cat">
                    <CategoryDot
                      :color="session.categoryId ? (timer.categoryById.value.get(session.categoryId)?.color ?? null) : null"
                      :size="7"
                    />
                    {{ timer.categoryName(session.categoryId) }}
                  </span>
                  <span v-if="session.mode === 'pomodoro'">{{ session.cycles }} {{ session.cycles === 1 ? 'ciclo' : 'ciclos' }}</span>
                  <span v-if="session.status !== 'completed'" class="badge" :class="session.status">{{
                    STATUS_LABELS[session.status]
                  }}</span>
                  <span v-if="session.notes" class="has-notes" data-tip="Tem observações"><AppIcon name="edit" :size="12" /></span>
                </span>
              </span>
              <span class="dur">
                {{ formatDuration(session.duration * 1000, { seconds: false }) }}
                <small v-if="session.duration !== session.measured"
                  >{{ formatDuration(session.measured * 1000, { seconds: false }) }} medidos</small
                >
              </span>
            </button>
          </li>
        </ul>
      </section>
      <button v-if="totals.count > limit" type="button" class="btn btn-sm show-more" @click="limit += 300">
        Mostrar mais ({{ totals.count - limit }})
      </button>
    </template>

    <TimerSessionDialog :session-id="editing" @close="editing = null" />
  </div>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 220px;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-3);
}
.search:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13.5px;
}
.select.sm {
  width: auto;
  min-height: 34px;
  padding-top: 5px;
  padding-bottom: 5px;
  font-size: 13px;
}
.summary {
  font-size: 13px;
  color: var(--text-3);
}
.summary strong {
  color: var(--text);
  font-weight: 650;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 4px;
  padding: 0 10px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.group-detail {
  font-weight: 500;
  color: var(--text-3);
}
.group-total {
  margin-left: auto;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: var(--r-lg);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast);
}
.row:hover {
  background: var(--hover);
}
.row.flash {
  animation: row-flash 1.6s var(--ease-out);
}
@keyframes row-flash {
  0%,
  35% {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-strong) 50%, transparent);
  }
}
.row.canceled .activity,
.row.canceled .dur {
  color: var(--text-3);
}
.mode-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--surface-3);
  color: var(--text-2);
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.activity {
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.activity.unnamed {
  color: var(--text-3);
  font-style: italic;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 12px;
  font-size: 12px;
  color: var(--text-3);
}
.time {
  font-variant-numeric: tabular-nums;
}
.cat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.badge {
  padding: 0 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  line-height: 18px;
}
.badge.interrupted {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.badge.canceled {
  background: var(--surface-3);
  color: var(--text-2);
}
.has-notes {
  display: inline-flex;
}
.dur {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 13.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.dur small {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-3);
}
.show-more {
  align-self: center;
}
.history-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 20px;
  text-align: center;
  color: var(--text-3);
}
.history-empty h3 {
  color: var(--text);
  font-size: 15px;
}
.history-empty p {
  max-width: 420px;
  font-size: 13px;
}
.history-empty .btn {
  margin-top: 6px;
}
html[data-layout='compact'] .filters .select.sm {
  flex: 1 1 140px;
}
html[data-layout='compact'] .row {
  padding: 10px 6px;
}
</style>
