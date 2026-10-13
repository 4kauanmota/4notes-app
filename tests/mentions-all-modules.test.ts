import { describe, expect, it } from 'vitest'
import { rankMentions } from '~/lib/mentions/catalog'
import { normalizeRefs, refFromPath, refKey, refPath, renamedRef, type MentionRef } from '~/lib/mentions/refs'
import {
  hrefUrl,
  idMentionPath,
  idOf,
  linksIn,
  mapMentionPath,
  mapOfMentionPath,
  mentionKind,
  mentionMarkdown,
  mentionTarget,
  relinkUrl,
  renameMentionLinks,
  retitleIdLinks,
  retitleTaskLinks,
} from '~/lib/notes/mention-links'
import { normalizeTasksFile } from '~/lib/tasks/model'

describe('caminhos de menção de todos os módulos', () => {
  it('tarefas, registros do Timer e links pelo id; mapas pelo mapa.json', () => {
    expect(idMentionPath('timer', 's_1')).toBe('timer/timer.json#s_1')
    expect(idMentionPath('link', 'l_1')).toBe('links/links.json#l_1')
    expect(idOf('timer/timer.json#s_1')).toEqual({ kind: 'timer', id: 's_1' })
    expect(idOf('tasks/tasks.json#t_9')).toEqual({ kind: 'task', id: 't_9' })
    expect(idOf('timer/timer.json#')).toBeNull()
    expect(idOf('notes/Ideias.md')).toBeNull()
    expect(mapMentionPath('Principal')).toBe('mindmap/Principal/mapa.json')
    expect(mapOfMentionPath('mindmap/Principal/mapa.json')).toBe('Principal')
    expect(mapOfMentionPath('mindmap/Principal/Godot.md')).toBeNull()
    expect(
      ['notes/A.md', 'mindmap/M/A.md', 'mindmap/M/mapa.json', 'tasks/tasks.json#t', 'timer/timer.json#s', 'links/links.json#l'].map(
        mentionKind,
      ),
    ).toEqual(['note', 'map', 'mindmap', 'task', 'timer', 'link'])
  })

  it('links das notas viram menção ao registro e ao mapa (e só a eles)', () => {
    expect(mentionTarget('notes', '../timer/timer.json#s_k3')).toBe('timer/timer.json#s_k3')
    expect(mentionTarget('mindmap/Jogos', '../Principal/mapa.json')).toBe('mindmap/Principal/mapa.json')
    expect(mentionTarget('notes/Trabalho', '../../tasks/tasks.json#t_1')).toBe('tasks/tasks.json#t_1')
    // Links salvos são links comuns; outros arquivos não são menções
    expect(mentionTarget('notes', '../links/links.json#l_1')).toBeNull()
    expect(mentionTarget('notes', '../timer/timer.json')).toBeNull()
    expect(mentionTarget('notes', '../mindmap/Principal/outro.json')).toBeNull()
    expect(mentionTarget('notes', 'https://nuxt.com')).toBeNull()
    expect(mentionMarkdown('notes/Trabalho', 'timer/timer.json#s_1', 'Estudando [Godot]')).toBe(
      '[Estudando \\[Godot\\]](../../timer/timer.json#s_1)',
    )
  })

  it('o título do registro ou da tarefa acompanha nas notas', () => {
    const content = 'Hoje: [Estudo](../timer/timer.json#s_1) e [Tarefa](../tasks/tasks.json#t_1)\n`[Estudo](../timer/timer.json#s_1)`'
    expect(retitleIdLinks(content, 'notes', new Map([['timer/timer.json#s_1', 'Estudando Godot']]))).toBe(
      'Hoje: [Estudando Godot](../timer/timer.json#s_1) e [Tarefa](../tasks/tasks.json#t_1)\n`[Estudo](../timer/timer.json#s_1)`',
    )
    expect(retitleTaskLinks(content, 'notes', new Map([['t_1', 'Revisar']]))).toContain('[Revisar](../tasks/tasks.json#t_1)')
    expect(retitleIdLinks(content, 'notes', new Map([['timer/timer.json#s_2', 'Outro']]))).toBeNull()
  })

  it('mapa renomeado: a menção ao mapa muda o caminho e o texto', () => {
    const content = 'Ver [Principal](../mindmap/Principal/mapa.json) e [Godot](../mindmap/Principal/Godot.md)'
    expect(renameMentionLinks(content, 'notes', { type: 'map-renamed', from: 'Principal', to: 'Jogos' }, null)).toBe(
      'Ver [Jogos](../mindmap/Jogos/mapa.json) e [Godot](../mindmap/Jogos/Godot.md)',
    )
  })

  it('link salvo com endereço novo: os links das notas acompanham (fora do código e das imagens)', () => {
    const content =
      'Docs: [Nuxt](https://nuxt.com/docs) · [outro](<https://nuxt.com/docs/>)\n![img](https://nuxt.com/docs)\n```\n[Nuxt](https://nuxt.com/docs)\n```'
    const next = relinkUrl(content, (url) => url.replace(/\/$/, '') === 'https://nuxt.com/docs', 'https://nuxt.com/docs/4.x')
    expect(next).toBe(
      'Docs: [Nuxt](https://nuxt.com/docs/4.x) · [outro](https://nuxt.com/docs/4.x)\n![img](https://nuxt.com/docs)\n```\n[Nuxt](https://nuxt.com/docs)\n```',
    )
    expect(hrefUrl('<https://a.com/x%28y%29>')).toBe('https://a.com/x(y)')
  })

  it('lista os links de um texto (para o "Ver menções")', () => {
    const content = '[A](A.md) [Reg](../timer/timer.json#s_1) [Site](https://a.com) ![i](x.png)'
    expect(linksIn(content, 'notes')).toEqual([
      { path: 'notes/A.md', url: 'A.md' },
      { path: 'timer/timer.json#s_1', url: '../timer/timer.json#s_1' },
      { path: null, url: 'https://a.com' },
    ])
  })
})

describe('menções guardadas nas tarefas', () => {
  const all: MentionRef[] = [
    { kind: 'note', path: 'notes/Ideias.md', title: 'Ideias' },
    { kind: 'map', map: 'Principal', note: 'Godot.md', title: 'Godot' },
    { kind: 'mindmap', map: 'Principal', title: 'Principal' },
    { kind: 'task', id: 't_1', title: 'Estudar' },
    { kind: 'timer', id: 's_1', title: 'Estudando Godot' },
    { kind: 'link', id: 'l_1', url: 'https://nuxt.com', title: 'Nuxt' },
  ]

  it('caminho de menção ida e volta, para todos os tipos', () => {
    for (const ref of all) {
      const back = refFromPath(refPath(ref), ref.title, ref.kind === 'link' ? ref.url : undefined)
      expect(back).toEqual(ref)
    }
    expect(new Set(all.map(refKey)).size).toBe(all.length)
    expect(refFromPath('attachments/foto.png')).toBeNull()
  })

  it('lê os tipos novos e os antigos; ignora o que não dá para achar', () => {
    const refs = normalizeRefs([
      ...all,
      { kind: 'timer', id: 's_1', title: 'Repetido' },
      { kind: 'timer', id: '' },
      { kind: 'link', url: 'https://sem-id.com' },
      { kind: 'mindmap', map: '  ' },
      { kind: 'task', id: 't_2' },
    ])
    expect(refs).toEqual([...all, { kind: 'task', id: 't_2', title: '' }])
  })

  it('mapa renomeado: a menção ao mapa e às notas dele acompanham', () => {
    const change = { type: 'map-renamed', from: 'principal', to: 'Jogos' } as const
    expect(renamedRef(all[2]!, change)).toEqual({ kind: 'mindmap', map: 'Jogos', title: 'Jogos' })
    expect(renamedRef(all[1]!, change)).toMatchObject({ map: 'Jogos' })
    expect(renamedRef(all[4]!, change)).toBeNull()
  })

  it('o tasks.json guarda menções de todos os tipos', () => {
    const file = normalizeTasksFile({ tasks: [{ id: 't_9', title: 'Revisar', mentions: all }] })
    expect(file.tasks[0]!.mentions).toEqual(all)
  })
})

describe('lista do @', () => {
  const items = [
    { title: 'Estudando Godot', keywords: 'Timer · Estudo · 12/10/2026', late: 3, order: -2 },
    { title: 'Estudando Godot', keywords: 'Timer · Estudo · 05/10/2026', late: 3, order: -1 },
    { title: 'Godot', keywords: 'Mapa · Principal' },
    { title: 'Ideias de Godot', keywords: 'Notas' },
    { title: 'Nuxt', keywords: 'Link · nuxt.com https://nuxt.com', late: 2 },
  ]

  it('começa com o texto, depois contém, depois pelas outras palavras', () => {
    expect(rankMentions(items, 'godot', 10).map((item) => item.title)).toEqual([
      'Godot',
      'Ideias de Godot',
      'Estudando Godot',
      'Estudando Godot',
    ])
    expect(rankMentions(items, 'principal', 10).map((item) => item.title)).toEqual(['Godot'])
  })

  it('várias palavras: atividade + data, sem acento e sem maiúsculas', () => {
    expect(rankMentions(items, 'estudo 12/10', 10)).toEqual([items[0]])
    expect(rankMentions(items, 'TIMER godot', 10)).toEqual([items[0], items[1]])
  })

  it('registros mais recentes primeiro; o limite vale', () => {
    expect(rankMentions(items, 'estudando', 10)).toEqual([items[0], items[1]])
    expect(rankMentions(items, '', 2)).toHaveLength(2)
    expect(rankMentions(items, 'nuxt.com', 10)).toEqual([items[4]])
  })
})
