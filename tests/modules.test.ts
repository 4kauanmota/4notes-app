import { describe, expect, it } from 'vitest'
import {
  canDisable,
  DEFAULT_PREFS,
  enabledModules,
  GENERAL_TUTORIAL,
  isModuleId,
  MODULE_IDS,
  MODULES,
  moduleForPath,
  movedBy,
  normalizePrefs,
  orderedModules,
  reorderedIds,
  withModuleEnabled,
  type ModulePrefs,
} from '~/lib/modules'

const prefs = (disabled: string[], navStyle: ModulePrefs['navStyle'] = 'icon-label', order: string[] = [...MODULE_IDS]): ModulePrefs => ({
  disabled,
  order,
  navStyle,
})
const ids = (list: { id: string }[]) => list.map((module) => module.id)

describe('registro dos módulos', () => {
  it('ids, rotas e teclas dos atalhos não se repetem', () => {
    for (const key of ['id', 'route', 'key', 'label', 'name'] as const) {
      const values = MODULES.map((module) => module[key])
      expect(new Set(values).size, key).toBe(values.length)
    }
    expect(MODULE_IDS).toEqual(['notes', 'tasks', 'mindmap', 'links'])
  })

  it('todo módulo tem um tutorial curto e completo', () => {
    for (const { name, tutorial } of [...MODULES, { name: 'Geral', tutorial: GENERAL_TUTORIAL }]) {
      expect(tutorial.purpose.length, name).toBeGreaterThan(10)
      expect(tutorial.purpose.length, name).toBeLessThan(140)
      expect(tutorial.features.length, name).toBeGreaterThanOrEqual(2)
      // O que está no botão direito também é ensinado
      expect(tutorial.contextMenu.length, name).toBeGreaterThanOrEqual(1)
      expect(tutorial.shortcuts.length, name).toBeGreaterThanOrEqual(1)
      // Curto: cada item cabe numa ou duas linhas do painel
      for (const line of [...tutorial.features, ...tutorial.contextMenu, ...tutorial.tips]) expect(line.length, line).toBeLessThan(100)
      for (const shortcut of tutorial.shortcuts) expect(shortcut.keys.length, shortcut.label).toBeGreaterThan(0)
    }
  })

  it('o atalho de módulos do "Geral" acompanha a lista de módulos', () => {
    expect(GENERAL_TUTORIAL.shortcuts[0]!.keys).toEqual(['Mod', '1 / 2 / 3 / 4'])
    expect(GENERAL_TUTORIAL.shortcuts[0]!.label).toBe('Ir para Notas / Tarefas / Mapa / Links')
  })

  it('acha o módulo pela rota', () => {
    expect(moduleForPath('/tasks')?.id).toBe('tasks')
    expect(moduleForPath('/mindmap/x')?.id).toBe('mindmap')
    expect(moduleForPath('/')).toBeNull()
    expect(moduleForPath('/tasksx')).toBeNull()
    expect(isModuleId('links')).toBe(true)
    expect(isModuleId('outro')).toBe(false)
  })
})

describe('preferências dos módulos (.4notes/app.json)', () => {
  it('sem nada guardado: todos ativos, com ícone e nome', () => {
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs({ lastModule: 'tasks' })).toEqual(DEFAULT_PREFS)
    expect(enabledModules(DEFAULT_PREFS).map((module) => module.id)).toEqual(MODULE_IDS)
  })

  it('lê o que foi guardado e tolera arquivo editado à mão', () => {
    expect(normalizePrefs({ modules: { disabled: ['links', 'links', 3, ''], navStyle: 'icon' } })).toEqual(prefs(['links'], 'icon'))
    expect(normalizePrefs({ modules: { disabled: 'links', navStyle: 'outro' } })).toEqual(prefs([]))
    // Um módulo de outra versão do 4notes continua guardado
    expect(normalizePrefs({ modules: { disabled: ['agenda'] } }).disabled).toEqual(['agenda'])
  })

  it('nunca ficam todos desativados', () => {
    const all = normalizePrefs({ modules: { disabled: [...MODULE_IDS] } })
    expect(enabledModules(all).map((module) => module.id)).toEqual(['notes'])
  })

  it('ligar e desligar só mexe na lista de desativados', () => {
    const start = prefs([])
    expect(withModuleEnabled(start, 'links', false)).toEqual(['links'])
    expect(withModuleEnabled(prefs(['links']), 'links', true)).toEqual([])
    // Sem mudança: null
    expect(withModuleEnabled(start, 'links', true)).toBeNull()
    expect(withModuleEnabled(prefs(['links']), 'links', false)).toBeNull()
  })

  it('a ordem do menu: guardada, completa e tolerante', () => {
    const saved = normalizePrefs({ modules: { order: ['links', 'notes', 'links', 7] } })
    // Os que faltam entram no fim, na ordem padrão
    expect(saved.order).toEqual(['links', 'notes', 'tasks', 'mindmap'])
    expect(ids(orderedModules(saved))).toEqual(['links', 'notes', 'tasks', 'mindmap'])
    // Módulo de outra versão do 4notes: fica guardado no lugar, mas não aparece
    const future = normalizePrefs({ modules: { order: ['agenda', 'mindmap'] } })
    expect(future.order).toEqual(['agenda', 'mindmap', 'notes', 'tasks', 'links'])
    expect(ids(orderedModules(future))).toEqual(['mindmap', 'notes', 'tasks', 'links'])
    // Os ativos seguem a ordem
    expect(ids(enabledModules(prefs(['tasks'], 'icon-label', ['links', 'tasks', 'notes', 'mindmap'])))).toEqual(['links', 'notes', 'mindmap'])
    // Todos desativados: volta o primeiro do menu
    expect(ids(enabledModules(normalizePrefs({ modules: { disabled: [...MODULE_IDS], order: ['mindmap'] } })))).toEqual(['mindmap'])
  })

  it('reorganizar só os do menu deixa os desativados no lugar', () => {
    const order = ['notes', 'tasks', 'mindmap', 'links']
    // "tasks" desativado: o menu mostra notes, mindmap, links → links, notes, mindmap
    expect(reorderedIds(order, ['links', 'notes', 'mindmap'])).toEqual(['links', 'tasks', 'notes', 'mindmap'])
    expect(reorderedIds(order, ['notes', 'mindmap'])).toBeNull()
    expect(reorderedIds(order, ['links', 'links'])).toBeNull()
    expect(reorderedIds(order, ['agenda', 'notes'])).toBeNull()
  })

  it('mover para cima/baixo', () => {
    expect(movedBy(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(movedBy(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c'])
    expect(movedBy(['a', 'b', 'c'], 'a', -1)).toBeNull()
    expect(movedBy(['a', 'b', 'c'], 'c', 1)).toBeNull()
    expect(movedBy(['a', 'b', 'c'], 'x', 1)).toBeNull()
  })

  it('o último módulo ativo não pode ser desligado', () => {
    const one = prefs(['tasks', 'mindmap', 'links'])
    expect(canDisable(one, 'notes')).toBe(false)
    expect(withModuleEnabled(one, 'notes', false)).toBeNull()
    expect(canDisable(prefs(['tasks']), 'notes')).toBe(true)
  })
})
