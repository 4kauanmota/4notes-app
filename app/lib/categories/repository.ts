/**
 * Persistência das categorias compartilhadas: <workspace>/categories/categories.json.
 * O arquivo só é criado quando existe alguma categoria. Antes da passagem da 1.6
 * (a primeira conciliação, que mexe nos arquivos dos módulos), uma cópia de cada
 * arquivo com categorias vai para .4notes/backups/1.7.0/.
 */
import { joinPath } from '../files/filename'
import { desktop } from '../platform'
import { readJsonFile } from '../storage/json-file'
import { DATA_PATHS } from '../storage/paths'
import { normalizeCategoriesFile, serializeCategoriesFile, type CategoriesData } from './model'

export type CategoriesLoadResult =
  | { status: 'ok'; data: CategoriesData; raw: string }
  | { status: 'missing' }
  | { status: 'invalid'; error: string; raw: string }

/** Arquivos com categorias antes da 1.7.0 (copiados antes da passagem). */
const MODULE_FILES = [`${DATA_PATHS.notesDir}/categorias.json`, DATA_PATHS.tasksFile, DATA_PATHS.linksFile, DATA_PATHS.timerFile]

export const categoriesRepository = {
  file: DATA_PATHS.categoriesFile,

  async load(): Promise<CategoriesLoadResult> {
    const result = await readJsonFile(DATA_PATHS.categoriesFile)
    if (result.status === 'missing') return { status: 'missing' }
    if (result.status === 'invalid') return { status: 'invalid', error: `JSON inválido: ${result.error}`, raw: result.raw }
    try {
      return { status: 'ok', data: normalizeCategoriesFile(result.data), raw: result.raw }
    } catch (error) {
      return { status: 'invalid', error: error instanceof Error ? error.message : String(error), raw: result.raw }
    }
  },

  readRaw: () => desktop().files.read(DATA_PATHS.categoriesFile),

  /** Grava; devolve o texto gravado. */
  async save(data: CategoriesData): Promise<string> {
    const raw = serializeCategoriesFile(data)
    await desktop().files.write(DATA_PATHS.categoriesFile, raw)
    return raw
  },

  /** Cópia dos arquivos dos módulos antes da passagem para as categorias compartilhadas. */
  async backupBeforeMigration(): Promise<string> {
    const dir = joinPath(DATA_PATHS.backupsDir, '1.7.0')
    for (const file of MODULE_FILES) {
      const raw = await desktop().files.read(file).catch(() => null)
      if (raw === null) continue
      const target = joinPath(dir, file.replace(/\//g, '-'))
      // Só a primeira cópia vale (a de antes de qualquer mudança)
      if (await desktop().files.exists(target)) continue
      await desktop().files.write(target, raw)
    }
    return dir
  },

  /** Guarda uma cópia de um categories.json com erro (ele não é sobrescrito enquanto estiver assim). */
  async backupBroken(raw: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const path = joinPath(DATA_PATHS.backupsDir, `categories-${stamp}.json`)
    await desktop().files.write(path, raw)
    return path
  },

  reveal: () => desktop().files.reveal(DATA_PATHS.categoriesFile),
}
