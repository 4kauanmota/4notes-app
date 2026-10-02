import { describe, expect, it } from 'vitest'
import { addDays, addMonths, diffDays, isISODate, relativeDayLabel } from '~/lib/dates'
import {
  describeRecurrence,
  nextDueAfterCompletion,
  nextOccurrenceAfter,
  upcomingOccurrences,
  type Recurrence,
} from '~/lib/tasks/recurrence'

const rule = (partial: Partial<Recurrence>): Recurrence => ({
  interval: 1,
  unit: 'day',
  anchor: '2026-10-05',
  basis: 'schedule',
  ...partial,
})

describe('datas', () => {
  it('soma dias atravessando meses e anos', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(diffDays('2026-10-01', '2026-10-05')).toBe(4)
  })

  it('soma meses usando o último dia quando o mês é mais curto', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15')
  })

  it('valida datas ISO', () => {
    expect(isISODate('2026-02-29')).toBe(false)
    expect(isISODate('2028-02-29')).toBe(true)
    expect(isISODate('05/10/2026')).toBe(false)
  })

  it('gera rótulos relativos em português', () => {
    expect(relativeDayLabel('2026-10-01', '2026-10-01')).toBe('Hoje')
    expect(relativeDayLabel('2026-10-02', '2026-10-01')).toBe('Amanhã')
    expect(relativeDayLabel('2026-09-30', '2026-10-01')).toBe('Ontem')
    expect(relativeDayLabel('2026-10-03', '2026-10-01')).toBe('Sábado')
    expect(relativeDayLabel('2026-10-20', '2026-10-01')).toBe('20 out')
    expect(relativeDayLabel('2027-01-20', '2026-10-01')).toBe('20 jan 2027')
  })
})

describe('recorrência', () => {
  it('exemplo do Kauan: a cada 7 dias a partir de 05/10/2026', () => {
    const r = rule({ interval: 7 })
    // Concluída no dia → volta em 12/10
    expect(nextDueAfterCompletion(r, '2026-10-05', '2026-10-05')).toBe('2026-10-12')
    expect(upcomingOccurrences(r, '2026-10-05', 3)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19'])
  })

  it('pula ocorrências perdidas quando o app ficou fechado', () => {
    const r = rule({ interval: 7, anchor: '2026-10-01' })
    // A tarefa era para 01/10, só foi concluída em 10/10 → próxima é 15/10 (não 08/10)
    expect(nextDueAfterCompletion(r, '2026-10-01', '2026-10-10')).toBe('2026-10-15')
  })

  it('concluir adiantado mantém o calendário', () => {
    const r = rule({ unit: 'week', anchor: '2026-10-05' })
    expect(nextDueAfterCompletion(r, '2026-10-05', '2026-10-03')).toBe('2026-10-12')
  })

  it('modo "após concluir" conta a partir do dia da conclusão', () => {
    const r = rule({ interval: 3, basis: 'completion', anchor: '2026-10-01' })
    expect(nextDueAfterCompletion(r, '2026-10-01', '2026-10-04')).toBe('2026-10-07')
  })

  it('mensal no dia 31 não "escorrega" para o dia 28', () => {
    const r = rule({ unit: 'month', anchor: '2026-01-31' })
    expect(nextOccurrenceAfter(r, '2026-01-31')).toBe('2026-02-28')
    expect(nextOccurrenceAfter(r, '2026-02-28')).toBe('2026-03-31')
    expect(nextOccurrenceAfter(r, '2026-03-31')).toBe('2026-04-30')
  })

  it('anual em 29/02 cai em 28/02 nos anos comuns', () => {
    const r = rule({ unit: 'year', anchor: '2028-02-29' })
    expect(nextOccurrenceAfter(r, '2028-02-29')).toBe('2029-02-28')
    expect(nextOccurrenceAfter(r, '2031-03-01')).toBe('2032-02-29')
  })

  it('a cada 2 semanas', () => {
    const r = rule({ interval: 2, unit: 'week', anchor: '2026-10-05' })
    expect(nextOccurrenceAfter(r, '2026-10-05')).toBe('2026-10-19')
    expect(nextOccurrenceAfter(r, '2026-10-18')).toBe('2026-10-19')
    expect(nextOccurrenceAfter(r, '2026-10-19')).toBe('2026-11-02')
  })

  it('descreve a regra em português', () => {
    expect(describeRecurrence(rule({}))).toBe('Todos os dias')
    expect(describeRecurrence(rule({ interval: 2, unit: 'week' }))).toBe('A cada 2 semanas')
    expect(describeRecurrence(rule({ unit: 'month' }))).toBe('Todo mês')
    expect(describeRecurrence(rule({ interval: 7, basis: 'completion' }))).toBe('A cada 7 dias após concluir')
  })
})
