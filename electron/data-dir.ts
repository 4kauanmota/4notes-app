/**
 * Pasta de dados: o lugar escolhido por você onde o 4notes guarda tudo.
 *
 *   <pasta de dados>/
 *   ├── notes/      notas rápidas (aba Notas) — arquivos .md
 *   ├── tasks/      tasks.json com tarefas e categorias (+ backups diários)
 *   ├── mindmap/    mapas mentais — uma pasta por mapa (notas .md + mapa.json)
 *   ├── links/      links.json com os links salvos e as pastas (+ icons/, os ícones dos sites)
 *   ├── timer/      timer.json com as categorias, o histórico e a sessão em andamento (+ backups diários)
 *   ├── attachments/ imagens coladas nas notas
 *   └── .4notes/    estado da interface (abas abertas, posições do mapa). Pode ser apagada.
 *
 * Essa pasta é o "workspace": o nome dele é o nome da pasta.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { DATA_FOLDERS } from '../shared/files'
import { workspaceNameProblem, type DataDirStatus, type FolderInspection } from '../shared/ipc'

export { DATA_FOLDERS } from '../shared/files'

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function isWritable(dir: string): Promise<boolean> {
  const probe = path.join(dir, `.4notes-write-test-${process.pid}-${Date.now()}`)
  try {
    await fs.writeFile(probe, 'ok', 'utf8')
    await fs.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

export async function inspectFolder(target: string): Promise<FolderInspection> {
  const absolute = path.resolve(target)
  if (!(await isDirectory(absolute))) {
    return { path: absolute, exists: false, isEmpty: true, hasData: false, writable: false }
  }
  const entries = (await fs.readdir(absolute)).filter((name) => !['desktop.ini', '.DS_Store', 'Thumbs.db'].includes(name))
  const hasData = entries.some((name) => (DATA_FOLDERS as readonly string[]).includes(name))
  return {
    path: absolute,
    exists: true,
    isEmpty: entries.length === 0,
    hasData,
    writable: await isWritable(absolute),
  }
}

export async function dataDirStatus(dir: string | null): Promise<DataDirStatus> {
  if (!dir) return { path: null, ready: false, problem: 'not-configured' }
  if (!(await isDirectory(dir))) return { path: dir, ready: false, problem: 'missing' }
  if (!(await isWritable(dir))) return { path: dir, ready: false, problem: 'not-writable' }
  return { path: dir, ready: true, problem: null }
}

/** Cria a pasta (se preciso) e a estrutura padrão de subpastas. */
export async function prepareDataDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  for (const folder of DATA_FOLDERS) {
    await fs.mkdir(path.join(dir, folder), { recursive: true })
  }
}

/** Copia os dados de uma pasta para outra SEM sobrescrever arquivos existentes. */
export async function copyDataDir(from: string, to: string): Promise<void> {
  const source = path.resolve(from)
  const target = path.resolve(to)
  if (source === target) return
  const relative = path.relative(source, target)
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('[EINVAL] A nova pasta não pode ficar dentro da pasta atual.')
  }
  for (const folder of DATA_FOLDERS) {
    const src = path.join(source, folder)
    if (!(await isDirectory(src))) continue
    await fs.cp(src, path.join(target, folder), { recursive: true, force: false, errorOnExist: false })
  }
}

/**
 * Cria um workspace novo: a pasta `name` dentro de `parent`, com a estrutura do 4notes.
 * Se a pasta já existir, só é aceita se estiver vazia (para não misturar com outros arquivos).
 */
export async function createWorkspace(parent: string, name: string): Promise<string> {
  const problem = workspaceNameProblem(name)
  if (problem) throw new Error(`[EINVAL] ${problem}`)
  if (!(await isDirectory(parent))) throw new Error('[ENOENT] A pasta escolhida não existe mais.')
  const target = path.join(path.resolve(parent), name.trim())
  const inspection = await inspectFolder(target)
  if (inspection.exists && !inspection.isEmpty) {
    throw new Error(`[EEXIST] Já existe uma pasta “${name.trim()}” nesse local. Escolha outro nome ou abra essa pasta como workspace.`)
  }
  await prepareDataDir(target)
  return target
}
