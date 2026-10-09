// Camada Android (app/lib/mobile): o mesmo contrato do Electron, com o disco do
// celular — aqui, o disco na memória com as regras do Android (sem diferenciar
// maiúsculas). As regras compartilhadas (biblioteca de imagens) dão o mesmo
// resultado no desktop e no celular.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listLibrary as listLibraryDesktop } from '../electron/library'
import { createMobileApi } from '~/lib/mobile/api'
import { createWorkspace, copyDataDir, inspectFolder } from '~/lib/mobile/data-dir'
import { memoryFs, type FsDriver } from '~/lib/mobile/fs'
import { fakeNative } from '~/lib/mobile/native'
import { WorkspaceFiles } from '~/lib/mobile/workspace'

const ROOT = '/storage/emulated/0'
let disk: FsDriver
beforeEach(() => {
  disk = memoryFs(ROOT)
})

const PNG_A = new Uint8Array(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex'))
const PNG_B = new Uint8Array(Buffer.from('89504e470d0a1a0a0000000d49484452000000020000000208060000007f15c489', 'hex'))

describe('disco do Android (na memória)', () => {
  it('não diferencia maiúsculas e cria as pastas de cima', async () => {
    await disk.writeText(`${ROOT}/Notas/Dev/Ideias.md`, 'oi')
    expect(await disk.readText(`${ROOT}/notas/dev/ideias.md`)).toBe('oi')
    expect((await disk.readdir(`${ROOT}/NOTAS`)).map((entry) => entry.name)).toEqual(['Dev'])
  })

  it('renomear só as maiúsculas direto perde o arquivo (como no Android)', async () => {
    await disk.writeText(`${ROOT}/a/nota.md`, 'texto')
    await expect(disk.rename(`${ROOT}/a/nota.md`, `${ROOT}/a/Nota.md`)).rejects.toThrow()
    expect(await disk.stat(`${ROOT}/a/nota.md`)).toBeNull()
  })
})

describe('arquivos do workspace no celular', () => {
  const ws = () => new WorkspaceFiles(disk, `${ROOT}/Documents/Pessoal`)

  it('grava, lê e lista como no desktop', async () => {
    const files = ws()
    await files.write('notes/Ideias.md', '﻿# Ideias\r\nlinha')
    await files.write('notes/Dev/Godot.md', '# Godot')
    await files.write('notes/.oculta.md', 'x')
    await files.write('notes/foto.png', 'x')
    expect(await files.read('notes/Ideias.md')).toBe('# Ideias\nlinha')
    expect(await files.read('notes/nada.md')).toBeNull()
    const list = await files.list('notes', { recursive: true, extensions: ['.md'], withContent: true })
    expect(list.map((file) => [file.path, file.content]).sort()).toEqual([
      ['notes/Dev/Godot.md', '# Godot'],
      ['notes/Ideias.md', '# Ideias\nlinha'],
    ])
    // Sem arquivos temporários sobrando
    expect((await disk.readdir(`${ROOT}/Documents/Pessoal/notes`)).map((entry) => entry.name).sort()).toEqual(['.oculta.md', 'Dev', 'Ideias.md', 'foto.png'])
    expect(await files.list('nada')).toEqual([])
  })

  it('nada escapa do workspace', async () => {
    expect(() => ws().resolve('../../Outro/x.md')).toThrow(/EACCES/)
    expect(() => ws().resolve('notes/../../x.md')).toThrow(/EACCES/)
    expect(ws().resolve('notes/../tasks/tasks.json')).toBe(`${ROOT}/Documents/Pessoal/tasks/tasks.json`)
  })

  it('renomear: conflito, só maiúsculas e pastas novas', async () => {
    const files = ws()
    await files.write('notes/nota.md', 'a')
    await files.write('notes/Outra.md', 'b')
    await expect(files.rename('notes/nota.md', 'notes/outra.md')).rejects.toThrow(/EEXIST/)
    await files.rename('notes/nota.md', 'notes/Nota.md')
    expect((await files.list('notes')).map((file) => file.name).sort()).toEqual(['Nota.md', 'Outra.md'])
    expect(await files.read('notes/Nota.md')).toBe('a')
    await files.rename('notes/Nota.md', 'notes/Dev/Nota.md')
    expect(await files.read('notes/Dev/Nota.md')).toBe('a')
    await expect(files.rename('notes/sumiu.md', 'notes/x.md')).rejects.toThrow(/ENOENT/)
  })

  it('excluir vai para .4notes/trash (não há Lixeira no Android)', async () => {
    const files = ws()
    await files.write('notes/Velha.md', 'conteúdo')
    await files.trash('notes/Velha.md')
    expect(await files.exists('notes/Velha.md')).toBe(false)
    const trash = await disk.readdir(`${ROOT}/Documents/Pessoal/.4notes/trash`)
    expect(trash).toHaveLength(1)
    expect(trash[0]!.name).toMatch(/ Velha\.md$/)
    await files.trash('notes/Velha.md') // já não existe: nada acontece
  })

  it('imagens coladas e cópias de imagem', async () => {
    const files = ws()
    const first = await files.saveImage(PNG_A, 'image/png')
    const second = await files.saveImage(PNG_A, 'image/png')
    expect(first).toMatch(/^attachments\/imagem-\d{8}-\d{6}\.png$/)
    expect(second).not.toBe(first)
    await expect(files.saveImage(PNG_A, 'image/tiff')).rejects.toThrow(/EINVAL/)
    await files.copyImage(first, 'notes/Dev/Dev.png')
    expect(await files.readBytes('notes/Dev/Dev.png')).toEqual(PNG_A)
  })
})

describe('pasta do workspace no celular', () => {
  it('inspeciona, cria e copia sem sobrescrever', async () => {
    const docs = `${ROOT}/Documents`
    expect(await inspectFolder(disk, docs)).toMatchObject({ exists: true, isEmpty: true, hasData: false, writable: true })
    const created = await createWorkspace(disk, docs, ' Pessoal ')
    expect(created).toBe(`${docs}/Pessoal`)
    expect(await inspectFolder(disk, created)).toMatchObject({ exists: true, isEmpty: false, hasData: true })
    await disk.writeText(`${created}/notes/A.md`, 'a')
    await expect(createWorkspace(disk, docs, 'pessoal')).rejects.toThrow(/EEXIST/)
    await expect(createWorkspace(disk, docs, 'a/b')).rejects.toThrow(/EINVAL/)

    const other = await createWorkspace(disk, docs, 'Trabalho')
    await disk.writeText(`${other}/notes/A.md`, 'do trabalho')
    await copyDataDir(disk, created, other)
    expect(await disk.readText(`${other}/notes/A.md`)).toBe('do trabalho')
    await disk.writeText(`${created}/notes/B.md`, 'b')
    await copyDataDir(disk, created, other)
    expect(await disk.readText(`${other}/notes/B.md`)).toBe('b')
    await expect(copyDataDir(disk, created, `${created}/notes/Sub`)).rejects.toThrow(/EINVAL/)
  })
})

describe('API do 4notes no Android', () => {
  it('primeiro uso: sem workspace; criar e usar', async () => {
    const api = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.5.0', test: true })
    expect(api.bootstrap).toMatchObject({ platform: 'android', appVersion: '1.5.0', dataDir: { ready: false, problem: 'not-configured' } })
    expect(api.bootstrap.capabilities).toEqual({ reveal: false, launchAtLogin: false, browserBookmarks: false, window: false, systemTrash: false })
    await expect(api.files.read('notes/A.md')).rejects.toThrow(/ENODATA/)

    const status = await api.dataDir.create(`${ROOT}/Documents`, 'Pessoal')
    expect(status).toEqual({ path: `${ROOT}/Documents/Pessoal`, ready: true, problem: null })
    await api.files.write('notes/A.md', '# A')
    expect(await api.files.read('notes/A.md')).toBe('# A')
    expect((await api.files.list('notes', { extensions: ['.md'] })).map((file) => file.path)).toEqual(['notes/A.md'])
    expect(await api.system.launchAtLogin()).toMatchObject({ supported: false })
    expect(await api.links.browsers()).toEqual([])

    // Reabrindo o app: o mesmo workspace (o caminho fica guardado no aparelho)
    const again = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.5.0', test: true })
    expect(again.bootstrap.dataDir).toMatchObject({ path: `${ROOT}/Documents/Pessoal`, ready: true })
  })

  it('sem o "Acesso a todos os arquivos": pede permissão', async () => {
    const native = { ...fakeNative(ROOT), storageInfo: async () => ({ root: ROOT, granted: false }) }
    await disk.mkdir(`${ROOT}/Documents/Pessoal`)
    const ok = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.5.0', test: true })
    await ok.dataDir.use(`${ROOT}/Documents/Pessoal`)
    const api = await createMobileApi({ fs: disk, native, version: '1.5.0', test: true })
    expect(api.bootstrap.dataDir).toEqual({ path: `${ROOT}/Documents/Pessoal`, ready: false, problem: 'no-permission' })
    expect(await api.dataDir.requestAccess?.()).toBe(true)
    await expect(api.dataDir.use('/data/data/outro')).rejects.toThrow(/EACCES/)
  })
})

// ── Biblioteca: o mesmo resultado no desktop e no celular ─────────────────────

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('biblioteca de imagens no celular', () => {
  const scenario: Record<string, string | Uint8Array> = {
    'attachments/foto.png': PNG_A,
    'attachments/sem uso.png': PNG_B,
    'notes/Dev/Dev.png': PNG_A,
    'notes/categorias.json': JSON.stringify({ categories: [{ name: 'Dev', color: 'blue', image: 'Dev.png' }] }),
    'notes/Dev/Ideias.md': '# Ideias\n![](../../attachments/foto.png)\n',
    'notes/Outra.md': '![](../attachments/foto.png) e [link](https://x.com)',
    'mindmap/Principal/Godot.md': '![x](../../attachments/foto.png "título")',
    'links/links.json': JSON.stringify({ folders: [{ id: 'jogos', name: 'Jogos', image: 'attachments/foto.png' }], links: [] }),
  }

  it('lista igual ao desktop e só exclui o que não está em uso', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), '4n-mob-'))
    dirs.push(root)
    for (const [rel, content] of Object.entries(scenario)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      fs.writeFileSync(path.join(root, rel), content)
    }
    const api = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.5.0', test: true })
    await api.dataDir.create(`${ROOT}/Documents`, 'Pessoal')
    const ws = new WorkspaceFiles(disk, `${ROOT}/Documents/Pessoal`)
    for (const [rel, content] of Object.entries(scenario)) {
      if (typeof content === 'string') await ws.write(rel, content)
      else await ws.writeBytes(rel, content)
    }
    const desktop = await listLibraryDesktop(root)
    const mobile = await api.library.list()
    const strip = (images: { path: string; usage: string[] }[]) => images.map(({ path, usage }) => ({ path, usage })).sort((a, b) => a.path.localeCompare(b.path))
    expect(strip(mobile)).toEqual(strip(desktop))
    expect(mobile.find((image) => image.path === 'attachments/foto.png')!.usage).toEqual(['2 notas', '1 nota do mapa mental', 'Categoria “Dev” (Notas)', 'Categoria “Jogos” (Links)'])

    expect(await api.library.remove('attachments/foto.png')).toBe('in-use')
    expect(await api.library.remove('attachments/sem uso.png')).toBe('removed')
    expect(await api.library.remove('attachments/sem uso.png')).toBe('missing')
    // Foto antiga de categoria: ganha uma cópia na biblioteca (a mesma imagem já está lá)
    expect(await api.library.adopt('notes/Dev/Dev.png')).toBe('attachments/foto.png')
  })
})
