<script setup lang="ts">
/**
 * Barra lateral de navegação entre os módulos + tutorial + tema + configurações.
 *
 * - Mostra só os módulos ativos (stores/modules.ts), com ícone e nome ou só o ícone.
 * - Ligar um módulo "conecta" ele ao 4notes: o espaço dele abre, um fio sai dele
 *   até os outros módulos, o ícone encaixa (com um "clique" de luz) e um sinal corre
 *   pelo fio até cada módulo, que responde. Desligar faz o caminho contrário: os
 *   outros mandam o sinal, o fio do módulo se solta, o ícone sai e o espaço fecha.
 *   A animação leva ~2 s (ligar) e ~1,4 s (desligar), com um som curto no encaixe e
 *   no desencaixe (lib/sounds.ts, disparado por stores/modules.ts).
 * - A ordem é a do usuário: arraste um módulo para cima ou para baixo
 *   (composables/useSortableList.ts) ou use "Mover para cima/baixo" no botão direito.
 * - Com as Configurações abertas em "Módulos", o fundo escurecido cobre só a área de
 *   conteúdo (SettingsDialog): o menu fica nítido, para ver as mudanças ao vivo.
 * - Botão direito no menu: mover/desativar o módulo clicado, ligar/desligar módulos e
 *   mostrar ou não os nomes.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { separator, showContextMenu, type MenuItemSpec } from '~/composables/useContextMenu'
import { useSortableList } from '~/composables/useSortableList'
import { useTheme } from '~/composables/useTheme'
import { toggleTutorial, tutorial } from '~/composables/useTutorial'
import { isModuleId, moduleById, moduleForPath, type ModuleDefinition, type ModuleId } from '~/lib/modules'
import { modKeyLabel } from '~/lib/platform'
import { useAppStore } from '~/stores/app'
import { EFFECT_MS, useModulesStore, type ModuleEffect } from '~/stores/modules'
import { useTasksStore } from '~/stores/tasks'
import { useTimerStore } from '~/stores/timer'
import { useUpdatesStore } from '~/stores/updates'

const route = useRoute()
const app = useAppStore()
const modules = useModulesStore()
const tasks = useTasksStore()
const { theme, setTheme } = useTheme()
const mod = modKeyLabel()

const dueCount = computed(() => tasks.progress.value.total - tasks.progress.value.done)
const badgeOf = (id: ModuleId) => (id === 'tasks' ? dueCount.value : 0)
const timer = useTimerStore()
/** Timer com uma sessão em andamento: um ponto no ícone (pulsando enquanto conta). */
/** Versão nova esperando (depois de um "Agora não"): um ponto discreto na engrenagem. */
const updates = useUpdatesStore()
const updateReady = computed(() => updates.state.status === 'available' || updates.state.status === 'permission')
const liveOf = (id: ModuleId) => (id === 'timer' && timer.state.active ? (timer.state.active.runningSince !== null ? 'running' : 'paused') : null)

const labels = computed(() => modules.state.prefs.navStyle === 'icon-label')
// A largura do menu é de todo o app (a logo da barra de título se alinha com ele)
watchEffect(() => document.documentElement.style.setProperty('--rail-w', labels.value ? '64px' : '54px'))

const effects = computed(() => modules.state.effects)
const effectOf = (id: ModuleId) => effects.value.find((effect) => effect.id === id) ?? null

/** Módulos no menu, na ordem do usuário: os ativos e, até a animação acabar, o que está sendo desligado. */
const items = computed(() =>
  modules.ordered.value.filter((module) => modules.isEnabled(module.id) || effectOf(module.id)?.kind === 'disconnect'),
)
const current = computed(() => moduleForPath(route.path))

// ── Geometria (igual ao CSS) ────────────────────────────────────────────────

const geometry = computed(() =>
  labels.value ? { height: 58, gap: 6, iconY: 21 } : { height: 46, gap: 6, iconY: 23 },
)
/** Centro do ícone do item `index` (com o menu já arrumado). */
const iconY = (index: number) => index * (geometry.value.height + geometry.value.gap) + geometry.value.iconY

// ── Indicador do módulo aberto: acompanha o item (também durante as animações) ──

const list = ref<HTMLElement>()
const indicatorY = ref(0)
const following = ref(false)
let frame = 0

/** Posição do módulo aberto na tela (inclusive arrastado ou animando). */
function measure(): void {
  const active = list.value?.querySelector<HTMLElement>('.rail-item.active')
  if (active && list.value) indicatorY.value = active.getBoundingClientRect().top - list.value.getBoundingClientRect().top
}

function follow(until: number): void {
  cancelAnimationFrame(frame)
  following.value = true
  const step = () => {
    measure()
    if (performance.now() < until) frame = requestAnimationFrame(step)
    else following.value = false
  }
  frame = requestAnimationFrame(step)
}

watch([() => route.path, items, labels], () => void nextTick(measure), { immediate: true })
watch(
  () => effects.value.map((effect) => effect.seq).join(),
  () => {
    const longest = Math.max(0, ...effects.value.map((effect) => EFFECT_MS[effect.kind]))
    if (longest) follow(performance.now() + longest + 50)
  },
)
// Trocar entre "ícone e nome" e "só o ícone" anima a altura dos itens
watch(labels, () => follow(performance.now() + 320))
onMounted(measure)
onBeforeUnmount(() => cancelAnimationFrame(frame))

// ── Reorganizar: arrastar um módulo ──────────────────────────────────────────

const sortable = useSortableList({
  container: list,
  itemSelector: '.rail-item',
  keyOf: (el) => el.dataset.module ?? '',
  onReorder: (keys) => modules.setOrder(keys),
  // Durante a animação de ligar/desligar, a posição dos itens está mudando
  enabled: () => !effects.value.length,
})
// O indicador do módulo aberto vai junto enquanto você arrasta (e até o item assentar)
watch(sortable.dragging, (key) => (key ? follow(Number.POSITIVE_INFINITY) : follow(performance.now() + 280)))

function move(id: ModuleId, delta: number) {
  void sortable.flip(() => modules.moveModule(id, delta))
  follow(performance.now() + 300)
}

// ── Fios da animação (um conjunto por módulo sendo ligado/desligado) ─────────

interface Wire {
  effect: ModuleEffect
  origin: number
  top: number
  height: number
  branches: { id: ModuleId; y: number; self: boolean; delay: number }[]
  pulses: { id: ModuleId; from: number; dy: number; delay: number; duration: number }[]
}

/**
 * Velocidade do sinal no fio (px por ms) e quando ele sai. A viagem leva entre 220 e
 * 700 ms, para caber na animação (stores/modules.ts › EFFECT_MS) com qualquer número de módulos.
 */
const SPEED = 0.26
const CONNECT_SIGNAL_AT = 940
const DISCONNECT_SIGNAL_AT = 100

const wires = computed<Wire[]>(() =>
  effects.value.flatMap((effect) => {
    const index = items.value.findIndex((item) => item.id === effect.id)
    if (index < 0) return []
    const ys = items.value.map((_, i) => iconY(i))
    const origin = ys[index]!
    const top = ys[0]!
    const height = Math.max(0, ys.at(-1)! - top)
    const travel = (distance: number) => Math.min(700, Math.max(220, Math.round(distance / SPEED)))
    const branches = items.value.map((item, i) => {
      const distance = Math.abs(ys[i]! - origin)
      // Ligando: o sinal sai do módulo novo e chega aos outros; desligando: sai dos outros
      const delay = effect.kind === 'connect' ? CONNECT_SIGNAL_AT + travel(distance) : DISCONNECT_SIGNAL_AT
      return { id: item.id, y: ys[i]!, self: item.id === effect.id, delay }
    })
    const pulses = items.value
      .map((item, i) => ({ item, y: ys[i]! }))
      .filter(({ item }) => item.id !== effect.id)
      .map(({ item, y }) => {
        const duration = travel(Math.abs(y - origin))
        return effect.kind === 'connect'
          ? { id: item.id, from: origin, dy: y - origin, delay: CONNECT_SIGNAL_AT, duration }
          : { id: item.id, from: y, dy: origin - y, delay: DISCONNECT_SIGNAL_AT + 180, duration }
      })
    return [{ effect, origin, top, height, branches, pulses }]
  }),
)

/** Os outros módulos respondem quando o sinal chega (ligando) ou quando o mandam (desligando). */
function pingOf(id: ModuleId): { delay: number } | null {
  for (const wire of wires.value) {
    if (wire.effect.id === id) continue
    const branch = wire.branches.find((item) => item.id === id)
    if (branch) return { delay: branch.delay }
  }
  return null
}

function itemClasses(item: ModuleDefinition) {
  const effect = effectOf(item.id)
  return {
    active: current.value?.id === item.id,
    connecting: effect?.kind === 'connect',
    disconnecting: effect?.kind === 'disconnect',
    pinged: !effect && !!pingOf(item.id),
  }
}

// ── Botão direito: o módulo clicado, ligar/desligar módulos e os nomes ───────

async function railMenu(event: MouseEvent): Promise<void> {
  // Botão direito num módulo: mover e desativar aquele módulo
  const key = (event.target as HTMLElement | null)?.closest<HTMLElement>('.rail-item')?.dataset.module
  const clicked = isModuleId(key) && modules.isEnabled(key) ? key : null
  const visible = modules.enabled.value.map((module) => module.id)
  const position = clicked ? visible.indexOf(clicked) : -1
  const own: MenuItemSpec[] = clicked
    ? [
        { id: 'up', label: 'Mover para cima', enabled: position > 0 },
        { id: 'down', label: 'Mover para baixo', enabled: position < visible.length - 1 },
        { id: 'disable', label: `Desativar ${moduleById(clicked).name}`, enabled: modules.canDisable(clicked) },
        separator,
      ]
    : []
  const menu: MenuItemSpec[] = [
    ...own,
    ...modules.ordered.value.map((module) => ({
      id: `module:${module.id}`,
      label: module.name,
      type: 'checkbox' as const,
      checked: modules.isEnabled(module.id),
      // O último módulo ativo não sai
      enabled: !modules.isEnabled(module.id) || modules.canDisable(module.id),
    })),
    separator,
    { id: 'labels', label: 'Mostrar os nomes', type: 'checkbox', checked: labels.value },
    separator,
    { id: 'settings', label: 'Configurações dos módulos…' },
    { id: 'tutorial', label: 'Tutorial', hint: 'F1' },
  ]
  const choice = await showContextMenu(menu)
  if (!choice) return
  if (clicked && (choice === 'up' || choice === 'down')) {
    move(clicked, choice === 'up' ? -1 : 1)
  } else if (clicked && choice === 'disable') {
    modules.setEnabled(clicked, false)
  } else if (choice.startsWith('module:')) {
    const id = choice.slice('module:'.length) as ModuleId
    modules.setEnabled(id, !modules.isEnabled(id))
  } else if (choice === 'labels') {
    modules.setNavStyle(labels.value ? 'icon' : 'icon-label')
  } else if (choice === 'settings') {
    app.openSettings('modules')
  } else if (choice === 'tutorial') {
    toggleTutorial(current.value?.id ?? 'general')
  }
}

function toggleTheme(event: MouseEvent) {
  const next = theme.resolved === 'dark' ? 'light' : 'dark'
  void setTheme(next, { x: event.clientX, y: event.clientY })
}
</script>

<template>
  <nav class="rail" :class="{ labels, icons: !labels }" aria-label="Módulos" @contextmenu.prevent="railMenu">
    <div ref="list" class="rail-items" @pointerdown="sortable.onPointerDown">
      <span
        v-if="current && items.some((item) => item.id === current!.id)"
        class="rail-indicator"
        :class="{ following }"
        :style="{ transform: `translateY(${indicatorY}px)` }"
        aria-hidden="true"
      />

      <!-- Fios da animação de ligar/desligar (por trás dos ícones) -->
      <div
        v-for="wire in wires"
        :key="wire.effect.seq"
        class="wires"
        :class="wire.effect.kind"
        :style="{ '--origin': `${wire.origin}px`, '--total': `${EFFECT_MS[wire.effect.kind]}ms` }"
        aria-hidden="true"
      >
        <span class="bus" :style="{ top: `${wire.top}px`, height: `${wire.height}px`, transformOrigin: `50% ${wire.origin - wire.top}px` }" />
        <span
          v-for="branch in wire.branches"
          :key="branch.id"
          class="branch"
          :class="{ self: branch.self }"
          :style="{ top: `${branch.y}px`, '--delay': `${branch.delay}ms` }"
        />
        <span
          v-for="pulse in wire.pulses"
          :key="pulse.id"
          class="pulse"
          :style="{ top: `${pulse.from}px`, '--dy': `${pulse.dy}px`, '--delay': `${pulse.delay}ms`, '--travel': `${pulse.duration}ms` }"
        />
      </div>

      <NuxtLink
        v-for="item in items"
        :key="item.id"
        :to="item.route"
        class="rail-item"
        :class="itemClasses(item)"
        :style="pingOf(item.id) ? { '--ping': `${pingOf(item.id)!.delay}ms` } : undefined"
        :data-module="item.id"
        :data-tip="`${item.name}${liveOf(item.id) ? (liveOf(item.id) === 'running' ? ' (contando)' : ' (pausado)') : ''}  ·  ${mod}+${item.key}`"
        data-tip-pos="right"
        :aria-label="item.name"
        :tabindex="effectOf(item.id)?.kind === 'disconnect' ? -1 : undefined"
        draggable="false"
        @dragstart.prevent
      >
        <span class="rail-icon">
          <AppIcon :name="item.icon" :size="21" />
          <span class="plug-ring" aria-hidden="true" />
          <Transition name="pop">
            <span v-if="badgeOf(item.id) > 0" class="rail-badge">{{ badgeOf(item.id) > 99 ? '99+' : badgeOf(item.id) }}</span>
          </Transition>
          <Transition name="pop">
            <span v-if="liveOf(item.id)" class="rail-live" :class="liveOf(item.id)" data-live aria-hidden="true" />
          </Transition>
        </span>
        <span class="rail-label">{{ item.label }}</span>
      </NuxtLink>
    </div>

    <div class="rail-bottom">
      <button
        class="rail-button"
        :data-tip="theme.resolved === 'dark' ? 'Tema claro' : 'Tema escuro'"
        data-tip-pos="right"
        aria-label="Alternar tema"
        @click="toggleTheme"
      >
        <Transition name="spin" mode="out-in">
          <AppIcon :key="theme.resolved" :name="theme.resolved === 'dark' ? 'sun' : 'moon'" :size="19" />
        </Transition>
      </button>
      <!-- Tutorial logo abaixo do tema (e acima das configurações) -->
      <button
        class="rail-button"
        :class="{ on: tutorial.open }"
        data-tutorial-toggle
        :data-tip="`Tutorial${current ? ` de ${current.name}` : ''}  ·  F1`"
        data-tip-pos="right"
        aria-label="Tutorial do módulo"
        :aria-expanded="tutorial.open"
        @click="toggleTutorial(current?.id ?? 'general')"
      >
        <AppIcon name="help" :size="19" />
      </button>
      <button
        class="rail-button rail-settings"
        :data-tip="updateReady ? 'Configurações  ·  versão nova disponível' : `Configurações  ·  ${mod}+,`"
        data-tip-pos="right"
        aria-label="Configurações"
        @click="app.openSettings()"
      >
        <AppIcon name="settings" :size="19" />
        <span v-if="updateReady" class="rail-update" data-update-dot aria-hidden="true" />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.rail {
  /* Geometria dos itens (a mesma de `geometry` no script) */
  --item-h: 58px;
  --item-gap: 6px;
  --icon-y: 21px;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: var(--rail-w);
  padding: 6px 0 12px;
  background: var(--chrome);
  transition: width 260ms var(--ease-out);
  /* Telas baixas (celular deitado): o menu rola em vez de cortar os botões de baixo */
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}
.rail.icons {
  --item-h: 46px;
  --icon-y: 23px;
}
.rail-items {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
}
.rail-indicator {
  position: absolute;
  top: 0;
  left: 6px;
  width: calc(var(--rail-w) - 12px);
  height: var(--item-h);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
  transition:
    transform 320ms var(--ease-spring),
    height 260ms var(--ease-out),
    width 260ms var(--ease-out);
}
.rail-indicator.following {
  transition:
    height 260ms var(--ease-out),
    width 260ms var(--ease-out);
}
.rail-indicator::before {
  content: '';
  position: absolute;
  left: -6px;
  top: calc(var(--item-h) / 2 - 10px);
  width: 3px;
  height: 20px;
  border-radius: 0 3px 3px 0;
  background: var(--accent-strong);
  transition: top 260ms var(--ease-out);
}
.rail-item {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 100%;
  height: var(--item-h);
  margin-bottom: var(--item-gap);
  color: var(--text-3);
  text-decoration: none;
  transition:
    color var(--t-med),
    height 260ms var(--ease-out);
}
.icons .rail-item {
  gap: 0;
}
.rail-item:hover {
  color: var(--text);
}
.rail-item.active {
  color: var(--primary-text);
}
.rail-icon {
  position: relative;
  display: grid;
  place-items: center;
  transition: transform var(--t-med) var(--ease-spring);
}
.rail-label {
  max-height: 16px;
  overflow: hidden;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  transition:
    opacity 180ms var(--ease-out),
    max-height 260ms var(--ease-out);
}
.icons .rail-label {
  max-height: 0;
  opacity: 0;
}
.rail-badge {
  position: absolute;
  top: -6px;
  right: -10px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--chrome);
}
/* Timer com uma sessão em andamento: um ponto amarelo (pulsando enquanto conta) */
.rail-live {
  position: absolute;
  top: -3px;
  right: -5px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent-strong);
  box-shadow: 0 0 0 2px var(--chrome);
}
.rail-live.paused {
  background: var(--text-3);
}
.rail-live.running::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--accent);
  animation: live-pulse 1.8s var(--ease-out) infinite;
}
@keyframes live-pulse {
  from {
    transform: scale(1);
    opacity: 0.75;
  }
  to {
    transform: scale(2.7);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rail-live.running::after {
    animation: none;
  }
}
.rail-bottom {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: auto;
}
.rail-settings {
  position: relative;
}
.rail-update {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 0 2px var(--chrome);
}
.rail-button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast), transform var(--t-fast) var(--ease-out);
}
.rail-button:hover {
  background: var(--hover);
  color: var(--text);
}
.rail-button.on {
  background: var(--primary-soft);
  color: var(--primary-text);
}

.spin-enter-active,
.spin-leave-active {
  transition: transform 260ms var(--ease-out), opacity 200ms;
}
.spin-enter-from {
  transform: rotate(-90deg) scale(0.6);
  opacity: 0;
}
.spin-leave-to {
  transform: rotate(90deg) scale(0.6);
  opacity: 0;
}

/* ── Ligar / desligar um módulo ─────────────────────────────────────────── */

/* Anel de luz em volta do ícone (o "clique" do encaixe) */
.plug-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 34px;
  height: 34px;
  margin: -17px 0 0 -17px;
  border-radius: 50%;
  border: 2px solid var(--primary);
  box-shadow: 0 0 12px var(--primary-soft-2);
  opacity: 0;
  pointer-events: none;
}

/* Ligando: o espaço abre, o ícone entra de lado e encaixa, o anel "clica", o nome aparece */
.rail-item.connecting {
  pointer-events: none;
  animation: slot-open 420ms var(--ease-out) both;
}
.rail-item.connecting .rail-icon {
  animation: plug-in 680ms 320ms var(--ease-spring) both;
}
.rail-item.connecting .plug-ring {
  animation: ring-snap 900ms 860ms var(--ease-out) both;
}
.rail-item.connecting .rail-label {
  animation: label-in 360ms 820ms var(--ease-out) both;
}

/* Desligando: o anel fecha, o ícone se solta para o lado, o espaço fecha */
.rail-item.disconnecting {
  pointer-events: none;
  animation: slot-close 380ms 1000ms var(--ease-in-out) both;
}
.rail-item.disconnecting .plug-ring {
  animation: ring-release 640ms 300ms var(--ease-out) both;
}
.rail-item.disconnecting .rail-icon {
  animation: unplug 560ms 520ms cubic-bezier(0.5, 0, 0.75, 0) both;
}
.rail-item.disconnecting .rail-label {
  animation: label-out 300ms 420ms ease-in both;
}

/* Reorganizando: o módulo arrastado fica "levantado" */
.rail-item.is-sorting-item {
  cursor: grabbing;
}
.rail-item.is-sorting-item::before {
  content: '';
  position: absolute;
  inset: 0 6px;
  z-index: -1;
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  box-shadow: var(--shadow-md), 0 0 0 1px var(--primary-soft-2);
}

/* Os outros módulos respondem ao sinal */
.rail-item.pinged .rail-icon {
  animation: ping 560ms var(--ping, 0ms) var(--ease-out) both;
}

.wires {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
/* O fio que liga todos os módulos, na borda do menu */
.bus {
  position: absolute;
  left: 3px;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(to bottom, var(--primary), var(--accent-strong), var(--primary));
  box-shadow: 0 0 6px var(--primary-soft-2);
}
.wires.connect .bus {
  animation: bus-draw var(--total) var(--ease-out) both;
}
.wires.disconnect .bus {
  animation: bus-release var(--total) var(--ease-in-out) both;
}
/* A ligação de cada módulo com o fio */
.branch {
  position: absolute;
  left: 4px;
  width: calc(var(--rail-w) / 2 - 17px);
  height: 2px;
  margin-top: -1px;
  border-radius: 2px;
  background: linear-gradient(to right, var(--primary), var(--accent-strong));
  transform-origin: left center;
  transform: scaleX(0);
  opacity: 0;
}
.wires.connect .branch.self {
  animation: branch-plug var(--total) var(--ease-out) both;
}
.wires.connect .branch:not(.self) {
  animation: branch-flash 560ms var(--delay) var(--ease-out) both;
}
.wires.disconnect .branch.self {
  animation: branch-unplug var(--total) var(--ease-in-out) both;
}
.wires.disconnect .branch:not(.self) {
  animation: branch-flash 560ms var(--delay) var(--ease-out) both;
}
/* O sinal que corre pelo fio */
.pulse {
  position: absolute;
  left: 1px;
  width: 6px;
  height: 6px;
  margin-top: -3px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow:
    0 0 6px 1px var(--accent),
    0 0 12px var(--primary-soft-2);
  opacity: 0;
  animation: pulse-travel var(--travel) var(--delay) cubic-bezier(0.45, 0, 0.25, 1) both;
}

@keyframes slot-open {
  from {
    height: 0;
    margin-bottom: 0;
  }
}
@keyframes slot-close {
  to {
    height: 0;
    margin-bottom: 0;
  }
}
@keyframes plug-in {
  from {
    opacity: 0;
    transform: translateX(18px) scale(0.5);
  }
  55% {
    opacity: 1;
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes unplug {
  from {
    transform: none;
    opacity: 1;
  }
  to {
    transform: translateX(20px) scale(0.5) rotate(8deg);
    opacity: 0;
  }
}
@keyframes ring-snap {
  /* Invisível até o encaixe (o primeiro quadro vale durante a espera) */
  0% {
    opacity: 0;
    transform: scale(0.55);
  }
  8% {
    opacity: 0.95;
    transform: scale(0.65);
  }
  100% {
    opacity: 0;
    transform: scale(1.9);
  }
}
@keyframes ring-release {
  0% {
    opacity: 0;
    transform: scale(1.8);
  }
  50% {
    opacity: 0.9;
  }
  100% {
    opacity: 0;
    transform: scale(0.5);
  }
}
@keyframes label-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
}
@keyframes label-out {
  to {
    opacity: 0;
    transform: translateY(3px);
  }
}
@keyframes ping {
  0% {
    transform: none;
  }
  35% {
    transform: scale(1.16);
    color: var(--primary-text);
    filter: drop-shadow(0 0 5px var(--primary-soft-2));
  }
  100% {
    transform: none;
  }
}
/* Os tempos em % são da animação inteira (--total = EFFECT_MS: 2,2 s ligando, 1,4 s desligando) */
@keyframes bus-draw {
  0% {
    opacity: 0;
    transform: scaleY(0);
  }
  10% {
    opacity: 1;
  }
  34% {
    transform: scaleY(1);
  }
  82% {
    opacity: 1;
    transform: scaleY(1);
  }
  100% {
    opacity: 0;
    transform: scaleY(1);
  }
}
@keyframes bus-release {
  0% {
    opacity: 0;
    transform: scaleY(1);
  }
  12% {
    opacity: 1;
  }
  64% {
    opacity: 1;
    transform: scaleY(1);
  }
  92% {
    opacity: 0.5;
    transform: scaleY(0);
  }
  100% {
    opacity: 0;
    transform: scaleY(0);
  }
}
@keyframes branch-plug {
  0%,
  20% {
    opacity: 0;
    transform: scaleX(0);
  }
  24% {
    opacity: 1;
  }
  38% {
    opacity: 1;
    transform: scaleX(1);
  }
  82% {
    opacity: 1;
    transform: scaleX(1);
  }
  100% {
    opacity: 0;
    transform: scaleX(1);
  }
}
@keyframes branch-unplug {
  0% {
    opacity: 0;
    transform: scaleX(1);
  }
  12% {
    opacity: 1;
    transform: scaleX(1);
  }
  50% {
    opacity: 1;
    transform: scaleX(1);
  }
  72% {
    opacity: 0.6;
    transform: scaleX(0);
  }
  100% {
    opacity: 0;
    transform: scaleX(0);
  }
}
@keyframes branch-flash {
  0% {
    opacity: 0;
    transform: scaleX(0);
  }
  35% {
    opacity: 1;
    transform: scaleX(1);
  }
  100% {
    opacity: 0;
    transform: scaleX(1);
  }
}
@keyframes pulse-travel {
  0% {
    opacity: 0;
    transform: translateY(0) scale(0.6);
  }
  15% {
    opacity: 1;
    transform: translateY(calc(var(--dy) * 0.08)) scale(1);
  }
  85% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(var(--dy)) scale(0.7);
  }
}

@media (prefers-reduced-motion: reduce) {
  .rail,
  .rail-item,
  .rail-indicator,
  .rail-label {
    transition: none;
  }
}
</style>
