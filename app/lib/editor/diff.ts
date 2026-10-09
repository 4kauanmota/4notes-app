/** Calcula a menor alteração entre dois textos (preserva o cursor em mudanças externas). */
export function minimalChange(current: string, next: string): { from: number; to: number; insert: string } {
  let start = 0
  const max = Math.min(current.length, next.length)
  while (start < max && current.charCodeAt(start) === next.charCodeAt(start)) start++
  let endCurrent = current.length
  let endNext = next.length
  while (endCurrent > start && endNext > start && current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)) {
    endCurrent--
    endNext--
  }
  return { from: start, to: endCurrent, insert: next.slice(start, endNext) }
}
