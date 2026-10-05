/**
 * Importar favoritos do navegador (regras puras): quais links entram, em quais
 * pastas, e quais já estavam salvos.
 *
 * - "Uma pasta para cada pasta do navegador": cada link vai para uma pasta com o
 *   nome da pasta dele no navegador (pastas com o mesmo nome se juntam, inclusive
 *   com pastas que já existem no 4notes). Links soltos na barra de favoritos (ou em
 *   outra raiz) ficam sem pasta.
 * - "Tudo numa pasta": todos vão para a pasta escolhida (ou sem pasta).
 * - Um link que já está salvo (mesmo endereço) não é importado de novo.
 */
import type { BookmarkFolder, BookmarkNode } from '#shared/ipc'
import { normalizeUrl, urlKey, type LinkFolder, type SavedLink } from './model'

/** Link marcado para importar, com o caminho de pastas até ele. */
export interface ImportCandidate {
  /** Chave estável do link na árvore (para lembrar o que está marcado). */
  key: string
  title: string
  url: string
  icon?: string
  /** Pastas do navegador até o link (a primeira é a raiz: "Barra de favoritos"…). */
  path: string[]
}

export type ImportMode = { kind: 'folders' } | { kind: 'single'; folderId: string | null }

export interface ImportPlan {
  /** Pastas novas a criar (pelo nome). */
  newFolders: string[]
  links: { title: string; url: string; icon?: string; folderId: string | null; folderName: string | null }[]
  /** Links que já estavam salvos (ou repetidos no próprio favoritos). */
  skipped: number
}

/** Todos os links da árvore, com o caminho de pastas e uma chave estável. */
export function flattenBookmarks(roots: BookmarkFolder[]): ImportCandidate[] {
  const result: ImportCandidate[] = []
  const walk = (nodes: BookmarkNode[], path: string[], key: string) => {
    nodes.forEach((node, index) => {
      const nodeKey = `${key}/${index}`
      if (node.kind === 'folder') walk(node.children, [...path, node.title], nodeKey)
      else result.push({ key: nodeKey, title: node.title, url: node.url, icon: node.icon, path })
    })
  }
  roots.forEach((root, index) => walk(root.children, [root.title], `${index}`))
  return result
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim()

/** Plano da importação: o que entra, onde, e o que fica de fora por já existir. */
export function planImport(candidates: ImportCandidate[], existing: { folders: LinkFolder[]; links: SavedLink[] }, mode: ImportMode): ImportPlan {
  const known = new Set(existing.links.map((link) => urlKey(link.url)))
  const folderByName = new Map(existing.folders.map((folder) => [fold(folder.name), folder]))
  const newFolders = new Map<string, string>()
  const plan: ImportPlan = { newFolders: [], links: [], skipped: 0 }
  for (const candidate of candidates) {
    const url = normalizeUrl(candidate.url)
    if (!url) continue
    const key = urlKey(url)
    if (known.has(key)) {
      plan.skipped++
      continue
    }
    known.add(key)
    let folderId: string | null = null
    let folderName: string | null = null
    if (mode.kind === 'single') {
      folderId = mode.folderId
    } else if (candidate.path.length > 1) {
      // A pasta é a de dentro (a raiz do navegador não vira pasta)
      const name = candidate.path.at(-1)!.trim().slice(0, 40) || 'Pasta'
      const found = folderByName.get(fold(name))
      if (found) folderId = found.id
      else {
        if (!newFolders.has(fold(name))) newFolders.set(fold(name), name)
        folderName = newFolders.get(fold(name))!
      }
    }
    plan.links.push({ title: candidate.title.trim() || url, url, icon: candidate.icon, folderId, folderName })
  }
  plan.newFolders = [...newFolders.values()]
  return plan
}
