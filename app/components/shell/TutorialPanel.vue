<script setup lang="ts">
/**
 * Tutoriais: um painel ao lado do menu lateral, por cima do módulo — sem fundo
 * escurecido, para ler e já testar. Abre no tutorial do módulo atual ("?" do menu ou
 * F1) e acompanha a troca de módulo pelo teclado; as abas no topo mostram os outros
 * (na ordem do menu) e o "Geral". Fecha com ×, "?", F1, Esc ou clicando fora dele.
 *
 * O conteúdo vem de lib/modules.ts (cada módulo tem o seu tutorial): um módulo
 * novo aparece aqui sozinho.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLayoutSize } from '~/composables/useLayoutSize'
import { registerShortcut } from '~/composables/useShortcuts'
import { closeTutorial, tutorial, type TutorialTopic } from '~/composables/useTutorial'
import { GENERAL_TUTORIAL, moduleById, moduleForPath, type ModuleTutorial } from '~/lib/modules'
import { modKeyLabel } from '~/lib/platform'
import { useModulesStore } from '~/stores/modules'

const route = useRoute()
const modules = useModulesStore()
const mod = modKeyLabel()
const panel = ref<HTMLElement>()
/** Celular / tela de toque: o "botão direito" é o toque prolongado; atalhos só com teclado. */
const { layout } = useLayoutSize()

const topics = computed(() => [
  ...modules.ordered.value.map((module) => ({ id: module.id as TutorialTopic, label: module.label, icon: module.icon, enabled: modules.isEnabled(module.id) })),
  { id: 'general' as TutorialTopic, label: 'Geral', icon: 'sparkle', enabled: true },
])

const content = computed<{ title: string; icon: string; tutorial: ModuleTutorial; disabled: boolean }>(() => {
  if (tutorial.topic === 'general') return { title: '4notes', icon: 'sparkle', tutorial: GENERAL_TUTORIAL, disabled: false }
  const module = moduleById(tutorial.topic)
  return { title: module.name, icon: module.icon, tutorial: module.tutorial, disabled: !modules.isEnabled(module.id) }
})

/** "Mod" vira Ctrl (ou ⌘ no macOS). */
const keyLabel = (key: string) => (key === 'Mod' ? mod : key)

function enableCurrent() {
  if (tutorial.topic !== 'general') modules.setEnabled(tutorial.topic, true)
}

// Trocou de módulo com o painel aberto: mostra o tutorial dele
watch(
  () => route.path,
  (path) => {
    const module = moduleForPath(path)
    if (tutorial.open && module) tutorial.topic = module.id
  },
)

// ── Esc fecha (menos quando você está digitando fora do painel) ──────────────

let previousFocus: HTMLElement | null = null
let disposeEscape: (() => void) | null = null
/** Quantas vezes o painel abriu (para saber se um clique o fechou e reabriu). */
let openCount = 0

function isTypingOutside(target: Element | null): boolean {
  if (!target || panel.value?.contains(target)) return false
  return (target as HTMLElement).isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

watch(
  () => tutorial.open,
  async (open) => {
    disposeEscape?.()
    disposeEscape = null
    listenOutside(open)
    if (!open) {
      // Volta para onde você estava (se o foco tinha ido para o painel)
      if (panel.value?.contains(document.activeElement)) previousFocus?.focus()
      return
    }
    openCount++
    previousFocus = document.activeElement as HTMLElement | null
    disposeEscape = registerShortcut(
      'escape',
      () => {
        if (isTypingOutside(document.activeElement)) return false
        closeTutorial()
      },
      { allowInInputs: true },
    )
    await nextTick()
    panel.value?.querySelector<HTMLElement>('.tp-body')?.scrollTo({ top: 0 })
  },
)
watch(
  () => tutorial.topic,
  () => void nextTick(() => panel.value?.querySelector<HTMLElement>('.tp-body')?.scrollTo({ top: 0 })),
)
onBeforeUnmount(() => {
  disposeEscape?.()
  listenOutside(false)
})

// ── Clique fora fecha (como o painel da tarefa e o da nota do mapa) ──────────

/** O clique começou fora do painel (arrastar a partir de dentro não conta). */
let pressedOutside = false

function isOutside(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || panel.value?.contains(target)) return false
  // Quem abre/fecha o tutorial ("?", Configurações) cuida dele sozinho
  return !target.closest('[data-tutorial-toggle]')
}

function onPointerDown(event: PointerEvent): void {
  pressedOutside = event.button === 0 && isOutside(event.target)
}

function onClick(event: MouseEvent): void {
  const outside = pressedOutside
  pressedOutside = false
  // detail 0 = Enter/Espaço num botão (não é clicar fora); is-sorting = fim de um
  // arraste para reorganizar os módulos (não é um clique)
  if (!outside || event.detail === 0 || !isOutside(event.target) || document.documentElement.classList.contains('is-sorting')) return
  const session = openCount
  // O clique faz o que ele faz normalmente; se ele mesmo fechou e reabriu o tutorial, fica aberto
  setTimeout(() => {
    if (tutorial.open && openCount === session) closeTutorial()
  })
}

function listenOutside(on: boolean): void {
  pressedOutside = false
  if (on) {
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('click', onClick, true)
  } else {
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('click', onClick, true)
  }
}
</script>

<template>
  <Transition name="tutorial">
    <aside v-if="tutorial.open" ref="panel" class="tutorial-panel" role="complementary" aria-label="Tutorial" tabindex="-1">
      <header class="tp-head">
        <span class="tp-heading"><AppIcon name="help" :size="16" /> Tutorial</span>
        <button class="icon-btn sm" data-tip="Fechar  ·  F1" aria-label="Fechar o tutorial" @click="closeTutorial()"><AppIcon name="x" :size="16" /></button>
      </header>

      <nav class="tp-topics" role="tablist" aria-label="Tutoriais">
        <button
          v-for="topic in topics"
          :key="topic.id"
          type="button"
          role="tab"
          class="tp-topic"
          :class="{ active: tutorial.topic === topic.id, off: !topic.enabled }"
          :aria-selected="tutorial.topic === topic.id"
          :data-topic="topic.id"
          :data-tip="topic.enabled ? undefined : 'Módulo desativado'"
          @click="tutorial.topic = topic.id"
        >
          <AppIcon :name="topic.icon" :size="13" />
          {{ topic.label }}
        </button>
      </nav>

      <Transition name="tp-swap" mode="out-in">
        <div :key="tutorial.topic" class="tp-body" role="tabpanel">
          <div class="tp-title">
            <span class="tp-tile"><AppIcon :name="content.icon" :size="18" /></span>
            <h2>{{ content.title }}</h2>
          </div>
          <p class="tp-purpose">{{ content.tutorial.purpose }}</p>

          <div v-if="content.disabled" class="tp-disabled">
            <span>Módulo desativado — os dados dele continuam guardados.</span>
            <button class="btn btn-sm btn-primary" @click="enableCurrent">Ativar</button>
          </div>

          <section>
            <h3 class="tp-label">O que dá para fazer</h3>
            <ul class="tp-list">
              <li v-for="item in content.tutorial.features" :key="item">{{ item }}</li>
            </ul>
          </section>

          <section v-if="layout.touch && content.tutorial.touch?.length" class="tp-touch">
            <h3 class="tp-label">No toque</h3>
            <ul class="tp-list touch">
              <li v-for="item in content.tutorial.touch" :key="item">{{ item }}</li>
            </ul>
          </section>

          <section v-if="content.tutorial.contextMenu.length">
            <h3 class="tp-label">{{ layout.touch ? 'Toque prolongado (botão direito)' : 'Botão direito' }}</h3>
            <ul class="tp-list menu">
              <li v-for="item in content.tutorial.contextMenu" :key="item">{{ item }}</li>
            </ul>
          </section>

          <section v-if="content.tutorial.tips.length">
            <h3 class="tp-label">Você sabia?</h3>
            <ul class="tp-list tips">
              <li v-for="item in content.tutorial.tips" :key="item">{{ item }}</li>
            </ul>
          </section>

          <section v-if="content.tutorial.shortcuts.length">
            <h3 class="tp-label">{{ layout.touch ? 'Atalhos (com teclado físico)' : 'Atalhos' }}</h3>
            <dl class="tp-shortcuts">
              <div v-for="item in content.tutorial.shortcuts" :key="item.label" class="tp-shortcut">
                <dt>
                  <template v-for="(key, index) in item.keys" :key="key">
                    <span v-if="index" class="plus">+</span><kbd class="kbd">{{ keyLabel(key) }}</kbd>
                  </template>
                </dt>
                <dd>{{ item.label }}</dd>
              </div>
            </dl>
          </section>
        </div>
      </Transition>

      <footer v-if="!layout.touch" class="tp-foot"><kbd class="kbd">F1</kbd> abre e fecha o tutorial do módulo em que você está</footer>
    </aside>
  </Transition>
</template>

<style scoped>
.tutorial-panel {
  position: fixed;
  /* --safe-*: margens do Android de ponta a ponta (no desktop são 0) */
  top: calc(var(--titlebar-h) + var(--safe-top) + 8px);
  bottom: calc(10px + var(--safe-bottom));
  left: calc(var(--rail-w) + var(--safe-left) + 6px);
  z-index: 800;
  display: flex;
  flex-direction: column;
  width: min(380px, calc(100vw - var(--rail-w) - var(--safe-left) - var(--safe-right) - 24px));
  border-radius: var(--r-xl);
  border: 1px solid var(--border);
  background: var(--elevated);
  box-shadow: var(--shadow-lg);
  outline: none;
  transition: left 260ms var(--ease-out);
}
/* Celular: sem menu lateral — o painel ocupa a largura, entre a barra de cima e a de baixo */
html[data-layout='compact'] .tutorial-panel {
  top: calc(var(--titlebar-h) + var(--safe-top) + 6px);
  bottom: calc(var(--bottom-nav-h) + var(--safe-bottom) + 8px);
  left: calc(var(--safe-left) + 8px);
  width: calc(100vw - var(--safe-left) - var(--safe-right) - 16px);
}
html[data-touch] .tp-topic {
  height: 34px;
  padding: 0 10px;
  font-size: 13px;
}
html[data-touch] .tp-list li {
  font-size: 14px;
}
.tp-list.touch li::before {
  background: var(--accent-strong);
  border-radius: 1.5px;
}
.tp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 10px 6px 16px;
}
.tp-heading {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--primary-text);
}
.tp-topics {
  display: flex;
  /* Módulos novos quebram para a linha de baixo (nada fica escondido) */
  flex-wrap: wrap;
  gap: 4px 2px;
  padding: 2px 12px 10px;
  border-bottom: 1px solid var(--border);
}
.tp-topic {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  height: 28px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--t-fast),
    color var(--t-fast),
    border-color var(--t-fast);
}
.tp-topic:hover {
  background: var(--hover);
  color: var(--text);
}
.tp-topic.active {
  border-color: color-mix(in srgb, var(--primary) 35%, transparent);
  background: var(--primary-soft);
  color: var(--primary-text);
}
.tp-topic.off:not(.active) {
  opacity: 0.55;
}
.tp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 18px 8px;
}
.tp-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tp-title h2 {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
}
.tp-tile {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary-text);
}
.tp-purpose {
  margin-top: 8px;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.5;
}
.tp-disabled {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 8px 10px 8px 12px;
  border-radius: var(--r-md);
  border: 1px dashed var(--border-strong);
  color: var(--text-2);
  font-size: 12.5px;
}
.tp-disabled span {
  flex: 1;
}
section {
  margin-top: 16px;
}
.tp-label {
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
}
.tp-list {
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tp-list li {
  position: relative;
  padding-left: 14px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
}
.tp-list li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 0.62em;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--primary);
}
.tp-list.menu li::before {
  border-radius: 1.5px;
  background: color-mix(in srgb, var(--primary) 55%, var(--text-3));
}
.tp-list.tips li::before {
  background: var(--accent-strong);
}
.tp-shortcuts {
  display: grid;
  gap: 7px;
  margin: 0;
}
.tp-shortcut {
  display: grid;
  grid-template-columns: 128px 1fr;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}
.tp-shortcut dt {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
}
.tp-shortcut dd {
  margin: 0;
  color: var(--text-2);
}
.plus {
  color: var(--text-3);
  font-size: 11px;
}
.tp-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--border);
  color: var(--text-3);
  font-size: 11.5px;
}

.tutorial-enter-active {
  transition:
    transform 260ms var(--ease-out),
    opacity 200ms var(--ease-out);
}
.tutorial-leave-active {
  transition:
    transform 160ms ease,
    opacity 140ms ease;
}
.tutorial-enter-from,
.tutorial-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}
.tp-swap-enter-active,
.tp-swap-leave-active {
  transition:
    opacity 120ms var(--ease-out),
    transform 160ms var(--ease-out);
}
.tp-swap-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.tp-swap-leave-to {
  opacity: 0;
}
</style>
