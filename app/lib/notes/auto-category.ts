/**
 * Categoria automática pelo título (Configurações › Módulos › Notas).
 *
 * Uma nota nova criada fora das categorias vai para a categoria que já tem notas
 * com o mesmo começo de título — o mesmo critério das pastas pelo título:
 *
 *   Dev: "4notes 1.1.1", "4notes 1.2.0"      nova: "4notes 1.2.1"  →  Dev
 *
 * Vale a categoria com o começo em comum mais comprido (em palavras); empatando,
 * a que tem mais notas com esse começo. Empate de novo: a nota fica onde está.
 */
import { titleWords } from './title-tree'

export interface CategoryTitles {
  category: string
  /** Títulos das notas da categoria. */
  titles: string[]
}

const fold = (word: string) => word.normalize('NFC').toLocaleLowerCase('pt-BR')

function commonPrefix(a: string[], b: string[]): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/** Categoria para uma nota nova com o título `title` (null = nenhuma combina, ou empate). */
export function matchCategory(title: string, groups: CategoryTitles[]): string | null {
  const words = titleWords(title).map(fold)
  if (!words.length) return null
  let best: { category: string; prefix: number; count: number } | null = null
  let tie = false
  for (const group of groups) {
    let prefix = 0
    let count = 0
    for (const other of group.titles) {
      const shared = commonPrefix(words, titleWords(other).map(fold))
      if (shared > prefix) {
        prefix = shared
        count = 1
      } else if (shared && shared === prefix) {
        count++
      }
    }
    if (!prefix) continue
    if (!best || prefix > best.prefix || (prefix === best.prefix && count > best.count)) {
      best = { category: group.category, prefix, count }
      tie = false
    } else if (prefix === best.prefix && count === best.count) {
      tie = true
    }
  }
  return best && !tie ? best.category : null
}

/** O título já foi terminado? (Enter depois dele: o texto continua na linha de baixo.) */
export function titleLineFinished(content: string): boolean {
  return content.trimStart().includes('\n')
}
