/**
 * Regras para transformar títulos em nomes de arquivo válidos no Windows,
 * macOS e Linux.
 */

/** Caracteres proibidos em nomes de arquivo no Windows (e caracteres de controle). */
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001F\u007F]/g
/** Caracteres que quebrariam a sintaxe [[link]] das notas permanentes. */
const WIKILINK_CHARS = /[[\]|#^]/g
/** Nomes reservados pelo Windows (CON, PRN, AUX, NUL, COM1…, LPT1…). */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export const MAX_NAME_LENGTH = 80
export const UNTITLED = 'Sem título'

export interface SanitizeOptions {
  /** Remove também [ ] | # ^ (usado nas notas do Mapa Mental). */
  forWikilinks?: boolean
  fallback?: string
}

export function sanitizeFileName(name: string, options: SanitizeOptions = {}): string {
  const fallback = options.fallback ?? UNTITLED
  let clean = (name ?? '').normalize('NFC').replace(INVALID_CHARS, ' ')
  if (options.forWikilinks) clean = clean.replace(WIKILINK_CHARS, ' ')
  clean = clean.replace(/\s+/g, ' ').trim()
  clean = clean.replace(/^\.+/, '').trim() // sem arquivos ocultos
  const codePoints = Array.from(clean)
  if (codePoints.length > MAX_NAME_LENGTH) clean = codePoints.slice(0, MAX_NAME_LENGTH).join('')
  clean = clean.replace(/[. ]+$/g, '') // o Windows não aceita nomes terminados em ponto ou espaço
  if (!clean) clean = fallback
  if (RESERVED_NAMES.test(clean)) clean = `${clean}_`
  return clean
}

/** "Ideia" → "Ideia (2)" → "Ideia (3)"… até encontrar um nome livre. */
export function uniqueName(base: string, isTaken: (candidate: string) => boolean): string {
  if (!isTaken(base)) return base
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base} (${i})`
    if (!isTaken(candidate)) return candidate
  }
  return `${base} ${Date.now()}`
}

/** Chave para comparar nomes ignorando maiúsculas/minúsculas (como o Windows faz). */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase('pt-BR')
}

export function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}

export function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(0, index) : ''
}

export function stripExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/')
}
