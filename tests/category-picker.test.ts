import { describe, expect, it } from 'vitest'
import { categoryMatchScore, foldCategoryName, hasExactName, rankCategories } from '../app/lib/categories/search'
import { filterExpenses, type Expense } from '../app/lib/finance/model'
import { matchesCategory } from '../app/lib/timer/stats'
import type { TimerSession } from '../app/lib/timer/model'

const list = (...names: string[]) => names.map((name, index) => ({ id: `c${index}`, name }))

describe('busca do seletor de categorias', () => {
  it('sem acentos nem maiúsculas', () => {
    expect(foldCategoryName('  Alimentação  ')).toBe('alimentacao')
    expect(rankCategories(list('Alimentação', 'Lazer'), 'ALIMENTACAO').map((item) => item.name)).toEqual(['Alimentação'])
  })

  it('cada palavra precisa aparecer', () => {
    expect(rankCategories(list('Casa de vidro', 'Casa', 'Vidraçaria'), 'cas vi').map((item) => item.name)).toEqual(['Casa de vidro'])
  })

  it('ordem: igual, começa com, palavra começa com, contém; empate na ordem do módulo', () => {
    const names = ['Supermercado', 'Mercado Livre', 'Estudo', 'Mercado', 'Compras no mercado']
    expect(rankCategories(list(...names), 'mercado').map((item) => item.name)).toEqual(['Mercado', 'Mercado Livre', 'Compras no mercado', 'Supermercado'])
  })

  it('sem texto: a lista inteira na ordem original', () => {
    expect(rankCategories(list('B', 'A', 'C'), '  ').map((item) => item.name)).toEqual(['B', 'A', 'C'])
    expect(categoryMatchScore('Qualquer', '')).toBe(3)
  })

  it('nome exato já existe (para não oferecer "Criar")', () => {
    expect(hasExactName(list('Saúde'), 'saude')).toBe(true)
    expect(hasExactName(list('Saúde'), 'saud')).toBe(false)
    expect(hasExactName(list('Saúde'), '')).toBe(false)
  })

  it('centenas de categorias: rápido', () => {
    const many = Array.from({ length: 1000 }, (_, index) => ({ id: `c${index}`, name: `Projeto ${index} Área ${index % 7}` }))
    const start = performance.now()
    for (let i = 0; i < 50; i++) rankCategories(many, 'proj 12')
    expect(performance.now() - start).toBeLessThan(1000)
    expect(rankCategories(many, 'projeto 120')[0]?.name).toBe('Projeto 120 Área 1')
  })
})

describe('filtros com várias categorias', () => {
  const expense = (id: string, categoryId: string | null): Expense =>
    ({ id, kind: 'expense', description: id, amount: 100, date: '2026-10-01', categoryId, notes: '', status: 'done' }) as Expense
  const expenses = [expense('a', 'mercado'), expense('b', 'lazer'), expense('c', null), expense('d', 'sumiu')]
  const known = new Set(['mercado', 'lazer'])

  it('lista vazia = todas; várias = qualquer uma delas; null = sem categoria (e as que sumiram)', () => {
    const ids = (category: readonly (string | null)[]) => filterExpenses(expenses, { category, knownCategories: known }).map((item) => item.id)
    expect(ids([])).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(['mercado', 'lazer'])).toEqual(['a', 'b'])
    expect(ids(['mercado', null])).toEqual(['a', 'c', 'd'])
  })

  it('o formato antigo (uma categoria) continua valendo', () => {
    expect(filterExpenses(expenses, { category: 'lazer', knownCategories: known }).map((item) => item.id)).toEqual(['b'])
    expect(filterExpenses(expenses, { category: null, knownCategories: known }).map((item) => item.id)).toEqual(['c', 'd'])
  })

  it('Timer: a mesma regra', () => {
    const session = (categoryId: string | null) => ({ categoryId }) as TimerSession
    expect(matchesCategory(session('estudo'), ['estudo', 'trabalho'])).toBe(true)
    expect(matchesCategory(session('lazer'), ['estudo', 'trabalho'])).toBe(false)
    expect(matchesCategory(session(null), [null])).toBe(true)
    expect(matchesCategory(session('lazer'), [])).toBe(true)
  })
})
