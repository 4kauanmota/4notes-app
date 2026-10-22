/**
 * Como os gráficos (components/timer/Timer*.vue) escrevem os valores e escolhem os
 * números "redondos" da grade. O padrão é tempo (Timer); as Finanças (1.7.0) usam os
 * mesmos gráficos com valores em dinheiro (lib/finance/format.ts › MONEY_FORMAT).
 */
import { formatDuration, formatShortDuration } from './timer/format'

export interface ChartFormat {
  /** Valor completo (balões, legendas, totais): "2 h 15 min", "R$ 1.234,56". */
  full(value: number): string
  /** Valor curto (grade, número sobre a coluna): "2h15", "R$ 1,2 mil". */
  short(value: number): string
  /** Passos possíveis entre as linhas da grade (crescentes), na unidade dos valores. */
  steps: readonly number[]
}

const MIN = 60_000

export const TIME_FORMAT: ChartFormat = {
  full: (ms) => formatDuration(ms, { seconds: false }),
  short: formatShortDuration,
  steps: [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720, 1440, 2880, 4320, 7200, 14400].map((m) => m * MIN),
}
