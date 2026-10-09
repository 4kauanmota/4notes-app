/**
 * Versões de uma nota: notas com o mesmo título a não ser por um número de versão.
 *
 *   4notes 1.4.1   →  versão anterior: 4notes 1.4.0  →  4notes 1.3.2  →  …
 *   Aula 3         →  Aula 2
 *   4notes 1.2.0 bugs  →  4notes 1.1.1 bugs   (o texto depois da versão também conta)
 *
 * - A versão é a última palavra do título que é um número ("3", "1.4.0", "v2.1").
 *   Antes dela precisa haver pelo menos uma palavra (o "nome": "4notes", "Aula").
 * - As outras palavras precisam ser iguais (sem diferenciar maiúsculas), como nas
 *   pastas pelo título (title-tree.ts) — por isso as versões de uma nota ficam
 *   sempre na mesma pasta da lista lateral.
 * - A anterior é a maior versão menor que a atual ("1.4.1" → "1.4.0"; sem "1.4.0",
 *   "1.3.9"…); a próxima, a menor versão maior ("1.4.0" → "1.4.1"; sem ela, "1.5"…).
 *   Versões iguais ("1.4" e "1.4.0") não contam nem como anterior nem como próxima.
 * - Quem chama decide o grupo (as notas da mesma categoria).
 */
import { titleWords } from './title-tree'

const VERSION = /^v?(\d+(?:\.\d+)*)$/i

export interface NoteVersion {
  /** O que precisa ser igual nas outras versões (o título sem a versão, sem diferenciar maiúsculas). */
  key: string
  /** Partes do número: "1.4.0" → [1, 4, 0]. */
  parts: number[]
  /** A versão como está no título ("1.4.0", "v2"). */
  label: string
}

const fold = (word: string) => word.normalize('NFC').toLocaleLowerCase('pt-BR')

/** Versão do título (null = o título não tem número de versão). */
export function versionOf(title: string): NoteVersion | null {
  const words = titleWords(title)
  for (let i = words.length - 1; i >= 1; i--) {
    const match = VERSION.exec(words[i]!)
    if (!match) continue
    const parts = match[1]!.split('.').map(Number)
    if (parts.some((part) => !Number.isSafeInteger(part))) return null
    const key = [...words.slice(0, i).map(fold), '#', ...words.slice(i + 1).map(fold)].join(' ')
    return { key, parts, label: words[i]! }
  }
  return null
}

/** Compara versões parte por parte ("1.10" > "1.9"; "1.4" = "1.4.0"). */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

/** A versão vizinha de `title` entre `items`, para trás (-1) ou para a frente (1). */
function neighborVersion<T>(title: string, items: readonly T[], titleOf: (item: T) => string, direction: -1 | 1): { item: T; version: NoteVersion } | null {
  const current = versionOf(title)
  if (!current) return null
  let best: { item: T; version: NoteVersion } | null = null
  for (const item of items) {
    const version = versionOf(titleOf(item))
    if (!version || version.key !== current.key || compareVersions(version.parts, current.parts) * direction <= 0) continue
    // A mais perto da atual: a maior das menores (anterior) ou a menor das maiores (próxima)
    if (!best || compareVersions(version.parts, best.version.parts) * direction < 0) best = { item, version }
  }
  return best
}

/**
 * A versão anterior de `title` entre `items` (null = não há). Empate entre duas
 * notas com a mesma versão: vale a que vem primeiro em `items`.
 */
export function previousVersion<T>(title: string, items: readonly T[], titleOf: (item: T) => string): { item: T; version: NoteVersion } | null {
  return neighborVersion(title, items, titleOf, -1)
}

/** A próxima versão de `title` entre `items` (null = não há). Empate: a que vem primeiro. */
export function nextVersion<T>(title: string, items: readonly T[], titleOf: (item: T) => string): { item: T; version: NoteVersion } | null {
  return neighborVersion(title, items, titleOf, 1)
}
