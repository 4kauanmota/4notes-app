/**
 * Persistência do Timer: <workspace>/timer/timer.json (categorias, histórico e a
 * sessão em andamento) + cópia de segurança automática (uma por dia da semana) em
 * .4notes/backups/.
 */
import { joinPath } from '../files/filename'
import { desktop } from '../platform'
import { readJsonFile } from '../storage/json-file'
import { DATA_PATHS } from '../storage/paths'
import { defaultTimerData, normalizeTimerFile, type TimerData } from './model'

export type TimerLoadResult = { status: 'ok'; data: TimerData; raw: string | null } | { status: 'invalid'; error: string }

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

export const timerRepository = {
  file: DATA_PATHS.timerFile,

  /** Lê o timer.json (que só é criado quando algo é guardado: uma categoria, uma sessão). */
  async load(): Promise<TimerLoadResult> {
    const result = await readJsonFile(DATA_PATHS.timerFile)
    if (result.status === 'missing') return { status: 'ok', data: defaultTimerData(), raw: null }
    if (result.status === 'invalid') return { status: 'invalid', error: `JSON inválido: ${result.error}` }
    try {
      return { status: 'ok', data: normalizeTimerFile(result.data), raw: result.raw }
    } catch (error) {
      return { status: 'invalid', error: error instanceof Error ? error.message : String(error) }
    }
  },

  /** Conteúdo bruto (para perceber mudanças feitas fora do app ou em outro aparelho). */
  readRaw: () => desktop().files.read(DATA_PATHS.timerFile),
  save: (raw: string) => desktop().files.write(DATA_PATHS.timerFile, raw),

  /** Guarda uma cópia por dia da semana (timer-segunda.json…): 7 dias de histórico. */
  async backup(raw: string, now = new Date()): Promise<void> {
    const name = `timer-${WEEKDAY_NAMES[now.getDay()]}.json`
    const existing = await desktop().files.list(DATA_PATHS.backupsDir)
    const current = existing.find((entry) => entry.name === name)
    if (current && new Date(current.mtimeMs).toDateString() === now.toDateString()) return
    await desktop().files.write(joinPath(DATA_PATHS.backupsDir, name), raw)
  },

  reveal: () => desktop().files.reveal(DATA_PATHS.timerFile),
}
