/**
 * Caminhos dentro do workspace (sempre com "/"), usados nos links das notas:
 * imagens (![](../attachments/x.png)) e menções a outras notas ([Ideias](Ideias.md)).
 */

/**
 * Codifica um pedaço do caminho para um link Markdown: só o que quebraria o link
 * (espaços, parênteses, colchetes, #, ?, %, < >). Acentos ficam legíveis.
 */
const encodePart = (part: string) =>
  part.replace(/[%\s()<>#?[\]]/g, (char) => (char === '(' ? '%28' : char === ')' ? '%29' : encodeURIComponent(char)))

function decodePart(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

function normalizeSegments(parts: string[]): string[] | null {
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!out.length) return null
      out.pop()
    } else {
      out.push(part)
    }
  }
  return out
}

/** Caminho relativo de uma pasta do workspace até um arquivo do workspace ("notes" → "../attachments/x.png"). */
export function relativeTo(fromDir: string, target: string): string {
  const from = normalizeSegments(fromDir.split('/')) ?? []
  const to = normalizeSegments(target.split('/')) ?? []
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  const up = from.slice(common).map(() => '..')
  return [...up, ...to.slice(common)].map((part) => (part === '..' ? part : encodePart(part))).join('/')
}

/**
 * Caminho no workspace de um arquivo citado numa nota (imagem ou outra nota;
 * `src` é relativo à pasta da nota). null = endereço externo ou caminho que sai do workspace.
 */
export function resolveFromNote(noteDir: string, src: string): string | null {
  const clean = src.trim().replace(/^<|>$/g, '')
  if (!clean || /^[a-z][\w+.-]*:/i.test(clean) || clean.startsWith('/')) return null
  const parts = normalizeSegments([...noteDir.split('/'), ...clean.split('/').map(decodePart)])
  return parts && parts.length ? parts.join('/') : null
}
