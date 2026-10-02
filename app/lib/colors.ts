/**
 * Paleta de cores do 4notes (categorias de tarefas, nós do mapa e cor do texto).
 * Cada cor tem uma variável CSS por tema (--cat-<cor>, em assets/css/tokens.css),
 * então o mesmo nome fica legível no modo claro e no escuro.
 * Os nomes também são cores válidas do CSS (red, blue…), o que mantém os arquivos
 * legíveis em outros programas.
 */
export const PALETTE = ['purple', 'yellow', 'blue', 'green', 'red', 'orange', 'teal', 'pink', 'gray'] as const
export type PaletteColor = (typeof PALETTE)[number]

export const PALETTE_LABELS: Record<PaletteColor, string> = {
  purple: 'Roxo',
  yellow: 'Amarelo',
  blue: 'Azul',
  green: 'Verde',
  red: 'Vermelho',
  orange: 'Laranja',
  teal: 'Turquesa',
  pink: 'Rosa',
  gray: 'Cinza',
}

export function isPaletteColor(value: unknown): value is PaletteColor {
  return typeof value === 'string' && (PALETTE as readonly string[]).includes(value)
}

/** Variável CSS da cor no tema atual. */
export const paletteVar = (color: PaletteColor) => `var(--cat-${color})`
