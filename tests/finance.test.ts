// Finanças (1.7.0): dinheiro em centavos, o finance.json, o histórico (filtros, ordem) e
// os números do painel, sempre a partir dos gastos registrados.
import { describe, expect, it } from 'vitest'
import { formatMoney, formatShortMoney, formatSignedMoney, parseAmount } from '~/lib/finance/format'
import { filterExpenses, groupByDay, normalizeFinanceFile, recentDescriptions, serializeFinance, sortExpenses, totalOf, type Expense } from '~/lib/finance/model'
import { byCategory, compareSpending, defaultStep, evolution, evolutionSteps, summarize, topDays, topExpenses } from '~/lib/finance/stats'
import { normalizeRefs } from '~/lib/mentions/refs'
import { idMentionPath, idOf, mentionKind, mentionMarkdown, mentionTarget, retitleIdLinks } from '~/lib/notes/mention-links'
import { customPeriod, periodOf } from '~/lib/timer/stats'

const NOW = '2026-10-22T12:00:00.000Z'
let seq = 0
function expense(date: string, amount: number, categoryId: string | null = null, description = `Gasto ${++seq}`): Expense {
  return { id: `e_${++seq}`, description, amount, date, categoryId, notes: '', createdAt: `${date}T10:00:${String(seq % 60).padStart(2, '0')}.000Z`, updatedAt: NOW }
}

describe('valores em reais', () => {
  it('mostra no formato brasileiro', () => {
    expect(formatMoney(123456)).toBe('R$ 1.234,56')
    expect(formatMoney(5)).toBe('R$ 0,05')
    expect(formatSignedMoney(1200)).toBe('+R$ 12,00')
    expect(formatSignedMoney(-350)).toBe('−R$ 3,50')
    expect(formatSignedMoney(0)).toBe('R$ 0,00')
    expect([5000, 150000, 250000000, 990].map(formatShortMoney)).toEqual(['50', '1,5 mil', '2,5 mi', '9,9'])
  })

  it('entende o que é digitado no campo de valor (vírgula ou ponto)', () => {
    const cases: [string, number | null][] = [
      ['52', 5200],
      ['52,3', 5230],
      ['52,30', 5230],
      ['R$ 1.234,56', 123456],
      ['1234.56', 123456],
      ['1.234', 123400],
      ['1.234.567', 123456700],
      ['12.5', 1250],
      ['0,99', 99],
      [',5', 50],
      ['1,234,56', 123456], // separador de milhar trocado: só a última vírgula vale como decimal
      ['12,345', null],
      ['0', null],
      ['-5', null],
      ['abc', null],
      ['', null],
      ['999999999999', null],
    ]
    for (const [input, cents] of cases) expect(parseAmount(input), input).toBe(cents)
  })
})

describe('finance.json', () => {
  it('lê de forma tolerante e volta igual', () => {
    const data = normalizeFinanceFile(
      {
        categories: [{ id: 'mercado', name: 'Mercado', color: 'green', createdAt: NOW }, { id: 'mercado', name: 'Repetida' }, { name: 'sem id' }],
        expenses: [
          { id: 'e1', description: ' Feira ', amount: 5230, date: '2026-10-21', categoryId: 'mercado', notes: 'barraca do Zé', createdAt: NOW, updatedAt: NOW },
          { id: 'e1', description: 'Repetido', amount: 1, date: '2026-10-21' },
          { id: 'e2', description: 'Valor em texto', amount: '990', date: '2026-10-20' },
          { id: 'e3', amount: 0, date: '2026-10-20' },
          { id: 'e4', amount: 100, date: '21/10/2026' },
          { id: 'e5', amount: -100, date: '2026-10-20' },
        ],
      },
      NOW,
    )
    expect(data.categories.map((category) => category.id)).toEqual(['mercado'])
    expect(data.expenses.map((item) => `${item.id}:${item.amount}`)).toEqual(['e1:5230', 'e2:990'])
    expect(data.expenses[0]).toMatchObject({ description: 'Feira', categoryId: 'mercado', notes: 'barraca do Zé' })
    const raw = JSON.parse(serializeFinance(data))
    expect(raw).toMatchObject({ app: '4notes', version: 1, currency: 'BRL' })
    expect(normalizeFinanceFile(raw, NOW)).toEqual(data)
    expect(() => normalizeFinanceFile([], NOW)).toThrow()
  })
})

describe('histórico', () => {
  const list = [
    expense('2026-10-21', 5230, 'mercado', 'Feira da semana'),
    expense('2026-10-21', 1200, 'transporte', 'Ônibus'),
    expense('2026-10-02', 890, null, 'Café com pão'),
    expense('2026-09-30', 15000, 'velha', 'Presente'), // categoria que não existe mais
  ]
  const known = new Set(['mercado', 'transporte'])

  it('filtra por período, categoria (incluindo "sem categoria") e busca sem acentos', () => {
    const ids = (items: Expense[]) => items.map((item) => item.description)
    expect(ids(filterExpenses(list, { from: '2026-10-01', to: '2026-10-31' }))).toEqual(['Feira da semana', 'Ônibus', 'Café com pão'])
    expect(ids(filterExpenses(list, { category: 'mercado', knownCategories: known }))).toEqual(['Feira da semana'])
    expect(ids(filterExpenses(list, { category: null, knownCategories: known }))).toEqual(['Café com pão', 'Presente'])
    expect(ids(filterExpenses(list, { search: 'onibus' }))).toEqual(['Ônibus'])
    expect(ids(filterExpenses(list, { search: 'CAFE pão' }))).toEqual(['Café com pão'])
  })

  it('ordena por data e por valor, agrupa por dia e soma', () => {
    expect(sortExpenses(list, 'amount-desc').map((item) => item.amount)).toEqual([15000, 5230, 1200, 890])
    expect(sortExpenses(list, 'amount-asc').map((item) => item.amount)).toEqual([890, 1200, 5230, 15000])
    expect(sortExpenses(list, 'date-asc').map((item) => item.date)).toEqual(['2026-09-30', '2026-10-02', '2026-10-21', '2026-10-21'])
    const groups = groupByDay(sortExpenses(list, 'date-desc'))
    expect(groups.map((group) => `${group.date}:${group.total}`)).toEqual(['2026-10-21:6430', '2026-10-02:890', '2026-09-30:15000'])
    expect(totalOf(list)).toBe(22320)
    expect(recentDescriptions([...list, expense('2026-10-22', 100, null, 'feira da semana')]).map((item) => item.description)).toEqual([
      'feira da semana',
      'Ônibus',
      'Café com pão',
      'Presente',
    ])
  })
})

describe('painel', () => {
  const october = periodOf('month', '2026-10-15')
  const list = [
    expense('2026-10-01', 1000, 'mercado'),
    expense('2026-10-01', 500, 'transporte'),
    expense('2026-10-10', 4000, 'mercado'),
    expense('2026-10-22', 2500, null),
    expense('2026-09-05', 3000, 'mercado'),
    expense('2026-09-25', 9000, 'transporte'), // depois do dia 22: fica fora da comparação parcial
  ]
  const inOctober = list.filter((item) => item.date >= october.from && item.date <= october.to)

  it('resumo: total, quantidade, média por gasto e por dia (até hoje)', () => {
    expect(summarize(inOctober, october, '2026-10-22')).toEqual({ total: 8000, count: 4, average: 2000, perDay: Math.round(8000 / 22), days: 22 })
    expect(summarize([], october, '2026-10-22')).toMatchObject({ total: 0, count: 0, average: null, perDay: null })
  })

  it('por categoria, dias com mais gastos e maiores gastos', () => {
    expect(byCategory(inOctober, new Set(['mercado']))).toEqual([
      { categoryId: 'mercado', total: 5000, count: 2 },
      { categoryId: null, total: 3000, count: 2 }, // "transporte" não existe mais: sem categoria
    ])
    expect(topDays(inOctober).map((day) => `${day.date}:${day.total}`)).toEqual(['2026-10-10:4000', '2026-10-22:2500', '2026-10-01:1500'])
    expect(topExpenses(list, 2).map((item) => item.amount)).toEqual([9000, 4000])
  })

  it('evolução por dia, semana e mês: as colunas somam o total do período', () => {
    expect(evolutionSteps(october)).toEqual(['day', 'week'])
    expect(defaultStep(october)).toBe('day')
    expect(defaultStep(periodOf('year', '2026-10-15'))).toBe('month')
    expect(evolutionSteps(periodOf('day', '2026-10-15'))).toEqual([])
    const days = evolution(list, october, 'day', '2026-10-22')
    expect(days.length).toBe(31)
    expect(days[0]).toMatchObject({ key: '2026-10-01', ms: 1500 })
    expect(days.find((point) => point.current)!.key).toBe('2026-10-22')
    expect(days.filter((point) => point.future).length).toBe(9)
    const weeks = evolution(list, october, 'week', '2026-10-22')
    expect(weeks[0]).toMatchObject({ key: '2026-10-01', label: '1/10' }) // semana cortada no começo do mês
    expect(weeks.reduce((sum, point) => sum + point.ms, 0)).toBe(8000)
    const months = evolution(list, customPeriod('2026-09-15', '2026-10-31'), 'month', '2026-10-22')
    expect(months.map((point) => `${point.key}:${point.ms}`)).toEqual(['2026-09:9000', '2026-10:8000'])
  })

  it('comparação: mês terminado × anterior inteiro', () => {
    const now = new Date(2026, 10, 3, 9).getTime() // 3 de novembro
    const result = compareSpending(list, october, now)
    expect(result).toMatchObject({ current: 8000, previous: 12000, diff: -4000, partial: false, previousUntil: '2026-09-30' })
    expect(result.pct).toBeCloseTo(-1 / 3)
    expect(result.categories.find((item) => item.categoryId === 'transporte')).toMatchObject({ current: 500, previous: 9000, diff: -8500 })
  })

  it('comparação: mês em andamento × o mesmo trecho do anterior (hoje entra inteiro)', () => {
    const now = new Date(2026, 9, 22, 8).getTime() // 22 de outubro, 8h (o gasto de hoje é contado)
    const result = compareSpending(list, october, now)
    expect(result).toMatchObject({ current: 8000, previous: 3000, partial: true, currentUntil: '2026-10-22', previousUntil: '2026-09-22' })
    expect(result.pct).toBeCloseTo(5 / 3)
  })

  it('sem gastos no período anterior: sem porcentagem (nada de "+∞%")', () => {
    const result = compareSpending([expense('2026-10-05', 1000)], october, new Date(2026, 10, 3).getTime())
    expect(result).toMatchObject({ current: 1000, previous: 0, diff: 1000, pct: null })
    expect(compareSpending([], october, new Date(2026, 10, 3).getTime())).toMatchObject({ current: 0, previous: 0, pct: null })
  })
})

describe('menções a gastos', () => {
  it('pelo id, no finance.json (o gasto não é copiado para a nota)', () => {
    const path = idMentionPath('expense', 'e_k3')
    expect(path).toBe('finance/finance.json#e_k3')
    expect(idOf(path)).toEqual({ kind: 'expense', id: 'e_k3' })
    expect(mentionKind(path)).toBe('expense')
    const markdown = mentionMarkdown('notes/Casa', path, 'Feira')
    expect(markdown).toBe('[Feira](../../finance/finance.json#e_k3)')
    // A nota reconhece o link como menção (chip, abrir, "Ver menções", PDF)
    expect(mentionTarget('notes/Casa', '../../finance/finance.json#e_k3')).toBe(path)
    expect(mentionTarget('notes', '../finance/finance.json')).toBeNull()
    expect(retitleIdLinks(`Hoje: ${markdown}`, 'notes/Casa', new Map([[path, 'Feira grande']]))).toBe('Hoje: [Feira grande](../../finance/finance.json#e_k3)')
  })

  it('nas tarefas, a menção fica nas referências da tarefa', () => {
    expect(normalizeRefs([{ kind: 'expense', id: 'e_1', title: 'Feira' }, { kind: 'expense', title: 'sem id' }])).toEqual([{ kind: 'expense', id: 'e_1', title: 'Feira' }])
  })
})
