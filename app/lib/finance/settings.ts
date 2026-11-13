/**
 * Configurações das Finanças (1.7.0): seção "finance" do .4notes/settings.json (as
 * mesmas no computador e no celular).
 *
 *   "finance": { "weekStart": 1,           ← a semana dos gráficos começa na segunda (0 = domingo)
 *                "notify": true,           ← aviso do sistema das contas com "Me lembre de pagar" (1.7.1)
 *                "defaultCategory": "x" }  ← categoria dos gastos sem outra sugestão (1.7.2; null = nenhuma)
 *
 * A 1.7.2 também guardava aqui "bank" (os bancos da conexão pelo Meu Pluggy). A conexão saiu
 * na 1.7.3: `hasLegacyBank` avisa o store, que grava a seção de novo sem essa chave.
 *
 * O que se usa toda hora (período, filtros, ordem do histórico) fica na própria tela.
 */
import type { WeekStart } from '../timer/stats'

export interface FinanceSettings {
  weekStart: WeekStart
  notify: boolean
  /** Id da categoria padrão dos gastos (quando a categoria automática não acha outra); null = nenhuma. */
  defaultCategory: string | null
}

export const DEFAULT_FINANCE_SETTINGS: Readonly<FinanceSettings> = { weekStart: 1, notify: true, defaultCategory: null }

export function normalizeFinanceSettings(raw: unknown): FinanceSettings {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const defaultCategory = typeof data.defaultCategory === 'string' && data.defaultCategory.trim() ? data.defaultCategory.trim() : null
  return { weekStart: data.weekStart === 0 ? 0 : 1, notify: data.notify !== false, defaultCategory }
}

/** A seção ainda tem os bancos da 1.7.2 (conexão removida na 1.7.3). */
export function hasLegacyBank(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && 'bank' in raw
}
