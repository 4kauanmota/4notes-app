import { describe, expect, it } from 'vitest'
import {
  categoryIdFor,
  completeTask,
  completedEntries,
  createTask,
  defaultTasksData,
  groupByDate,
  isPending,
  isScheduled,
  normalizeTasksFile,
  reopenTask,
  serializeTasks,
  skipOccurrence,
  todayProgress,
} from '~/lib/tasks/model'

const today = '2026-10-05'
const tomorrow = '2026-10-06'

describe('tarefas', () => {
  it('tarefa comum concluída sai de Pendentes e pode ser reaberta', () => {
    const task = createTask({ title: 'Comprar café' }, today)
    expect(isPending(task, today)).toBe(true)
    const done = completeTask(task, today)
    expect(done.done).toBe(true)
    expect(isPending(done, today)).toBe(false)
    expect(isPending(reopenTask(done), today)).toBe(true)
  })

  it('recorrente concluída some e volta sozinha na próxima data', () => {
    const task = createTask({ title: 'Estudar Godot', date: today, recurrence: { interval: 7, unit: 'day', basis: 'schedule' } }, today)
    const done = completeTask(task, today)
    expect(done.date).toBe('2026-10-12')
    expect(done.history).toHaveLength(1)
    // Enquanto a data não chega, fica em "Agendadas"
    expect(isPending(done, '2026-10-11')).toBe(false)
    expect(isScheduled(done, '2026-10-11')).toBe(true)
    // Ao abrir o app no dia (ou depois), está de volta
    expect(isPending(done, '2026-10-12')).toBe(true)
    expect(isPending(done, '2026-10-20')).toBe(true)
  })

  it('recorrente criada para o futuro só aparece na data', () => {
    const task = createTask({ title: 'Pagar aluguel', date: '2026-10-10', recurrence: { interval: 1, unit: 'month', basis: 'schedule' } }, today)
    expect(isPending(task, today)).toBe(false)
    expect(isScheduled(task, today)).toBe(true)
  })

  it('pular ocorrência não registra conclusão', () => {
    const task = createTask({ title: 'Academia', date: today, recurrence: { interval: 1, unit: 'day', basis: 'schedule' } }, today)
    const skipped = skipOccurrence(task, today)
    expect(skipped.date).toBe(tomorrow)
    expect(skipped.history).toHaveLength(0)
  })

  it('agrupa por data', () => {
    const tasks = [
      createTask({ title: 'A', date: '2026-10-01' }, today),
      createTask({ title: 'B', date: today }, today),
      createTask({ title: 'C', date: tomorrow }, today),
      createTask({ title: 'D', date: '2026-10-30' }, today),
      createTask({ title: 'E' }, today),
    ]
    expect(groupByDate(tasks, today, tomorrow).map((g) => g.key)).toEqual(['overdue', 'today', 'tomorrow', 'upcoming', 'nodate'])
  })

  it('normaliza arquivos editados à mão e preserva os dados', () => {
    const data = normalizeTasksFile({
      categories: [{ id: 'estudos', name: 'Estudos', color: 'cor-invalida' }],
      tasks: [
        { id: 'x', title: 'Ok', date: '2026-10-05', recurrence: { interval: '7', unit: 'day' } },
        { id: 'x', title: 'Duplicada' },
        { title: '' },
        'lixo',
      ],
    })
    expect(data.categories[0]!.color).toBe('gray')
    expect(data.tasks).toHaveLength(2)
    expect(data.tasks[0]!.recurrence).toMatchObject({ interval: 7, anchor: '2026-10-05', basis: 'schedule' })
    expect(data.tasks[1]!.id).not.toBe('x')
    const roundTrip = normalizeTasksFile(JSON.parse(serializeTasks(data)))
    expect(roundTrip).toEqual(data)
    expect(() => normalizeTasksFile('texto')).toThrow()
  })

  it('gera ids legíveis para categorias', () => {
    const taken = new Set(['estudos'])
    expect(categoryIdFor('Projetos Pessoais', (id) => taken.has(id))).toBe('projetos-pessoais')
    expect(categoryIdFor('Estudos', (id) => taken.has(id))).toBe('estudos-2')
    expect(categoryIdFor('Ação & Reação!', () => false)).toBe('acao-reacao')
  })

  it('histórico e progresso do dia', () => {
    const now = new Date('2026-10-05T15:00:00')
    const a = completeTask(createTask({ title: 'A', date: today }, today), today, now)
    const b = completeTask(createTask({ title: 'B', date: today, recurrence: { interval: 1, unit: 'day', basis: 'schedule' } }, today), today, now)
    const c = createTask({ title: 'C', date: today }, today)
    expect(completedEntries([a, b, c])).toHaveLength(2)
    expect(todayProgress([a, b, c], today)).toEqual({ done: 2, total: 3 })
  })

  it('progresso conta também as tarefas sem data (só as futuras ficam de fora)', () => {
    const now = new Date('2026-10-05T15:00:00')
    const semData = createTask({ title: 'Sem data' }, today)
    const semDataFeita = completeTask(createTask({ title: 'Sem data feita' }, today), today, now)
    const atrasada = createTask({ title: 'Atrasada', date: '2026-10-01' }, today)
    const futura = createTask({ title: 'Futura', date: '2026-10-20' }, today)
    expect(todayProgress([semData, semDataFeita, atrasada, futura], today)).toEqual({ done: 1, total: 3 })
  })

  it('um arquivo novo começa sem categorias', () => {
    expect(defaultTasksData()).toEqual({ categories: [], tasks: [] })
  })
})
