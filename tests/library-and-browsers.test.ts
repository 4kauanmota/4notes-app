import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countLinks, decodeLz4Block, decodeMozLz4, geckoBookmarksFromRows, parseGeckoBackup, parseProfilesIni, type PlacesRow } from '#shared/bookmarks'
import { exportFileName, inlineWorkspaceImages } from '../electron/export'
import { adoptIntoLibrary, listLibrary, referencedFiles, removeFromLibrary } from '../electron/library'
import { normalizeLinksFile, serializeLinks, sortLinks, urlSortKey, type SavedLink } from '~/lib/links/model'

// ── Workspace temporário ────────────────────────────────────────────────────

const dirs: string[] = []
function workspace(files: Record<string, string | Buffer>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '4n-lib-'))
  dirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), content)
  }
  return root
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const PNG_A = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex')
const PNG_B = Buffer.from('89504e470d0a1a0a0000000d49484452000000020000000208060000007f15c489', 'hex')

describe('biblioteca de imagens', () => {
  it('lista as imagens enviadas, sem repetidas, e mostra onde cada uma é usada', async () => {
    const root = workspace({
      'attachments/foto.png': PNG_A,
      'attachments/sem uso.png': PNG_B,
      'attachments/leia.txt': 'não é imagem',
      // A mesma imagem copiada como foto da categoria "Dev" das Notas
      'notes/Dev/Dev.png': PNG_A,
      'notes/categorias.json': JSON.stringify({ categories: [{ name: 'Dev', color: 'blue', image: 'Dev.png' }] }),
      'notes/Dev/Ideias.md': '# Ideias\n![](../../attachments/foto.png)\n',
      'notes/Outra.md': '![](../attachments/foto.png) e [link](https://x.com)',
      'mindmap/Principal/Godot.md': '![x](../../attachments/foto.png "título")',
      'links/links.json': JSON.stringify({ folders: [{ id: 'jogos', name: 'Jogos', image: 'attachments/foto.png' }], links: [] }),
    })
    const images = await listLibrary(root)
    expect(images.map((image) => image.path).sort()).toEqual(['attachments/foto.png', 'attachments/sem uso.png'])
    const foto = images.find((image) => image.path === 'attachments/foto.png')!
    expect(foto.usage).toEqual(['2 notas', '1 nota do mapa mental', 'Categoria “Dev” (Notas)', 'Categoria “Jogos” (Links)'])
    expect(images.find((image) => image.path === 'attachments/sem uso.png')!.usage).toEqual([])
  })

  it('fotos antigas das categorias (só na pasta da categoria) também aparecem', async () => {
    const root = workspace({
      'notes/Velha/Velha.png': PNG_B,
      'notes/categorias.json': JSON.stringify({ categories: [{ name: 'Velha', color: 'red', image: 'Velha.png' }] }),
    })
    const images = await listLibrary(root)
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ path: 'notes/Velha/Velha.png', usage: ['Categoria “Velha” (Notas)'] })
    // Usar numa categoria dos Links: ganha uma cópia na biblioteca (attachments/)
    const adopted = await adoptIntoLibrary(root, 'notes/Velha/Velha.png')
    expect(adopted).toBe('attachments/Velha.png')
    expect(fs.readFileSync(path.join(root, adopted))).toEqual(PNG_B)
    // De novo: a mesma imagem não é copiada outra vez
    expect(await adoptIntoLibrary(root, 'notes/Velha/Velha.png')).toBe('attachments/Velha.png')
    expect(fs.readdirSync(path.join(root, 'attachments'))).toEqual(['Velha.png'])
    // E agora aparece uma vez só, pela cópia da biblioteca
    expect((await listLibrary(root)).map((image) => image.path)).toEqual(['attachments/Velha.png'])
  })

  it('só exclui imagens sem uso (e recusa caminhos fora da biblioteca)', async () => {
    const root = workspace({
      'attachments/usada.png': PNG_A,
      'attachments/livre.png': PNG_B,
      'notes/A.md': '![](../attachments/usada.png)',
    })
    expect(await removeFromLibrary(root, 'attachments/usada.png')).toBe('in-use')
    expect(await removeFromLibrary(root, 'attachments/livre.png')).toBe('removed')
    expect(fs.existsSync(path.join(root, 'attachments/livre.png'))).toBe(false)
    expect(await removeFromLibrary(root, 'attachments/livre.png')).toBe('missing')
    await expect(removeFromLibrary(root, 'notes/A.md')).rejects.toThrow()
    await expect(removeFromLibrary(root, '../fora.png')).rejects.toThrow()
  })

  it('acha os arquivos citados nas notas (caminhos relativos, com espaços codificados)', () => {
    expect(referencedFiles('notes/Dev/A.md', '![](../../attachments/minha%20foto.png) [n](../Outra.md)')).toEqual(['attachments/minha foto.png', 'notes/Outra.md'])
    expect(referencedFiles('notes/A.md', '![](<../attachments/a b.png>) ![](https://x.com/y.png) ![](../../fora.png)')).toEqual(['attachments/a b.png'])
    expect(referencedFiles('notes/A.md', '<img src="../attachments/html.png">')).toEqual(['attachments/html.png'])
    // Parênteses equilibrados fazem parte do endereço (como no editor); "título" depois do espaço não
    expect(referencedFiles('notes/A.md', '![](../attachments/foto%20(1).png) ![](../attachments/b.png "título") [x](../attachments/c\\(2\\).png)')).toEqual([
      'attachments/foto (1).png',
      'attachments/b.png',
      'attachments/c(2).png',
    ])
  })

  it('exclui exatamente o arquivo pedido (no Linux, "Foto.png" e "foto.png" são diferentes)', async () => {
    if (process.platform !== 'linux') return
    const root = workspace({ 'attachments/Foto.png': PNG_A, 'attachments/foto.png': PNG_B })
    expect(await removeFromLibrary(root, 'attachments/foto.png')).toBe('removed')
    expect(fs.readdirSync(path.join(root, 'attachments'))).toEqual(['Foto.png'])
  })
})

describe('exportar: nome do arquivo e imagens do PDF', () => {
  it('nome do arquivo a partir do título', () => {
    expect(exportFileName('Reunião: 05/10 <x>', 'pdf')).toBe('Reunião 05 10 x.pdf')
    expect(exportFileName('', 'txt')).toBe('Nota.txt')
    expect(exportFileName('CON', 'txt')).toBe('CON_.txt')
  })

  it('as imagens do workspace entram embutidas; o resto fica de fora', async () => {
    const root = workspace({ 'attachments/a b.png': PNG_A })
    const html = await inlineWorkspaceImages(
      root,
      '<img class="img" src="workspace://files/attachments/a%20b.png" alt=""><img src="workspace://files/attachments/sumiu.png"><img src="workspace://files/..%2F..%2Fetc%2Fpasswd">',
    )
    expect(html).toContain(`src="data:image/png;base64,${PNG_A.toString('base64')}"`)
    expect(html.match(/data-missing="1"/g)).toHaveLength(2)
  })
})

// ── Firefox e Zen ───────────────────────────────────────────────────────────

const BACKUP_JSONLZ4 =
  'bW96THo0MACBCQAA8wB7Imd1aWQiOiAicm9vdF8BAPEOIiwgInRpdGxlIjogIiIsICJpbmRleCI6IDAsICIvAPMBMSwgInR5cGVDb2RlIjogMg8A8hEiOiAidGV4dC94LW1vei1wbGFjZS1jb250YWluZXIiLGcAQSI6ICIbAPYGc1Jvb3QiLCAiY2hpbGRyZW4iOiBbkwBDbWVudZIACpMAT21lbnWXAAIEiAAPlwAm8gJib29rbWFya3NNZW51Rm9sZLYAD6AAAxdhAQAJoAB/TW96aWxsYaMAAiMxMCwBA6QAEzEPAA87AQHyCSIsICJ1cmkiOiAiaHR0cHM6Ly93d3cubV8A9gAub3JnL3B0LUJSLyJ9LCA4ATVzZXADAAmYAAiRABUxywEEggADkQAfM5EACKotc2VwYXJhdG9ycgAXYgEACXIA6E1haXMgdmlzaXRhZG9zgAAVMoAAC7UBBI8ADxEBDAFBAvkJOnNvcnQ9OCZtYXhSZXN1bHRzPTEwIn1dDwFxdG9vbGJhckoCCZ0AAxkACJYABRYBBAYBAxUBBKQAD5UAAQ/hAgMDXQAPRAINF2MBAAmdADhEZXaZABQwLwEbMkACD5oAFw/FAgMXZAEACYEAMU51eJwDDfwDFDKiAQMcAQQPAA8cAQEPwgIA2m51eHQuY29tL2RvY3NHAhdlAQAJjACSWmVuIEJyb3dzjwMEkwAFrgEUMgYBD5MAI1J6ZW4tYl8AXC5hcHAvQgIXZgEACZgACKIBBo0ACzwCDyABHHFleGFtcGxlIwGsc2VtLXRpdHVsb5MAQXRhZ3PSAgwcBT90YWdoAwMTNNgDAyMBBDIBD7YBAQ/SAgQ/YWdzzwINF2cBAAkqATh0YWctAQXPAh8zzwI8F2gBAAmBAB94fwADBJ0BAxYBBA8ADxYBAQ/MAgBDdGFnLrABATUCCnkEfnVuZmlsZWSkAQMZAAiSABQz4AMfNacBLQNdABRCygYPswENF2kBAAkyAd9SZXBldGnDp8OjbyByDAAbCNoABesBGzTrAQ9sARwDaAEBGAMfYQIAEQwzA2Ftb2JpbGWOAQtPCAEZAAi0ABQ0jgEfNo4BLQJ1AA+EAQJQW119XX0='

describe('favoritos do Firefox e do Zen', () => {
  it('lê o profiles.ini: perfis relativos e absolutos, o padrão primeiro', () => {
    const ini = [
      '[Profile1]',
      'Name=trabalho',
      'IsRelative=0',
      'Path=D:\\Perfis\\trabalho',
      '',
      '[Profile0]',
      'Name=Default (release)',
      'IsRelative=1',
      'Path=Profiles/abc123.Default (release)',
      'Default=1',
      '',
      '[Install6F193CCC56814779]',
      'Default=Profiles/abc123.Default (release)',
      'Locked=1',
      '',
      '[General]',
      'StartWithLastProfile=1',
    ].join('\r\n')
    expect(parseProfilesIni(`\uFEFF${ini}`)).toEqual([
      { name: 'Default (release)', path: 'Profiles/abc123.Default (release)', relative: true, isDefault: true },
      { name: 'trabalho', path: 'D:\\Perfis\\trabalho', relative: false, isDefault: false },
    ])
  })

  it('monta as pastas a partir do places.sqlite (sem separadores, marcadores e "place:")', () => {
    const rows: PlacesRow[] = [
      { id: 1, parent: 0, type: 2, title: '', url: null, position: 0, guid: 'root________' },
      { id: 2, parent: 1, type: 2, title: 'menu', url: null, position: 0, guid: 'menu________' },
      { id: 3, parent: 1, type: 2, title: 'toolbar', url: null, position: 1, guid: 'toolbar_____' },
      { id: 4, parent: 1, type: 2, title: 'tags', url: null, position: 2, guid: 'tags________' },
      { id: 5, parent: 1, type: 2, title: 'unfiled', url: null, position: 3, guid: 'unfiled_____' },
      { id: 10, parent: 3, type: 1, title: 'Zen', url: 'https://zen-browser.app/', position: 1, guid: 'a' },
      { id: 11, parent: 3, type: 2, title: 'Dev', url: null, position: 0, guid: 'b' },
      { id: 12, parent: 11, type: 1, title: null, url: 'https://nuxt.com/', position: 0, guid: 'c' },
      { id: 13, parent: 11, type: 3, title: null, url: null, position: 1, guid: 'd' },
      { id: 14, parent: 2, type: 1, title: 'Mais visitados', url: 'place:sort=8', position: 0, guid: 'e' },
      { id: 15, parent: 4, type: 2, title: 'tag', url: null, position: 0, guid: 'f' },
      { id: 16, parent: 15, type: 1, title: 'x', url: 'https://tag.example/', position: 0, guid: 'g' },
      { id: 17, parent: 5, type: 1, title: 'Outro', url: 'https://outro.example/', position: 0, guid: 'h' },
    ]
    const roots = geckoBookmarksFromRows(rows)
    expect(roots.map((root) => root.title)).toEqual(['Barra de favoritos', 'Outros favoritos'])
    expect(roots[0]!.children).toEqual([
      { kind: 'folder', title: 'Dev', children: [{ kind: 'link', title: 'https://nuxt.com/', url: 'https://nuxt.com/' }] },
      { kind: 'link', title: 'Zen', url: 'https://zen-browser.app/' },
    ])
    expect(countLinks(roots)).toBe(3)
  })

  it('lê a cópia automática compactada (bookmarkbackups/*.jsonlz4)', () => {
    const data = new Uint8Array(Buffer.from(BACKUP_JSONLZ4, 'base64'))
    const roots = parseGeckoBackup(JSON.parse(new TextDecoder().decode(decodeMozLz4(data))))
    expect(roots.map((root) => root.title)).toEqual(['Barra de favoritos', 'Menu de favoritos', 'Outros favoritos'])
    expect(roots[0]!.children[0]).toEqual({
      kind: 'folder',
      title: 'Dev',
      children: [
        { kind: 'link', title: 'Nuxt', url: 'https://nuxt.com/docs' },
        { kind: 'link', title: 'Zen Browser', url: 'https://zen-browser.app/' },
      ],
    })
    expect(roots[1]!.children).toEqual([{ kind: 'link', title: 'Mozilla', url: 'https://www.mozilla.org/pt-BR/' }])
    expect(roots[2]!.children[0]).toMatchObject({ title: 'Repetição repetição repetição repetição repetição' })
    expect(countLinks(roots)).toBe(5)
  })

  it('recusa arquivos que não são mozLz4 ou estão corrompidos', () => {
    expect(() => decodeMozLz4(new TextEncoder().encode('{"json": true}'))).toThrow()
    const data = new Uint8Array(Buffer.from(BACKUP_JSONLZ4, 'base64'))
    expect(() => decodeMozLz4(data.subarray(0, 200))).toThrow()
    // Bloco só com texto (sem cópias) e cópia que se sobrepõe ("aaaa…")
    expect(new TextDecoder().decode(decodeLz4Block(new Uint8Array([0x30, 0x61, 0x62, 0x63]), 3))).toBe('abc')
    expect(new TextDecoder().decode(decodeLz4Block(new Uint8Array([0x16, 0x61, 0x01, 0x00, 0x10, 0x62]), 12))).toBe('aaaaaaaaaaab')
  })
})

// ── Links: foto da categoria e ordem pela URL ───────────────────────────────

const link = (url: string, title = url): SavedLink => ({ id: url, url, title, folderId: null, icon: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })

describe('links: categorias com foto e ordem pela URL', () => {
  it('guarda a foto da categoria (só imagens da biblioteca)', () => {
    const data = normalizeLinksFile({
      folders: [
        { id: 'a', name: 'A', image: 'attachments/foto.png' },
        { id: 'b', name: 'B', image: '../fora.png' },
        { id: 'c', name: 'C', image: 'attachments/../../fora.png' },
        { id: 'd', name: 'D', image: 'notes/Dev/Dev.png' },
      ],
      links: [],
    })
    expect(data.folders.map((folder) => folder.image)).toEqual(['attachments/foto.png', null, null, null])
    expect(JSON.parse(serializeLinks(data)).folders[0]).toMatchObject({ id: 'a', image: 'attachments/foto.png' })
  })

  it('ordena pelo endereço: domínio (sem www.) e depois o caminho', () => {
    const list = [link('https://www.zebra.com/'), link('https://nuxt.com/docs/2'), link('https://nuxt.com/docs/10'), link('http://abc.org/x'), link('https://www.nuxt.com/')]
    expect(sortLinks(list, 'url').map((item) => item.url)).toEqual([
      'http://abc.org/x',
      'https://www.nuxt.com/',
      'https://nuxt.com/docs/2',
      'https://nuxt.com/docs/10',
      'https://www.zebra.com/',
    ])
    expect(urlSortKey('https://www.xn--ao-siap.com.br/p%C3%A1gina')).toBe('ação.com.br/página')
  })
})
