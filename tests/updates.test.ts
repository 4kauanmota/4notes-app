import { describe, expect, it } from 'vitest'
import {
  apkAsset,
  compareVersions,
  notesSummary,
  parseRepository,
  parseVersion,
  updateFromRelease,
  type GithubRelease,
} from '#shared/updates'
import { fakeUpdater, createMobileUpdates } from '~/lib/mobile/updates'
import * as releaseLib from '../scripts/release-lib.mjs'

describe('versões e repositório', () => {
  it('compara versões (com ou sem "v")', () => {
    expect(parseVersion('v1.6.2')).toEqual([1, 6, 2])
    expect(parseVersion('1.10.0-beta.1')).toEqual([1, 10, 0])
    expect(parseVersion('1.6')).toBeNull()
    expect(compareVersions('1.6.2', '1.6.1')).toBeGreaterThan(0)
    expect(compareVersions('v1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.6.1', 'v1.6.1')).toBe(0)
    expect(compareVersions('1.5.9', '1.6.0')).toBeLessThan(0)
  })

  it('aceita "usuario/repositorio" e endereços do GitHub', () => {
    expect(parseRepository('kauan/4notes-releases')).toEqual({ owner: 'kauan', repo: '4notes-releases' })
    expect(parseRepository(' https://github.com/kauan/4notes-releases.git/ ')).toEqual({ owner: 'kauan', repo: '4notes-releases' })
    expect(parseRepository('github:kauan/x')).toEqual({ owner: 'kauan', repo: 'x' })
    for (const bad of ['', 'kauan', 'kauan/x/y', 'ka uan/x', null, 3]) expect(parseRepository(bad)).toBeNull()
    // O script de publicação usa a mesma regra
    for (const value of ['kauan/4notes-releases', 'https://github.com/a/b', 'kauan', 'a/b/c']) {
      expect(releaseLib.parseRepository(value)).toEqual(parseRepository(value))
    }
  })
})

describe('Release do GitHub → versão disponível', () => {
  const release: GithubRelease = {
    tag_name: 'v1.6.2',
    body: '## Novidades\n- **Atualização** automática\n- [Docs](https://x.com)',
    published_at: '2026-10-13T12:00:00Z',
    assets: [
      {
        name: '4notes-Setup-1.6.2.exe',
        browser_download_url: 'https://github.com/a/b/releases/download/v1.6.2/4notes-Setup-1.6.2.exe',
        size: 90,
      },
      { name: '4notes-1.6.2.apk', browser_download_url: 'https://github.com/a/b/releases/download/v1.6.2/4notes-1.6.2.apk', size: 30 },
    ],
  }

  it('só oferece o que é mais novo, publicado e (no Android) com APK', () => {
    expect(updateFromRelease(release, '1.6.1')).toMatchObject({ version: '1.6.2', date: '2026-10-13T12:00:00Z' })
    expect(updateFromRelease(release, '1.6.2')).toBeNull()
    expect(updateFromRelease(release, '1.7.0')).toBeNull()
    expect(updateFromRelease({ ...release, draft: true }, '1.6.1')).toBeNull()
    expect(updateFromRelease({ ...release, prerelease: true }, '1.6.1')).toBeNull()
    expect(updateFromRelease({ ...release, tag_name: 'ultima' }, '1.6.1')).toBeNull()
    expect(updateFromRelease({ ...release, assets: release.assets!.slice(0, 1) }, '1.6.1', 'apk')).toBeNull()
    expect(apkAsset(release)).toEqual({ url: release.assets![1]!.browser_download_url, name: '4notes-1.6.2.apk', size: 30 })
  })

  it('resumo das notas sem Markdown', () => {
    expect(notesSummary(release.body!)).toBe('Novidades\n• Atualização automática\n• Docs')
    expect(notesSummary('x'.repeat(400), 50)).toHaveLength(50)
  })
})

describe('Android: procurar e instalar', () => {
  const ok = (data: unknown) => async () => new Response(JSON.stringify(data), { status: 200 })
  const release = {
    tag_name: 'v1.7.0',
    body: 'Novidades',
    assets: [
      { name: '4notes-1.7.0.apk', browser_download_url: 'https://github.com/a/b/releases/download/v1.7.0/4notes-1.7.0.apk', size: 10 },
    ],
  }

  it('sem repositório configurado: não procura', async () => {
    const updates = createMobileUpdates({ repository: '', version: '1.6.1', native: fakeUpdater(), test: true })
    expect(await updates.check()).toEqual({ status: 'unsupported', reason: 'not-configured' })
  })

  it('versão nova: baixa uma vez, pede a permissão e depois abre o instalador', async () => {
    const original = globalThis.fetch
    globalThis.fetch = ok(release) as typeof fetch
    try {
      const native = fakeUpdater()
      native.needsPermission = true
      const updates = createMobileUpdates({ repository: 'a/b', version: '1.6.1', native, test: true })
      const progress: number[] = []
      updates.onProgress((percent) => progress.push(percent))
      expect(await updates.check()).toMatchObject({ status: 'available', update: { version: '1.7.0' } })
      expect(await updates.install()).toBe('permission')
      expect(await updates.install()).toBe('installing')
      expect(native.downloads).toEqual([release.assets[0]!.browser_download_url])
      expect(native.installs).toEqual(['/cache/updates/4notes-1.7.0.apk', '/cache/updates/4notes-1.7.0.apk'])
      expect(progress).toContain(100)
    } finally {
      globalThis.fetch = original
    }
  })

  it('já está na mais nova, sem versão publicada ou sem internet', async () => {
    const original = globalThis.fetch
    try {
      globalThis.fetch = ok(release) as typeof fetch
      expect(await createMobileUpdates({ repository: 'a/b', version: '1.7.0', native: fakeUpdater(), test: true }).check()).toEqual({
        status: 'latest',
      })
      globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch
      const missing = await createMobileUpdates({ repository: 'a/b', version: '1.6.1', native: fakeUpdater(), test: true }).check()
      expect(missing).toMatchObject({ status: 'error' })
      expect((missing as { message: string }).message).toContain('a/b')
      globalThis.fetch = (async () => {
        throw new TypeError('Failed to fetch')
      }) as typeof fetch
      expect(await createMobileUpdates({ repository: 'a/b', version: '1.6.1', native: fakeUpdater(), test: true }).check()).toMatchObject({
        status: 'error',
        message: expect.stringContaining('internet'),
      })
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('npm run release', () => {
  it('lê o .env', () => {
    expect(releaseLib.parseEnv('# token\nGH_TOKEN="github_pat_123"\nexport OTHER = x \n\nbad line')).toEqual({
      GH_TOKEN: 'github_pat_123',
      OTHER: 'x',
    })
  })

  it('latest.yml no formato do electron-updater', () => {
    const sha = releaseLib.sha512Base64(Buffer.from('instalador'))
    const yml = releaseLib.latestYml({
      version: '1.6.2',
      fileName: '4notes-Setup-1.6.2.exe',
      sha512: sha,
      size: 10,
      releaseDate: '2026-10-13T12:00:00.000Z',
    })
    expect(yml).toBe(
      `version: 1.6.2\nfiles:\n  - url: 4notes-Setup-1.6.2.exe\n    sha512: ${sha}\n    size: 10\npath: 4notes-Setup-1.6.2.exe\nsha512: ${sha}\nreleaseDate: '2026-10-13T12:00:00.000Z'\n`,
    )
    expect(sha).toMatch(/^[A-Za-z0-9+/]{86}==$/)
  })

  it('opções', () => {
    expect(releaseLib.parseReleaseArgs([])).toMatchObject({ windows: true, android: true, draft: false })
    expect(releaseLib.parseReleaseArgs(['--windows'])).toMatchObject({ windows: true, android: false })
    expect(releaseLib.parseReleaseArgs(['--android', '--draft', '--notes', 'Oi'])).toMatchObject({
      windows: false,
      android: true,
      draft: true,
      notes: 'Oi',
    })
  })
})
