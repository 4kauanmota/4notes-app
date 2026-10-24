/**
 * Texto "limpo" (sem marcações de formatação) para títulos, prévias e buscas.
 * Sem dependência do editor: pode ser usado em qualquer lugar.
 */

/** Remove o HTML de formatação usado pelo editor: <u>…</u>, <span style="color: …">…</span> e <mark style="…">…</mark>. */
export function stripHtmlFormatting(text: string): string {
  return text
    .replace(/<\/?u>/gi, '')
    .replace(/<(?:span|mark)\s+style\s*=\s*(["'])[^"']*\1\s*>/gi, '')
    .replace(/<\/(?:span|mark)>/gi, '')
}

/** Remove imagens (![](…)) — o texto delas não conta como conteúdo. */
export function stripImages(text: string): string {
  return text.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
}

/** Versão em texto corrido de um trecho Markdown (para prévias curtas). */
export function toPlainText(text: string): string {
  return stripImages(stripHtmlFormatting(text))
    .replace(/^\s{0,3}(?:```|~~~).*$/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*|__|~~|==/g, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
