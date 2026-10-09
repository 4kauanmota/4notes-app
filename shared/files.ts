/**
 * Regras dos arquivos do workspace usadas pelas duas plataformas — o Electron
 * (electron/*.ts) e o app Android (app/lib/mobile): nomes, formatos de imagem,
 * texto, base64…
 *
 * Só funções puras (sem Node.js e sem Vue), para o computador e o celular gravarem
 * os arquivos exatamente do mesmo jeito.
 */

/** Pastas que todo workspace tem (e que mostram que uma pasta já tem dados do 4notes). */
export const DATA_FOLDERS = ['notes', 'tasks', 'mindmap', 'links', 'attachments', '.4notes'] as const

/** Pasta das imagens do workspace (a biblioteca de imagens). */
export const ATTACHMENTS_DIR = 'attachments'

/** Pasta onde vai o que é excluído quando não há Lixeira (celular, unidades de rede). */
export const TRASH_DIR = '.4notes/trash'

export const MAX_IMAGE_BYTES = 40 * 1024 * 1024

/** Arquivo de imagem (pelo nome). */
export const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i

/** Tipo (MIME) → extensão das imagens aceitas ao colar ou enviar. */
export const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

/** Extensão → tipo (MIME). */
export const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
}

/** Extensão de um nome de arquivo, sem o ponto e em minúsculas ("Foto.PNG" → "png"). */
export function extensionOf(name: string): string {
  const base = name.split('/').pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** Remove o BOM (comum em arquivos do Bloco de Notas antigo) e padroniza quebras de linha (CRLF → LF). */
export function normalizeText(text: string): string {
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, '\n')
}

/** "AAAAMMDD-HHMMSS" (nome das imagens coladas). */
export function fileStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Nome do arquivo a partir do título da nota ("Reunião: 05/10" → "Reunião 05 10.pdf"). */
export function exportFileName(name: unknown, extension: string): string {
  const base =
    (typeof name === 'string' ? name : '')
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 100)
      .replace(/[. ]+$/, '') || 'Nota'
  return `${RESERVED.test(base) ? `${base}_` : base}.${extension}`
}

/** Nome do arquivo na biblioteca a partir do nome original ("Minha foto!.PNG" → "Minha foto!", "png"). */
export function libraryName(fileName: string): { base: string; extension: string } {
  const name = fileName.split(/[\\/]/).pop() ?? fileName
  const extension = extensionOf(name)
  const withoutExtension = extension ? name.slice(0, -(extension.length + 1)) : name
  const base =
    withoutExtension
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f#%]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 60)
      .replace(/[. ]+$/, '') || 'imagem'
  return { base: RESERVED.test(base) ? `${base}_` : base, extension: extension === 'jpeg' ? 'jpg' : extension }
}

// ── base64 ──────────────────────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Bytes de um endereço data: (data:image/png;base64,… ou texto escapado). */
export function decodeDataUrl(url: string): Uint8Array | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(url)
  if (!match) return null
  try {
    return match[2] ? base64ToBytes(match[3]!) : new TextEncoder().encode(decodeURIComponent(match[3]!))
  } catch {
    return null
  }
}

// ── Exportar como PDF ───────────────────────────────────────────────────────

function decodePart(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/**
 * Troca as imagens do workspace (endereços que começam com `prefix`) pela imagem
 * embutida (data:…). `readImage` devolve o base64 da imagem (null = não encontrada).
 */
export async function inlineWorkspaceImages(html: string, prefix: string, readImage: (relativePath: string) => Promise<string | null>): Promise<string> {
  const pattern = /(<img\b[^>]*?\bsrc=")([^"]*)(")/gi
  const cache = new Map<string, string | null>()
  const embed = async (src: string): Promise<string | null> => {
    if (!src.startsWith(prefix)) return null
    const relative = src.slice(prefix.length).split(/[?#]/)[0]!.split('/').map(decodePart).join('/')
    if (!IMAGE_FILE.test(relative)) return null
    try {
      const data = await readImage(relative)
      return data === null ? null : `data:${IMAGE_MIME[extensionOf(relative)] ?? 'application/octet-stream'};base64,${data}`
    } catch {
      return null
    }
  }
  const sources = new Set([...html.matchAll(pattern)].map((match) => match[2]!.replace(/&amp;/g, '&')))
  for (const src of sources) cache.set(src, await embed(src))
  return html.replace(pattern, (_all, open: string, src: string, close: string) => {
    const data = cache.get(src.replace(/&amp;/g, '&'))
    // Sem a imagem (fora do workspace ou não encontrada): fica só o espaço dela
    return `${open}${data ?? ''}${close}${data ? '' : ' data-missing="1"'}`
  })
}
