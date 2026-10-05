import { describe, expect, it } from 'vitest'
import { countLinks, parseBookmarksHtml, parseChromiumBookmarks } from '#shared/bookmarks'
import { decodeEntities, iconFileBase, iconUrls, parseHead, sniffImage } from '#shared/link-meta'
import { flattenBookmarks, planImport } from '~/lib/links/import'
import {
  displayHost,
  folderIdFor,
  folderNameProblem,
  normalizeLinksFile,
  normalizeUrl,
  placeholderTitle,
  searchLinks,
  serializeLinks,
  sortLinks,
  urlKey,
  type LinkFolder,
  type SavedLink,
} from '~/lib/links/model'

const link = (url: string, extra: Partial<SavedLink> = {}): SavedLink => ({
  id: extra.id ?? `l_${url}`,
  url,
  title: extra.title ?? placeholderTitle(url),
  folderId: null,
  icon: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

const folder = (id: string, name: string): LinkFolder => ({ id, name, color: 'purple', icon: null, createdAt: '2026-01-01T00:00:00.000Z' })

describe('título e ícone da página', () => {
  it('lê o título (com entidades) e os ícones do <head>', () => {
    const head = parseHead(`<!doctype html><html><head>
      <meta charset="utf-8">
      <title>  Nuxt &amp; Vue &#8212; Docs
      </title>
      <link rel="mask-icon" href="/mask.svg">
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="apple-touch-icon" href="/apple.png" sizes="180x180">
      <link rel="icon" type="image/svg+xml" href="/icon.svg">
      <link rel="stylesheet" href="/style.css">
    </head><body><title>Outro</title></body></html>`)
    expect(head.title).toBe('Nuxt & Vue — Docs')
    expect(head.icons.map((icon) => icon.href)).toEqual(['/favicon-16.png', '/apple.png', '/icon.svg'])
  })

  it('usa og:title quando a página não tem <title>', () => {
    expect(parseHead('<meta property="og:title" content="Página &quot;legal&quot;">').title).toBe('Página "legal"')
    expect(parseHead('<p>sem nada</p>').title).toBeNull()
  })

  it('ordena os ícones (SVG e tamanhos médios primeiro) e deixa o /favicon.ico por último', () => {
    const head = parseHead(`<head><base href="https://cdn.site.com/assets/">
      <link rel="shortcut icon" href="fav.ico">
      <link rel="icon" href="icon-32.png" sizes="32x32">
      <link rel="icon" href="icon-192.png" sizes="192x192">
      <link rel="icon" href="logo.svg">
      <link rel="icon" href="data:image/png;base64,AAAA">
    </head>`)
    const urls = iconUrls(head, 'https://www.site.com/pagina')
    expect(urls[0]).toBe('https://cdn.site.com/assets/logo.svg')
    expect(urls.indexOf('https://cdn.site.com/assets/icon-192.png')).toBeLessThan(urls.indexOf('https://cdn.site.com/assets/fav.ico'))
    expect(urls).toContain('data:image/png;base64,AAAA')
    expect(urls.at(-1)).toBe('https://www.site.com/favicon.ico')
    expect(urls.length).toBeLessThanOrEqual(6)
  })

  it('reconhece imagens pelos primeiros bytes', () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('png')
    expect(sniffImage(new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]))).toBe('ico')
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(sniffImage(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('svg')
    // Uma página de erro em HTML não é ícone
    expect(sniffImage(new TextEncoder().encode('<!doctype html><html><body>404</body></html>'), 'text/html')).toBeNull()
  })

  it('gera nomes de arquivo seguros para os ícones e decodifica entidades', () => {
    expect(iconFileBase('WWW.Nuxt.com')).toBe('www.nuxt.com')
    expect(iconFileBase('[::1]')).toBe('_1')
    expect(iconFileBase('..')).toBe('site')
    expect(decodeEntities('&#x1F600; &eacute; &#233;')).toBe('😀 &eacute; é')
  })
})

describe('favoritos do navegador', () => {
  const chromium = {
    roots: {
      bookmark_bar: {
        type: 'folder',
        name: 'Bookmarks bar',
        children: [
          { type: 'url', name: 'Nuxt', url: 'https://nuxt.com/' },
          { type: 'url', name: 'Script', url: 'javascript:alert(1)' },
          {
            type: 'folder',
            name: 'Dev',
            children: [
              { type: 'url', name: 'Vue', url: 'https://vuejs.org' },
              { type: 'folder', name: 'Vazia', children: [] },
              { type: 'folder', name: 'Godot', children: [{ type: 'url', name: '', url: 'https://godotengine.org' }] },
            ],
          },
        ],
      },
      other: { type: 'folder', name: 'Other', children: [{ type: 'url', name: 'Interno', url: 'chrome://settings' }] },
      synced: { type: 'folder', name: 'Mobile', children: [{ type: 'url', name: 'MDN', url: 'https://developer.mozilla.org' }] },
    },
  }

  it('lê o arquivo Bookmarks do Chromium (Brave, Chrome, Edge…)', () => {
    const roots = parseChromiumBookmarks(chromium)
    expect(roots.map((root) => root.title)).toEqual(['Barra de favoritos', 'Favoritos do celular'])
    expect(countLinks(roots)).toBe(4)
    const dev = roots[0]!.children[1]!
    expect(dev).toMatchObject({ kind: 'folder', title: 'Dev' })
    // Sem título: usa o endereço
    expect(JSON.stringify(roots)).toContain('"title":"https://godotengine.org"')
    expect(parseChromiumBookmarks(null)).toEqual([])
    expect(parseChromiumBookmarks({ roots: 'x' })).toEqual([])
  })

  it('lê as raízes do Opera / Opera GX (e ignora a lixeira)', () => {
    const roots = parseChromiumBookmarks({
      roots: {
        bookmark_bar: { type: 'folder', children: [] },
        custom_root: {
          speedDial: { type: 'folder', children: [{ type: 'url', name: 'YouTube', url: 'https://youtube.com' }] },
          userRoot: { type: 'folder', children: [{ type: 'url', name: 'Steam', url: 'https://store.steampowered.com' }] },
          trash: { type: 'folder', children: [{ type: 'url', name: 'Velho', url: 'https://velho.com' }] },
        },
      },
    })
    expect(roots.map((root) => root.title)).toEqual(['Discagem rápida', 'Favoritos'])
    expect(countLinks(roots)).toBe(2)
  })

  it('lê o arquivo HTML exportado pelos navegadores', () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Barra de favoritos</H3>
    <DL><p>
        <DT><A HREF="https://nuxt.com/" ICON="data:image/png;base64,iVBORw0KGgo=">Nuxt &amp; Co</A>
        <DT><H3>Jogos</H3>
        <DL><p>
            <DT><A HREF="https://store.steampowered.com/">Steam</A>
            <DT><A HREF="javascript:void(0)">Bookmarklet</A>
        </DL><p>
        <DT><H3>Vazia</H3>
        <DL><p>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://developer.mozilla.org/" ICON="https://evil.example/x.png">MDN</A>
</DL><p>`
    const roots = parseBookmarksHtml(html)
    expect(roots.map((root) => root.title)).toEqual(['Favoritos', 'Barra de favoritos'])
    expect(countLinks(roots)).toBe(3)
    const bar = roots[1]!
    expect(bar.children[0]).toEqual({ kind: 'link', title: 'Nuxt & Co', url: 'https://nuxt.com/', icon: 'data:image/png;base64,iVBORw0KGgo=' })
    expect(bar.children[1]).toMatchObject({ kind: 'folder', title: 'Jogos', children: [{ kind: 'link', title: 'Steam' }] })
    // Ícone que não é data:image não vem junto
    expect(roots[0]!.children[0]).toEqual({ kind: 'link', title: 'MDN', url: 'https://developer.mozilla.org/' })
  })
})

describe('endereços', () => {
  it('completa e valida o que foi digitado ou colado', () => {
    expect(normalizeUrl('nuxt.com/docs')).toBe('https://nuxt.com/docs')
    expect(normalizeUrl('  https://Nuxt.com  ')).toBe('https://nuxt.com/')
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000/')
    expect(normalizeUrl('127.0.0.1:8080/api')).toBe('http://127.0.0.1:8080/api')
    expect(normalizeUrl('//cdn.site.com/lib.js')).toBe('https://cdn.site.com/lib.js')
    expect(normalizeUrl('<https://site.com.br/a>')).toBe('https://site.com.br/a')
    expect(normalizeUrl('exemplo.com.br?q=1')).toBe('https://exemplo.com.br/?q=1')
    // Domínio com acento (vira punycode, como no navegador)
    expect(normalizeUrl('ação.com.br')).toBe(new URL('https://ação.com.br').href)
    expect(normalizeUrl('ação.com.br')).toMatch(/^https:\/\/xn--/)
    for (const bad of ['', 'texto qualquer', 'javascript:alert(1)', 'ftp://site.com', 'mailto:a@b.com', 'nota', 'arquivo.', 'C:\\pasta']) {
      expect(normalizeUrl(bad), bad).toBeNull()
    }
  })

  it('acha links repetidos mesmo com pequenas diferenças', () => {
    expect(urlKey('https://Nuxt.com/docs/')).toBe(urlKey('https://nuxt.com/docs'))
    expect(urlKey('https://nuxt.com:443/')).toBe(urlKey('https://nuxt.com'))
    expect(urlKey('https://nuxt.com/Docs')).not.toBe(urlKey('https://nuxt.com/docs'))
    expect(urlKey('http://nuxt.com')).not.toBe(urlKey('https://nuxt.com'))
  })

  it('usa o domínio como título provisório (com acentos, sem "www.")', () => {
    expect(placeholderTitle('https://www.github.com/nuxt')).toBe('github.com')
    expect(placeholderTitle(normalizeUrl('ação.com.br/página')!)).toBe('ação.com.br')
    expect(displayHost('https://www.xn--bcher-kva.de/')).toBe('bücher.de')
  })
})

describe('pastas, busca e ordem', () => {
  it('valida nomes de pasta (sem repetir, ignorando acentos e maiúsculas)', () => {
    expect(folderNameProblem('  ', [])).toMatch(/nome/)
    expect(folderNameProblem('Música', ['musica'])).toMatch(/Já existe/)
    expect(folderNameProblem('x'.repeat(41), [])).toMatch(/40/)
    expect(folderNameProblem('Dev', ['Jogos'])).toBeNull()
  })

  it('gera ids legíveis e únicos', () => {
    const taken = new Set(['dev'])
    expect(folderIdFor('Dev', (id) => taken.has(id))).toBe('dev-2')
    expect(folderIdFor('Jogos e Godot!', () => false)).toBe('jogos-e-godot')
    expect(folderIdFor('🎮', () => false)).toBe('pasta')
  })

  it('busca no título e no endereço, sem diferenciar acentos', () => {
    const list = [link('https://nuxt.com', { title: 'Documentação do Nuxt' }), link('https://godotengine.org', { title: 'Godot' })]
    expect(searchLinks(list, 'documentacao nuxt').map((item) => item.title)).toEqual(['Documentação do Nuxt'])
    expect(searchLinks(list, 'ENGINE')).toHaveLength(1)
    expect(searchLinks(list, '  ')).toHaveLength(2)
    // Domínio com acento (o endereço guarda em punycode)
    expect(searchLinks([link(normalizeUrl('ação.com.br')!, { title: 'Loja' })], 'acao')).toHaveLength(1)
  })

  it('ordena por mais recentes ou por nome', () => {
    const a = link('https://a.com', { title: 'Zebra', createdAt: '2026-01-01T00:00:00.000Z' })
    const b = link('https://b.com', { title: 'abacaxi', createdAt: '2026-03-01T00:00:00.000Z' })
    const c = link('https://c.com', { title: 'Item 10', createdAt: '2026-02-01T00:00:00.000Z' })
    const d = link('https://d.com', { title: 'Item 9', createdAt: '2025-02-01T00:00:00.000Z' })
    expect(sortLinks([a, b, c, d], 'recent').map((item) => item.title)).toEqual(['abacaxi', 'Item 10', 'Zebra', 'Item 9'])
    expect(sortLinks([a, b, c, d], 'name').map((item) => item.title)).toEqual(['abacaxi', 'Item 9', 'Item 10', 'Zebra'])
  })
})

describe('arquivo links.json', () => {
  it('lê de forma tolerante e grava de volta igual', () => {
    const data = normalizeLinksFile({
      folders: [
        { id: 'dev', name: 'Dev', color: 'blue', icon: 'code' },
        { id: 'dev', name: 'Repetida' },
        { id: 'x', name: '' },
        { id: 'jogos', name: 'Jogos', color: 'cor-que-nao-existe', icon: 'icone-que-nao-existe' },
      ],
      links: [
        { id: 'l1', url: 'nuxt.com', title: '', folderId: 'dev', icon: 'nuxt.com.png' },
        { id: 'l1', url: 'https://vuejs.org', title: 'Vue', folderId: 'sumiu', icon: '../fora.png' },
        { id: 'l3', url: 'javascript:alert(1)' },
        'lixo',
      ],
    })
    expect(data.folders.map((item) => [item.id, item.color, item.icon])).toEqual([
      ['dev', 'blue', 'code'],
      ['jogos', 'gray', null],
    ])
    expect(data.links).toHaveLength(2)
    expect(data.links[0]).toMatchObject({ id: 'l1', url: 'https://nuxt.com/', title: 'nuxt.com', folderId: 'dev', icon: 'nuxt.com.png' })
    expect(data.links[1]!.id).not.toBe('l1')
    expect(data.links[1]).toMatchObject({ folderId: null, icon: null })
    const raw = serializeLinks(data)
    expect(normalizeLinksFile(JSON.parse(raw))).toEqual(data)
    expect(JSON.parse(raw)).toMatchObject({ app: '4notes', version: 1 })
    expect(() => normalizeLinksFile([])).toThrow()
  })
})

describe('importar do navegador', () => {
  const roots = parseChromiumBookmarks({
    roots: {
      bookmark_bar: {
        type: 'folder',
        children: [
          { type: 'url', name: 'Nuxt', url: 'https://nuxt.com' },
          { type: 'folder', name: 'Música', children: [{ type: 'url', name: 'Spotify', url: 'https://open.spotify.com' }] },
          {
            type: 'folder',
            name: 'Dev',
            children: [
              { type: 'url', name: 'Vue', url: 'https://vuejs.org' },
              { type: 'folder', name: 'Godot', children: [{ type: 'url', name: 'Godot', url: 'https://godotengine.org' }] },
              { type: 'url', name: 'Nuxt de novo', url: 'https://nuxt.com/' },
            ],
          },
        ],
      },
    },
  })
  const candidates = flattenBookmarks(roots)

  it('achata a árvore com o caminho de pastas e chaves estáveis', () => {
    expect(candidates.map((candidate) => [candidate.key, candidate.path.join(' / ')])).toEqual([
      ['0/0', 'Barra de favoritos'],
      ['0/1/0', 'Barra de favoritos / Música'],
      ['0/2/0', 'Barra de favoritos / Dev'],
      ['0/2/1/0', 'Barra de favoritos / Dev / Godot'],
      ['0/2/2', 'Barra de favoritos / Dev'],
    ])
  })

  it('uma pasta para cada pasta do navegador: junta com as que já existem e não repete links', () => {
    const plan = planImport(candidates, { folders: [folder('musica', 'musica')], links: [link('https://vuejs.org/')] }, { kind: 'folders' })
    expect(plan.newFolders).toEqual(['Godot'])
    expect(plan.skipped).toBe(2) // Vue já estava salvo; o segundo Nuxt é repetido
    expect(plan.links.map((item) => [item.title, item.folderId, item.folderName])).toEqual([
      ['Nuxt', null, null],
      ['Spotify', 'musica', null],
      ['Godot', null, 'Godot'],
    ])
  })

  it('tudo numa pasta só', () => {
    const plan = planImport(candidates, { folders: [folder('dev', 'Dev')], links: [] }, { kind: 'single', folderId: 'dev' })
    expect(plan.newFolders).toEqual([])
    expect(plan.links).toHaveLength(4)
    expect(plan.links.every((item) => item.folderId === 'dev')).toBe(true)
  })
})
