/**
 * Arquivos do workspace no celular — o mesmo que electron/files.ts faz no computador.
 *
 * Toda operação recebe um caminho RELATIVO ao workspace (ex.: "notes/Ideias.md") e
 * `resolve` garante que nada escape dele. As regras são as do desktop: escrita
 * atômica (arquivo temporário + renomear), itens ocultos ignorados nas listas, texto
 * sem BOM e com quebras de linha "\n", imagens com os mesmos nomes.
 *
 * Diferenças do Android: não há Lixeira do sistema (o que é excluído vai para
 * .4notes/trash/ do workspace) e o armazenamento não diferencia maiúsculas
 * ("nota.md" e "Nota.md" são o mesmo arquivo).
 */
import { ATTACHMENTS_DIR, fileStamp, IMAGE_EXTENSIONS, IMAGE_FILE, MAX_IMAGE_BYTES, normalizeText, TRASH_DIR } from '#shared/files'
import type { FileEntry, ListOptions } from '#shared/ipc'
import { base64ToBytes, bytesToBase64 } from '#shared/files'
import { basenameFs, cleanPath, dirnameFs, FsError, joinFs, type FsDriver } from './fs'

const randomId = () => Math.random().toString(36).slice(2, 10)

export class WorkspaceFiles {
  readonly root: string

  constructor(
    readonly fs: FsDriver,
    root: string,
  ) {
    this.root = cleanPath(root)
  }

  /** Caminho absoluto de um caminho relativo, recusando qualquer coisa fora do workspace. */
  resolve(relativePath: unknown): string {
    if (typeof relativePath !== 'string' || relativePath.length > 1024 || relativePath.includes('\0')) throw new FsError('EINVAL', 'Caminho inválido.')
    const parts: string[] = []
    for (const part of relativePath.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {
        if (!parts.length) throw new FsError('EACCES', 'Acesso negado: o caminho está fora da pasta de dados.')
        parts.pop()
        continue
      }
      parts.push(part)
    }
    return parts.length ? `${this.root}/${parts.join('/')}` : this.root
  }

  /** Caminho relativo (com "/") de um caminho absoluto do workspace. */
  relative(absolute: string): string {
    return cleanPath(absolute).slice(this.root.length).replace(/^\//, '')
  }

  private async entry(absolute: string, withContent: boolean, known?: { size: number; mtimeMs: number }): Promise<FileEntry> {
    const info = known ?? (await this.fs.stat(absolute))
    if (!info) throw new FsError('ENOENT', 'O arquivo não existe mais.')
    const entry: FileEntry = { path: this.relative(absolute), name: basenameFs(absolute), size: info.size, mtimeMs: info.mtimeMs }
    if (withContent) entry.content = normalizeText((await this.fs.readText(absolute)) ?? '')
    return entry
  }

  async list(dir: string, options: ListOptions = {}): Promise<FileEntry[]> {
    const base = this.resolve(dir)
    const extensions = options.extensions?.map((ext) => ext.toLowerCase())
    const result: FileEntry[] = []
    const walk = async (absoluteDir: string): Promise<void> => {
      let items
      try {
        items = await this.fs.readdir(absoluteDir)
      } catch (error) {
        if (error instanceof FsError && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return
        throw error
      }
      for (const item of items) {
        // Itens ocultos (".4notes", ".obsidian", arquivos temporários) são ignorados.
        if (item.name.startsWith('.')) continue
        const absolute = `${absoluteDir}/${item.name}`
        if (item.type === 'directory') {
          if (options.recursive) await walk(absolute)
          continue
        }
        const dot = item.name.lastIndexOf('.')
        if (extensions && !extensions.includes(dot > 0 ? item.name.slice(dot).toLowerCase() : '')) continue
        try {
          result.push(await this.entry(absolute, options.withContent === true, item))
        } catch (error) {
          // Apagado no meio da leitura: ignora
          if (!(error instanceof FsError && error.code === 'ENOENT')) throw error
        }
      }
    }
    await walk(base)
    return result
  }

  async read(relativePath: string): Promise<string | null> {
    const text = await this.fs.readText(this.resolve(relativePath))
    return text === null ? null : normalizeText(text)
  }

  async readBytes(relativePath: string): Promise<Uint8Array | null> {
    const data = await this.fs.readBase64(this.resolve(relativePath))
    return data === null ? null : base64ToBytes(data)
  }

  /** Escrita atômica: grava num temporário oculto e depois troca pelo arquivo. */
  private async writeAtomic(absolute: string, write: (path: string) => Promise<void>): Promise<void> {
    const tmp = joinFs(dirnameFs(absolute), `.${basenameFs(absolute)}.${randomId()}.tmp`)
    await write(tmp)
    try {
      await this.fs.rename(tmp, absolute)
    } catch {
      // Último recurso: grava diretamente
      try {
        await write(absolute)
      } finally {
        await this.fs.remove(tmp).catch(() => undefined)
      }
    }
  }

  async write(relativePath: string, content: string): Promise<FileEntry> {
    if (typeof content !== 'string') throw new FsError('EINVAL', 'Conteúdo inválido.')
    const absolute = this.resolve(relativePath)
    await this.writeAtomic(absolute, (path) => this.fs.writeText(path, content))
    return this.entry(absolute, false)
  }

  async writeBytes(relativePath: string, data: Uint8Array): Promise<FileEntry> {
    const absolute = this.resolve(relativePath)
    const base64 = bytesToBase64(data)
    await this.writeAtomic(absolute, (path) => this.fs.writeBase64(path, base64))
    return this.entry(absolute, false)
  }

  async mkdir(relativePath: string): Promise<void> {
    await this.fs.mkdir(this.resolve(relativePath))
  }

  async exists(relativePath: string): Promise<boolean> {
    return (await this.fs.stat(this.resolve(relativePath))) !== null
  }

  async rename(from: string, to: string): Promise<void> {
    const source = this.resolve(from)
    const target = this.resolve(to)
    if (source === target) return
    if (!(await this.fs.stat(source))) throw new FsError('ENOENT', 'O arquivo original não existe mais.')
    // No Android "nota.md" e "Nota.md" são o MESMO arquivo: trocar só as maiúsculas
    // passa por um nome temporário; qualquer outro destino existente é um conflito.
    const caseOnly = source.toLowerCase() === target.toLowerCase()
    if (!caseOnly && (await this.fs.stat(target))) throw new FsError('EEXIST', 'Já existe um arquivo com esse nome.')
    await this.fs.mkdir(dirnameFs(target))
    if (caseOnly) {
      const tmp = `${source}.${randomId()}.renaming`
      await this.fs.rename(source, tmp)
      await this.fs.rename(tmp, target)
    } else {
      await this.fs.rename(source, target)
    }
  }

  /** "Excluir": não há Lixeira no Android — vai para .4notes/trash/ (dá para recuperar). */
  async trash(relativePath: string): Promise<void> {
    const absolute = this.resolve(relativePath)
    if (!(await this.fs.stat(absolute))) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dir = this.resolve(TRASH_DIR)
    await this.fs.mkdir(dir)
    let target = joinFs(dir, `${stamp} ${basenameFs(absolute)}`)
    if (await this.fs.stat(target)) target = joinFs(dir, `${stamp}-${randomId()} ${basenameFs(absolute)}`)
    await this.fs.rename(absolute, target)
  }

  /**
   * Grava uma imagem nova em attachments/ com um nome livre: "<base>.<ext>",
   * "<base>-2.<ext>"… Devolve o caminho no workspace ("attachments/foto.png").
   */
  async writeNewAttachment(base: string, extension: string, data: Uint8Array): Promise<string> {
    const dir = this.resolve(ATTACHMENTS_DIR)
    await this.fs.mkdir(dir)
    for (let attempt = 1; attempt < 1000; attempt++) {
      const name = `${base}${attempt > 1 ? `-${attempt}` : ''}.${extension}`
      if (await this.fs.stat(joinFs(dir, name))) continue
      await this.fs.writeBase64(joinFs(dir, name), bytesToBase64(data))
      return `${ATTACHMENTS_DIR}/${name}`
    }
    throw new FsError('EEXIST', 'Não foi possível criar um nome para a imagem.')
  }

  /** Grava uma imagem colada em attachments/ com um nome único (imagem-AAAAMMDD-HHMMSS.png). */
  async saveImage(data: unknown, mime: unknown): Promise<string> {
    const extension = typeof mime === 'string' ? IMAGE_EXTENSIONS[mime.toLowerCase()] : undefined
    if (!extension) throw new FsError('EINVAL', 'Formato de imagem não suportado.')
    if (!(data instanceof Uint8Array) || data.byteLength === 0) throw new FsError('EINVAL', 'Imagem vazia.')
    if (data.byteLength > MAX_IMAGE_BYTES) throw new FsError('EFBIG', 'A imagem é grande demais (máximo de 40 MB).')
    return this.writeNewAttachment(`imagem-${fileStamp()}`, extension, data)
  }

  /** Copia uma imagem do workspace para outro caminho dele (substitui o destino). */
  async copyImage(from: unknown, to: unknown): Promise<FileEntry> {
    if (typeof from !== 'string' || !IMAGE_FILE.test(from) || typeof to !== 'string' || !IMAGE_FILE.test(to)) throw new FsError('EINVAL', 'Imagem inválida.')
    const source = this.resolve(from)
    const target = this.resolve(to)
    if (source === target) return this.entry(target, false)
    const data = await this.readBytes(from)
    if (!data) throw new FsError('ENOENT', 'A imagem não existe mais.')
    if (data.byteLength > MAX_IMAGE_BYTES) throw new FsError('EFBIG', 'A imagem é grande demais (máximo de 40 MB).')
    if (source.toLowerCase() === target.toLowerCase()) {
      // Mesmo arquivo com outras maiúsculas: só renomeia
      await this.rename(from, to)
      return this.entry(target, false)
    }
    return this.writeBytes(to, data)
  }
}
