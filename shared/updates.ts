/**
 * Atualizações pelo GitHub Releases — regras e tipos usados pelos dois lados (Electron
 * e interface/Android). Sem Node.js e sem Vue.
 *
 * O repositório fica no package.json ("updates": { "github": "usuario/repositorio" }).
 * Cada versão publicada (npm run release) é um Release do GitHub com a tag "v<versão>"
 * e os arquivos:
 *   4notes-Setup-<versão>.exe (+ .blockmap) e latest.yml  → Windows (electron-updater)
 *   4notes-<versão>.apk                                    → Android
 */

/** Uma versão nova disponível. */
export interface UpdateInfo {
  version: string
  /** Notas da versão (texto do Release, em Markdown). */
  notes: string
  /** Data de publicação (ISO) ou null. */
  date: string | null
}

export type UpdateCheck =
  | { status: 'available'; update: UpdateInfo }
  | { status: 'latest' }
  /** dev: rodando sem instalar (npm run dev); not-configured: sem repositório no package.json. */
  | { status: 'unsupported'; reason: 'dev' | 'not-configured' }
  | { status: 'error'; message: string }

/**
 * Resultado de instalar: "installing" — o Windows fecha o 4notes, instala e abre de novo;
 * no Android, o instalador do sistema abriu. "permission" — o Android precisa que você
 * permita o 4notes instalar apps (a tela de permissão abriu).
 */
export type UpdateInstallResult = 'installing' | 'permission'

/** "usuario/repositorio" (ou um endereço do GitHub) → dono e repositório; null se não serve. */
export function parseRepository(value: unknown): { owner: string; repo: string } | null {
  if (typeof value !== 'string') return null
  const text = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^github:/i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  const match = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(text)
  return match ? { owner: match[1]!, repo: match[2]! } : null
}

/** "v1.6.2" / "1.6.2" → [1, 6, 2]; null se não é uma versão. */
export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** > 0 quando `a` é mais nova que `b`; 0 iguais; < 0 mais antiga. Versões inválidas contam como 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) ?? [0, 0, 0]
  const y = parseVersion(b) ?? [0, 0, 0]
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/** O que importa de um Release do GitHub (api.github.com/repos/…/releases/latest). */
export interface GithubRelease {
  tag_name?: string
  name?: string | null
  body?: string | null
  draft?: boolean
  prerelease?: boolean
  published_at?: string | null
  assets?: { name?: string; browser_download_url?: string; size?: number }[]
}

/** O APK de um Release (o arquivo .apk; com mais de um, o que tem "4notes" no nome). */
export function apkAsset(release: GithubRelease): { url: string; name: string; size: number } | null {
  const apks = (release.assets ?? []).filter((asset) => /\.apk$/i.test(asset.name ?? '') && asset.browser_download_url)
  const asset = apks.find((item) => /4notes/i.test(item.name ?? '')) ?? apks[0]
  return asset ? { url: asset.browser_download_url!, name: asset.name!, size: asset.size ?? 0 } : null
}

/**
 * Release → versão disponível (null: rascunho, pré-lançamento, sem versão na tag, não é
 * mais nova que `current` ou não tem o arquivo `needs` — "apk" no Android).
 */
export function updateFromRelease(release: GithubRelease, current: string, needs?: 'apk'): UpdateInfo | null {
  if (release.draft || release.prerelease) return null
  const tag = release.tag_name ?? ''
  if (!parseVersion(tag)) return null
  const version = tag.replace(/^v/, '')
  if (compareVersions(version, current) <= 0) return null
  if (needs === 'apk' && !apkAsset(release)) return null
  return { version, notes: (release.body ?? '').trim(), date: release.published_at ?? null }
}

/** Notas da versão em texto curto (para o aviso): sem marcação de Markdown, até `max` caracteres. */
export function notesSummary(notes: string, max = 280): string {
  const text = notes
    .replace(/\r/g, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^\s*[-*+]\s+/, '• ')
        .replace(/\*\*|__|`/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}
