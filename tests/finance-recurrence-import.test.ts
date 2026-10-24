// 1.7.1 nas Finanças, regras puras: recorrências (meses curtos, bissextos, versões),
// contas e saldo (realizado × projetado), lembretes e a leitura de extratos (CSV e OFX).
import { describe, expect, it } from 'vitest'
import { balanceSummary, cashFlow, dueReminders, forecast, upcoming } from '~/lib/finance/bills'
import { cashDate, entryState, normalizeFinanceFile, paidExpenses, serializeFinance, type Expense } from '~/lib/finance/model'
import {
  describeSchedule,
  occurrenceBefore,
  occurrenceFrom,
  occurrenceId,
  occurrencesBetween,
  pendingGeneration,
  stepFrom,
  withFutureChange,
  type Recurrence,
} from '~/lib/finance/recurrence'
import {
  categorySuggester,
  decodeStatement,
  detectCsvMapping,
  detectFormat,
  duplicateFinder,
  guessSign,
  kindOf,
  parseCsv,
  parseOfx,
  parseSignedAmount,
  parseStatementDate,
} from '~/lib/finance/statement'

const NOW = '2026-10-23T12:00:00.000Z'

function recurrence(patch: Partial<Recurrence> & { anchor: string; frequency?: Recurrence['versions'][0]['frequency']; amount?: number }): Recurrence {
  const { anchor, frequency = 'monthly', amount = 10000, ...rest } = patch
  return {
    id: 'r_test',
    kind: 'expense',
    description: 'Aluguel',
    categoryId: null,
    notes: '',
    remind: false,
    versions: [{ from: anchor, amount, frequency, anchor }],
    endDate: null,
    stoppedAt: null,
    generatedUntil: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...rest,
  }
}

function entry(patch: Partial<Expense>): Expense {
  return {
    id: patch.id ?? Math.random().toString(36).slice(2),
    kind: 'expense',
    description: 'Gasto',
    amount: 1000,
    date: '2026-10-10',
    categoryId: null,
    notes: '',
    status: 'done',
    doneOn: null,
    remind: false,
    recurrenceId: null,
    occurrence: null,
    importId: null,
    externalId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  }
}

const dates = (list: { occurrence: string }[]) => list.map((item) => item.occurrence)

describe('recorrências: datas', () => {
  it('todo dia 31: cai no último dia dos meses curtos e volta para 31 (sem "escorregar")', () => {
    const rent = recurrence({ anchor: '2026-01-31' })
    expect(dates(occurrencesBetween(rent, '2026-01-01', '2026-05-31'))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
    // 2028 é bissexto
    expect(dates(occurrencesBetween(rent, '2028-02-01', '2028-03-31'))).toEqual(['2028-02-29', '2028-03-31'])
  })

  it('29/02 anual: 28/02 nos anos comuns, 29/02 nos bissextos', () => {
    const yearly = recurrence({ anchor: '2024-02-29', frequency: 'yearly' })
    expect(dates(occurrencesBetween(yearly, '2024-01-01', '2028-12-31'))).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  })

  it('diária e semanal; data final inclusive; nada antes da primeira', () => {
    const weekly = recurrence({ anchor: '2026-10-07', frequency: 'weekly', endDate: '2026-10-28' })
    expect(dates(occurrencesBetween(weekly, '2026-09-01', '2026-12-31'))).toEqual(['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28'])
    const daily = recurrence({ anchor: '2026-10-21', frequency: 'daily' })
    expect(dates(occurrencesBetween(daily, '2026-10-20', '2026-10-23'))).toEqual(['2026-10-21', '2026-10-22', '2026-10-23'])
    expect(stepFrom('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(occurrenceFrom(weekly, '2026-10-15')?.occurrence).toBe('2026-10-21')
    expect(occurrenceFrom(weekly, '2026-10-29')).toBeNull()
    expect(occurrenceBefore(weekly, '2026-10-21')?.occurrence).toBe('2026-10-14')
    expect(occurrenceBefore(weekly, '2026-10-07')).toBeNull()
  })

  it('gerar as ocorrências até hoje: nunca duas vezes (mesmo id), nem depois do fim', () => {
    const rent = recurrence({ anchor: '2026-08-05' })
    const first = pendingGeneration(rent, '2026-10-23', new Set())
    expect(dates(first.due)).toEqual(['2026-08-05', '2026-09-05', '2026-10-05'])
    expect(first.until).toBe('2026-10-23')
    // De novo (o app abriu outra vez): nada novo
    expect(pendingGeneration({ ...rent, generatedUntil: first.until }, '2026-10-23', new Set()).due).toEqual([])
    // Outro aparelho já criou a de outubro (sem ter marcado até onde gerou): ela não se repete
    const again = pendingGeneration(rent, '2026-10-23', new Set(['r_test|2026-10-05']))
    expect(dates(again.due)).toEqual(['2026-08-05', '2026-09-05'])
    expect(occurrenceId('r_test', '2026-10-05')).toBe('r_test_20261005')
    // Com fim: não passa dele
    expect(dates(pendingGeneration({ ...rent, endDate: '2026-09-30' }, '2026-10-23', new Set()).due)).toEqual(['2026-08-05', '2026-09-05'])
  })

  it('mudar "a partir da próxima": nova versão; o histórico e a âncora (dia 31) ficam', () => {
    const rent = recurrence({ anchor: '2026-01-31', amount: 100000 })
    const versions = withFutureChange(rent, '2026-11-30', { amount: 120000 })
    const changed = { ...rent, versions }
    expect(occurrencesBetween(changed, '2026-09-01', '2027-01-31').map((item) => `${item.occurrence}:${item.amount}`)).toEqual([
      '2026-09-30:100000',
      '2026-10-31:100000',
      '2026-11-30:120000',
      '2026-12-31:120000',
      '2027-01-31:120000',
    ])
    // Mudar a frequência (e a data) a partir da próxima
    const weekly = { ...rent, versions: withFutureChange(rent, '2026-11-30', { frequency: 'weekly', date: '2026-11-02' }) }
    expect(dates(occurrencesBetween(weekly, '2026-10-01', '2026-11-16'))).toEqual(['2026-10-31', '2026-11-02', '2026-11-09', '2026-11-16'])
    expect(describeSchedule(rent.versions[0]!)).toBe('Todo mês, dia 31 (ou o último dia)')
  })
})

describe('finance.json 1.7.1', () => {
  it('entradas, contas, recorrências, importações e saldo inicial voltam iguais; um gasto comum fica como na 1.7.0', () => {
    const data = normalizeFinanceFile(
      {
        openingBalance: { amount: -2550, date: '2026-10-01' },
        expenses: [
          { id: 'e1', description: 'Feira', amount: 5230, date: '2026-10-21', categoryId: null, notes: '', createdAt: NOW, updatedAt: NOW },
          { id: 'r1_20261105', description: 'Aluguel', amount: 180000, date: '2026-11-05', status: 'pending', remind: true, recurrenceId: 'r1', occurrence: '2026-11-05' },
          { id: 'x', description: 'Estado estranho', amount: 100, date: '2026-10-01', status: 'talvez', doneOn: 'ontem' },
        ],
        incomes: [{ id: 'i1', description: 'Salário', amount: 500000, date: '2026-10-05', status: 'done', doneOn: '2026-10-06' }],
        recurrences: [
          { id: 'r1', kind: 'expense', description: 'Aluguel', versions: [{ amount: 180000, frequency: 'monthly', anchor: '2026-01-05' }], generatedUntil: '2026-10-23' },
          { id: 'r2', versions: [] },
        ],
        imports: [{ id: 'x1', file: 'extrato.ofx', format: 'ofx', importedAt: NOW, count: 3 }],
      },
      NOW,
    )
    expect(data.expenses.map((item) => `${item.kind}:${item.id}:${item.status}`)).toEqual(['expense:e1:done', 'expense:r1_20261105:pending', 'expense:x:done', 'income:i1:done'])
    expect(data.expenses[2]!.doneOn).toBeNull()
    expect(data.recurrences.map((item) => item.id)).toEqual(['r1'])
    expect(data.recurrences[0]!.versions[0]!.from).toBe('2026-01-05')
    const raw = JSON.parse(serializeFinance(data))
    expect(raw.version).toBe(2)
    expect(Object.keys(raw.expenses[0])).toEqual(['id', 'description', 'amount', 'date', 'categoryId', 'notes', 'createdAt', 'updatedAt'])
    expect(raw.incomes[0]).toMatchObject({ id: 'i1', doneOn: '2026-10-06' })
    expect(normalizeFinanceFile(raw, NOW)).toEqual(data)
  })

  it('situação: pendente, vencido, pago (no dia da confirmação) e pulado', () => {
    const today = '2026-10-23'
    expect(entryState(entry({ status: 'pending', date: '2026-10-23' }), today)).toBe('pending')
    expect(entryState(entry({ status: 'pending', date: '2026-10-22' }), today)).toBe('overdue')
    expect(entryState(entry({ status: 'cancelled' }), today)).toBe('cancelled')
    const paid = entry({ status: 'done', date: '2026-10-20', doneOn: '2026-10-22' })
    expect(cashDate(paid)).toBe('2026-10-22')
    expect(paidExpenses([paid, entry({ status: 'pending' }), entry({ kind: 'income' })]).map((item) => item.date)).toEqual(['2026-10-22'])
  })
})

describe('contas e saldo', () => {
  const today = '2026-10-23'
  const rent = recurrence({ id: 'r1', anchor: '2026-08-05', amount: 180000, generatedUntil: today })
  const salary = recurrence({ id: 'r2', kind: 'income', description: 'Salário', anchor: '2026-08-05', amount: 500000, generatedUntil: today })
  const entries = [
    entry({ kind: 'income', amount: 500000, date: '2026-10-05', recurrenceId: 'r2', occurrence: '2026-10-05', doneOn: '2026-10-06' }),
    entry({ amount: 180000, date: '2026-10-05', recurrenceId: 'r1', occurrence: '2026-10-05', status: 'pending', remind: true }),
    entry({ amount: 5000, date: '2026-10-21' }),
    entry({ amount: 9900, date: '2026-10-25', status: 'pending' }),
    entry({ amount: 7777, date: '2026-09-30' }),
    entry({ amount: 1, date: '2026-10-22', status: 'cancelled' }),
  ]

  it('realizado não desconta pendentes; projetado inclui vencidos, pendentes e as próximas ocorrências', () => {
    const summary = balanceSummary(entries, [rent, salary], { amount: 100000, date: '2026-09-30' }, today, '2026-11-30')
    // 1.000 + 5.000 (salário) − 50 (feira); o gasto de 30/09 é antes do saldo inicial
    expect(summary.realized).toBe(100000 + 500000 - 5000)
    expect(summary.overdue).toBe(180000)
    expect(summary.overdueCount).toBe(1)
    // A conta de 25/10 + o aluguel previsto de 05/11
    expect(summary.pending).toBe(9900 + 180000)
    expect(summary.committed).toBe(180000 + 9900 + 180000)
    expect(summary.expected).toBe(500000)
    expect(summary.projected).toBe(summary.realized - summary.committed + 500000)
    expect(summary.estimated).toBe(false)
    // Sem saldo inicial: só uma estimativa com tudo o que foi registrado
    const estimate = balanceSummary(entries, [rent, salary], null, today, '2026-10-31')
    expect(estimate.estimated).toBe(true)
    expect(estimate.realized).toBe(500000 - 5000 - 7777)
  })

  it('próximas: as pendentes já lançadas e as previstas (sem repetir as que já existem)', () => {
    const list = upcoming(entries, [rent, salary], '2026-12-10')
    expect(list.map((item) => `${item.date}:${item.kind}:${item.stored ? 'lançada' : 'prevista'}`)).toEqual([
      '2026-10-05:expense:lançada',
      '2026-10-25:expense:lançada',
      '2026-11-05:income:prevista',
      '2026-11-05:expense:prevista',
      '2026-12-05:income:prevista',
      '2026-12-05:expense:prevista',
    ])
    expect(forecast([rent], entries, '2026-10-01', '2026-10-31')).toEqual([])
  })

  it('no período: entradas recebidas e gastos pagos no dia em que o dinheiro mexeu', () => {
    expect(cashFlow(entries, '2026-10-01', '2026-10-31')).toEqual({ received: 500000, paid: 5000, receivedCount: 1, paidCount: 1 })
  })

  it('lembretes: só gastos pendentes com "Me lembre de pagar" que vencem hoje ou já venceram', () => {
    expect(dueReminders(entries, today).map((item) => item.amount)).toEqual([180000])
  })
})

describe('extrato: valores e datas', () => {
  it('valores com sinal, R$, parênteses, D/C e os dois separadores', () => {
    expect(parseSignedAmount('-1.234,56', ',')).toBe(-123456)
    expect(parseSignedAmount('R$ 52,30', ',')).toBe(5230)
    expect(parseSignedAmount('(12,00)', ',')).toBe(-1200)
    expect(parseSignedAmount('12,00-', ',')).toBe(-1200)
    expect(parseSignedAmount('12,50 D', ',')).toBe(-1250)
    expect(parseSignedAmount('12,50 C', ',')).toBe(1250)
    expect(parseSignedAmount('-1,234.56', '.')).toBe(-123456)
    expect(parseSignedAmount('-50.00', '.')).toBe(-5000)
    expect(parseSignedAmount('−7,5', ',')).toBe(-750)
    expect(parseSignedAmount('12.345', '.')).toBeNull()
    expect(parseSignedAmount('abc', ',')).toBeNull()
  })

  it('datas: dd/mm/aaaa, aa, ISO, OFX; mês/dia só quando escolhido', () => {
    expect(parseStatementDate('21/10/2026', 'dmy')).toBe('2026-10-21')
    expect(parseStatementDate('21-10-26', 'dmy')).toBe('2026-10-21')
    expect(parseStatementDate('2026-10-21T13:00:00', 'dmy')).toBe('2026-10-21')
    expect(parseStatementDate('20261021120000[-3:BRT]', 'ymd')).toBe('2026-10-21')
    expect(parseStatementDate('10/21/2026', 'mdy')).toBe('2026-10-21')
    expect(parseStatementDate('31/02/2026', 'dmy')).toBeNull()
  })
})

describe('extrato: OFX', () => {
  const ofx = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261021000000[-3:BRT]
<TRNAMT>-52.30
<FITID>2026102101
<MEMO>COMPRA CARTAO - PADARIA PÃO &amp; CIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261005
<TRNAMT>5000.00
<FITID>2026100501
<NAME>SALARIO
<MEMO>EMPRESA X LTDA
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

  it('lê data, valor com sinal, descrição e o id do banco', () => {
    expect(detectFormat(ofx)).toBe('ofx')
    const { rows, creditCard } = parseOfx(ofx)
    expect(creditCard).toBe(false)
    expect(rows).toEqual([
      { line: 1, date: '2026-10-21', description: 'COMPRA CARTAO - PADARIA PÃO & CIA', amount: -5230, externalId: '2026102101' },
      { line: 2, date: '2026-10-05', description: 'SALARIO · EMPRESA X LTDA', amount: 500000, externalId: '2026100501' },
    ])
    expect(rows.map((row) => kindOf(row.amount!, guessSign(rows)))).toEqual(['expense', 'income'])
  })

  it('arquivo em Windows-1252 (acentos)', () => {
    const bytes = new Uint8Array([0x50, 0xe3, 0x6f]) // "Pão" em 1252
    expect(decodeStatement(bytes)).toBe('Pão')
    expect(decodeStatement(new TextEncoder().encode('﻿Pão'))).toBe('Pão')
  })
})

describe('extrato: CSV', () => {
  it('banco brasileiro: linhas antes do cabeçalho, ";", vírgula nos centavos, saldo de fora', () => {
    const csv = `Extrato Conta Corrente
Agência: 1234 Conta: 5678-9

Data;Lançamento;Valor (R$);Saldo (R$)
21/10/2026;PIX ENVIADO Fulano;-150,00;1.350,00
22/10/2026;"COMPRA CARTAO; MERCADO BOM";-1.234,56;115,44
23/10/2026;SALDO DO DIA;;115,44
05/10/2026;PIX RECEBIDO Cliente;2.000,00;2.000,00
`
    const mapping = detectCsvMapping(csv)
    expect(mapping).toMatchObject({ delimiter: ';', header: 2, date: 0, description: [1], amount: 2, decimal: ',', dateOrder: 'dmy' })
    const rows = parseCsv(csv, mapping)
    expect(rows.map((row) => `${row.date}|${row.description}|${row.amount}`)).toEqual([
      '2026-10-21|PIX ENVIADO Fulano|-15000',
      '2026-10-22|COMPRA CARTAO; MERCADO BOM|-123456',
      '2026-10-05|PIX RECEBIDO Cliente|200000',
    ])
    expect(guessSign(rows)).toBe('account')
  })

  it('fatura de cartão (Nubank): vírgula, ponto nos centavos, ISO; quase tudo positivo = fatura', () => {
    const csv = `date,title,amount
2026-10-01,Uber *Trip,23.90
2026-10-02,Restaurante Sabor,58.00
2026-10-03,iFood,41.50
2026-10-05,Pagamento recebido,-500.00
`
    const mapping = detectCsvMapping(csv)
    expect(mapping).toMatchObject({ delimiter: ',', header: 0, date: 0, description: [1], amount: 2, decimal: '.', dateOrder: 'ymd' })
    const rows = parseCsv(csv, mapping)
    expect(rows.map((row) => row.amount)).toEqual([2390, 5800, 4150, -50000])
    const sign = guessSign(rows)
    expect(sign).toBe('account') // 3 de 4 positivos: não chega a 85%
    expect(guessSign([...rows, ...rows.slice(0, 3), ...rows.slice(0, 3)])).toBe('card')
    expect(kindOf(2390, 'card')).toBe('expense')
    expect(kindOf(-50000, 'card')).toBe('income')
  })

  it('crédito e débito em colunas separadas; coluna D/C', () => {
    const csv = `Data,Histórico,Crédito,Débito
10/21/2026,Mercado,,52.30
10/22/2026,Salário,5000.00,
`
    const mapping = detectCsvMapping(csv)
    expect(mapping).toMatchObject({ amount: -1, credit: 2, debit: 3, dateOrder: 'mdy', decimal: '.' })
    expect(parseCsv(csv, mapping).map((row) => `${row.date}:${row.amount}`)).toEqual(['2026-10-21:-5230', '2026-10-22:500000'])
    const typed = `Data;Descrição;Valor;Tipo
21/10/2026;Mercado;52,30;D
22/10/2026;Salário;5.000,00;C
`
    const typedMapping = detectCsvMapping(typed)
    expect(typedMapping.type).toBe(3)
    expect(parseCsv(typed, typedMapping).map((row) => row.amount)).toEqual([-5230, 500000])
  })
})

describe('extrato: categorias e duplicados', () => {
  const existing = [
    entry({ id: 'a', description: 'UBER *TRIP 12/10', categoryId: 'transporte', amount: 2390, date: '2026-10-01' }),
    entry({ id: 'b', description: 'Mercado Bom', categoryId: 'mercado', amount: 123456, date: '2026-10-21' }),
    entry({ id: 'c', description: 'Feira', amount: 5230, date: '2026-10-21', externalId: '2026102101' }),
    entry({ id: 'd', description: 'Aluguel', amount: 180000, date: '2026-10-05', status: 'pending' }),
  ]
  const categories = [
    { id: 'transporte', name: 'Transporte' },
    { id: 'mercado', name: 'Mercado' },
    { id: 'farmacia', name: 'Farmácia' },
  ]

  it('sugere pela descrição parecida já classificada ou pelo nome da categoria no texto', () => {
    const suggest = categorySuggester(existing, categories)
    expect(suggest('UBER *TRIP 22/10', 'expense')).toBe('transporte')
    expect(suggest('Uber Eats', 'expense')).toBe('transporte')
    expect(suggest('COMPRA FARMACIA SAO JOAO', 'expense')).toBe('farmacia')
    expect(suggest('Algo novo', 'expense')).toBeNull()
    expect(suggest('UBER *TRIP', 'income')).toBeNull()
  })

  it('mesmo id do banco = já importado; mesmo valor em data próxima = possível duplicado (cada um casa uma vez)', () => {
    const find = duplicateFinder(existing)
    expect(find({ date: '2026-10-25', amount: 5230, kind: 'expense', externalId: '2026102101', description: 'x' })).toMatchObject({ certain: true, entry: { id: 'c' } })
    expect(find({ date: '2026-10-22', amount: 123456, kind: 'expense', externalId: null, description: 'COMPRA MERCADO BOM' })).toMatchObject({ certain: false, entry: { id: 'b' } })
    expect(find({ date: '2026-10-22', amount: 123456, kind: 'expense', externalId: null, description: 'outra igual' })).toBeNull()
    expect(find({ date: '2026-10-06', amount: 180000, kind: 'expense', externalId: null, description: 'ALUGUEL' })).toMatchObject({ entry: { id: 'd', status: 'pending' } })
    expect(find({ date: '2026-10-21', amount: 999, kind: 'expense', externalId: null, description: 'Mercado' })).toBeNull()
  })
})
