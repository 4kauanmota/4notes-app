/**
 * A API do 4notes no Android: o mesmo contrato (`FourNotesApi`, shared/ipc.ts) que o
 * preload do Electron oferece no computador — então a interface inteira (stores,
 * módulos, editor) é a mesma nas duas plataformas.
 *
 * O que muda aqui:
 *  - arquivos: plugin @capacitor/filesystem (lib/mobile/fs.ts), com as mesmas regras
 *    do desktop (lib/mobile/workspace.ts, shared/files.ts, shared/library.ts);
 *  - escolher pastas: o seletor do próprio 4notes (useFolderPicker), depois de pedir o
 *    "Acesso a todos os arquivos";
 *  - escolher arquivos: o seletor do Android (lib/mobile/pick-files.ts);
 *  - título/ícone dos links: buscados pelo Android (CapacitorHttp), sem as limitações
 *    de um site; as regras são as de shared/link-meta.ts;
 *  - PDF: a impressão do Android ("Salvar como PDF"); TXT: na pasta que você escolher;
 *  - o que não existe no celular (Explorador, iniciar com o sistema, favoritos dos
 *    navegadores instalados) aparece em `capabilities` e a interface esconde.
 */
import { App } from '@capacitor/app'
import { Capacitor, CapacitorHttp, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { countLinks, parseBookmarksHtml } from '#shared/bookmarks'
import { base64ToBytes, bytesToBase64, decodeDataUrl, exportFileName, extensionOf, IMAGE_EXTENSIONS, inlineWorkspaceImages, MAX_IMAGE_BYTES } from '#shared/files'
import {
  PICKABLE_IMAGE_EXTENSIONS,
  setWorkspaceFileUrlBase,
  workspaceFileUrlBase,
  type BootstrapInfo,
  type DataDirStatus,
  type FourNotesApi,
  type LaunchAtLogin,
  type ThemePreference,
} from '#shared/ipc'
import * as library from '#shared/library'
import { fetchLinkMetaWith, iconFileBase, sniffImage, validLinkUrl, type Fetched, type IconFormat } from '#shared/link-meta'
import { confirmDialog } from '~/composables/useDialog'
import { pickFolder } from '~/composables/useFolderPicker'
import { readLocalValue, writeLocalValue } from '~/lib/storage/device-state'
import { createWorkspace, copyDataDir, dataDirStatus, inspectFolder, prepareDataDir } from './data-dir'
import { cleanPath, dirnameFs, FsError, isInside, joinFs, type FsDriver } from './fs'
import type { FourNotesNative } from './native'
import { createMobileBank } from './bank'
import { createMobileUpdates, type UpdaterNative } from './updates'
import { pickFiles } from './pick-files'
import { WorkspaceFiles } from './workspace'

export interface MobileOptions {
  fs: FsDriver
  native: FourNotesNative
  version: string
  /** Testes automatizados (no navegador, com o disco na memória). */
  test?: boolean
  /** Atualizações pelo GitHub Releases: o plugin que baixa e instala o APK e o repositório. */
  updater?: UpdaterNative
  updatesRepository?: string
  fakeToday?: string | null
}

const LINK_ICONS_DIR = 'links/icons'
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; 4notes) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const ROOT_LABEL = 'Armazenamento interno'

const isTheme = (value: unknown): value is ThemePreference => value === 'system' || value === 'light' || value === 'dark'

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

/** Cabeçalho HTTP sem diferenciar maiúsculas. */
function header(headers: Record<string, string> | undefined, name: string): string {
  const key = Object.keys(headers ?? {}).find((item) => item.toLowerCase() === name)
  return key ? String(headers![key]) : ''
}

export async function createMobileApi(options: MobileOptions): Promise<FourNotesApi> {
  const { fs, native } = options
  const storage = await native.storageInfo().catch(() => ({ root: fs.root, granted: false }))
  const root = cleanPath(storage.root || fs.root)
  let granted = storage.granted

  // ── Workspace ──
  const savedPath = readLocalValue('dataDir')
  let dataDirPath: string | null = savedPath && isInside(root, savedPath) ? cleanPath(savedPath) : null

  async function status(): Promise<DataDirStatus> {
    if (dataDirPath && !granted) return { path: dataDirPath, ready: false, problem: 'no-permission' }
    return dataDirStatus(fs, dataDirPath)
  }

  let current = await status()
  let workspace = current.ready && current.path ? new WorkspaceFiles(fs, current.path) : null

  function requireWorkspace(): WorkspaceFiles {
    if (!workspace) throw new FsError('ENODATA', 'Nenhuma pasta de dados configurada.')
    return workspace
  }

  function remember(path: string, next: DataDirStatus) {
    dataDirPath = path
    writeLocalValue('dataDir', path)
    current = next
    workspace = next.ready ? new WorkspaceFiles(fs, path) : null
  }

  // Imagens do workspace: servidas pelo próprio app (o servidor local do Capacitor)
  if (!options.test && current.path) {
    const base = Capacitor.convertFileSrc('/').replace(/\/+$/, '')
    setWorkspaceFileUrlBase(`${base}${current.path.split('/').map(encodeURIComponent).join('/')}/`)
  }

  /** Pede o "Acesso a todos os arquivos" (explica antes de abrir a tela do Android). */
  async function ensureAccess(): Promise<boolean> {
    if (granted) return true
    granted = (await native.storageInfo().catch(() => storage)).granted
    if (granted) return true
    const ok = await confirmDialog({
      title: 'Permitir acesso aos arquivos',
      message:
        'Para guardar o workspace numa pasta do celular que você escolher (e que o Google Drive, o Autosync ou o FolderSync podem sincronizar), o 4notes precisa do “Acesso a todos os arquivos”. Na tela seguinte, ative a opção para o 4notes e volte para o app.',
      confirmLabel: 'Continuar',
      icon: 'folder',
    })
    if (!ok) return false
    granted = (await native.requestStorageAccess().catch(() => ({ granted: false }))).granted
    return granted
  }

  async function listFolders(path: string): Promise<string[]> {
    return (await fs.readdir(path)).filter((entry) => entry.type === 'directory').map((entry) => entry.name)
  }

  async function createFolder(path: string, name: string): Promise<string> {
    const target = joinFs(path, name.trim())
    if (await fs.stat(target)) throw new FsError('EEXIST', 'Já existe uma pasta com esse nome aqui.')
    await fs.mkdir(target)
    return target
  }

  async function chooseFolder(title: string, buttonLabel: string, start: string | null): Promise<string | null> {
    return pickFolder({ title, buttonLabel, root, rootLabel: ROOT_LABEL, start, list: listFolders, create: createFolder })
  }

  // ── Biblioteca de imagens ──
  const libraryIo = (): library.LibraryIo => {
    const ws = requireWorkspace()
    return {
      list: (dir, listOptions) => ws.list(dir, listOptions),
      async readJson(path) {
        try {
          const text = await ws.read(path)
          return text === null ? null : JSON.parse(text)
        } catch {
          return null
        }
      },
      async stat(path) {
        const info = await fs.stat(ws.resolve(path)).catch(() => null)
        return info?.type === 'file' ? { size: info.size, mtimeMs: info.mtimeMs } : null
      },
      readBytes: (path) => ws.readBytes(path).catch(() => null),
      sha1: async (data) => hex(await crypto.subtle.digest('SHA-1', data as Uint8Array<ArrayBuffer>)),
      writeNew: (base, extension, data) => ws.writeNewAttachment(base, extension, data),
      trash: (path) => ws.trash(path),
    }
  }

  // ── Links: título e ícone dos sites ──
  async function fetchLimited(url: string, accept: string, limit: number, timeout: number): Promise<Fetched | null> {
    if (options.test) return null
    let address = url
    try {
      for (let hop = 0; hop < 6; hop++) {
        const response = await CapacitorHttp.request({
          url: address,
          method: 'GET',
          headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' },
          responseType: 'arraybuffer',
          connectTimeout: timeout,
          readTimeout: timeout,
          // Os redirecionamentos são seguidos aqui (o Android não segue de http para https)
          disableRedirects: true,
        })
        if (response.status >= 300 && response.status < 400) {
          const location = header(response.headers, 'location')
          if (!location) return null
          address = new URL(location, address).href
          continue
        }
        if (response.status < 200 || response.status >= 300 || typeof response.data !== 'string') return null
        const body = base64ToBytes(response.data)
        return { url: address, contentType: header(response.headers, 'content-type').toLowerCase(), body: body.subarray(0, limit) }
      }
    } catch {
      // sem internet, site fora do ar, tempo esgotado
    }
    return null
  }

  async function writeIcon(host: string, data: Uint8Array, format: IconFormat): Promise<string> {
    const ws = requireWorkspace()
    const base = iconFileBase(host)
    const name = `${base}.${format}`
    await ws.writeBytes(`${LINK_ICONS_DIR}/${name}`, data)
    // O ícone anterior do site, com outra extensão, sai
    const others = (await fs.readdir(ws.resolve(LINK_ICONS_DIR)).catch(() => [])).filter(
      (entry) => entry.name !== name && entry.name.toLowerCase().startsWith(`${base}.`) && /^[a-z]+$/.test(entry.name.slice(base.length + 1)),
    )
    for (const entry of others) await fs.remove(ws.resolve(`${LINK_ICONS_DIR}/${entry.name}`)).catch(() => undefined)
    return name
  }

  // ── Exportar ──
  let lastExportDir: string | null = null

  async function defaultExportDir(): Promise<string> {
    if (lastExportDir && (await fs.stat(lastExportDir))?.type === 'directory') return lastExportDir
    const downloads = joinFs(root, 'Download')
    return (await fs.stat(downloads))?.type === 'directory' ? downloads : root
  }

  // ── Barras do sistema acompanham o tema ──
  function setBarsFor(color: string) {
    if (options.test || !/^#[0-9a-f]{6}$/i.test(color)) return
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number]
    const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5
    void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined)
  }

  const savedTheme = readLocalValue('theme')
  const notSupported = () => Promise.reject(new FsError('ENOTSUP', 'Não disponível no celular.'))
  const noLaunch: LaunchAtLogin = { supported: false, enabled: false, reason: 'platform' }

  const bootstrap: BootstrapInfo = {
    appVersion: options.version,
    platform: 'android',
    isDev: false,
    settings: { theme: isTheme(savedTheme) ? savedTheme : 'system' },
    dataDir: current,
    fakeToday: options.fakeToday ?? null,
    testMode: options.test === true,
    capabilities: { reveal: false, launchAtLogin: false, browserBookmarks: false, window: false, systemTrash: false },
  }

  return {
    bootstrap,
    bank: createMobileBank({ test: options.test }),
    updates: options.updater
      ? createMobileUpdates({ repository: options.updatesRepository ?? '', version: options.version, native: options.updater, test: options.test })
      : undefined,
    app: {
      ready: () => undefined,
      onBeforeClose(handler) {
        // No celular não há "fechar": salva quando o app vai para o fundo
        if (!options.test) void App.addListener('pause', () => void handler())
      },
      onResume(handler) {
        if (!options.test) void App.addListener('resume', () => handler())
      },
    },
    settings: {
      async setTheme(theme) {
        if (isTheme(theme)) writeLocalValue('theme', theme)
      },
    },
    dataDir: {
      status: async () => (current = await status()),
      async pick(labels) {
        if (!(await ensureAccess())) return null
        const start = current.path ? dirnameFs(current.path) : null
        return chooseFolder(labels?.title ?? 'Escolha a pasta do workspace', labels?.buttonLabel ?? 'Selecionar pasta', start)
      },
      inspect: (path) => inspectFolder(fs, path),
      async use(path, useOptions = {}) {
        const next = cleanPath(path)
        if (!isInside(root, next)) throw new FsError('EACCES', 'Escolha uma pasta do armazenamento interno.')
        await fs.mkdir(next)
        if (useOptions.copyFromCurrent && current.ready && current.path && current.path.toLowerCase() !== next.toLowerCase()) {
          await copyDataDir(fs, current.path, next)
        }
        await prepareDataDir(fs, next)
        const result = await dataDirStatus(fs, next)
        if (!result.ready) throw new FsError('EACCES', 'Não foi possível gravar nessa pasta.')
        remember(next, result)
        return result
      },
      async create(parent, name) {
        const target = await createWorkspace(fs, cleanPath(parent), name)
        const result = await dataDirStatus(fs, target)
        if (!result.ready) throw new FsError('EACCES', 'Não foi possível gravar nessa pasta.')
        remember(target, result)
        return result
      },
      reveal: notSupported,
      async requestAccess() {
        granted = (await native.requestStorageAccess().catch(() => ({ granted: false }))).granted
        return granted
      },
    },
    // (async: sem workspace, o erro chega como uma Promise rejeitada — igual ao desktop)
    files: {
      list: async (dir, listOptions) => requireWorkspace().list(dir, listOptions),
      read: async (path) => requireWorkspace().read(path),
      write: async (path, content) => requireWorkspace().write(path, content),
      rename: async (from, to) => requireWorkspace().rename(from, to),
      exists: async (path) => requireWorkspace().exists(path),
      trash: async (path) => requireWorkspace().trash(path),
      reveal: notSupported,
      mkdir: async (dir) => requireWorkspace().mkdir(dir),
    },
    images: {
      copy: async (from, to) => requireWorkspace().copyImage(from, to),
    },
    attachments: {
      saveImage: async (data, mime) => requireWorkspace().saveImage(data, mime),
    },
    library: {
      list: async () => library.listLibrary(libraryIo()),
      async upload() {
        const io = libraryIo()
        const files = await pickFiles({ accept: 'image/*', multiple: true })
        const accepted = (PICKABLE_IMAGE_EXTENSIONS as readonly string[])
        const images = files.flatMap((file) => {
          const extension = extensionOf(file.name)
          if (accepted.includes(extension)) return [{ file, name: file.name }]
          const fromType = IMAGE_EXTENSIONS[file.type.toLowerCase()]
          return fromType ? [{ file, name: `${file.name || 'imagem'}.${fromType}` }] : []
        })
        if (!images.length && files.length) throw new FsError('EINVAL', 'Escolha arquivos de imagem.')
        const big = images.find(({ file }) => file.size > MAX_IMAGE_BYTES)
        if (big) throw new FsError('EFBIG', `A imagem “${big.name}” é grande demais (máximo de 40 MB).`)
        const stored: string[] = []
        for (const { file, name } of images) {
          const data = new Uint8Array(await file.arrayBuffer())
          if (!data.byteLength) continue
          const saved = await library.storeInLibrary(io, name, data)
          if (!stored.includes(saved)) stored.push(saved)
        }
        return stored
      },
      adopt: async (path) => library.adoptIntoLibrary(libraryIo(), path),
      remove: async (path) => library.removeFromLibrary(libraryIo(), path),
    },
    exports: {
      async saveText(name, text) {
        if (typeof text !== 'string') throw new FsError('EINVAL', 'Texto inválido.')
        if (!(await ensureAccess())) return null
        const dir = await chooseFolder('Exportar nota como TXT', 'Salvar aqui', await defaultExportDir())
        if (!dir) return null
        const target = joinFs(dir, exportFileName(name, 'txt'))
        if (await fs.stat(target)) {
          const replace = await confirmDialog({ title: 'Exportar nota', message: `“${target.split('/').pop()}” já existe nessa pasta. Deseja substituir o arquivo?`, confirmLabel: 'Substituir', icon: 'export' })
          if (!replace) return null
        }
        await fs.writeText(target, text)
        lastExportDir = dir
        return target
      },
      async savePdf(name, html) {
        if (typeof html !== 'string') throw new FsError('EINVAL', 'Conteúdo inválido.')
        const ws = requireWorkspace()
        const page = await inlineWorkspaceImages(html, workspaceFileUrlBase(), async (path) => {
          const data = await ws.readBytes(path)
          return data && data.byteLength <= MAX_IMAGE_BYTES ? bytesToBase64(data) : null
        })
        // A impressão do Android cuida do resto (impressora "Salvar como PDF")
        await native.printHtml({ name: exportFileName(name, 'pdf').replace(/\.pdf$/, ''), html: page })
        return null
      },
      reveal: async () => undefined,
    },
    system: {
      launchAtLogin: async () => noLaunch,
      setLaunchAtLogin: async () => noLaunch,
    },
    links: {
      async fetchMeta(rawUrl, withIcon) {
        const url = validLinkUrl(rawUrl)
        if (!url) throw new FsError('EINVAL', 'Endereço inválido.')
        requireWorkspace()
        return fetchLinkMetaWith({ fetch: fetchLimited, writeIcon }, url, withIcon !== false)
      },
      async saveIcon(host, dataUrl) {
        if (typeof host !== 'string' || !host.trim() || typeof dataUrl !== 'string' || dataUrl.length > 2_000_000) return null
        const data = decodeDataUrl(dataUrl)
        const format = data ? sniffImage(data) : null
        return data && format ? writeIcon(host, data, format) : null
      },
      browsers: async () => [],
      readBrowser: notSupported,
      async pickBookmarksFile() {
        const [file] = await pickFiles({ accept: '.html,.htm,text/html' })
        if (!file) return null
        if (file.size > 50 * 1024 * 1024) throw new FsError('EFBIG', 'O arquivo é grande demais (máximo de 50 MB).')
        const roots = parseBookmarksHtml(await file.text())
        if (!countLinks(roots)) throw new FsError('EINVAL', 'Nenhum link encontrado nesse arquivo. Escolha o arquivo HTML exportado pelo navegador.')
        return roots
      },
    },
    window: {
      setTitleBarColors: ({ color }) => setBarsFor(color),
    },
    shell: {
      async openExternal(url) {
        if (typeof url !== 'string' || !/^(https?:|mailto:)/i.test(url)) throw new FsError('EINVAL', 'Link não permitido.')
        await native.openUrl({ url })
      },
    },
    menu: {
      // O menu de texto (copiar, colar, corretor) é o do próprio Android
      onTextMenu: () => undefined,
      runTextAction: async () => undefined,
    },
  }
}
