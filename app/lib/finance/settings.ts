/**
 * Configurações das Finanças (1.7.0): seção "finance" do .4notes/settings.json (as
 * mesmas no computador e no celular).
 *
 *   "finance": { "weekStart": 1 }   ← a semana dos gráficos começa na segunda (0 = domingo)
 *
 * O que se usa toda hora (período, filtros, ordem do histórico) fica na própria tela.
 */
import type { WeekStart } from '../timer/stats'

export interface FinanceSettings {
  weekStart: WeekStart
}

export const DEFAULT_FINANCE_SETTINGS: Readonly<FinanceSettings> = { weekStart: 1 }

export function normalizeFinanceSettings(raw: unknown): FinanceSettings {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return { weekStart: data.weekStart === 0 ? 0 : 1 }
}
