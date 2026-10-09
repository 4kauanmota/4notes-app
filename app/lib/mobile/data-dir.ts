/**
 * A pasta do workspace no celular — o mesmo que electron/data-dir.ts faz no computador:
 * inspecionar uma pasta, criar a estrutura do 4notes, criar um workspace novo e copiar
 * os dados de um workspace para outro (sem sobrescrever nada).
 */
import { DATA_FOLDERS } from '#shared/files'
import { workspaceNameProblem, type DataDirStatus, type FolderInspection } from '#shared/ipc'
import { cleanPath, FsError, isInside, joinFs, type FsDriver } from './fs'

/** Arquivos do sistema que não contam como "a pasta tem outros arquivos". */
const IGNORED = ['desktop.ini', '.DS_Store', 'Thumbs.db', '.nomedia']

async function isDirectory(fs: FsDriver, path: string): Promise<boolean> {
  return (await fs.stat(path).catch(() => null))?.type === 'directory'
}

async function isWritable(fs: FsDriver, dir: string): Promise<boolean> {
  const probe = joinFs(dir, `.4notes-write-test-${Date.now().toString(36)}`)
  try {
    await fs.writeText(probe, 'ok')
    await fs.remove(probe)
    return true
  } catch {
    return false
  }
}

export async function inspectFolder(fs: FsDriver, target: string): Promise<FolderInspection> {
  const path = cleanPath(target)
  if (!(await isDirectory(fs, path))) return { path, exists: false, isEmpty: true, hasData: false, writable: false }
  const entries = (await fs.readdir(path)).map((entry) => entry.name).filter((name) => !IGNORED.includes(name))
  const hasData = entries.some((name) => (DATA_FOLDERS as readonly string[]).includes(name))
  return { path, exists: true, isEmpty: entries.length === 0, hasData, writable: await isWritable(fs, path) }
}

export async function dataDirStatus(fs: FsDriver, dir: string | null): Promise<DataDirStatus> {
  if (!dir) return { path: null, ready: false, problem: 'not-configured' }
  if (!(await isDirectory(fs, dir))) return { path: dir, ready: false, problem: 'missing' }
  if (!(await isWritable(fs, dir))) return { path: dir, ready: false, problem: 'not-writable' }
  return { path: dir, ready: true, problem: null }
}

/** Cria a pasta (se preciso) e a estrutura padrão de subpastas. */
export async function prepareDataDir(fs: FsDriver, dir: string): Promise<void> {
  await fs.mkdir(dir)
  for (const folder of DATA_FOLDERS) await fs.mkdir(joinFs(dir, folder))
}

/** Copia os dados de uma pasta para outra SEM sobrescrever arquivos existentes. */
export async function copyDataDir(fs: FsDriver, from: string, to: string): Promise<void> {
  const source = cleanPath(from)
  const target = cleanPath(to)
  if (source.toLowerCase() === target.toLowerCase()) return
  if (isInside(source, target)) throw new FsError('EINVAL', 'A nova pasta não pode ficar dentro da pasta atual.')
  const copyTree = async (src: string, dest: string): Promise<void> => {
    await fs.mkdir(dest)
    for (const entry of await fs.readdir(src)) {
      const a = joinFs(src, entry.name)
      const b = joinFs(dest, entry.name)
      if (entry.type === 'directory') await copyTree(a, b)
      else if (!(await fs.stat(b))) await fs.copy(a, b)
    }
  }
  for (const folder of DATA_FOLDERS) {
    const src = joinFs(source, folder)
    if (await isDirectory(fs, src)) await copyTree(src, joinFs(target, folder))
  }
}

/**
 * Cria um workspace novo: a pasta `name` dentro de `parent`, com a estrutura do 4notes.
 * Se a pasta já existir, só é aceita se estiver vazia (para não misturar com outros arquivos).
 */
export async function createWorkspace(fs: FsDriver, parent: string, name: string): Promise<string> {
  const problem = workspaceNameProblem(name)
  if (problem) throw new FsError('EINVAL', problem)
  if (!(await isDirectory(fs, parent))) throw new FsError('ENOENT', 'A pasta escolhida não existe mais.')
  const target = joinFs(parent, name.trim())
  const inspection = await inspectFolder(fs, target)
  if (inspection.exists && !inspection.isEmpty) {
    throw new FsError('EEXIST', `Já existe uma pasta “${name.trim()}” nesse local. Escolha outro nome ou abra essa pasta como workspace.`)
  }
  await prepareDataDir(fs, target)
  return target
}
