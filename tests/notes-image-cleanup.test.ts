// 1.7.1: excluir uma nota libera as imagens dela só depois que o "Desfazer" some (com
// Desfazer, nada é liberado); a biblioteca só exclui as que ninguém mais usa: outra
// nota, a descrição de uma tarefa, as observações das Finanças ou a foto de uma categoria.
// E a lista lateral pode não acompanhar a nota aberta (Configurações › Módulos › Notas).
import { beforeAll, describe, expect, it } from 'vitest'
import { createMobileApi } from '~/lib/mobile/api'
import { memoryFs } from '~/lib/mobile/fs'
import { fakeNative } from '~/lib/mobile/native'
import { WorkspaceFiles } from '~/lib/mobile/workspace'

const ROOT = '/storage/emulated/0'
const WS = `${ROOT}/Documents/Imagens`
const disk = memoryFs(ROOT)
const files = new WorkspaceFiles(disk, WS)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

let api: Awaited<ReturnType<typeof createMobileApi>>
let notes: ReturnType<(typeof import('~/stores/notes'))['useNotesStore']>
let toasts: ReturnType<(typeof import('~/composables/useToasts'))['useToasts']>
let released: string[][] = []

beforeAll(async () => {
  await files.writeBytes('attachments/so-dela.png', PNG)
  await files.writeBytes('attachments/compartilhada.png', new Uint8Array([...PNG, 9]))
  await files.writeBytes('attachments/financas.png', new Uint8Array([...PNG, 8, 8]))
  await files.write('notes/Com imagens.md', '# Com imagens\n![](../attachments/so-dela.png)\n![](../attachments/compartilhada.png)\n![](../attachments/financas.png)')
  await files.write('notes/Outra.md', '# Outra\n![](../attachments/compartilhada.png)')
  await files.write(
    'finance/finance.json',
    JSON.stringify({ app: '4notes', version: 2, expenses: [{ id: 'e1', description: 'Nota fiscal', amount: 100, date: '2026-10-20', notes: '![](../attachments/financas.png)' }] }),
  )
  await files.write('notes/Desfazer.md', '# Desfazer\n![](../attachments/so-dela.png)')
  api = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.7.1', test: true })
  await api.dataDir.use(WS)
  const noop = () => undefined
  Object.assign(globalThis, {
    window: { fourNotes: api, addEventListener: noop, removeEventListener: noop },
    document: { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', documentElement: { style: {} } },
  })
  const store = await import('~/stores/notes')
  notes = store.useNotesStore()
  toasts = (await import('~/composables/useToasts')).useToasts()
  store.onImagesReleased((paths) => released.push(paths))
  await (await import('~/stores/settings')).loadSettings()
  await notes.load()
})

const byTitle = (title: string) => notes.state.notes.find((note) => note.content.startsWith(`# ${title}`))!

describe('imagens de uma nota excluída', () => {
  it('com "Desfazer": nada é liberado', async () => {
    await notes.deleteNote(byTitle('Desfazer').id)
    const toast = toasts.toasts.at(-1)!
    await toast.action!.run()
    toasts.dismissToast(toast.id)
    expect(released).toEqual([])
  })

  it('o aviso sumiu: as imagens dela são liberadas; a biblioteca só exclui as que ninguém mais usa', async () => {
    released = []
    await notes.deleteNote(byTitle('Com imagens').id)
    // Enquanto o "Desfazer" está na tela, nada acontece
    expect(released).toEqual([])
    const toast = toasts.toasts.at(-1)!
    toasts.dismissToast(toast.id)
    expect(released).toEqual([['attachments/so-dela.png', 'attachments/compartilhada.png', 'attachments/financas.png']])
    // "so-dela" ainda está na nota restaurada pelo Desfazer do teste anterior
    expect(await api.library.remove('attachments/so-dela.png')).toBe('in-use')
    // Usada em outra nota e nas observações de um gasto: ficam
    expect(await api.library.remove('attachments/compartilhada.png')).toBe('in-use')
    expect(await api.library.remove('attachments/financas.png')).toBe('in-use')
    // Sem a outra nota, a compartilhada sai (para a lixeira)
    await notes.deleteNote(byTitle('Outra').id)
    expect(await api.library.remove('attachments/compartilhada.png')).toBe('removed')
    expect(await files.read('attachments/compartilhada.png')).toBeNull()
  })
})

describe('lista lateral × nota aberta', () => {
  it('"Selecionar a nota aberta na lista" vem ligado e fica guardado', async () => {
    expect(notes.state.settings.revealActive).toBe(true)
    notes.updateSettings({ revealActive: false })
    expect(notes.state.settings.revealActive).toBe(false)
    const { flushSettings, settingsSection } = await import('~/stores/settings')
    await flushSettings()
    expect(settingsSection('notes')).toMatchObject({ revealActive: false })
    const saved = JSON.parse((await files.read('.4notes/settings.json'))!)
    expect(saved.notes.revealActive).toBe(false)
  })
})
