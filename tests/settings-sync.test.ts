// Configurações do workspace (settings.json) × estado de cada aparelho (4notes 1.5.0):
// a passagem dos arquivos da 1.4.3, a gravação e a releitura quando outro aparelho
// muda o arquivo (pasta sincronizada). Com um "disco" falso na memória.
import { beforeEach, describe, expect, it, vi } from 'vitest'

let files: Map<string, string>
const api = {
  bootstrap: { platform: 'win32', settings: { theme: 'dark' }, dataDir: { path: 'C:\\Users\\Kauan\\Pessoal', ready: true, problem: null } },
  files: {
    read: async (path: string) => files.get(path) ?? null,
    write: async (path: string, content: string) => {
      files.set(path, content)
      return { path, name: path.split('/').pop()!, size: content.length, mtimeMs: 1 }
    },
    exists: async (path: string) => files.has(path),
    rename: async (from: string, to: string) => {
      const content = files.get(from)
      if (content === undefined) throw new Error('[ENOENT] não existe')
      files.delete(from)
      files.set(to, content)
    },
    list: async () => [],
    mkdir: async () => undefined,
  },
  settings: { setTheme: async () => undefined },
}
;(globalThis as unknown as { window: unknown }).window = { fourNotes: api }

const json = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`
const read = (path: string) => JSON.parse(files.get(path)!)

async function freshStores() {
  vi.resetModules()
  const settings = await import('~/stores/settings')
  const device = await import('~/lib/storage/device-state')
  return { settings, device }
}

beforeEach(() => {
  files = new Map()
})

describe('passagem da 1.4.3 para o settings.json', () => {
  it('junta as configurações num arquivo só e guarda o estado da tela no aparelho', async () => {
    files.set('.4notes/notes.json', json({ openTabs: ['notes/A.md'], activeTab: 'notes/A.md', sidebarOpen: false, collapsedCategories: ['dev'], openFolders: [], settings: { autoCategory: true, folderCase: 'upper' } }))
    files.set('.4notes/mindmap.json', json({ settingsVersion: 2, settings: { showOrphans: false, nodeStyle: 'circle', labels: 'always' }, currentMap: 'Estudos', layouts: { Estudos: { 'note:A.md': [1, 2] } } }))
    files.set('.4notes/links.json', json({ sort: 'name' }))
    files.set('.4notes/app.json', json({ lastModule: 'links', modules: { disabled: ['tasks'], order: ['links', 'notes'], navStyle: 'icon' } }))

    const { settings, device } = await freshStores()
    await settings.loadSettings()

    expect(read('.4notes/settings.json')).toEqual({
      version: 1,
      theme: 'dark',
      modules: { disabled: ['tasks'], order: ['links', 'notes'], navStyle: 'icon' },
      notes: { autoCategory: true, folderCase: 'upper' },
      mindmap: { settingsVersion: 2, showOrphans: false, nodeStyle: 'circle', labels: 'always' },
      links: { sort: 'name' },
    })
    // O estado da tela foi para o aparelho
    expect(device.readDeviceState('notes')).toEqual({ openTabs: ['notes/A.md'], activeTab: 'notes/A.md', sidebarOpen: false, collapsedCategories: ['dev'], openFolders: [] })
    expect(device.readDeviceState('app')).toEqual({ lastModule: 'links' })
    expect(device.readDeviceState('mindmap')).toEqual({ currentMap: 'Estudos' })
    // Os arquivos antigos foram para os backups; o mindmap.json (posições) continua
    expect([...files.keys()].sort()).toEqual([
      '.4notes/backups/1.5.0/app.json',
      '.4notes/backups/1.5.0/links.json',
      '.4notes/backups/1.5.0/notes.json',
      '.4notes/mindmap.json',
      '.4notes/settings.json',
    ])
  })

  it('workspace novo: as configurações padrão (nada do workspace aberto antes, nem o tema)', async () => {
    // O aparelho guarda "dark" (o tema do último workspace aberto): o novo não herda
    const { settings } = await freshStores()
    await settings.loadSettings()
    expect(read('.4notes/settings.json')).toEqual({ version: 1, theme: 'system' })
    expect(settings.settingsSection('notes')).toBeUndefined()
  })

  it('o estado da tela é de cada workspace', async () => {
    const { device } = await freshStores()
    device.writeDeviceState('notes', { openTabs: ['notes/B.md'] })
    expect(device.readDeviceState('notes')).toEqual({ openTabs: ['notes/B.md'] })
    api.bootstrap.dataDir.path = 'C:/Users/Kauan/Trabalho'
    expect(device.readDeviceState('notes')).toBeNull()
    // O mesmo caminho escrito de outro jeito é o mesmo workspace
    api.bootstrap.dataDir.path = 'c:\\users\\kauan\\pessoal\\'
    expect(device.readDeviceState('notes')).toEqual({ openTabs: ['notes/B.md'] })
    api.bootstrap.dataDir.path = 'C:\\Users\\Kauan\\Pessoal'
  })
})

describe('cada workspace com as suas configurações (1.6.3)', () => {
  it('reabrir restaura as configurações; um workspace novo não herda as do anterior', async () => {
    const disks = { pessoal: new Map<string, string>(), trabalho: new Map<string, string>() }
    async function open(name: keyof typeof disks) {
      files = disks[name]
      api.bootstrap.dataDir.path = `C:\\Users\\Kauan\\${name}`
      const { settings } = await freshStores()
      await settings.loadSettings()
      const notes = (await import('~/stores/notes')).useNotesStore()
      const modules = (await import('~/stores/modules')).useModulesStore()
      await Promise.all([notes.load(), modules.load()])
      return { settings, notes, modules }
    }

    // Pessoal: tema escuro, sem título na primeira linha, pastas no topo, menu só com ícones
    let ws = await open('pessoal')
    ws.settings.updateSettingsSection('theme', 'dark')
    ws.notes.updateSettings({ titleFirstLine: false, foldersFirst: true, wrapCode: true })
    ws.modules.setNavStyle('icon')
    await ws.settings.flushSettings()
    // O aparelho guarda uma cópia do tema do último workspace aberto
    api.bootstrap.settings.theme = 'dark'

    // Trabalho (novo): tudo no padrão — nada vem do Pessoal
    ws = await open('trabalho')
    expect(ws.settings.settingsSection('theme')).toBe('system')
    expect(ws.notes.state.settings).toEqual({ autoCategory: false, folderCase: 'typed', titleFirstLine: true, foldersFirst: false, wrapCode: false, wrapText: true })
    expect(ws.modules.state.prefs.navStyle).toBe('icon-label')
    ws.notes.updateSettings({ folderCase: 'upper' })
    await ws.settings.flushSettings()

    // De volta ao Pessoal: as configurações dele, intactas
    ws = await open('pessoal')
    expect(ws.settings.settingsSection('theme')).toBe('dark')
    expect(ws.notes.state.settings).toEqual({ autoCategory: false, folderCase: 'typed', titleFirstLine: false, foldersFirst: true, wrapCode: true, wrapText: true })
    expect(ws.modules.state.prefs.navStyle).toBe('icon')
    // E o Trabalho continua com as dele
    expect(JSON.parse(disks.trabalho.get('.4notes/settings.json')!)).toMatchObject({ theme: 'system', notes: { folderCase: 'upper', titleFirstLine: true, foldersFirst: false, wrapCode: false } })

    files = new Map()
    api.bootstrap.dataDir.path = 'C:\\Users\\Kauan\\Pessoal'
  })
})

describe('settings.json', () => {
  it('grava a seção alterada e mantém chaves de outras versões', async () => {
    files.set('.4notes/settings.json', json({ version: 1, theme: 'light', agenda: { semana: 'domingo' } }))
    const { settings } = await freshStores()
    await settings.loadSettings()
    settings.updateSettingsSection('links', { sort: 'url' })
    await settings.flushSettings()
    expect(read('.4notes/settings.json')).toEqual({ version: 1, theme: 'light', agenda: { semana: 'domingo' }, links: { sort: 'url' } })
  })

  it('relê o arquivo mudado em outro aparelho e avisa só o que mudou', async () => {
    files.set('.4notes/settings.json', json({ version: 1, theme: 'light', notes: { autoCategory: false } }))
    const { settings } = await freshStores()
    await settings.loadSettings()
    const changes: string[][] = []
    settings.onSettingsChange((changed) => changes.push([...changed].sort()))

    await settings.refreshSettings()
    expect(changes).toEqual([])

    files.set('.4notes/settings.json', json({ version: 1, theme: 'dark', notes: { autoCategory: false }, links: { sort: 'name' } }))
    await settings.refreshSettings()
    expect(changes).toEqual([['links', 'theme']])
    expect(settings.settingsSection('theme')).toBe('dark')
  })

  it('arquivo com erro: guarda uma cópia e volta ao padrão', async () => {
    files.set('.4notes/settings.json', '{ "theme": ')
    const { settings } = await freshStores()
    await settings.loadSettings()
    await settings.flushSettings()
    expect(read('.4notes/settings.json')).toEqual({ version: 1, theme: 'dark' })
    const backups = [...files.keys()].filter((path) => path.startsWith('.4notes/backups/settings-'))
    expect(backups).toHaveLength(1)
    expect(files.get(backups[0]!)).toBe('{ "theme": ')
  })
})

describe('os módulos leem e gravam a parte deles', () => {
  it('Notas, Links e menu dos módulos', async () => {
    files.set('.4notes/settings.json', json({ version: 1, notes: { autoCategory: true }, links: { sort: 'name' }, modules: { disabled: ['links'], navStyle: 'icon' } }))
    const { settings } = await freshStores()
    await settings.loadSettings()
    const notes = (await import('~/stores/notes')).useNotesStore()
    const links = (await import('~/stores/links')).useLinksStore()
    const modules = (await import('~/stores/modules')).useModulesStore()
    await Promise.all([notes.load(), links.load(), modules.load()])
    expect(notes.state.settings).toEqual({ autoCategory: true, folderCase: 'typed', titleFirstLine: true, foldersFirst: false, wrapCode: false, wrapText: true })
    expect(links.state.sort).toBe('name')
    expect(modules.isEnabled('links')).toBe(false)
    expect(modules.state.prefs.navStyle).toBe('icon')

    notes.updateSettings({ folderCase: 'upper', titleFirstLine: false, foldersFirst: true })
    links.setSort('url')
    modules.setNavStyle('icon-label')
    await settings.flushSettings()
    expect(read('.4notes/settings.json')).toMatchObject({
      notes: { autoCategory: true, folderCase: 'upper', titleFirstLine: false, foldersFirst: true },
      links: { sort: 'url' },
      modules: { disabled: ['links'], navStyle: 'icon-label' },
    })

    // Outro aparelho ativou os Links e desligou a categoria automática
    const changed = read('.4notes/settings.json')
    changed.modules.disabled = []
    changed.notes.autoCategory = false
    files.set('.4notes/settings.json', json(changed))
    await settings.refreshSettings()
    expect(modules.isEnabled('links')).toBe(true)
    expect(notes.state.settings.autoCategory).toBe(false)
  })
})
