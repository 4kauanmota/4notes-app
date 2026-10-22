/**
 * O que cada tipo de menção mostra (ícone e textos) e como a lista do "@" é filtrada
 * e ordenada. Regras puras, usadas pelo editor (chips das notas), pelas menções das
 * tarefas e pelo "Ver menções".
 *
 * Um módulo novo que quiser ser mencionado ganha uma linha aqui (e um "provedor" em
 * stores/mentions.ts, que sabe listar, descrever e abrir os itens dele).
 */
import type { MentionKind } from '../notes/mention-links'

export interface MentionKindInfo {
  icon: string
  /** Nome do tipo ("Tarefa", "Registro do Timer"…). */
  noun: string
  /** Dica do chip: o que o clique faz. */
  open: string
  /** Dica do chip quando o item não existe mais. */
  missing: string
  /** Aviso ao tentar abrir um item que não existe mais. */
  gone: string
}

export const MENTION_KINDS: Record<MentionKind, MentionKindInfo> = {
  note: {
    icon: 'notes',
    noun: 'Nota',
    open: 'Abrir a nota',
    missing: 'Nota não encontrada',
    gone: 'A nota não foi encontrada (foi apagada ou renomeada fora do app).',
  },
  map: {
    icon: 'graph',
    noun: 'Nota do mapa',
    open: 'Abrir a nota no Mapa Mental',
    missing: 'Nota não encontrada',
    gone: 'A nota não foi encontrada (foi apagada ou renomeada fora do app).',
  },
  mindmap: {
    icon: 'layers',
    noun: 'Mapa mental',
    open: 'Abrir o mapa',
    missing: 'Mapa não encontrado',
    gone: 'O mapa não foi encontrado (foi apagado ou renomeado fora do app).',
  },
  task: {
    icon: 'task-open',
    noun: 'Tarefa',
    open: 'Abrir a tarefa',
    missing: 'Tarefa não encontrada',
    gone: 'A tarefa não foi encontrada (foi excluída).',
  },
  timer: {
    icon: 'timer',
    noun: 'Registro do Timer',
    open: 'Abrir o registro no Timer',
    missing: 'Registro do Timer não encontrado',
    gone: 'O registro do Timer não foi encontrado (foi excluído).',
  },
  link: {
    icon: 'link',
    noun: 'Link',
    open: 'Abrir o link',
    missing: 'Link não encontrado',
    gone: 'O link não foi encontrado no módulo Links (foi excluído).',
  },
  expense: {
    icon: 'wallet',
    noun: 'Gasto',
    open: 'Abrir o gasto nas Finanças',
    missing: 'Gasto não encontrado',
    gone: 'O gasto não foi encontrado nas Finanças (foi excluído).',
  },
}

/** Um item da lista do "@", antes de filtrar e ordenar. */
export interface RankItem {
  title: string
  /** Outros textos que também acham o item (categoria, endereço, data…). */
  keywords?: string
  /** Fila: 0 = notas e tarefas abertas, 1 = tarefas concluídas, 2 = mapas e links, 3 = registros do Timer e gastos. */
  late?: number
  /** Desempate dentro da mesma fila (menor primeiro) — ex.: registros mais recentes antes. */
  order?: number
}

export const foldText = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR')

/**
 * Filtra pelo texto digitado e ordena: título que começa com o texto, depois título que
 * contém o texto, depois os achados palavra por palavra no título e nas outras palavras
 * (categoria, data…: "estudo 12/10"); em cada grupo, a fila (`late`), a ordem própria
 * (`order`) e o título (A–Z).
 */
export function rankMentions<T extends RankItem>(items: readonly T[], query: string, limit: number): T[] {
  const q = foldText(query.trim())
  const words = q.split(/\s+/).filter(Boolean)
  const scored: { item: T; score: number; title: string }[] = []
  for (const item of items) {
    const title = foldText(item.title)
    let score = 0
    if (q) {
      if (title.startsWith(q)) score = 0
      else if (title.includes(q)) score = 1
      else {
        const haystack = `${title} ${item.keywords ? foldText(item.keywords) : ''}`
        if (!words.every((word) => haystack.includes(word))) continue
        score = 2
      }
    }
    scored.push({ item, score, title })
  }
  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        (a.item.late ?? 0) - (b.item.late ?? 0) ||
        (a.item.order ?? 0) - (b.item.order ?? 0) ||
        a.title.localeCompare(b.title, 'pt-BR'),
    )
    .slice(0, limit)
    .map(({ item }) => item)
}
