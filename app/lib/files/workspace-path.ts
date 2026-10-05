/**
 * Caminhos dentro do workspace (sempre com "/"), usados nos links das notas:
 * imagens (![](../attachments/x.png)), menções a outras notas ([Ideias](Ideias.md))
 * e a tarefas ([Estudar](../tasks/tasks.json#t_x1) — o "#" separa o id da tarefa).
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

/** "tasks/tasks.json#t_x1" → ["tasks/tasks.json", "t_x1"]. */
function splitFragment(value: string): [string, string | null] {
  const index = value.indexOf('#')
  return index < 0 ? [value, null] : [value.slice(0, index), value.slice(index + 1)]
}

/**
 * Caminho relativo de uma pasta do workspace até um arquivo do workspace ("notes" → "../attachments/x.png").
 * Um "#id" no fim do alvo é mantido ("tasks/tasks.json#t_x1" → "../tasks/tasks.json#t_x1").
 */
export function relativeTo(fromDir: string, target: string): string {
  const [file, fragment] = splitFragment(target)
  const from = normalizeSegments(fromDir.split('/')) ?? []
  const to = normalizeSegments(file.split('/')) ?? []
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  const up = from.slice(common).map(() => '..')
  const path = [...up, ...to.slice(common)].map((part) => (part === '..' ? part : encodePart(part))).join('/')
  return fragment === null ? path : `${path}#${encodePart(decodePart(fragment))}`
}

/**
 * Arquivo do workspace citado num link de uma nota (`href` é relativo à pasta da nota),
 * com o "#…" do fim separado. null = endereço externo, só "#âncora" ou caminho que sai do workspace.
 */
export function resolveLink(noteDir: string, href: string): { path: string; fragment: string | null } | null {
  const clean = href.trim().replace(/^<|>$/g, '')
  if (!clean || /^[a-z][\w+.-]*:/i.test(clean) || clean.startsWith('/')) return null
  const [file, fragment] = splitFragment(clean)
  if (!file) return null
  const parts = normalizeSegments([...noteDir.split('/'), ...file.split('/').map(decodePart)])
  return parts && parts.length ? { path: parts.join('/'), fragment: fragment === null ? null : decodePart(fragment) } : null
}

/**
 * Caminho no workspace de um arquivo citado numa nota (imagem ou outra nota;
 * `src` é relativo à pasta da nota). null = endereço externo ou caminho que sai do workspace.
 */
export function resolveFromNote(noteDir: string, src: string): string | null {
  return resolveLink(noteDir, src)?.path ?? null
}
