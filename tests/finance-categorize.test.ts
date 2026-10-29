import { describe, expect, it } from 'vitest'
import { categoryForTopic, createCategorizer, topicOf, type CategoryCandidate } from '../app/lib/finance/categorize'
import type { Expense } from '../app/lib/finance/model'

let seq = 0
function entry(description: string, categoryId: string | null, patch: Partial<Expense> = {}): Expense {
  return {
    id: `e${++seq}`,
    kind: 'expense',
    description,
    amount: 1000,
    date: '2026-10-01',
    categoryId,
    notes: '',
    status: 'done',
    doneOn: null,
    remind: false,
    recurrenceId: null,
    occurrence: null,
    importId: null,
    externalId: null,
    createdAt: '',
    updatedAt: '',
    ...patch,
  }
}

const cat = (id: string, name: string, member = true): CategoryCandidate => ({ id, name, member })

describe('assunto pelo texto (dicionário)', () => {
  it('reconhece estabelecimentos pelo nome, como aparecem no extrato', () => {
    expect(topicOf('IFOOD *IFD BR', 'expense')?.topic.id).toBe('delivery')
    expect(topicOf('PAG*Netflix.com', 'expense')?.topic.id).toBe('assinaturas')
    expect(topicOf('POSTO SHELL AV AMAZONAS', 'expense')?.topic.id).toBe('combustivel')
    expect(topicOf('Drogasil 123', 'expense')?.topic.id).toBe('farmacia')
  })

  it('o termo com mais palavras vence (uber eats × uber, mercado livre × mercado)', () => {
    expect(topicOf('UBER EATS', 'expense')?.topic.id).toBe('delivery')
    expect(topicOf('UBER *TRIP', 'expense')?.topic.id).toBe('transporte')
    expect(topicOf('MERCADOLIVRE*VENDEDOR', 'expense')?.topic.id).toBe('compras')
    expect(topicOf('Mercado Livre', 'expense')?.topic.id).toBe('compras')
    expect(topicOf('Amazon Prime Video', 'expense')?.topic.id).toBe('assinaturas')
    expect(topicOf('Amazon BR', 'expense')?.topic.id).toBe('compras')
  })

  it('só palavras inteiras: "raia" não acha "praia"; dia da semana não vira mercado', () => {
    expect(topicOf('Fim de semana na praia', 'expense')).toBeNull()
    expect(topicOf('Pix segunda-feira', 'expense')).toBeNull()
  })

  it('entradas só com assuntos de entrada', () => {
    expect(topicOf('SALARIO OUTUBRO', 'income')?.topic.id).toBe('salario')
    expect(topicOf('SALARIO OUTUBRO', 'expense')).toBeNull()
    expect(topicOf('Netflix', 'income')).toBeNull()
  })
})

describe('assunto → a sua categoria', () => {
  it('usa o nome que você deu (Alimentação, Comida, Food…), sem acento e sem plural', () => {
    expect(categoryForTopic('delivery', [cat('a', 'Food')])?.id).toBe('a')
    expect(categoryForTopic('delivery', [cat('a', 'Comida')])?.id).toBe('a')
    expect(categoryForTopic('delivery', [cat('a', 'alimentacao')])?.id).toBe('a')
    expect(categoryForTopic('restaurante', [cat('a', 'Restaurantes'), cat('b', 'Alimentação')])?.id).toBe('a')
  })

  it('sobe para um assunto mais geral quando você não tem a categoria específica', () => {
    expect(categoryForTopic('combustivel', [cat('t', 'Transporte')])?.id).toBe('t')
    expect(categoryForTopic('mercado', [cat('a', 'Alimentação')])?.id).toBe('a')
    expect(categoryForTopic('mercado', [cat('m', 'Mercado'), cat('a', 'Alimentação')])?.id).toBe('m')
  })

  it('as categorias das Finanças vêm antes das outras do app', () => {
    expect(categoryForTopic('delivery', [cat('x', 'Comida', false), cat('y', 'Alimentação')])?.id).toBe('y')
    expect(categoryForTopic('delivery', [cat('x', 'Comida', false)])?.id).toBe('x')
  })

  it('nome que só contém o assunto como palavra inteira', () => {
    expect(categoryForTopic('delivery', [cat('a', 'Comida e bebida')])?.id).toBe('a')
    expect(categoryForTopic('moradia', [cat('a', 'Casamento')])).toBeNull()
  })

  it('sem nenhuma categoria do assunto: nada (nunca cria)', () => {
    expect(categoryForTopic('pets', [cat('a', 'Mercado')])).toBeNull()
  })
})

describe('categorizador', () => {
  const candidates = [cat('food', 'Alimentação'), cat('car', 'Transporte'), cat('home', 'Casa'), cat('fun', 'Lazer'), cat('pix', 'Farmácia')]

  it('iFood vai para a sua categoria de alimentação', () => {
    const suggest = createCategorizer([], candidates)
    expect(suggest({ description: 'iFood', kind: 'expense' })).toEqual({ id: 'food', source: 'keyword', topic: 'delivery' })
  })

  it('o que você já fez vale mais que o dicionário', () => {
    const suggest = createCategorizer([entry('Uber trip', 'fun')], candidates)
    expect(suggest({ description: 'Uber trip', kind: 'expense' })?.id).toBe('fun')
  })

  it('termo de várias palavras vence a primeira palavra do histórico (uber eats × uber)', () => {
    const suggest = createCategorizer([entry('Uber trip', 'car')], candidates)
    expect(suggest({ description: 'Uber Eats', kind: 'expense' })?.id).toBe('food')
    expect(suggest({ description: 'Uber trip centro', kind: 'expense' })?.id).toBe('car')
  })

  it('nome da categoria no texto', () => {
    const suggest = createCategorizer([], candidates)
    expect(suggest({ description: 'farmácia do bairro', kind: 'expense' })).toEqual({ id: 'pix', source: 'name' })
  })

  it('pistas extras (estabelecimento, categoria do banco) ajudam', () => {
    const suggest = createCategorizer([], candidates)
    expect(suggest({ description: 'PAG*JOSE', kind: 'expense', hints: ['Food and drinks'] })?.id).toBe('food')
    expect(suggest({ description: 'COMPRA 1234', kind: 'expense', hints: ['Gas stations'] })?.id).toBe('car')
  })

  it('categoria padrão só quando nada combina, e só para gastos', () => {
    const suggest = createCategorizer([], candidates, { defaultCategory: 'home' })
    expect(suggest({ description: 'Coisa qualquer', kind: 'expense' })).toEqual({ id: 'home', source: 'default' })
    expect(suggest({ description: 'Coisa qualquer', kind: 'income' })).toBeNull()
    expect(suggest({ description: 'Netflix', kind: 'expense' })?.id).toBe('fun')
  })

  it('categoria padrão que não existe mais é ignorada', () => {
    const suggest = createCategorizer([], candidates, { defaultCategory: 'sumiu' })
    expect(suggest({ description: 'Coisa qualquer', kind: 'expense' })).toBeNull()
  })

  it('lançamentos cancelados e de categorias fora das Finanças não ensinam', () => {
    const suggest = createCategorizer([entry('Padaria Pão Bom', 'fun', { status: 'cancelled' }), entry('Padaria Pão Bom', 'outra')], candidates)
    expect(suggest({ description: 'Padaria Pão Bom', kind: 'expense' })?.id).toBe('food')
  })
})
