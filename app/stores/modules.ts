/**
 * Preferências dos módulos, guardadas no workspace (.4notes/app.json):
 *  - quais módulos estão ativos (aparecem no menu lateral);
 *  - como o menu lateral mostra os módulos (ícone e nome, ou só o ícone);
 *  - o último módulo aberto.
 *
 * Desativar um módulo é só uma preferência de exibição: o store dele continua
 * carregando, salvando e acompanhando os arquivos normalmente (nada é apagado), e
 * ao ativar de novo ele volta com tudo como estava.
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
  normalizePrefs,
  withModuleEnabled,
  type ModuleId,
  type ModulePrefs,
  type NavStyle,
} from '~/lib/modules'
import { createJsonWriter, readJsonFile } from '~/lib/storage/json-file'
import { DATA_PATHS } from '~/lib/storage/paths'

/** Animação de ligar/desligar um módulo no menu lateral (NavRail.vue). */
export interface ModuleEffect {
  id: ModuleId
  kind: 'connect' | 'disconnect'
  /** Muda a cada animação (reinicia a animação mesmo no mesmo módulo). */
  seq: number
}

/** Duração das animações (o módulo desligado continua no menu até a dele acabar). */
export const EFFECT_MS = { connect: 1300, disconnect: 900 } as const

const state = reactive({
  prefs: { ...DEFAULT_PREFS, disabled: [] } as ModulePrefs,
  lastModule: 'notes' as ModuleId,
  effects: [] as ModuleEffect[],
})

/** Outras chaves do app.json (de outra versão do 4notes): continuam no arquivo. */
let extra: Record<string, unknown> = {}
let seq = 0
const writer = createJsonWriter(DATA_PATHS.appUiState, 250)

function save(): void {
  writer.save(() => ({ ...extra, lastModule: state.lastModule, modules: { disabled: state.prefs.disabled, navStyle: state.prefs.navStyle } }))
}

async function load(): Promise<void> {
  const result = await readJsonFile(DATA_PATHS.appUiState)
  const data = result.status === 'ok' && result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>) : {}
  extra = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'lastModule' && key !== 'modules'))
  state.prefs = normalizePrefs(data)
  if (isModuleId(data.lastModule)) state.lastModule = data.lastModule
}

const enabled = computed(() => enabledModules(state.prefs))
const isEnabled = (id: ModuleId) => isEnabledIn(state.prefs, id)

/** O último módulo aberto, se ainda estiver ativo; senão, o primeiro ativo. */
const startModule = computed<ModuleId>(() => (isEnabled(state.lastModule) ? state.lastModule : (enabled.value[0]?.id ?? 'notes')))

function remember(module: ModuleId): void {
  if (state.lastModule === module) return
  state.lastModule = module
  save()
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function playEffect(id: ModuleId, kind: ModuleEffect['kind']): void {
  if (reducedMotion()) return
  const effect: ModuleEffect = { id, kind, seq: ++seq }
  state.effects = [...state.effects.filter((item) => item.id !== id), effect]
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
    startModule,
    load,
    flush: () => writer.flush(),
    remember,
    isEnabled,
    canDisable: (id: ModuleId) => canDisable(state.prefs, id),
    setEnabled,
    setNavStyle,
    requireModule,
  }
}
