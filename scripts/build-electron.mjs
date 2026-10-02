// Compila o código do Electron (electron/*.ts) para JavaScript com o esbuild.
//
//   electron/main.ts    → dist-electron/main.cjs     (processo principal)
//   electron/preload.ts → dist-electron/preload.cjs  (ponte segura com a interface)
//
// Tudo é "empacotado" num único arquivo por entrada, então o app instalado não
// precisa da pasta node_modules.
import { build } from 'esbuild'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @type {import('esbuild').BuildOptions} */
export const electronBuildOptions = {
  absWorkingDir: root,
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'info',
}

// Executado diretamente (npm run build)?
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  rmSync(path.join(root, 'dist-electron'), { recursive: true, force: true })
  await build({ ...electronBuildOptions, sourcemap: false, minify: false })
}
