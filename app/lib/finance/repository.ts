/**
 * Persistência das Finanças (1.7.0): <workspace>/finance/finance.json + cópia de
 * segurança automática (uma por dia da semana) em .4notes/backups/. O arquivo só é
 * criado quando algo é guardado (um gasto, uma categoria).
 */
import { joinPath } from '../files/filename'
import { desktop } from '../platform'
import { readJsonFile } from '../storage/json-file'
import { DATA_PATHS } from '../storage/paths'
import { defaultFinanceData, normalizeFinanceFile, type FinanceData } from './model'

export type FinanceLoadResult = { status: 'ok'; data: FinanceData; raw: string | null } | { status: 'invalid'; error: string }

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

export const financeRepository = {
  file: DATA_PATHS.financeFile,

  async load(): Promise<FinanceLoadResult> {
    const result = await readJsonFile(DATA_PATHS.financeFile)
    if (result.status === 'missing') return { status: 'ok', data: defaultFinanceData(), raw: null }
    if (result.status === 'invalid') return { status: 'invalid', error: `JSON inválido: ${result.error}` }
    try {
      return { status: 'ok', data: normalizeFinanceFile(result.data), raw: result.raw }
    } catch (error) {
      return { status: 'invalid', error: error instanceof Error ? error.message : String(error) }
    }
  },

  /** Conteúdo bruto (para perceber mudanças feitas fora do app ou em outro aparelho). */
  readRaw: () => desktop().files.read(DATA_PATHS.financeFile),
  save: (raw: string) => desktop().files.write(DATA_PATHS.financeFile, raw),

  /** Guarda uma cópia por dia da semana (finance-segunda.json…): 7 dias de histórico. */
  async backup(raw: string, now = new Date()): Promise<void> {
    const name = `finance-${WEEKDAY_NAMES[now.getDay()]}.json`
    const existing = await desktop().files.list(DATA_PATHS.backupsDir)
    const current = existing.find((entry) => entry.name === name)
    if (current && new Date(current.mtimeMs).toDateString() === now.toDateString()) return
    await desktop().files.write(joinPath(DATA_PATHS.backupsDir, name), raw)
  },

  reveal: () => desktop().files.reveal(DATA_PATHS.financeFile),
}
