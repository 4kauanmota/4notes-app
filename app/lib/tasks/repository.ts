/**
 * Persistência das Tarefas: <pasta de dados>/tasks/tasks.json
 * + cópia de segurança automática (uma por dia da semana) em .4notes/backups/.
 */
import { joinPath } from '../files/filename'
import { desktop } from '../platform'
import { readJsonFile } from '../storage/json-file'
import { DATA_PATHS } from '../storage/paths'
import { defaultTasksData, normalizeTasksFile, serializeTasks, type TasksData } from './model'

export type TasksLoadResult =
  | { status: 'ok'; data: TasksData; raw: string }
  | { status: 'created'; data: TasksData; raw: string }
  | { status: 'invalid'; error: string }

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

export const tasksRepository = {
  file: DATA_PATHS.tasksFile,

  async load(): Promise<TasksLoadResult> {
    const result = await readJsonFile(DATA_PATHS.tasksFile)
    if (result.status === 'missing') {
      const data = defaultTasksData()
      const raw = serializeTasks(data)
      await desktop().files.write(DATA_PATHS.tasksFile, raw)
      return { status: 'created', data, raw }
    }
    if (result.status === 'invalid') return { status: 'invalid', error: `JSON inválido: ${result.error}` }
    try {
      return { status: 'ok', data: normalizeTasksFile(result.data), raw: result.raw }
    } catch (error) {
      return { status: 'invalid', error: error instanceof Error ? error.message : String(error) }
    }
  },

  /** Lê o conteúdo bruto (para detectar edições feitas fora do app). */
  readRaw: () => desktop().files.read(DATA_PATHS.tasksFile),

  save: (raw: string) => desktop().files.write(DATA_PATHS.tasksFile, raw),

  /** Guarda uma cópia por dia da semana (tasks-segunda.json…): 7 dias de histórico. */
  async backup(raw: string, now = new Date()): Promise<void> {
    const name = `tasks-${WEEKDAY_NAMES[now.getDay()]}.json`
    const path = joinPath(DATA_PATHS.backupsDir, name)
    const existing = await desktop().files.list(DATA_PATHS.backupsDir)
    const current = existing.find((entry) => entry.name === name)
    if (current && new Date(current.mtimeMs).toDateString() === now.toDateString()) return
    await desktop().files.write(path, raw)
  },

  reveal: () => desktop().files.reveal(DATA_PATHS.tasksFile),
}
