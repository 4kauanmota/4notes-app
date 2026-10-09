/**
 * Preferências dos módulos:
 *  - quais módulos estão ativos (aparecem no menu lateral) e em que ordem, e como o
 *    menu lateral mostra os módulos (ícone e nome, ou só o ícone) — configurações do
 *    workspace (.4notes/settings.json), as mesmas no computador e no celular;
 *  - o último módulo aberto — deste aparelho (lib/storage/device-state.ts).
 *
 * Desativar ou reorganizar um módulo é só uma preferência de exibição: o store dele
 * continua carregando, salvando e acompanhando os arquivos normalmente (nada é
 * apagado), e ao ativar de novo ele volta com tudo como estava.
 */
import { computed, reactive } from 'vue'
import { showToast } from '~/composables/useToasts'
import {
  canDisable,
  DEFAULT_PREFS,
  enabledModules,
  isEnabledIn,
  isModuleId,
  moduleById,
  movedBy,
  normalizePrefs,
  orderedModules,
  reorderedIds,
  withModuleEnabled,
  type ModuleId,
  type ModulePrefs,
  type NavStyle,
} from '~/lib/modules'
import { playModuleSound } from '~/lib/sounds'
import { readDeviceState, writeDeviceState } from '~/lib/storage/device-state'
import { flushSettings, onSettingsChange, settingsSection, updateSettingsSection } from './settings'

/** Animação de ligar/desligar um módulo no menu lateral (NavRail.vue). */
export interface ModuleEffect {
  id: ModuleId
  kind: 'connect' | 'disconnect'
  /** Muda a cada animação (reinicia a animação mesmo no mesmo módulo). */
  seq: number
}

/** Duração das animações (o módulo desligado continua no menu até a dele acabar). */
export const EFFECT_MS = { connect: 2200, disconnect: 1400 } as const
/**
 * Quando o som toca, dentro da animação (NavRail.vue): ligando, no "encaixe" do ícone
 * (o anel de luz); desligando, quando o ícone se solta.
 */
export const SOUND_AT_MS = { connect: 860, disconnect: 480 } as const

const state = reactive({
  prefs: { disabled: [], order: [...DEFAULT_PREFS.order], navStyle: DEFAULT_PREFS.navStyle } as ModulePrefs,
  lastModule: 'notes' as ModuleId,
  effects: [] as ModuleEffect[],
})

let seq = 0

function save(): void {
  updateSettingsSection('modules', { disabled: state.prefs.disabled, order: state.prefs.order, navStyle: state.prefs.navStyle })
}

async function load(): Promise<void> {
  state.prefs = normalizePrefs({ modules: settingsSection('modules') })
  const last = readDeviceState('app')?.lastModule
  if (isModuleId(last)) state.lastModule = last
}

// Mudou em outro aparelho (settings.json relido): vale aqui também
onSettingsChange((changed) => {
  if (changed.has('modules')) state.prefs = normalizePrefs({ modules: settingsSection('modules') })
})

const enabled = computed(() => enabledModules(state.prefs))
/** Todos os módulos, na ordem do menu (as Configurações listam assim). */
const ordered = computed(() => orderedModules(state.prefs))
const isEnabled = (id: ModuleId) => isEnabledIn(state.prefs, id)

/** O último módulo aberto, se ainda estiver ativo; senão, o primeiro ativo. */
const startModule = computed<ModuleId>(() => (isEnabled(state.lastModule) ? state.lastModule : (enabled.value[0]?.id ?? 'notes')))

function remember(module: ModuleId): void {
  if (state.lastModule === module) return
  state.lastModule = module
  writeDeviceState('app', { lastModule: module })
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function playEffect(id: ModuleId, kind: ModuleEffect['kind']): void {
  const sound = kind === 'connect' ? 'connect' : 'disconnect'
  if (reducedMotion()) {
    // Sem animação: o som toca na hora
    playModuleSound(sound)
    return
  }
  const effect: ModuleEffect = { id, kind, seq: ++seq }
  state.effects = [...state.effects.filter((item) => item.id !== id), effect]
  // O som acompanha a animação (se ela foi trocada por outra antes, não toca)
  setTimeout(() => {
    if (state.effects.some((item) => item.seq === effect.seq)) playModuleSound(sound)
  }, SOUND_AT_MS[kind])
  setTimeout(() => {
    // Pelo número: dentro do estado reativo a animação é outro objeto (proxy do Vue)
    state.effects = state.effects.filter((item) => item.seq !== effect.seq)
  }, EFFECT_MS[kind])
}

/**
 * Liga/desliga um módulo (só a exibição: os dados continuam no workspace).
 * Pelo menos um módulo fica ativo. Devolve true se mudou.
 */
function setEnabled(id: ModuleId, on: boolean): boolean {
  const disabled = withModuleEnabled(state.prefs, id, on)
  if (!disabled) return false
  state.prefs = { ...state.prefs, disabled }
  playEffect(id, on ? 'connect' : 'disconnect')
  save()
  return true
}

/**
 * Nova ordem de uma parte dos módulos (os do menu, arrastando; ou todos, nas
 * Configurações): os outros ficam onde estavam. Devolve true se mudou.
 */
function setOrder(ids: readonly string[]): boolean {
  const order = reorderedIds(state.prefs.order, ids)
  if (!order) return false
  state.prefs = { ...state.prefs, order }
  save()
  return true
}

/** Sobe (−1) ou desce (+1) o módulo entre os do menu lateral (botão direito). */
function moveModule(id: ModuleId, delta: number): boolean {
  const visible = enabled.value.map((module) => module.id)
  const moved = movedBy(visible, id, delta)
  return moved ? setOrder(moved) : false
}

function setNavStyle(navStyle: NavStyle): void {
  if (state.prefs.navStyle === navStyle) return
  state.prefs = { ...state.prefs, navStyle }
  save()
}

/**
 * Abrir algo de um módulo (uma menção, um atalho): se ele estiver desativado,
 * avisa e oferece "Ativar" — que ativa o módulo e segue com `then`.
 */
function requireModule(id: ModuleId, then: () => void): boolean {
  if (isEnabled(id)) return true
  showToast({
    message: `O módulo ${moduleById(id).name} está desativado.`,
    icon: 'info',
    action: {
      label: 'Ativar',
      run: () => {
        setEnabled(id, true)
        then()
      },
    },
  })
  return false
}

export function useModulesStore() {
  return {
    state,
    enabled,
    ordered,
    startModule,
    load,
    flush: flushSettings,
    remember,
    isEnabled,
    canDisable: (id: ModuleId) => canDisable(state.prefs, id),
    setEnabled,
    setOrder,
    moveModule,
    setNavStyle,
    requireModule,
  }
}
