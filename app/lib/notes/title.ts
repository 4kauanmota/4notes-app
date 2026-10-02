/**
 * Título das notas rápidas (aba Notas).
 *
 * Regra: o título é a PRIMEIRA LINHA COM TEXTO da nota, sem as marcações Markdown.
 *   "# Minha primeira nota"   → "Minha primeira nota"
 *   "**Lista** de compras"    → "Lista de compras"
 *   "- [ ] ligar para o João" → "ligar para o João"
 * Se a nota estiver vazia, o título é "Sem título".
 * O nome do arquivo .md acompanha esse título.
 */
import { stripHtmlFormatting, stripImages } from '../editor/markup'

/** Remove marcações Markdown simples de UMA linha. */
export function stripInlineMarkdown(line: string): string {
  return stripHtmlFormatting(line) // <u>sublinhado</u>, <span style="color: …">cor</span>
    .replace(/^\s{0,3}#{1,6}(\s+|$)/, '') // # Título
    .replace(/\s+#+\s*$/, '') // "Título ##" (fechamento opcional)
    .replace(/^\s*>\s?/, '') // > citação
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '') // - [ ] tarefa
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '') // listas
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // imagens
    .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias || target) // [[link]]
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [texto](url)
    .replace(/(\*\*|__)(.+?)\1/g, '$2') // **negrito**
    .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=[^\w*]|$)/g, '$1$2') // *itálico*
    .replace(/~~(.+?)~~/g, '$1') // ~~riscado~~
    .replace(/==(.+?)==/g, '$1') // ==destaque==
    .replace(/`([^`]+)`/g, '$1') // `código`
    .replace(/\s+/g, ' ')
    .trim()
}

const FENCE = /^\s*(```|~~~)/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

function meaningfulLines(content: string): string[] {
  const lines = content.split(/\r?\n/)
  const result: string[] = []
  let index = 0
  // Ignora "frontmatter" YAML no topo (--- ... ---)
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
    if (end > 0) index = end + 1
  }
  let inFence = false
  for (; index < lines.length; index++) {
    const line = lines[index]!
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || RULE.test(line)) continue
    const text = stripInlineMarkdown(line)
    if (text) result.push(text)
  }
  return result
}

export function deriveTitle(content: string): string {
  const first = meaningfulLines(content)[0] ?? ''
  return Array.from(first).slice(0, 120).join('').trim()
}

/** Pequeno resumo (linhas depois do título) para a lista de notas. */
export function notePreview(content: string, maxLength = 140): string {
  const text = meaningfulLines(content).slice(1).join(' · ')
  const chars = Array.from(text)
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join('').trimEnd()}…` : text
}

/** Palavras do texto (sem contar as marcações HTML de sublinhado/cor nem as imagens, que ficam escondidas). */
export function countWords(content: string): number {
  const trimmed = stripImages(stripHtmlFormatting(content)).trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}
