import { describe, expect, it } from 'vitest'
import { relativeTo, resolveFromNote, resolveLink } from '~/lib/files/workspace-path'
import {
  categoryNameProblem,
  categoryOfPath,
  mergeWithFolders,
  normalizeCategories,
  serializeCategories,
  suggestCategoryColor,
} from '~/lib/notes/categories'
import {
  mentionKind,
  mentionMarkdown,
  mentionTarget,
  rebaseLinks,
  renameMentionLinks,
  retitleTaskLinks,
  taskIdOf,
  taskMentionPath,
} from '~/lib/notes/mention-links'
import { titleFor } from '~/lib/editor/title-line'
import { buildTitleTree, flattenTree, folderPathTo, type TitleTreeNode } from '~/lib/notes/title-tree'
import { renamedRef } from '~/lib/mentions/refs'

/** Árvore em texto, para comparar: pastas com "/", nota da pasta com "*". */
function outline(nodes: TitleTreeNode[], indent = ''): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'note'
      ? [`${indent}${node.label}`]
      : [`${indent}${node.label}/${node.noteId ? '*' : ''} (${node.count})`, ...outline(node.children, `${indent}  `)],
  )
}

const tree = (...titles: string[]) => buildTitleTree(titles.map((title, index) => ({ id: `n${index}`, title })))

describe('pastas pelo título', () => {
  it('a primeira palavra vira pasta quando 2+ notas começam com ela', () => {
    expect(outline(tree('4notes 1.2.0', '4notes 1.1.1', 'Lista de compras', 'Ideias'))).toEqual([
      '4notes/ (2)',
      '  1.1.1',
      '  1.2.0',
      'Ideias',
      'Lista de compras',
    ])
  })

  it('nota sozinha e título de uma palavra ficam como estão', () => {
    expect(outline(tree('4notes 1.2.0', 'Godot', 'Godot'))).toEqual(['4notes 1.2.0', 'Godot', 'Godot'])
  })

  it('a segunda palavra vira subpasta quando há mais texto depois (até dois níveis)', () => {
    const nodes = tree('4notes 1.1.1', '4notes 1.2.0', '4notes 1.2.0 bugs', '4notes 1.2.0 ideias de layout', '4notes 1.3.0 plano')
    expect(outline(nodes)).toEqual([
      '4notes/ (5)',
      '  1.2.0/* (2)',
      '    bugs',
      '    ideias de layout',
      '  1.1.1',
      '  1.3.0 plano',
    ])
    const folder = nodes[0]!.kind === 'folder' ? nodes[0].children[0]! : null
    expect(folder?.kind === 'folder' && folder.noteId).toBe('n1') // a pasta "1.2.0" é a nota "4notes 1.2.0"
  })

  it('a nota com o título igual ao da pasta é a própria pasta', () => {
    expect(outline(tree('Godot', 'Godot shaders', 'Godot física'))).toEqual(['Godot/* (2)', '  física', '  shaders'])
  })

  it('agrupa sem diferenciar maiúsculas, ordena números e deixa as pastas primeiro', () => {
    // o nome da pasta usa a grafia mais comum ("aula" aparece 2 vezes)
    expect(outline(tree('Aula 10', 'aula 9', 'aula 2', 'Zebra', 'Banana split', 'banana bread'))).toEqual([
      'aula/ (3)',
      '  2',
      '  9',
      '  10',
      'banana/ (2)',
      '  bread',
      '  split',
      'Zebra',
    ])
  })

  it('notas com o mesmo título não viram pasta', () => {
    expect(outline(tree('Ideias de jogo', 'Ideias de jogo'))).toEqual(['Ideias de jogo', 'Ideias de jogo'])
    expect(outline(tree('4notes 1.2 bugs', '4notes 1.2 bugs', '4notes 1.1'))).toEqual(['4notes/ (3)', '  1.1', '  1.2 bugs', '  1.2 bugs'])
  })

  it('notas sem título não viram pasta', () => {
    expect(outline(tree('', '', 'Sem título'))).toEqual(['Sem título', 'Sem título', 'Sem título'])
  })

  it('encontra as pastas que levam até uma nota', () => {
    const nodes = tree('4notes 1.2.0', '4notes 1.2.0 bugs', '4notes 1.1.1', 'Outra')
    expect(folderPathTo(nodes, 'n1')).toEqual(['f:4notes', 'f:4notes\u001f1.2.0'])
    expect(folderPathTo(nodes, 'n0')).toEqual(['f:4notes'])
    expect(folderPathTo(nodes, 'n3')).toEqual([])
    expect(folderPathTo(nodes, 'x')).toBeNull()
  })
})

describe('linhas da lista lateral', () => {
  it('entra só nas pastas abertas e guarda a nota da pasta', () => {
    const nodes = tree('4notes 1.2.0', '4notes 1.2.0 bugs', '4notes 1.1.1', 'Outra')
    const notes = new Map(['n0', 'n1', 'n2', 'n3'].map((id) => [id, { id }]))
    const closed = flattenTree(nodes, notes, () => false)
    expect(closed.map((row) => `${row.depth}:${row.label}`)).toEqual(['0:4notes', '0:Outra'])
    const open = flattenTree(nodes, notes, () => true)
    expect(open.map((row) => `${row.depth}:${row.label}`)).toEqual(['0:4notes', '1:1.2.0', '2:bugs', '1:1.1.1', '0:Outra'])
    expect(open[1]).toMatchObject({ kind: 'folder', note: { id: 'n0' }, count: 1, open: true })
  })

  it('cada pasta sabe o começo do título das notas dela (para o + da pasta)', () => {
    const nodes = tree('4notes 1.2.0', '4notes 1.2.0 bugs', '4notes 1.1.1', 'Outra')
    const rows = flattenTree(nodes, new Map(), () => true)
    expect(rows.map((row) => row.titlePath)).toEqual(['4notes', '4notes 1.2.0', null, null, null])
    // A grafia da pasta é a da nota da pasta (ou a mais comum)
    expect(flattenTree(tree('Godot shaders', 'godot física', 'Godot'), new Map(), () => false)[0]!.titlePath).toBe('Godot')
  })
})

describe('primeira linha como título', () => {
  it('o primeiro texto de uma nota vazia vira título, a não ser que já seja outra marcação', () => {
    expect(titleFor('R')).toBe('# R')
    expect(titleFor('4notes 1.2.0')).toBe('# 4notes 1.2.0')
    for (const text of ['#', '- ', '* x', '> c', '`', '[', '!', '@', ' ', 'duas\nlinhas', '']) expect(titleFor(text), JSON.stringify(text)).toBeNull()
  })
})

describe('categorias das notas', () => {
  it('valida o nome (vira nome de pasta)', () => {
    expect(categoryNameProblem('Trabalho', [])).toBeNull()
    expect(categoryNameProblem('v1.2 estudos', [])).toBeNull()
    for (const bad of ['', '  ', 'a/b', 'x?', '.oculta', 'fim.', 'CON', 'x'.repeat(41)]) expect(categoryNameProblem(bad, []), bad).toBeTypeOf('string')
    expect(categoryNameProblem('trabalho', ['Trabalho'])).toBe('Já existe uma categoria com esse nome.')
  })

  it('lê o categorias.json de forma tolerante', () => {
    const raw = {
      categories: [
        { name: 'Trabalho', color: 'blue', image: 'Trabalho.png' },
        { name: 'trabalho', color: 'red' }, // repetida
        { name: 'Estudos', color: 'cor-que-não-existe', image: '../fora.png', icon: 'icone-que-não-existe' },
        { name: 'Dev', color: 'purple', icon: 'code' },
        { name: '' },
        'lixo',
      ],
    }
    const list = normalizeCategories(raw)
    expect(list.map((c) => c.name)).toEqual(['Trabalho', 'Estudos', 'Dev'])
    expect(list[0]).toEqual({ name: 'Trabalho', color: 'blue', image: 'Trabalho.png', icon: null })
    expect(list[1]!.image).toBeNull()
    expect(list[1]!.icon).toBeNull() // ícone desconhecido: volta para a inicial
    expect(list[2]).toEqual({ name: 'Dev', color: 'purple', image: null, icon: 'code' })
    expect(JSON.parse(serializeCategories(list)).categories[2]).toEqual({ name: 'Dev', color: 'purple', icon: 'code', image: null })
    expect(normalizeCategories(JSON.parse(serializeCategories(list)))).toEqual(list)
    expect(normalizeCategories(null)).toEqual([])
  })

  it('junta as categorias salvas com as pastas encontradas', () => {
    const merged = mergeWithFolders(
      [
        { name: 'Trabalho', color: 'blue', image: null, icon: 'briefcase' },
        { name: 'Vazia', color: 'red', image: null, icon: null },
      ],
      ['trabalho', 'Estudos'],
    )
    expect(merged.map((c) => c.name)).toEqual(['trabalho', 'Vazia', 'Estudos'])
    expect(merged[0]!.color).toBe('blue')
    expect(merged[0]!.icon).toBe('briefcase')
    expect(merged[2]!.icon).toBeNull()
    // a cor de uma pasta nova é sempre a mesma (até ser salva)
    expect(mergeWithFolders([], ['Estudos'])[0]!.color).toBe(merged[2]!.color)
  })

  it('sugere uma cor ainda não usada e acha a categoria pelo caminho', () => {
    expect(suggestCategoryColor(['purple', 'yellow'])).toBe('blue')
    expect(categoryOfPath('notes/Trabalho/Reunião.md')).toBe('Trabalho')
    expect(categoryOfPath('notes/Ideias.md')).toBeNull()
    expect(categoryOfPath('mindmap/Principal/Godot.md')).toBeNull()
  })
})

describe('links das notas', () => {
  it('caminhos com #id (tarefas)', () => {
    expect(relativeTo('notes', 'tasks/tasks.json#t_x1')).toBe('../tasks/tasks.json#t_x1')
    expect(relativeTo('mindmap/Principal', 'tasks/tasks.json#t_x1')).toBe('../../tasks/tasks.json#t_x1')
    expect(resolveLink('notes/Trabalho', '../../tasks/tasks.json#t_x1')).toEqual({ path: 'tasks/tasks.json', fragment: 't_x1' })
    expect(resolveFromNote('notes', 'Ideias.md#Seção')).toBe('notes/Ideias.md')
    expect(resolveLink('notes', '#só-âncora')).toBeNull()
  })

  it('menção a tarefa', () => {
    const path = taskMentionPath('t_k3j9')
    expect(mentionMarkdown('notes/Trabalho', path, 'Estudar [Godot]')).toBe('[Estudar \\[Godot\\]](../../tasks/tasks.json#t_k3j9)')
    expect(mentionTarget('notes/Trabalho', '../../tasks/tasks.json#t_k3j9')).toBe(path)
    expect(mentionTarget('notes', '../tasks/tasks.json')).toBeNull() // sem id não é menção
    expect(taskIdOf(path)).toBe('t_k3j9')
    expect([mentionKind(path), mentionKind('mindmap/A/B.md'), mentionKind('notes/A.md')]).toEqual(['task', 'map', 'note'])
  })

  it('o texto da menção acompanha o título da tarefa', () => {
    const content = 'Fazer [Estudar](../tasks/tasks.json#t_1) e [Outra](../tasks/tasks.json#t_2).\n`[Estudar](../tasks/tasks.json#t_1)`'
    expect(retitleTaskLinks(content, 'notes', new Map([['t_1', 'Estudar Godot']]))).toBe(
      'Fazer [Estudar Godot](../tasks/tasks.json#t_1) e [Outra](../tasks/tasks.json#t_2).\n`[Estudar](../tasks/tasks.json#t_1)`',
    )
    expect(retitleTaskLinks(content, 'notes', new Map([['t_2', 'Outra']]))).toBeNull()
  })

  it('nota movida de pasta: links e imagens continuam apontando para os mesmos arquivos', () => {
    const content = [
      '# Reunião',
      '![](../attachments/print%201.png) [Ideias](Ideias.md) [Godot](../mindmap/Principal/Godot.md)',
      '[Tarefa](../tasks/tasks.json#t_1) [site](https://exemplo.com/a.md) [seção](#topo)',
      '```',
      '[Ideias](Ideias.md)',
      '```',
    ].join('\n')
    expect(rebaseLinks(content, 'notes', 'notes/Trabalho')).toBe(
      [
        '# Reunião',
        '![](../../attachments/print%201.png) [Ideias](../Ideias.md) [Godot](../../mindmap/Principal/Godot.md)',
        '[Tarefa](../../tasks/tasks.json#t_1) [site](https://exemplo.com/a.md) [seção](#topo)',
        '```',
        '[Ideias](Ideias.md)',
        '```',
      ].join('\n'),
    )
    expect(rebaseLinks(content, 'notes', 'notes')).toBeNull()
  })

  it('categoria renomeada: as menções acompanham a pasta', () => {
    const change = { type: 'notes-folder-renamed', from: 'notes/Trabalho', to: 'notes/Projetos' } as const
    expect(renameMentionLinks('[Reunião](Trabalho/Reuni%C3%A3o.md) e [Outra](Outra.md)', 'notes', change, null)).toBe(
      '[Reunião](Projetos/Reunião.md) e [Outra](Outra.md)',
    )
    expect(renameMentionLinks('[Ideias](../../notes/Trabalho/Ideias.md)', 'mindmap/Principal', change, null)).toBe(
      '[Ideias](../../notes/Projetos/Ideias.md)',
    )
    expect(renamedRef({ kind: 'note', path: 'notes/Trabalho/Ideias.md', title: 'Ideias' }, change)).toEqual({
      kind: 'note',
      path: 'notes/Projetos/Ideias.md',
      title: 'Ideias',
    })
    expect(renamedRef({ kind: 'note', path: 'notes/Ideias.md', title: 'Ideias' }, change)).toBeNull()
  })

  it('nota movida para uma categoria: menções de outras notas acompanham', () => {
    const change = { type: 'note-renamed', from: 'notes/Ideias.md', to: 'notes/Trabalho/Ideias.md' } as const
    expect(renameMentionLinks('Ver [Ideias](Ideias.md)', 'notes', change, 'Ideias')).toBe('Ver [Ideias](Trabalho/Ideias.md)')
    expect(renameMentionLinks('Ver [Ideias](../Ideias.md)', 'notes/Estudos', change, 'Ideias')).toBe('Ver [Ideias](../Trabalho/Ideias.md)')
    // links para tarefas não são tocados
    expect(renameMentionLinks('[T](../tasks/tasks.json#t_1)', 'notes', change, 'Ideias')).toBeNull()
  })
})
