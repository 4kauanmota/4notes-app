import { describe, expect, it } from 'vitest'
import { workspaceFileUrl, workspaceNameProblem } from '#shared/ipc'
import { mentionMarkdown, mentionTarget, renameMentionLinks } from '~/lib/notes/mention-links'
import { normalizeRefs, refKey, renamedRef, type MentionRef } from '~/lib/mentions/refs'

describe('menções a notas', () => {
  it('lê de forma tolerante, completa o título e ignora repetidas', () => {
    const refs = normalizeRefs([
      { kind: 'note', path: 'notes/Ideias.md' },
      { kind: 'note', path: 'notes/ideias.md', title: 'Repetida' }, // mesma nota (sem diferenciar maiúsculas)
      { kind: 'map', map: 'Principal', note: 'Godot.md', title: '  Godot  ' },
      { kind: 'map', map: '', note: 'Sem mapa.md' },
      { kind: 'note', path: 'notes/arquivo.txt' },
      { kind: 'outra' },
      'lixo',
      null,
    ])
    expect(refs).toEqual([
      { kind: 'note', path: 'notes/Ideias.md', title: 'Ideias' },
      { kind: 'map', map: 'Principal', note: 'Godot.md', title: 'Godot' },
    ])
    expect(normalizeRefs('nada')).toEqual([])
    expect(refKey(refs[0]!)).toBe(refKey({ kind: 'note', path: 'NOTES/IDEIAS.md', title: '' }))
  })

  it('acompanha notas e mapas renomeados no app', () => {
    const note: MentionRef = { kind: 'note', path: 'notes/Ideias.md', title: 'Ideias' }
    const mapNote: MentionRef = { kind: 'map', map: 'Principal', note: 'Godot.md', title: 'Godot' }

    expect(renamedRef(note, { type: 'note-renamed', from: 'notes/ideias.md', to: 'notes/Ideias 2D.md' })).toMatchObject({ path: 'notes/Ideias 2D.md' })
    expect(renamedRef(mapNote, { type: 'map-note-renamed', map: 'Principal', from: 'Godot.md', to: 'Godot 4.md' })).toEqual({
      kind: 'map',
      map: 'Principal',
      note: 'Godot 4.md',
      title: 'Godot 4',
    })
    expect(renamedRef(mapNote, { type: 'map-renamed', from: 'Principal', to: 'Jogos' })).toMatchObject({ map: 'Jogos', note: 'Godot.md' })
  })

  it('menções de outras notas não mudam', () => {
    const note: MentionRef = { kind: 'note', path: 'notes/Ideias.md', title: 'Ideias' }
    const mapNote: MentionRef = { kind: 'map', map: 'Principal', note: 'Godot.md', title: 'Godot' }
    expect(renamedRef(note, { type: 'note-renamed', from: 'notes/Outra.md', to: 'notes/Nova.md' })).toBeNull()
    expect(renamedRef(note, { type: 'map-renamed', from: 'Principal', to: 'Jogos' })).toBeNull()
    expect(renamedRef(mapNote, { type: 'map-note-renamed', map: 'Estudos', from: 'Godot.md', to: 'Godot 4.md' })).toBeNull()
    expect(renamedRef(mapNote, { type: 'note-renamed', from: 'Godot.md', to: 'Godot 4.md' })).toBeNull()
  })
})

describe('menções dentro das Notas', () => {
  it('a menção é um link Markdown relativo para o .md da nota', () => {
    expect(mentionMarkdown('notes', 'notes/Ideias de jogo.md', 'Ideias de jogo')).toBe('[Ideias de jogo](Ideias%20de%20jogo.md)')
    expect(mentionMarkdown('notes', 'mindmap/Principal/Godot.md', 'Godot')).toBe('[Godot](../mindmap/Principal/Godot.md)')
    expect(mentionMarkdown('notes', 'notes/Ideia (2).md', 'Ideia [rascunho]')).toBe('[Ideia \\[rascunho\\]](Ideia%20%282%29.md)')
    expect(mentionMarkdown('notes', 'notes/Programação.md', 'Programação')).toBe('[Programação](Programação.md)')
  })

  it('reconhece links para notas (e só eles)', () => {
    expect(mentionTarget('notes', 'Ideias%20de%20jogo.md')).toBe('notes/Ideias de jogo.md')
    expect(mentionTarget('notes', '../mindmap/Principal/Godot.md')).toBe('mindmap/Principal/Godot.md')
    expect(mentionTarget('notes', 'Ideia%20%282%29.md')).toBe('notes/Ideia (2).md')
    expect(mentionTarget('notes', 'https://exemplo.com/a.md')).toBeNull()
    expect(mentionTarget('notes', '../attachments/print.png')).toBeNull()
  })

  it('acompanha a nota renomeada (link e texto)', () => {
    const content = 'Ver [Ideias](Ideias.md) e [Godot](../mindmap/Principal/Godot.md).\n`[Ideias](Ideias.md)` fica\n```\n[Ideias](Ideias.md)\n```'
    const renamed = renameMentionLinks(content, 'notes', { type: 'note-renamed', from: 'notes/ideias.md', to: 'notes/Ideias 2D.md' }, 'Ideias 2D')
    expect(renamed).toBe('Ver [Ideias 2D](Ideias%202D.md) e [Godot](../mindmap/Principal/Godot.md).\n`[Ideias](Ideias.md)` fica\n```\n[Ideias](Ideias.md)\n```')
  })

  it('acompanha notas e mapas renomeados no Mapa Mental', () => {
    const content = '- [Godot](../mindmap/Principal/Godot.md)\n- [Arte](../mindmap/Principal/Arte.md)'
    expect(
      renameMentionLinks(content, 'notes', { type: 'map-note-renamed', map: 'Principal', from: 'Godot.md', to: 'Godot 4.md' }, 'Godot 4'),
    ).toBe('- [Godot 4](../mindmap/Principal/Godot%204.md)\n- [Arte](../mindmap/Principal/Arte.md)')
    expect(renameMentionLinks(content, 'notes', { type: 'map-renamed', from: 'Principal', to: 'Jogos' }, null)).toBe(
      '- [Godot](../mindmap/Jogos/Godot.md)\n- [Arte](../mindmap/Jogos/Arte.md)',
    )
  })

  it('sem menções da nota renomeada, nada muda', () => {
    expect(renameMentionLinks('[Outra](Outra.md) ![](../attachments/a.png)', 'notes', { type: 'note-renamed', from: 'notes/A.md', to: 'notes/B.md' }, 'B')).toBeNull()
  })
})

describe('workspaces', () => {
  it('aceita nomes comuns', () => {
    // Espaços nas pontas são ignorados (o nome é aparado antes de criar a pasta)
    for (const name of ['Pessoal', 'Trabalho 2026', 'Estudos — Godot', 'Ação', ' Pessoal ']) expect(workspaceNameProblem(name)).toBeNull()
  })

  it('recusa nomes que não podem virar pasta', () => {
    for (const name of ['', '   ', 'Meu/Workspace', 'a\\b', 'nome?', 'fim.', 'fim. ', 'CON', 'com1', 'x'.repeat(81)]) {
      expect(workspaceNameProblem(name), JSON.stringify(name)).toBeTypeOf('string')
    }
  })

  it('endereço das imagens do workspace', () => {
    expect(workspaceFileUrl('attachments/minha imagem#1.png')).toBe('workspace://files/attachments/minha%20imagem%231.png')
  })
})
