// App Android do 4notes (Capacitor) — usado pelos comandos do package.json:
//
//   npm run build:android   → gera o APK: release/android/4notes-<versão>.apk
//   npm run android:run     → gera e instala no celular conectado por USB (depuração USB ligada)
//   npm run android:sync    → só atualiza o projeto android/ com a interface (para abrir no Android Studio)
//   npm run android:open    → abre o projeto android/ no Android Studio
//
// Precisa do Android Studio instalado (ele traz o Java e o Android SDK). Este script
// encontra os dois nos lugares de instalação padrão, se o JAVA_HOME e o ANDROID_HOME
// não estiverem configurados.
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const androidDir = path.join(root, 'android')
const isWindows = process.platform === 'win32'
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: isWindows, ...options })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} terminou com erro (${code}).`))))
  })
}

const firstExisting = (paths) => paths.filter(Boolean).find((candidate) => existsSync(candidate)) ?? null

// O Gradle do projeto Android (8.14) só roda com o Java 17 a 24: um JDK mais novo (ex.:
// o 25 no JAVA_HOME) falha com "Unsupported class file major version 69".
const JAVA_MIN = 17
const JAVA_MAX = 24

/** Versão principal de um JDK (21, 25…) — pelo arquivo "release" dele ou por `java -version`. */
function javaMajor(home) {
  const parse = (text) => {
    const match = /(?:JAVA_VERSION=|version )"?(\d+)(?:\.(\d+))?/.exec(text ?? '')
    if (!match) return null
    const major = Number(match[1])
    return major === 1 ? Number(match[2]) : major // "1.8" → 8
  }
  try {
    const fromRelease = parse(readFileSync(path.join(home, 'release'), 'utf8'))
    if (fromRelease) return fromRelease
  } catch {
    // sem o arquivo "release": pergunta ao próprio java
  }
  const java = path.join(home, 'bin', isWindows ? 'java.exe' : 'java')
  if (!existsSync(java)) return null
  const result = spawnSync(java, ['-version'], { encoding: 'utf8' })
  return parse(`${result.stderr ?? ''}${result.stdout ?? ''}`)
}

/** Subpastas de uma pasta (ex.: os JDKs instalados em C:\Program Files\Java). */
function subfolders(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name))
  } catch {
    return []
  }
}

/** Onde procurar um Java: o JAVA_HOME, o do Android Studio e os JDKs instalados. */
function javaCandidates() {
  const home = os.homedir()
  if (isWindows) {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    return [
      process.env.JAVA_HOME,
      path.join(programFiles, 'Android', 'Android Studio', 'jbr'),
      path.join(local, 'Programs', 'Android Studio', 'jbr'),
      ...['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft'].flatMap((vendor) =>
        subfolders(path.join(programFiles, vendor)),
      ),
    ]
  }
  if (process.platform === 'darwin') {
    return [
      process.env.JAVA_HOME,
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
      path.join(home, 'Applications', 'Android Studio.app', 'Contents', 'jbr', 'Contents', 'Home'),
      ...subfolders('/Library/Java/JavaVirtualMachines').map((jdk) => path.join(jdk, 'Contents', 'Home')),
    ]
  }
  return [
    process.env.JAVA_HOME,
    '/opt/android-studio/jbr',
    path.join(home, 'android-studio', 'jbr'),
    '/usr/local/android-studio/jbr',
    '/snap/android-studio/current/jbr',
    ...subfolders('/usr/lib/jvm'),
  ]
}

/**
 * Um Java que o Gradle aceita (17 a 24), de preferência o JAVA_HOME e depois o do
 * Android Studio. Devolve também os que foram encontrados mas não servem (para a mensagem).
 */
function findJava() {
  const seen = new Set()
  const rejected = []
  for (const candidate of javaCandidates()) {
    if (!candidate || !existsSync(candidate)) continue
    const key = path.resolve(candidate).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const major = javaMajor(candidate)
    if (major && major >= JAVA_MIN && major <= JAVA_MAX) return { home: candidate, major, rejected }
    rejected.push({ home: candidate, major })
  }
  return { home: null, major: null, rejected }
}

/** Android SDK: o ANDROID_HOME, ou a pasta onde o Android Studio instala. */
function findSdk() {
  const fromEnv = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const home = os.homedir()
  return firstExisting(
    isWindows
      ? [path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Android', 'Sdk')]
      : process.platform === 'darwin'
        ? [path.join(home, 'Library', 'Android', 'sdk')]
        : [path.join(home, 'Android', 'Sdk')],
  )
}

/** android/local.properties com o caminho do SDK (o Gradle precisa dele). */
function ensureLocalProperties(sdk) {
  const file = path.join(androidDir, 'local.properties')
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (/^\s*sdk\.dir\s*=/m.test(current)) return
  const escaped = sdk.replace(/\\/g, '\\\\').replace(/:/g, '\\:')
  writeFileSync(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}sdk.dir=${escaped}\n`)
}

function requireTools() {
  const java = findJava()
  const sdk = findSdk()
  if (!java.home) {
    if (java.rejected.length) {
      console.error(`\n✖ O Gradle do Android precisa do Java ${JAVA_MIN} a ${JAVA_MAX}, e só encontrei:`)
      for (const item of java.rejected) console.error(`    Java ${item.major ?? '?'} — ${item.home}`)
      console.error('  Instale o JDK 21 (https://adoptium.net → Temurin 21, instalador .msi) e rode o comando de novo:')
      console.error('  o script o encontra sozinho, sem mexer no JAVA_HOME.\n')
    } else {
      console.error('\n✖ Não encontrei o Java (JDK 21).')
      console.error('  Instale o Android Studio (https://developer.android.com/studio), abra-o uma vez e rode o comando de novo.\n')
    }
    process.exit(1)
  }
  if (!sdk) {
    console.error('\n✖ Não encontrei o Android SDK.')
    console.error('  Abra o Android Studio uma vez para ele baixar o SDK (ou configure ANDROID_HOME) e rode o comando de novo.\n')
    process.exit(1)
  }
  const skipped = java.rejected.find((item) => process.env.JAVA_HOME && path.resolve(item.home) === path.resolve(process.env.JAVA_HOME))
  if (skipped)
    console.log(
      `\nℹ O JAVA_HOME aponta para o Java ${skipped.major ?? '?'}, que o Gradle do Android não aceita — usando o Java ${java.major} de ${java.home}.`,
    )
  else console.log(`\nℹ Java ${java.major}: ${java.home}`)
  ensureLocalProperties(sdk)
  return { ...process.env, JAVA_HOME: java.home, ANDROID_HOME: sdk }
}

/** A interface (a mesma do desktop) e o projeto android/ atualizado com ela. */
async function syncWeb() {
  console.log('\n▸ Gerando a interface (nuxt generate)…')
  await run('npx', ['nuxt', 'generate'])
  console.log('\n▸ Copiando para o projeto Android (cap sync)…')
  await run('npx', ['cap', 'sync', 'android'])
}

async function build() {
  const env = requireTools()
  await syncWeb()
  console.log('\n▸ Compilando o APK (Gradle)… na primeira vez demora alguns minutos.')
  await run(isWindows ? 'gradlew.bat' : 'sh', isWindows ? ['assembleRelease'] : ['gradlew', 'assembleRelease'], { cwd: androidDir, env })
  const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  if (!existsSync(apk)) throw new Error(`O Gradle terminou, mas o APK não está em ${apk}.`)
  const outDir = path.join(root, 'release', 'android')
  mkdirSync(outDir, { recursive: true })
  const target = path.join(outDir, `4notes-${version}.apk`)
  copyFileSync(apk, target)
  console.log(`\n✔ APK pronto: ${path.relative(root, target)}`)
  console.log('  Copie para o celular e toque nele para instalar (permita "instalar apps desconhecidos" para o app que abrir o arquivo).\n')
}

const commands = {
  build,
  sync: syncWeb,
  async run() {
    const env = requireTools()
    await syncWeb()
    await run('npx', ['cap', 'run', 'android'], { env })
  },
  open: () => run('npx', ['cap', 'open', 'android']),
}

const name = process.argv[2] ?? 'build'
if (!commands[name]) {
  console.error(`Uso: node scripts/android.mjs ${Object.keys(commands).join(' | ')}`)
  process.exit(1)
}
commands[name]().catch((error) => {
  console.error(`\n✖ ${error.message}\n`)
  process.exit(1)
})
