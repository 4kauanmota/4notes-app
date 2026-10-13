/**
 * Atualizações no Android pelo GitHub Releases.
 *
 * - Procurar: o Release mais recente do repositório (api.github.com …/releases/latest);
 *   vale se a tag ("v1.6.2") for mais nova que o app e o Release tiver o APK.
 * - Instalar: o plugin nativo (UpdaterPlugin.java) baixa o APK para o cache do app, com o
 *   andamento, e abre o instalador do Android. Na primeira vez o Android pede que você
 *   permita o 4notes instalar apps ("permission"); ao voltar, o app tenta de novo.
 *   O APK novo precisa ser assinado com a mesma chave do instalado (android/keystore.properties).
 */
import { CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { FourNotesApi } from '#shared/ipc'
import { apkAsset, parseRepository, updateFromRelease, type GithubRelease, type UpdateCheck } from '#shared/updates'

export interface UpdaterNative {
  /** Baixa o APK para o cache do app ("downloadProgress" avisa o andamento). */
  download(options: { url: string; fileName: string }): Promise<{ path: string }>
  /** Abre o instalador do Android ("permission": abriu a tela para permitir instalar apps). */
  install(options: { path: string }): Promise<{ status: 'installing' | 'permission' }>
  addListener(event: 'downloadProgress', handler: (data: { percent: number }) => void): Promise<PluginListenerHandle>
}

/** O plugin de verdade (só existe dentro do app Android). */
export const UpdaterNativePlugin = registerPlugin<UpdaterNative>('FourNotesUpdater')

/** Para os testes (navegador): finge o download e o instalador. */
export function fakeUpdater(): UpdaterNative & { downloads: string[]; installs: string[]; needsPermission: boolean } {
  let listener: ((data: { percent: number }) => void) | null = null
  const fake = {
    downloads: [] as string[],
    installs: [] as string[],
    needsPermission: false,
    async download({ url, fileName }: { url: string; fileName: string }) {
      fake.downloads.push(url)
      listener?.({ percent: 40 })
      listener?.({ percent: 100 })
      return { path: `/cache/updates/${fileName}` }
    },
    async install({ path }: { path: string }) {
      fake.installs.push(path)
      if (fake.needsPermission) {
        fake.needsPermission = false
        return { status: 'permission' as const }
      }
      return { status: 'installing' as const }
    },
    async addListener(_event: 'downloadProgress', handler: (data: { percent: number }) => void) {
      listener = handler
      return { remove: async () => void (listener = null) }
    },
  }
  return fake
}

export interface MobileUpdatesOptions {
  /** "usuario/repositorio" (package.json → "updates"."github"). */
  repository: string
  /** Versão instalada. */
  version: string
  native: UpdaterNative
  /** Testes: busca com o fetch do navegador (dá para simular a resposta). */
  test?: boolean
}

export function createMobileUpdates(options: MobileUpdatesOptions): NonNullable<FourNotesApi['updates']> {
  const repository = parseRepository(options.repository)
  const label = repository ? `${repository.owner}/${repository.repo}` : ''
  let found: { version: string; url: string; name: string } | null = null
  let downloaded: { version: string; path: string } | null = null
  let progress: ((percent: number) => void) | null = null
  let listening = false

  async function latestRelease(): Promise<{ status: number; data: unknown }> {
    const url = `https://api.github.com/repos/${repository!.owner}/${repository!.repo}/releases/latest`
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    if (options.test) {
      const response = await fetch(url, { headers })
      return { status: response.status, data: response.ok ? await response.json() : null }
    }
    const response = await CapacitorHttp.request({
      url,
      method: 'GET',
      headers: { ...headers, 'User-Agent': '4notes' },
      connectTimeout: 15_000,
      readTimeout: 15_000,
    })
    const data = typeof response.data === 'string' ? JSON.parse(response.data || 'null') : response.data
    return { status: response.status, data }
  }

  async function check(): Promise<UpdateCheck> {
    if (!repository) return { status: 'unsupported', reason: 'not-configured' }
    let response: { status: number; data: unknown }
    try {
      response = await latestRelease()
    } catch {
      return { status: 'error', message: 'Sem conexão com a internet (ou o GitHub não respondeu).' }
    }
    if (response.status === 404) {
      return {
        status: 'error',
        message: `Nenhuma versão publicada em ${label} (o repositório precisa existir, ser público e ter uma versão publicada).`,
      }
    }
    if (response.status === 403 || response.status === 429)
      return { status: 'error', message: 'O GitHub pediu para esperar um pouco. Tente de novo mais tarde.' }
    if (response.status < 200 || response.status >= 300 || !response.data)
      return { status: 'error', message: `O GitHub respondeu com erro (${response.status}).` }
    const release = response.data as GithubRelease
    const update = updateFromRelease(release, options.version, 'apk')
    if (!update) {
      found = null
      return { status: 'latest' }
    }
    const apk = apkAsset(release)!
    found = { version: update.version, url: apk.url, name: apk.name }
    return { status: 'available', update }
  }

  return {
    check,
    async install() {
      if (!found) {
        const result = await check()
        if (result.status === 'error') throw new Error(result.message)
        if (!found) throw new Error('Não há uma versão nova para instalar.')
      }
      const target = found
      if (!listening) {
        listening = true
        await options.native.addListener('downloadProgress', ({ percent }) => progress?.(percent)).catch(() => undefined)
      }
      if (downloaded?.version !== target.version) {
        try {
          const { path } = await options.native.download({ url: target.url, fileName: target.name })
          downloaded = { version: target.version, path }
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Não foi possível baixar a atualização.')
        }
      }
      progress?.(100)
      const { status } = await options.native.install({ path: downloaded!.path })
      return status
    },
    onProgress(handler) {
      progress = handler
    },
  }
}
