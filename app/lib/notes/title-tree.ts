/**
 * Pastas das notas pelo título — só na lista lateral; os arquivos não mudam.
 *
 *   4notes 1.1.1           📁 4notes
 *   4notes 1.2.0      →       1.1.1
 *   4notes 1.2.0 bugs         📁 1.2.0      (a pasta é a nota "4notes 1.2.0")
 *   Lista de compras             bugs
 *                           Lista de compras
 *
 * Regras:
 * - A primeira palavra vira pasta quando 2 ou mais notas (de títulos diferentes) começam com ela.
 * - Dentro dela, a segunda palavra vira subpasta quando 2 ou mais notas começam
 *   com as mesmas duas palavras e alguma tem mais texto depois. Não há um terceiro nível.
 * - A nota cujo título é exatamente o caminho da pasta ("4notes 1.2.0") é a
 *   própria pasta: clicar nela abre a nota.
 * - Uma nota sozinha (ou de uma palavra só) aparece com o título inteiro.
 * - Maiúsculas/minúsculas não importam para agrupar.
 */

export interface TitleItem {
  id: string
  /** Título da nota ("" = sem título). */
  title: string
}

export interface TitleNote {
  kind: 'note'
  key: string
  id: string
  label: string
}

export interface TitleFolder {
  kind: 'folder'
  /** Chave estável da pasta (para lembrar se está aberta). */
  key: string
  label: string
  /** Começo do título das notas desta pasta ("4notes", "4notes 1.2.0"): usado pelo + da pasta. */
  titlePath: string
  /** Nota cujo título é exatamente o caminho da pasta (clicar na pasta abre ela). */
  noteId: string | null
  children: TitleTreeNode[]
  /** Quantidade de notas dentro da pasta (sem contar a nota da própria pasta). */
  count: number
}

export type TitleTreeNode = TitleNote | TitleFolder

/** Pastas vão até o segundo nível (primeira e segunda palavra). */
const MAX_DEPTH = 2

interface Entry {
  item: TitleItem
  words: string[]
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })
const fold = (word: string) => word.normalize('NFC').toLocaleLowerCase('pt-BR')
export const titleWords = (title: string) => title.trim().split(/\s+/).filter(Boolean)

function leaf(entry: Entry, depth: number, untitled: string): TitleNote {
  const label = entry.words.slice(depth).join(' ') || entry.words.join(' ') || untitled
  return { kind: 'note', key: `n:${entry.item.id}`, id: entry.item.id, label }
}

function countNotes(nodes: TitleTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.kind === 'note' ? 1 : node.count + (node.noteId ? 1 : 0)), 0)
}

/** Pastas primeiro, depois as notas; em ordem alfabética ("1.10" depois de "1.9"). */
function sortNodes(nodes: TitleTreeNode[]): TitleTreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return collator.compare(a.label, b.label) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  })
}

/** Nome da pasta: o da nota da pasta, se houver; senão, a grafia mais usada nas notas dela. */
function folderLabel(bucket: Entry[], own: Entry | undefined, depth: number): string {
  if (own) return own.words[depth]!
  const counts = new Map<string, number>()
  for (const entry of bucket) counts.set(entry.words[depth]!, (counts.get(entry.words[depth]!) ?? 0) + 1)
  let best = bucket[0]!.words[depth]!
  for (const [word, count] of counts) if (count > counts.get(best)!) best = word
  return best
}

function group(entries: Entry[], depth: number, parentKey: string, untitled: string, parentPath = ''): TitleTreeNode[] {
  const nodes: TitleTreeNode[] = []
  const buckets = new Map<string, Entry[]>()
  for (const entry of entries) {
    if (depth >= MAX_DEPTH || entry.words.length <= depth) {
      nodes.push(leaf(entry, depth, untitled))
      continue
    }
    const key = fold(entry.words[depth]!)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }

  for (const [word, bucket] of buckets) {
    const deeper = bucket.filter((entry) => entry.words.length > depth + 1)
    // Pasta só com 2+ títulos diferentes (notas com o mesmo título não viram pasta)
    const titles = new Set(bucket.map((entry) => entry.words.map(fold).join(' ')))
    if (titles.size < 2 || !deeper.length) {
      for (const entry of bucket) nodes.push(leaf(entry, depth, untitled))
      continue
    }
    const own = bucket.filter((entry) => entry.words.length === depth + 1)
    const key = parentKey ? `${parentKey}\u001f${word}` : word
    const label = folderLabel(bucket, own[0], depth)
    const titlePath = parentPath ? `${parentPath} ${label}` : label
    const children = group(deeper, depth + 1, key, untitled, titlePath)
    // Títulos repetidos iguais ao da pasta ficam como notas dentro dela
    for (const extra of own.slice(1)) children.push(leaf(extra, depth, untitled))
    sortNodes(children)
    nodes.push({
      kind: 'folder',
      key: `f:${key}`,
      label,
      titlePath,
      noteId: own[0]?.item.id ?? null,
      children,
      count: countNotes(children),
    })
  }
  return sortNodes(nodes)
}

/** Monta as pastas de um grupo de notas (uma categoria ou as notas sem categoria). */
export function buildTitleTree(items: TitleItem[], untitled = 'Sem título'): TitleTreeNode[] {
  const entries = [...items]
    .sort((a, b) => collator.compare(a.title, b.title) || (a.id < b.id ? -1 : 1))
    .map((item) => ({ item, words: titleWords(item.title) }))
  return group(entries, 0, '', untitled)
}

/** Chaves das pastas que levam até a nota `id` (para abrir o caminho até ela). */
export function folderPathTo(nodes: TitleTreeNode[], id: string): string[] | null {
  for (const node of nodes) {
    if (node.kind === 'note') {
      if (node.id === id) return []
      continue
    }
    if (node.noteId === id) return []
    const inner = folderPathTo(node.children, id)
    if (inner) return [node.key, ...inner]
  }
  return null
}

// ── Linhas da lista lateral ─────────────────────────────────────────────────

/** Uma linha da lista lateral: uma pasta (pelo título) ou uma nota. */
export interface TreeRow<N> {
  key: string
  kind: 'folder' | 'note'
  /** Nível de recuo (0 = primeiro nível do grupo). */
  depth: number
  label: string
  /** A nota da linha (numa pasta, a nota com o mesmo título da pasta, se houver). */
  note: N | null
  folderKey: string | null
  /** Pasta: começo do título das notas dela ("4notes 1.2.0"); nota: null. */
  titlePath: string | null
  open: boolean
  count: number
}

/** Transforma as pastas em linhas, entrando só nas pastas abertas. */
export function flattenTree<N>(nodes: TitleTreeNode[], notes: ReadonlyMap<string, N>, isOpen: (folderKey: string) => boolean): TreeRow<N>[] {
  const rows: TreeRow<N>[] = []
  const walk = (level: TitleTreeNode[], depth: number) => {
    for (const node of level) {
      if (node.kind === 'note') {
        rows.push({ key: node.key, kind: 'note', depth, label: node.label, note: notes.get(node.id) ?? null, folderKey: null, titlePath: null, open: false, count: 0 })
        continue
      }
      const open = isOpen(node.key)
      const note = node.noteId ? (notes.get(node.noteId) ?? null) : null
      rows.push({ key: node.key, kind: 'folder', depth, label: node.label, note, folderKey: node.key, titlePath: node.titlePath, open, count: node.count })
      if (open) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return rows
}
