// Categorias compartilhadas (1.7.0): o arquivo central, os nomes e a conciliação com as
// listas dos módulos (que também é a passagem da 1.6).
import { describe, expect, it } from 'vitest'
import {
  emptyCategoriesData,
  markReplaced,
  normalizeCategoriesFile,
  reconcile,
  resolveReplaced,
  serializeCategoriesFile,
  sharedIdFor,
  sharedNameProblem,
  type CategoriesData,
  type ModuleMembers,
} from '~/lib/categories/model'

const NOW = '2026-10-22T12:00:00.000Z'

describe('categories.json', () => {
  it('lê de forma tolerante e volta igual', () => {
    const data = normalizeCategoriesFile(
      {
        categories: [
          { id: 'estudo', name: 'Estudo', color: 'blue', icon: 'book', image: 'attachments/foto.png', createdAt: NOW, updatedAt: NOW },
          { id: 'estudo', name: 'Outra', color: 'red' }, // id repetido
          { id: 'x', name: 'estudo', color: 'red' }, // nome repetido (sem diferenciar maiúsculas)
          { id: 'casa', name: 'Casa', color: 'cor-que-não-existe', icon: 'nada', image: '../fora.png' },
          { name: 'sem id' },
          'lixo',
        ],
        replaced: { velha: 'estudo', sumiu: null, estudo: 'casa' },
      },
      NOW,
    )
    expect(data.categories.map((category) => category.id)).toEqual(['estudo', 'casa'])
    expect(data.categories[1]).toMatchObject({ color: 'gray', icon: null, image: null })
    // Um id que existe não pode estar como trocado
    expect(data.replaced).toEqual({ velha: 'estudo', sumiu: null })
    expect(normalizeCategoriesFile(JSON.parse(serializeCategoriesFile(data)), NOW)).toEqual(data)
    expect(() => normalizeCategoriesFile([], NOW)).toThrow()
  })

  it('nomes: regras de pasta (viram pasta nas Notas) e únicos no app', () => {
    expect(sharedNameProblem('Estudo', ['Trabalho'])).toBeNull()
    expect(sharedNameProblem('estudo', ['Estudo'])).toMatch(/Já existe/)
    expect(sharedNameProblem('A/B', [])).toMatch(/caracteres/)
    expect(sharedNameProblem('  ', [])).toMatch(/Dê um nome/)
    expect(sharedNameProblem('CON', [])).toMatch(/reservado/)
    expect(sharedIdFor('Projetos Pessoais', () => false)).toBe('projetos-pessoais')
    expect(sharedIdFor('Café', (id) => id === 'cafe')).toBe('cafe-2')
  })

  it('juntar e excluir deixam o caminho para quem ainda aponta para a antiga', () => {
    const data: CategoriesData = {
      categories: [
        { id: 'b', name: 'B', color: 'blue', icon: null, image: null, createdAt: NOW, updatedAt: NOW },
        { id: 'c', name: 'C', color: 'red', icon: null, image: null, createdAt: NOW, updatedAt: NOW },
      ],
      replaced: {},
    }
    markReplaced(data, 'a', 'b') // A juntada a B
    markReplaced(data, 'b2', 'b')
    data.categories = data.categories.filter((category) => category.id !== 'b')
    markReplaced(data, 'b', 'c') // depois B juntada a C: A também vai para C
    expect(resolveReplaced(data, 'a')).toBe('c')
    expect(resolveReplaced(data, 'b2')).toBe('c')
    expect(resolveReplaced(data, 'b')).toBe('c')
    expect(resolveReplaced(data, 'nunca')).toBeUndefined()
    data.categories = []
    markReplaced(data, 'c', null) // C excluída: tudo fica sem categoria
    expect(resolveReplaced(data, 'a')).toBeNull()
  })
})

describe('conciliação (e a passagem da 1.6)', () => {
  const modules: ModuleMembers[] = [
    {
      module: 'timer',
      members: [
        { id: 'estudo', name: 'ESTUDO', color: 'green' },
        { id: 'trabalho', name: 'Trabalho', color: 'orange' },
      ],
    },
    {
      module: 'notes',
      members: [
        { id: null, name: 'Estudo', color: 'blue', icon: 'book', image: 'notes/Estudo/Estudo.png' },
        { id: null, name: 'Trabalho', color: 'red' },
      ],
    },
    {
      module: 'tasks',
      members: [
        { id: 'estudo', name: 'Estudo', color: 'purple' },
        { id: 'casa', name: 'Casa', color: 'green' },
      ],
    },
    {
      module: 'links',
      members: [
        { id: 'estudo-1', name: 'estudo', color: 'teal' },
        { id: 'dev', name: 'Dev', color: 'purple', icon: 'code' },
        // Mesmo id que uma categoria de outro módulo, mas outra categoria
        { id: 'casa', name: 'Cafés', color: 'yellow' },
      ],
    },
  ]

  it('mesmo nome em módulos diferentes vira uma categoria só (cor, ícone e foto do primeiro: Notas, Links, Tarefas, Timer)', () => {
    const result = reconcile(emptyCategoriesData(), modules, NOW)
    expect(result.changed).toBe(true)
    const byName = Object.fromEntries(result.data.categories.map((category) => [category.name, category]))
    expect(Object.keys(byName).sort()).toEqual(['Cafés', 'Casa', 'Dev', 'Estudo', 'Trabalho'])
    expect(byName.Estudo).toMatchObject({ id: 'estudo', color: 'blue', icon: 'book', image: 'notes/Estudo/Estudo.png' })
    expect(byName.Trabalho).toMatchObject({ id: 'trabalho', color: 'red' })
    expect(byName.Dev).toMatchObject({ id: 'dev', icon: 'code' })
    // Id "casa" nos Links (Cafés) e nas Tarefas (Casa): os Links vêm antes, então "Cafés"
    // fica com ele e "Casa" ganha outro id (as tarefas dela passam para o novo)
    expect(byName['Cafés']!.id).toBe('casa')
    expect(byName.Casa!.id).toBe('casa-2')
  })

  it('diz o que mudar em cada módulo (ids diferentes passam para o da categoria que ficou)', () => {
    const result = reconcile(emptyCategoriesData(), modules, NOW)
    const remaps = result.remaps.map((remap) => `${remap.module}:${remap.from.id ?? remap.from.name}>${remap.to}`).sort()
    expect(remaps).toEqual(['links:estudo-1>estudo', 'notes:Estudo>estudo', 'notes:Trabalho>trabalho', 'tasks:casa>casa-2'])
  })

  it('depois da passagem: nada muda (e o nome/cor da lista central vale, mesmo com a cópia do módulo diferente)', () => {
    const first = reconcile(emptyCategoriesData(), modules, NOW)
    const settled: ModuleMembers[] = [
      { module: 'notes', members: [{ id: 'estudo', name: 'Estudo', color: 'blue' }] },
      // Cópia antiga (renomeada em outro aparelho): o id vale
      { module: 'tasks', members: [{ id: 'estudo', name: 'Estudos (antigo)', color: 'red' }] },
    ]
    const again = reconcile(first.data, settled, NOW)
    expect(again.changed).toBe(false)
    expect(again.remaps).toEqual([])
  })

  it('categoria nova num arquivo de uma versão antiga entra na lista; uma juntada ou excluída não volta', () => {
    const base = reconcile(emptyCategoriesData(), modules, NOW).data
    markReplaced(base, 'casa-2', 'trabalho')
    base.categories = base.categories.filter((category) => category.id !== 'casa-2')
    markReplaced(base, 'dev', null)
    base.categories = base.categories.filter((category) => category.id !== 'dev')
    const result = reconcile(
      base,
      [
        {
          module: 'tasks',
          members: [
            { id: 'casa-2', name: 'Casa', color: 'green' }, // juntada a Trabalho
            { id: 'viagem', name: 'Viagem', color: 'teal' }, // criada no celular, na 1.6
          ],
        },
        { module: 'links', members: [{ id: 'dev', name: 'Dev', color: 'purple' }] }, // excluída
        { module: 'notes', members: [{ id: null, name: 'trabalho', color: 'red' }] }, // categorias.json de uma versão antiga (sem id)
      ],
      NOW,
    )
    expect(result.created).toEqual(['viagem'])
    const remaps = result.remaps.map((remap) => `${remap.module}:${remap.from.id ?? remap.from.name}>${remap.to}`).sort()
    expect(remaps).toEqual(['links:dev>null', 'notes:trabalho>trabalho', 'tasks:casa-2>trabalho'])
  })
})
