// Modo de desenvolvimento: `npm run dev`
//
// 1. Sobe o servidor de desenvolvimento do Nuxt (interface com hot reload).
// 2. Compila o código do Electron com o esbuild em modo "watch".
// 3. Abre o Electron apontando para o servidor do Nuxt.
//
// Alterou um .vue? A interface atualiza sozinha (HMR do Vite).
// Alterou algo em electron/? O Electron é reiniciado automaticamente.
// Fechou a janela? Tudo é encerrado.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { context } from 'esbuild'
import { electronBuildOptions, root } from './build-electron.mjs'

const require = createRequire(import.meta.url)
const electronBinary = require('electron') // o pacote "electron" exporta o caminho do executável
const nuxtCli = path.join(root, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs')
const FALLBACK_URL = 'http://127.0.0.1:3141'

let shuttingDown = false
let nuxtProcess = null
let electronProcess = null
let restartingElectron = false
let esbuildContext = null

function killTree(child) {
  if (!child || child.exitCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') {
    // No Windows, child.kill() não encerra os subprocessos: usamos o taskkill.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  killTree(electronProcess)
  killTree(nuxtProcess)
  await esbuildContext?.dispose().catch(() => {})
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// ── 1. Nuxt ────────────────────────────────────────────────────────────────
console.log('\n[4notes] Iniciando o servidor do Nuxt…\n')
nuxtProcess = spawn(process.execPath, [nuxtCli, 'dev'], {
  cwd: root,
  stdio: ['inherit', 'pipe', 'inherit'],
  env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1' },
})

const devUrl = await new Promise((resolve) => {
  let resolved = false
  const done = (url) => {
    if (resolved) return
    resolved = true
    resolve(url.replace(/\/$/, ''))
  }
  nuxtProcess.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    // eslint-disable-next-line no-control-regex
    const text = chunk.toString().replace(/\x1b\[[0-9;]*m/g, '')
    const match = /Local:\s+(https?:\/\/\S+)/.exec(text)
    if (match) done(match[1])
  })
  setTimeout(() => done(FALLBACK_URL), 60_000)
})

nuxtProcess.on('exit', (code) => {
  if (!shuttingDown) {
    console.error('[4notes] O servidor do Nuxt foi encerrado.')
    shutdown(code ?? 1)
  }
})

async function waitForServer(url, timeoutMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`O servidor do Nuxt não respondeu em ${url}`)
}

await waitForServer(devUrl)

// ── 2 e 3. Electron (com recompilação automática) ─────────────────────────
function startElectron() {
  const args = ['.']
  // Necessário apenas em ambientes Linux rodando como root (ex.: contêineres).
  if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')
  // Opcional: argumentos extras para o Electron (ex.: --remote-debugging-port=9222)
  if (process.env.FOURNOTES_ELECTRON_ARGS) args.push(...process.env.FOURNOTES_ELECTRON_ARGS.split(' ').filter(Boolean))
  electronProcess = spawn(electronBinary, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, FOURNOTES_DEV_SERVER_URL: devUrl },
  })
  electronProcess.on('exit', () => {
    if (restartingElectron) {
      restartingElectron = false
      startElectron()
    } else if (!shuttingDown) {
      shutdown(0)
    }
  })
}

let firstBuild = true
esbuildContext = await context({
  ...electronBuildOptions,
  sourcemap: 'inline',
  plugins: [
    {
      name: 'restart-electron',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) return
          if (firstBuild) {
            firstBuild = false
            console.log(`\n[4notes] Abrindo o Electron em ${devUrl}\n`)
            startElectron()
            return
          }
          console.log('\n[4notes] Código do Electron alterado — reiniciando a janela…\n')
          restartingElectron = true
          killTree(electronProcess)
        })
      },
    },
  ],
})
await esbuildContext.watch()
