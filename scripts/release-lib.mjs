// Partes do `npm run release` que não dependem de rede nem de build (testadas em
// tests/updates.test.ts).
import { createHash } from 'node:crypto'

/** Lê um arquivo .env simples (CHAVE=valor, # comentários, aspas opcionais). */
export function parseEnv(text) {
  const values = {}
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[match[1]] = value
  }
  return values
}

/** SHA-512 em base64 (o formato do latest.yml do electron-updater). */
export function sha512Base64(buffer) {
  return createHash('sha512').update(buffer).digest('base64')
}

/**
 * O latest.yml que o electron-updater lê para saber a versão nova do Windows e conferir o
 * instalador baixado (nome, tamanho e SHA-512).
 */
export function latestYml({ version, fileName, sha512, size, releaseDate }) {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${fileName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${fileName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n')
}

/** Argumentos do `npm run release -- …`. */
export function parseReleaseArgs(argv) {
  const options = { windows: true, android: true, draft: false, allowDebugKey: false, notes: null, notesFile: null, skipBuild: false }
  const onlyWindows = argv.includes('--windows')
  const onlyAndroid = argv.includes('--android')
  if (onlyWindows && !onlyAndroid) options.android = false
  if (onlyAndroid && !onlyWindows) options.windows = false
  options.draft = argv.includes('--draft')
  options.allowDebugKey = argv.includes('--allow-debug-key')
  options.skipBuild = argv.includes('--skip-build')
  const notesAt = argv.indexOf('--notes')
  if (notesAt >= 0 && argv[notesAt + 1] !== undefined) options.notes = argv[notesAt + 1]
  const fileAt = argv.indexOf('--notes-file')
  if (fileAt >= 0 && argv[fileAt + 1] !== undefined) options.notesFile = argv[fileAt + 1]
  return options
}

/** "usuario/repositorio" (a mesma regra de shared/updates.ts → parseRepository). */
export function parseRepository(value) {
  if (typeof value !== 'string') return null
  const text = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^github:/i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  const match = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(text)
  return match ? { owner: match[1], repo: match[2] } : null
}
