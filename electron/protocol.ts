/**
 * Protocolo app://4notes/ — como a interface é servida no app instalado.
 *
 * Em produção não existe servidor web: os arquivos gerados pelo `nuxt generate`
 * (.output/public) ficam dentro do aplicativo. Em vez de abrir com file:// (que
 * quebra rotas e caminhos absolutos como /_nuxt/...), registramos um protocolo
 * próprio que lê esses arquivos do disco e os entrega para o Chromium.
 */
import { protocol } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { WORKSPACE_SCHEME } from '../shared/ipc'

export const APP_SCHEME = 'app'
export const APP_ORIGIN = 'app://4notes'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

/** Precisa ser chamado ANTES de `app.whenReady()`. */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
    {
      scheme: WORKSPACE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

/**
 * Content-Security-Policy: só permite scripts do próprio app. O Nuxt injeta um
 * pequeno <script> inline com a configuração da SPA; liberamos exatamente esse
 * script pelo hash SHA-256 do conteúdo.
 */
function contentSecurityPolicy(html: string): string {
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => !/\bsrc=/i.test(attrs ?? '') && !/type=["']?application\/json/i.test(attrs ?? ''))
    .map(([, , body]) => `'sha256-${crypto.createHash('sha256').update(body ?? '').digest('base64')}'`)
  return [
    "default-src 'self'",
    `script-src 'self' ${inlineScripts.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${WORKSPACE_SCHEME}:`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ')
}

export function registerAppProtocol(rendererRoot: string): void {
  const root = path.resolve(rendererRoot)

  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    let file = path.join(root, decodeURIComponent(pathname))
    if (file !== root && !file.startsWith(root + path.sep)) {
      return new Response('Forbidden', { status: 403 })
    }

    const stat = await fs.stat(file).catch(() => null)
    if (!stat || stat.isDirectory()) {
      // Arquivo inexistente com extensão (ex.: /_nuxt/x.js) → 404.
      // Rotas da SPA (/notes, /tasks, /mindmap) → index.html (o roteador do Vue resolve).
      if (path.extname(pathname)) return new Response('Not found', { status: 404 })
      file = path.join(root, 'index.html')
    }

    const body = await fs.readFile(file)
    const extension = path.extname(file).toLowerCase()
    const headers: Record<string, string> = {
      'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
    }
    if (extension === '.html') {
      headers['Content-Security-Policy'] = contentSecurityPolicy(body.toString('utf8'))
      headers['Cache-Control'] = 'no-cache'
    }
    return new Response(new Uint8Array(body), { headers })
  })
}

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|bmp|avif|svg)$/i

/**
 * workspace://files/<caminho> — imagens guardadas no workspace (attachments/).
 * Só serve imagens, e só de dentro da pasta de dados atual.
 */
export function registerWorkspaceProtocol(dataDir: () => string | null): void {
  protocol.handle(WORKSPACE_SCHEME, async (request) => {
    const root = dataDir()
    if (!root) return new Response('Not found', { status: 404 })
    const base = path.resolve(root)
    const { pathname } = new URL(request.url)
    const file = path.resolve(base, decodeURIComponent(pathname).replace(/^\/+/, ''))
    if (!file.startsWith(base + path.sep) || !IMAGE_FILE.test(file)) return new Response('Forbidden', { status: 403 })
    const body = await fs.readFile(file).catch(() => null)
    if (!body) return new Response('Not found', { status: 404 })
    return new Response(new Uint8Array(body), {
      headers: { 'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' },
    })
  })
}
