/**
 * Sistema de arquivos do celular (Android), com caminhos absolutos
 * ("/storage/emulated/0/Documents/Pessoal/notes/Ideias.md").
 *
 * - `capacitorFs`: o de verdade — plugin @capacitor/filesystem, sempre a partir da
 *   raiz do armazenamento interno (Directory.ExternalStorage). Precisa da permissão
 *   "Acesso a todos os arquivos" (lib/mobile/native.ts) para ler e gravar fora da
 *   pasta do próprio app.
 * - `memoryFs`: um disco na memória com as mesmas regras do Android (nomes sem
 *   diferenciar maiúsculas) — usado nos testes automatizados.
 *
 * Quem usa (lib/mobile/workspace.ts) só vê a interface FsDriver.
 */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { base64ToBytes, bytesToBase64 } from '#shared/files'

export interface FsStat {
  type: 'file' | 'directory'
  size: number
  mtimeMs: number
}

export interface FsEntry extends FsStat {
  name: string
}

export interface FsDriver {
  /** Raiz do armazenamento interno (ex.: "/storage/emulated/0"). */
  readonly root: string
  /** null = não existe. */
  stat(path: string): Promise<FsStat | null>
  /** Itens de uma pasta (lança ENOENT se a pasta não existir). */
  readdir(path: string): Promise<FsEntry[]>
  /** null = não existe. */
  readText(path: string): Promise<string | null>
  /** Conteúdo em base64; null = não existe. */
  readBase64(path: string): Promise<string | null>
  /** Grava (criando as pastas de cima, se faltarem). */
  writeText(path: string, text: string): Promise<void>
  writeBase64(path: string, base64: string): Promise<void>
  /** Cria a pasta (e as de cima); não faz nada se ela já existir. */
  mkdir(path: string): Promise<void>
  /** Renomeia/move um arquivo ou pasta (um arquivo no destino é substituído). */
  rename(from: string, to: string): Promise<void>
  /** Apaga um arquivo ou uma pasta (com tudo dentro). */
  remove(path: string): Promise<void>
  /** Copia um arquivo (substitui o destino). */
  copy(from: string, to: string): Promise<void>
}

/** Erro com código, no mesmo formato dos erros do desktop ("[ENOENT] …"). */
export class FsError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(`[${code}] ${message}`)
  }
}

// ── Caminhos ────────────────────────────────────────────────────────────────

/** Junta e limpa um caminho absoluto ("/a//b/./c/" → "/a/b/c"); ".." não é aceito. */
export function cleanPath(path: string): string {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') throw new FsError('EINVAL', 'Caminho inválido.')
    parts.push(part)
  }
  return `/${parts.join('/')}`
}

export function joinFs(base: string, ...parts: string[]): string {
  return cleanPath([base, ...parts].join('/'))
}

export function dirnameFs(path: string): string {
  const clean = cleanPath(path)
  const index = clean.lastIndexOf('/')
  return index <= 0 ? '/' : clean.slice(0, index)
}

export function basenameFs(path: string): string {
  return cleanPath(path).split('/').pop() ?? ''
}

/** `path` é `parent` ou fica dentro dele (sem diferenciar maiúsculas, como no Android)? */
export function isInside(parent: string, path: string): boolean {
  const a = cleanPath(parent).toLowerCase()
  const b = cleanPath(path).toLowerCase()
  return b === a || b.startsWith(a === '/' ? '/' : `${a}/`)
}

// ── Android (@capacitor/filesystem) ─────────────────────────────────────────

/** Código dos erros do plugin → código do 4notes. */
function mapError(error: unknown, path: string): FsError {
  const code = (error as { code?: unknown })?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'OS-PLUG-FILE-0008' || code === 'OS-PLUG-FILE-0011' || /does not exist/i.test(message)) return new FsError('ENOENT', `Não encontrado: ${path}`)
  if (code === 'OS-PLUG-FILE-0010') return new FsError('EEXIST', `Já existe: ${path}`)
  if (code === 'OS-PLUG-FILE-0007' || /permission|EACCES/i.test(message)) return new FsError('EACCES', 'O 4notes não tem permissão para acessar os arquivos. Permita o “Acesso a todos os arquivos” nas configurações do Android.')
  return new FsError('EIO', message)
}

const isMissing = (error: FsError) => error.code === 'ENOENT'

/**
 * Sistema de arquivos do Android a partir da raiz do armazenamento interno
 * (`root`, ex.: "/storage/emulated/0"). Os caminhos vão para o plugin relativos a
 * essa raiz (Directory.ExternalStorage): assim o plugin não confunde nomes com "#"
 * ou com "synthetic" com endereços de outro tipo.
 */
export function capacitorFs(root: string): FsDriver {
  const base = cleanPath(root)
  const directory = Directory.ExternalStorage
  const rel = (path: string) => {
    const clean = cleanPath(path)
    if (!isInside(base, clean)) throw new FsError('EACCES', 'Só é possível usar pastas do armazenamento interno.')
    return clean.slice(base.length).replace(/^\//, '')
  }
  const call = async <T>(path: string, task: () => Promise<T>): Promise<T> => {
    try {
      return await task()
    } catch (error) {
      throw error instanceof FsError ? error : mapError(error, path)
    }
  }

  const driver: FsDriver = {
    root: base,
    async stat(path) {
      try {
        const info = await call(path, () => Filesystem.stat({ path: rel(path), directory }))
        return { type: info.type, size: info.size, mtimeMs: info.mtime }
      } catch (error) {
        if (error instanceof FsError && isMissing(error)) return null
        throw error
      }
    },
    async readdir(path) {
      const { files } = await call(path, () => Filesystem.readdir({ path: rel(path), directory }))
      return files.map((file) => ({ name: file.name, type: file.type, size: file.size, mtimeMs: file.mtime }))
    },
    async readText(path) {
      try {
        const { data } = await call(path, () => Filesystem.readFile({ path: rel(path), directory, encoding: Encoding.UTF8 }))
        return typeof data === 'string' ? data : await data.text()
      } catch (error) {
        if (error instanceof FsError && isMissing(error)) return null
        throw error
      }
    },
    async readBase64(path) {
      try {
        const { data } = await call(path, () => Filesystem.readFile({ path: rel(path), directory }))
        return typeof data === 'string' ? data : bytesToBase64(new Uint8Array(await data.arrayBuffer()))
      } catch (error) {
        if (error instanceof FsError && isMissing(error)) return null
        throw error
      }
    },
    async writeText(path, text) {
      await call(path, () => Filesystem.writeFile({ path: rel(path), directory, data: text, encoding: Encoding.UTF8, recursive: true }))
    },
    async writeBase64(path, base64) {
      await call(path, () => Filesystem.writeFile({ path: rel(path), directory, data: base64, recursive: true }))
    },
    async mkdir(path) {
      if ((await driver.stat(path))?.type === 'directory') return
      try {
        await call(path, () => Filesystem.mkdir({ path: rel(path), directory, recursive: true }))
      } catch (error) {
        // Criada ao mesmo tempo por outra gravação: tudo certo
        if (!(error instanceof FsError && error.code === 'EEXIST')) throw error
      }
    },
    async rename(from, to) {
      await call(from, () => Filesystem.rename({ from: rel(from), to: rel(to), directory, toDirectory: directory }))
    },
    async remove(path) {
      const info = await driver.stat(path)
      if (!info) return
      if (info.type === 'directory') await call(path, () => Filesystem.rmdir({ path: rel(path), directory, recursive: true }))
      else await call(path, () => Filesystem.deleteFile({ path: rel(path), directory }))
    },
    async copy(from, to) {
      await call(from, () => Filesystem.copy({ from: rel(from), to: rel(to), directory, toDirectory: directory }))
    },
  }
  return driver
}

// ── Na memória (testes) ─────────────────────────────────────────────────────

interface MemoryNode {
  /** Caminho como foi criado (o nome guarda as maiúsculas). */
  path: string
  type: 'file' | 'directory'
  bytes?: Uint8Array
  mtimeMs: number
}

/**
 * Disco na memória com as regras do armazenamento do Android (nomes sem diferenciar
 * maiúsculas). Com `persistKey`, sobrevive a recarregar a página (testes da interface).
 */
export function memoryFs(root = '/storage/emulated/0', options: { persistKey?: string; folders?: string[] } = {}): FsDriver {
  const base = cleanPath(root)
  const nodes = new Map<string, MemoryNode>()
  const keyOf = (path: string) => cleanPath(path).toLowerCase()
  let clock = Date.now()
  const now = () => ++clock

  const save = () => {
    if (!options.persistKey) return
    const data = [...nodes.values()].map((node) => ({ ...node, bytes: node.bytes ? bytesToBase64(node.bytes) : undefined }))
    try {
      localStorage.setItem(options.persistKey, JSON.stringify(data))
    } catch {
      // sem armazenamento: só na memória
    }
  }
  const restore = (): boolean => {
    if (!options.persistKey) return false
    try {
      const raw = localStorage.getItem(options.persistKey)
      if (!raw) return false
      for (const node of JSON.parse(raw) as (Omit<MemoryNode, 'bytes'> & { bytes?: string })[]) {
        nodes.set(keyOf(node.path), { ...node, bytes: node.bytes !== undefined ? base64ToBytes(node.bytes) : undefined })
      }
      return true
    } catch {
      return false
    }
  }

  const ensureDir = (path: string) => {
    const clean = cleanPath(path)
    const parts = clean.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) {
      const current = `/${parts.slice(0, i).join('/')}`
      const node = nodes.get(keyOf(current))
      if (node?.type === 'file') throw new FsError('ENOTDIR', `Não é uma pasta: ${current}`)
      if (!node) nodes.set(keyOf(current), { path: current, type: 'directory', mtimeMs: now() })
    }
  }
  const children = (path: string) => {
    const prefix = `${keyOf(path)}/`.replace('//', '/')
    return [...nodes.entries()].filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
  }
  const writeBytes = (path: string, bytes: Uint8Array) => {
    const existing = nodes.get(keyOf(path))
    if (existing?.type === 'directory') throw new FsError('EISDIR', `É uma pasta: ${path}`)
    ensureDir(dirnameFs(path))
    nodes.set(keyOf(path), { path: existing?.path ?? cleanPath(path), type: 'file', bytes, mtimeMs: now() })
    save()
  }
  const readBytes = (path: string) => {
    const node = nodes.get(keyOf(path))
    return node?.type === 'file' ? node.bytes! : null
  }

  if (!restore()) {
    ensureDir(base)
    for (const folder of options.folders ?? ['Documents', 'Download']) ensureDir(joinFs(base, folder))
    save()
  }

  return {
    root: base,
    async stat(path) {
      const node = nodes.get(keyOf(path))
      return node ? { type: node.type, size: node.bytes?.byteLength ?? 0, mtimeMs: node.mtimeMs } : null
    },
    async readdir(path) {
      const node = nodes.get(keyOf(path))
      if (node?.type !== 'directory') throw new FsError('ENOENT', `Não encontrado: ${path}`)
      return children(path).map(([, child]) => ({ name: basenameFs(child.path), type: child.type, size: child.bytes?.byteLength ?? 0, mtimeMs: child.mtimeMs }))
    },
    async readText(path) {
      const bytes = readBytes(path)
      return bytes ? new TextDecoder().decode(bytes) : null
    },
    async readBase64(path) {
      const bytes = readBytes(path)
      return bytes ? bytesToBase64(bytes) : null
    },
    async writeText(path, text) {
      writeBytes(path, new TextEncoder().encode(text))
    },
    async writeBase64(path, base64) {
      writeBytes(path, base64ToBytes(base64))
    },
    async mkdir(path) {
      ensureDir(path)
      save()
    },
    async rename(from, to) {
      const source = nodes.get(keyOf(from))
      if (!source) throw new FsError('ENOENT', `Não encontrado: ${from}`)
      if (source.type === 'file' && keyOf(from) === keyOf(to)) {
        // Como no Android: o plugin apaga o destino antes de renomear — e o destino
        // é o próprio arquivo ("nota.md" → "Nota.md"). Quem renomeia usa um nome temporário.
        nodes.delete(keyOf(from))
        save()
        throw new FsError('EIO', `Falha ao renomear: ${from}`)
      }
      const target = nodes.get(keyOf(to))
      if (target && target.type !== source.type) throw new FsError('EEXIST', `Já existe: ${to}`)
      if (source.type === 'directory' && target && keyOf(from) !== keyOf(to)) throw new FsError('EEXIST', `Já existe: ${to}`)
      if (!nodes.has(keyOf(dirnameFs(to)))) throw new FsError('ENOENT', `Pasta não encontrada: ${dirnameFs(to)}`)
      const fromKey = keyOf(from)
      const moved = [...nodes.entries()].filter(([key]) => key === fromKey || key.startsWith(`${fromKey}/`))
      for (const [key] of moved) nodes.delete(key)
      const toClean = cleanPath(to)
      for (const [, node] of moved) {
        const path = toClean + node.path.slice(cleanPath(from).length)
        nodes.set(keyOf(path), { ...node, path, mtimeMs: node.path === source.path ? now() : node.mtimeMs })
      }
      save()
    },
    async remove(path) {
      const key = keyOf(path)
      for (const existing of [...nodes.keys()]) if (existing === key || existing.startsWith(`${key}/`)) nodes.delete(existing)
      save()
    },
    async copy(from, to) {
      const bytes = readBytes(from)
      if (!bytes) throw new FsError('ENOENT', `Não encontrado: ${from}`)
      writeBytes(to, bytes.slice())
    },
  }
}
