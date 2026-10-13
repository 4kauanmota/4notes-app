// Publica uma versão nova do 4notes no GitHub Releases — os apps instalados (Windows e
// Android) encontram a versão ao abrir e perguntam se você quer instalar.
//
//   npm run release                         → Windows + Android
//   npm run release -- --windows            → só o Windows
//   npm run release -- --android            → só o Android
//   npm run release -- --notes "O que mudou"   (ou --notes-file arquivo.md; sem nada,
//                                               usa o release-notes.md, se existir)
//   npm run release -- --draft              → deixa como rascunho (os apps não veem)
//   npm run release -- --skip-build         → usa os arquivos já gerados em release/
//
// Antes (uma vez só — veja o README, "Atualizações automáticas"):
//   - package.json → "updates": { "github": "seu-usuario/seu-repositorio" } (repositório PÚBLICO);
//   - um token do GitHub no arquivo .env da raiz:  GH_TOKEN=github_pat_…
//   - para o Android, a chave de assinatura em android/keystore.properties.
//
// O que ele faz: confere tudo, gera o instalador do Windows (npm run dist:win) e o APK
// (npm run build:android), cria o Release "v<versão>" como rascunho, envia os arquivos
// (instalador, latest.yml e APK) e só então publica — os apps nunca veem uma versão pela metade.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { latestYml, parseEnv, parseReleaseArgs, parseRepository, sha512Base64 } from './release-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const tag = `v${version}`
const options = parseReleaseArgs(process.argv.slice(2))

function fail(message, hint) {
  console.error(`\n✖ ${message}`)
  if (hint) console.error(`  ${hint.replace(/\n/g, '\n  ')}`)
  console.error('')
  process.exit(1)
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: isWindows })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} terminou com erro (${code}).`))))
  })
}

// ── Configuração ────────────────────────────────────────────────────────────

const repository = parseRepository(pkg.updates?.github)
if (!repository) {
  fail(
    'Falta o repositório das versões no package.json.',
    'Preencha "updates": { "github": "seu-usuario/seu-repositorio" } (o repositório precisa ser público).',
  )
}
const repoLabel = `${repository.owner}/${repository.repo}`

const envFile = path.join(root, '.env')
const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}
const token = env.GH_TOKEN || env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (!token) {
  fail(
    'Falta o token do GitHub.',
    'Crie o arquivo .env na raiz do projeto com a linha:\n  GH_TOKEN=github_pat_...\n(o .env não vai para o Git). Veja o README, "Atualizações automáticas".',
  )
}

const keystore = path.join(root, 'android', 'keystore.properties')
if (options.android && !existsSync(keystore) && !options.allowDebugKey) {
  fail(
    'Falta a chave de assinatura do Android (android/keystore.properties).',
    'O Android só atualiza um app com um APK assinado pela MESMA chave. Crie a chave uma vez (README, "Atualizações automáticas")\nou rode com --allow-debug-key para usar a chave de testes deste computador (só funciona enquanto você gerar sempre neste PC).',
  )
}

let notes = options.notes
if (!notes) {
  const file = options.notesFile ? path.resolve(root, options.notesFile) : path.join(root, 'release-notes.md')
  if (existsSync(file)) notes = readFileSync(file, 'utf8').trim()
  else if (options.notesFile) fail(`Não encontrei o arquivo de notas: ${options.notesFile}`)
}
notes = notes || `4notes ${version}`

// ── GitHub ──────────────────────────────────────────────────────────────────

const API = `https://api.github.com/repos/${repository.owner}/${repository.repo}`
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': '4notes-release',
}

async function github(method, url, body) {
  const response = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    method,
    headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: response.status, ok: response.ok, data }
}

async function checkRepository() {
  console.log(`\n▸ Conferindo o repositório ${repoLabel}…`)
  const repo = await github('GET', '')
  if (repo.status === 401) fail('O GitHub recusou o token (401).', 'Confira o GH_TOKEN no .env (ele pode ter expirado).')
  if (repo.status === 404)
    fail(`Não encontrei o repositório ${repoLabel}.`, 'Confira o nome no package.json e se o token tem acesso a ele.')
  if (!repo.ok) fail(`O GitHub respondeu ${repo.status} ao ler o repositório.`, JSON.stringify(repo.data).slice(0, 300))
  if (repo.data.private) {
    fail(
      `O repositório ${repoLabel} é privado — o app instalado não consegue ler as versões.`,
      'Use um repositório público só para os instaladores (ex.: 4notes-releases); o código pode continuar num repositório privado.',
    )
  }
  const commits = await github('GET', '/commits?per_page=1')
  if (commits.status === 409)
    fail(
      `O repositório ${repoLabel} está vazio.`,
      'No GitHub, adicione um README (ou qualquer arquivo) — o Release precisa de um commit para criar a tag.',
    )
  const releases = await github('GET', '/releases?per_page=50')
  if (!releases.ok)
    fail(
      `Não consegui listar os Releases (${releases.status}).`,
      'O token precisa da permissão "Contents: Read and write" nesse repositório.',
    )
  const same = releases.data.find((release) => release.tag_name === tag)
  // Já publicada: só dá para acrescentar a plataforma que faltou (ex.: o APK depois do Windows)
  if (same && !same.draft && (same.assets ?? []).some((asset) => expectedNames().includes(asset.name))) {
    fail(
      `A versão ${version} já está publicada em ${repoLabel}.`,
      'Aumente a versão no package.json ("version") antes de publicar de novo.',
    )
  }
  const newer = releases.data.find((release) => !release.draft && !release.prerelease && compare(release.tag_name, tag) > 0)
  if (newer) fail(`Já existe uma versão mais nova publicada (${newer.tag_name}).`, 'Aumente a versão no package.json.')
  return same ?? null
}

/** Arquivos que esta publicação envia. */
function expectedNames() {
  return [...(options.windows ? [`4notes-Setup-${version}.exe`, 'latest.yml'] : []), ...(options.android ? [`4notes-${version}.apk`] : [])]
}

function compare(a, b) {
  const parse = (value) => (/^v?(\d+)\.(\d+)\.(\d+)/.exec(value ?? '') ?? [0, 0, 0, 0]).slice(1).map(Number)
  const [x, y] = [parse(a), parse(b)]
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

async function upload(release, file, name) {
  const existing = (release.assets ?? []).find((asset) => asset.name === name)
  if (existing) await github('DELETE', `/releases/assets/${existing.id}`)
  const data = readFileSync(file)
  process.stdout.write(`  ↑ ${name} (${(data.length / 1024 / 1024).toFixed(1)} MB)… `)
  const url = `https://uploads.github.com/repos/${repository.owner}/${repository.repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) },
    body: data,
  })
  if (!response.ok) {
    console.log('falhou')
    fail(`Não consegui enviar ${name} (${response.status}).`, (await response.text()).slice(0, 300))
  }
  console.log('ok')
}

// ── Build ───────────────────────────────────────────────────────────────────

/** Instalador do Windows + latest.yml (o que o electron-updater lê). */
async function buildWindows() {
  if (!options.skipBuild) {
    console.log('\n▸ Gerando o instalador do Windows (npm run dist:win)…')
    await run('npm', ['run', 'dist:win'])
  }
  const dir = path.join(root, 'release', version)
  const exeName = `4notes-Setup-${version}.exe`
  const exe = path.join(dir, exeName)
  if (!existsSync(exe))
    fail(`Não encontrei o instalador ${path.relative(root, exe)}.`, 'Gere com "npm run dist:win" (no Windows) ou rode sem --skip-build.')
  const data = readFileSync(exe)
  const yml = path.join(dir, 'latest.yml')
  writeFileSync(
    yml,
    latestYml({ version, fileName: exeName, sha512: sha512Base64(data), size: data.length, releaseDate: new Date().toISOString() }),
  )
  const files = [
    { file: exe, name: exeName },
    { file: yml, name: 'latest.yml' },
  ]
  const blockmap = `${exe}.blockmap`
  if (existsSync(blockmap)) files.push({ file: blockmap, name: `${exeName}.blockmap` })
  return files
}

async function buildAndroid() {
  if (!options.skipBuild) {
    console.log('\n▸ Gerando o APK do Android (npm run build:android)…')
    await run('npm', ['run', 'build:android'])
  }
  const name = `4notes-${version}.apk`
  const apk = path.join(root, 'release', 'android', name)
  if (!existsSync(apk) || statSync(apk).size === 0)
    fail(`Não encontrei o APK ${path.relative(root, apk)}.`, 'Gere com "npm run build:android" ou rode sem --skip-build.')
  return [{ file: apk, name }]
}

// ── Publicar ────────────────────────────────────────────────────────────────

async function main() {
  const targets = [options.windows && 'Windows', options.android && 'Android'].filter(Boolean).join(' + ')
  console.log(`\n4notes ${version} → ${repoLabel} (${targets})`)
  let release = await checkRepository()

  const files = []
  if (options.windows) files.push(...(await buildWindows()))
  if (options.android) files.push(...(await buildAndroid()))

  console.log(`\n▸ Enviando para o GitHub (${tag})…`)
  if (!release) {
    const created = await github('POST', '/releases', {
      tag_name: tag,
      name: `4notes ${version}`,
      body: notes,
      draft: true,
      prerelease: false,
    })
    if (!created.ok) fail(`Não consegui criar o Release (${created.status}).`, JSON.stringify(created.data).slice(0, 300))
    release = created.data
  } else if (release.draft || options.notes || options.notesFile) {
    // (numa versão já publicada, as notas só mudam se você passar outras)
    await github('PATCH', `/releases/${release.id}`, { body: notes, name: `4notes ${version}` })
  }
  for (const item of files) await upload(release, item.file, item.name)

  if (!release.draft) {
    console.log(`\n✔ Arquivos acrescentados à versão ${version}: ${release.html_url}\n`)
    return
  }
  if (options.draft) {
    console.log(`\n✔ Rascunho pronto: ${release.html_url}`)
    console.log('  Os apps só veem a versão depois de você publicar o rascunho no GitHub.\n')
    return
  }
  const published = await github('PATCH', `/releases/${release.id}`, { draft: false, make_latest: 'true' })
  if (!published.ok)
    fail(`Os arquivos foram enviados, mas não consegui publicar (${published.status}).`, `Publique o rascunho em ${release.html_url}`)
  console.log(`\n✔ Versão ${version} publicada: ${published.data.html_url}`)
  console.log('  Ao abrir, o 4notes (Windows e Android) vai perguntar se você quer instalar.\n')
}

main().catch((error) => fail(error.message))
