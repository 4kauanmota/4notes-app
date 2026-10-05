/**
 * Ícones prontos para as categorias das Notas e as pastas dos Links.
 * O nome fica gravado no arquivo (categorias.json / links.json), então os nomes
 * desta lista não devem mudar. Os desenhos ficam em lib/icons.ts.
 */
import { ICONS } from './icons'

export interface CategoryIcon {
  name: string
  /** Sugestão de uso (aparece como dica ao passar o mouse). */
  label: string
}

export const CATEGORY_ICONS: readonly CategoryIcon[] = [
  { name: 'briefcase', label: 'Trabalho' },
  { name: 'code', label: 'Código' },
  { name: 'terminal', label: 'Terminal' },
  { name: 'bug', label: 'Bugs' },
  { name: 'rocket', label: 'Projetos' },
  { name: 'book', label: 'Leitura' },
  { name: 'graduation', label: 'Estudos' },
  { name: 'bulb', label: 'Ideias' },
  { name: 'edit', label: 'Escrita' },
  { name: 'bookmark', label: 'Salvos' },
  { name: 'home', label: 'Casa' },
  { name: 'heart', label: 'Pessoal' },
  { name: 'star', label: 'Favoritos' },
  { name: 'flag', label: 'Importante' },
  { name: 'target', label: 'Metas' },
  { name: 'calendar', label: 'Agenda' },
  { name: 'checklist', label: 'Listas' },
  { name: 'chat', label: 'Conversas' },
  { name: 'users', label: 'Pessoas' },
  { name: 'paw', label: 'Pets' },
  { name: 'gamepad', label: 'Jogos' },
  { name: 'music', label: 'Música' },
  { name: 'video', label: 'Vídeos' },
  { name: 'film', label: 'Filmes e séries' },
  { name: 'camera', label: 'Fotos' },
  { name: 'palette', label: 'Arte e design' },
  { name: 'sparkle', label: 'Inspiração' },
  { name: 'globe', label: 'Web' },
  { name: 'plane', label: 'Viagens' },
  { name: 'coffee', label: 'Café e rotina' },
  { name: 'utensils', label: 'Receitas' },
  { name: 'cart', label: 'Compras' },
  { name: 'wallet', label: 'Finanças' },
  { name: 'dumbbell', label: 'Treino' },
  { name: 'leaf', label: 'Natureza e saúde' },
  { name: 'puzzle', label: 'Desafios' },
  { name: 'cloud', label: 'Nuvem' },
  { name: 'lock', label: 'Privado' },
  { name: 'folder', label: 'Pasta' },
]

const NAMES = new Set(CATEGORY_ICONS.map((icon) => icon.name))

/** O valor lido do arquivo é um dos ícones da lista? */
export function isCategoryIcon(value: unknown): value is string {
  return typeof value === 'string' && NAMES.has(value) && value in ICONS
}
