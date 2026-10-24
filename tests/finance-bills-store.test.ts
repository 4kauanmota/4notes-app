// 1.7.1 nas Finanças, no store com o disco do Android na memória (hoje = 23/10/2026):
// contas com "Me lembre de pagar", recorrências (gerar sem duplicar, mudar só a próxima ou
// as futuras, encerrar e excluir sem perder o histórico), entradas, saldo inicial e a
// importação do extrato.
import { beforeAll, describe, expect, it } from 'vitest'
import { createMobileApi } from '~/lib/mobile/api'
import { memoryFs } from '~/lib/mobile/fs'
import { fakeNative } from '~/lib/mobile/native'
import { WorkspaceFiles } from '~/lib/mobile/workspace'

const ROOT = '/storage/emulated/0'
const WS = `${ROOT}/Documents/Contas`
const TODAY = '2026-10-23'
const disk = memoryFs(ROOT)
const files = new WorkspaceFiles(disk, WS)
const read = async (path: string) => JSON.parse((await files.read(path)) ?? 'null')

let finance: ReturnType<(typeof import('~/stores/finance'))['useFinanceStore']>
let shared: ReturnType<(typeof import('~/stores/categories'))['useCategoriesStore']>
let toasts: ReturnType<(typeof import('~/composables/useToasts'))['useToasts']>['toasts']
let balance: typeof import('~/lib/finance/bills')

beforeAll(async () => {
  const api = await createMobileApi({ fs: disk, native: fakeNative(ROOT), version: '1.7.1', test: true, fakeToday: TODAY })
  await api.dataDir.use(WS)
  const noop = () => undefined
  Object.assign(globalThis, {
    window: { fourNotes: api, addEventListener: noop, removeEventListener: noop },
    document: { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', documentElement: { style: {} }, hasFocus: () => true },
  })
  finance = (await import('~/stores/finance')).useFinanceStore()
  shared = (await import('~/stores/categories')).useCategoriesStore()
  toasts = (await import('~/composables/useToasts')).useToasts().toasts
  balance = await import('~/lib/finance/bills')
  await finance.load()
  await shared.load()
})

const flush = () => Promise.all([finance.flush(), shared.flush()])
const file = () => read('finance/finance.json')

describe('contas a pagar', () => {
  it('"Me lembre de pagar": fica pendente (vencido depois da data) até confirmar; a confirmação guarda o dia', async () => {
    expect(finance.today.value).toBe(TODAY)
    const light = finance.addExpense({ description: 'Conta de luz', amount: 18990, date: '2026-10-20', categoryId: null, remind: true })!
    expect(light).toMatchObject({ status: 'pending', remind: true, doneOn: null })
    expect(finance.reminders.value.map((item) => item.id)).toEqual([light.id])
    // Não conta como gasto enquanto não for pago
    expect(balance.cashFlow(finance.state.expenses, '2026-10-01', '2026-10-31').paid).toBe(0)
    expect(finance.confirmEntry(light.id, '2026-10-22')).toBe(true)
    expect(finance.findExpense(light.id)).toMatchObject({ status: 'done', doneOn: '2026-10-22' })
    expect(finance.reminders.value).toEqual([])
    expect(balance.cashFlow(finance.state.expenses, '2026-10-01', '2026-10-31').paid).toBe(18990)
    // Desfazer volta a pendente
    await toasts.at(-1)!.action!.run()
    expect(finance.findExpense(light.id)).toMatchObject({ status: 'pending', doneOn: null })
    finance.confirmEntry(light.id)
    await flush()
    const saved = (await file()).expenses.find((item: { id: string }) => item.id === light.id)
    expect(saved).toMatchObject({ doneOn: TODAY, remind: true })
    expect(saved.status).toBeUndefined()
  })

  it('entrada: vai para "incomes" no arquivo; a receber até confirmar', async () => {
    const freela = finance.addExpense({ kind: 'income', description: 'Freela', amount: 120000, date: '2026-10-30', categoryId: null, pending: true })!
    expect(freela).toMatchObject({ kind: 'income', status: 'pending', remind: false })
    await flush()
    const data = await file()
    expect(data.incomes.map((item: { id: string }) => item.id)).toEqual([freela.id])
    expect(data.expenses.some((item: { id: string }) => item.id === freela.id)).toBe(false)
  })
})

describe('recorrências', () => {
  it('cadastrar: as ocorrências até hoje viram lançamentos pendentes, sem duplicar ao abrir de novo', async () => {
    const rent = finance.addRecurrence({
      kind: 'expense',
      description: 'Aluguel',
      amount: 180000,
      categoryId: null,
      remind: true,
      frequency: 'monthly',
      firstDate: '2026-08-31',
      endDate: null,
    })!
    const occurrences = () => finance.state.expenses.filter((item) => item.recurrenceId === rent.id)
    expect(occurrences().map((item) => `${item.date}:${item.status}`)).toEqual(['2026-08-31:pending', '2026-09-30:pending'])
    expect(occurrences().map((item) => item.id)).toEqual([`${rent.id}_20260831`, `${rent.id}_20260930`])
    expect(rent.generatedUntil).toBe(TODAY)
    // O próximo (31/10) ainda é só previsão
    expect(finance.nextOccurrence(rent)).toMatchObject({ occurrence: '2026-10-31', amount: 180000, entry: null })
    await flush()
    // Reabrir (reler o arquivo) não cria nada novo
    await finance.load()
    expect(occurrences().length).toBe(2)
    // Mesmo se o arquivo perder o "até onde gerou" (outro aparelho, versão antiga), as que existem não se repetem
    const data = await file()
    data.recurrences[0].generatedUntil = null
    await files.write('finance/finance.json', `${JSON.stringify(data, null, 2)}\n`)
    await finance.refreshFromDisk()
    expect(occurrences().length).toBe(2)
  })

  it('pagar uma vencida e adiantar a próxima (prevista)', () => {
    const rent = finance.state.recurrences[0]!
    const [august] = finance.state.expenses.filter((item) => item.recurrenceId === rent.id)
    expect(finance.confirmEntry(august!.id, '2026-09-02')).toBe(true)
    const next = finance.upcomingUntil('2026-11-30').find((item) => item.recurrenceId === rent.id && !item.stored)!
    expect(next).toMatchObject({ date: '2026-10-31', amount: 180000 })
    expect(finance.confirmUpcoming(next, TODAY)).toBe(true)
    expect(finance.findExpense(`${rent.id}_20261031`)).toMatchObject({ status: 'done', doneOn: TODAY })
    // A próxima passa a ser a de novembro (30/11, o último dia)
    expect(finance.nextOccurrence(rent)?.occurrence).toBe('2026-11-30')
  })

  it('mudar o valor só da próxima: a regra continua; a seguinte volta ao valor normal', () => {
    const rent = finance.state.recurrences[0]!
    expect(finance.updateRecurrence(rent.id, { amount: 150000 }, 'next')).toBe(true)
    expect(finance.findExpense(`${rent.id}_20261130`)).toMatchObject({ amount: 150000, status: 'pending' })
    expect(rent.versions.length).toBe(1)
    const after = finance.upcomingUntil('2026-12-31').filter((item) => item.recurrenceId === rent.id && item.date > '2026-11-30')
    expect(after.map((item) => `${item.date}:${item.amount}`)).toEqual(['2026-12-31:180000'])
  })

  it('mudar o valor da próxima e das futuras: nova versão; o histórico pago não muda', () => {
    const rent = finance.state.recurrences[0]!
    expect(finance.updateRecurrence(rent.id, { amount: 200000 }, 'future')).toBe(true)
    expect(rent.versions.map((item) => `${item.from}:${item.amount}`)).toEqual(['2026-08-31:180000', '2026-11-30:200000'])
    // A de novembro (pendente, já lançada) acompanha; agosto (paga) não
    expect(finance.findExpense(`${rent.id}_20261130`)?.amount).toBe(200000)
    expect(finance.findExpense(`${rent.id}_20260831`)?.amount).toBe(180000)
    expect(finance.findExpense(`${rent.id}_20261031`)?.amount).toBe(180000)
  })

  it('descrição e categoria valem para as pendentes; pular uma ocorrência', () => {
    const rent = finance.state.recurrences[0]!
    const casa = finance.addCategory('Casa', 'orange')!
    finance.updateRecurrence(rent.id, { description: 'Aluguel do apê', categoryId: casa.id })
    expect(finance.findExpense(`${rent.id}_20260930`)).toMatchObject({ description: 'Aluguel do apê', categoryId: casa.id })
    expect(finance.findExpense(`${rent.id}_20260831`)?.description).toBe('Aluguel')
    expect(finance.skipEntry(`${rent.id}_20260930`)).toBe(true)
    expect(finance.findExpense(`${rent.id}_20260930`)?.status).toBe('cancelled')
  })

  it('encerrar: nada novo depois de hoje, o histórico fica; desfazer volta', async () => {
    const rent = finance.state.recurrences[0]!
    expect(finance.stopRecurrence(rent.id)).toBe(true)
    expect(rent.endDate).toBe(TODAY)
    expect(finance.upcomingUntil('2027-01-31').filter((item) => item.recurrenceId === rent.id && !item.stored)).toEqual([])
    // A de novembro já estava lançada (com valor só dela): continua na lista de contas
    expect(finance.findExpense(`${rent.id}_20261130`)?.status).toBe('pending')
    await toasts.at(-1)!.action!.run()
    expect(rent.endDate).toBeNull()
  })

  it('salário mensal: entradas a receber; confirmar o recebimento', () => {
    const salary = finance.addRecurrence({
      kind: 'income',
      description: 'Salário',
      amount: 500000,
      categoryId: null,
      frequency: 'monthly',
      firstDate: '2026-10-05',
      endDate: '2027-03-05',
      pastAsDone: true,
    })!
    // A de 05/10 já passou e entrou como recebida (pedido no cadastro)
    expect(finance.findExpense(`${salary.id}_20261005`)).toMatchObject({ kind: 'income', status: 'done' })
    const upcoming = finance.upcomingUntil('2027-12-31').filter((item) => item.recurrenceId === salary.id)
    expect(upcoming.map((item) => item.date)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05', '2027-02-05', '2027-03-05'])
  })

  it('excluir a recorrência: as pendentes saem, as pagas ficam como lançamentos comuns', async () => {
    const rent = finance.state.recurrences[0]!
    const id = rent.id
    const { dialogs } = (await import('~/composables/useDialog')).useDialogs()
    const pending = finance.requestDeleteRecurrence(id)
    // Confirma o diálogo
    await Promise.resolve()
    dialogs.at(-1)!.resolve({ button: 'confirm', value: '' })
    expect(await pending).toBe(true)
    expect(finance.findRecurrence(id)).toBeUndefined()
    expect(finance.findExpense(`${id}_20261130`)).toBeUndefined()
    expect(finance.findExpense(`${id}_20260831`)).toMatchObject({ status: 'done', recurrenceId: null })
    await toasts.at(-1)!.action!.run()
    expect(finance.findRecurrence(id)).toBeDefined()
    expect(finance.findExpense(`${id}_20261130`)).toBeDefined()
  })
})

describe('saldo', () => {
  it('saldo inicial guardado no arquivo; realizado só com o que foi pago/recebido', async () => {
    expect(finance.setOpeningBalance({ amount: 100000, date: '2026-09-30' })).toBe(true)
    await flush()
    expect((await file()).openingBalance).toEqual({ amount: 100000, date: '2026-09-30' })
    const summary = balance.balanceSummary(finance.state.expenses, finance.state.recurrences, finance.state.openingBalance, TODAY, finance.horizonEnd.value)
    // 1.000 + salário (5.000) − luz (189,90) − aluguel de outubro adiantado (1.800); agosto foi pago em 02/09, antes do saldo inicial
    expect(summary.realized).toBe(100000 + 500000 - 18990 - 180000)
    expect(summary.estimated).toBe(false)
  })
})

describe('importar extrato', () => {
  it('cria os lançamentos, confirma a conta pendente que aparece no extrato e tem Desfazer', async () => {
    const rentPending = finance.state.expenses.find((item) => item.kind === 'expense' && item.status === 'pending' && item.recurrenceId)!
    const before = finance.state.expenses.length
    const result = finance.importEntries(
      [
        { kind: 'expense', date: '2026-10-21', description: 'PADARIA', amount: 1250, categoryId: null, externalId: 'F1' },
        { kind: 'income', date: '2026-10-22', description: 'PIX RECEBIDO', amount: 5000, categoryId: null, externalId: 'F2' },
        { kind: 'expense', date: rentPending.date, description: 'ALUGUEL', amount: rentPending.amount, categoryId: null, externalId: 'F3', confirms: rentPending.id },
      ],
      { file: 'extrato.ofx', format: 'ofx' },
    )
    expect(result).toEqual({ added: 2, confirmed: 1 })
    expect(finance.state.expenses.length).toBe(before + 2)
    expect(finance.findExpense(rentPending.id)).toMatchObject({ status: 'done', doneOn: rentPending.date, externalId: 'F3' })
    const batch = finance.state.imports.at(-1)!
    expect(batch).toMatchObject({ file: 'extrato.ofx', format: 'ofx', count: 3 })
    expect(finance.state.expenses.filter((item) => item.importId === batch.id).length).toBe(3)
    await flush()
    expect((await file()).imports.at(-1)).toMatchObject({ file: 'extrato.ofx', count: 3 })
    // Desfazer: some o que veio e a conta volta a pendente
    await toasts.at(-1)!.action!.run()
    expect(finance.state.expenses.length).toBe(before)
    expect(finance.findExpense(rentPending.id)?.status).toBe('pending')
    expect(finance.state.imports.some((item) => item.id === batch.id)).toBe(false)
  })
})
