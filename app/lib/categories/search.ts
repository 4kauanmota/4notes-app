/**
 * Busca de categorias (1.7.2): a mesma regra no seletor de categorias de todos os
 * módulos (components/categories/CategoryPicker*.vue).
 *
 * - Sem diferenciar acentos nem maiúsculas ("alimentacao" acha "Alimentação").
 * - Cada palavra digitada precisa aparecer no nome ("cas vi" acha "Casa de vidro").
 * - Ordem: nome igual, depois o que começa com o texto, depois o que tem uma palavra
 *   começando com ele, depois o resto; dentro de cada grupo, a ordem original da lista
 *   (a do módulo), para a lista não "pular" enquanto você digita.
 */

/** Texto para comparar: sem acentos, minúsculo, espaços simples. */
export function foldCategoryName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Quão bem um nome combina com a busca (menor = melhor); null = não combina. */
export function categoryMatchScore(name: string, query: string): number | null {
  const q = foldCategoryName(query)
  if (!q) return 3
  const n = foldCategoryName(name)
  const words = q.split(' ')
  if (!words.every((word) => n.includes(word))) return null
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  if (n.split(/[\s\-_/.]+/).some((part) => part.startsWith(words[0]!))) return 2
  return 3
}

/** As categorias que combinam com a busca, das que combinam melhor para as piores. */
export function rankCategories<T extends { name: string }>(items: readonly T[], query: string): T[] {
  if (!foldCategoryName(query)) return [...items]
  const scored: { item: T; score: number; index: number }[] = []
  items.forEach((item, index) => {
    const score = categoryMatchScore(item.name, query)
    if (score !== null) scored.push({ item, score, index })
  })
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((entry) => entry.item)
}

/** Já existe uma categoria com exatamente esse nome (sem diferenciar acentos/maiúsculas)? */
export function hasExactName(items: readonly { name: string }[], query: string): boolean {
  const q = foldCategoryName(query)
  return !!q && items.some((item) => foldCategoryName(item.name) === q)
}
