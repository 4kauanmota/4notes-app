/**
 * Dinheiro nas Finanças (1.7.0): os valores ficam em CENTAVOS (números inteiros), para
 * as somas nunca terem erro de arredondamento (0,1 + 0,2), e aparecem em reais, no
 * formato brasileiro (o app inteiro é em pt-BR): "R$ 1.234,56".
 */
import type { ChartFormat } from '../chart-format'

export const CURRENCY = 'BRL'
/** Maior valor aceito num gasto: R$ 99.999.999,99. */
export const MAX_AMOUNT = 9_999_999_999

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: CURRENCY })
const plain = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 123456 → "R$ 1.234,56" (com espaço comum entre o R$ e o número). */
export function formatMoney(cents: number): string {
  return money.format(cents / 100).replace(/ /g, ' ')
}

/** 123456 → "1.234,56" (o campo de valor, sem o R$). */
export function formatAmountInput(cents: number): string {
  return plain.format(cents / 100)
}

/** Diferença com sinal: "+R$ 12,00", "−R$ 3,50", "R$ 0,00". */
export function formatSignedMoney(cents: number): string {
  if (!cents) return formatMoney(0)
  return `${cents > 0 ? '+' : '−'}${formatMoney(Math.abs(cents))}`
}

/** Valor curto para a grade dos gráficos: 50000 → "500", 150000 → "1,5 mil", 250000000 → "2,5 mi". */
export function formatShortMoney(cents: number): string {
  const reais = cents / 100
  const abs = Math.abs(reais)
  const one = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: value < 10 ? 1 : 0 })
  if (abs >= 1_000_000) return `${one(reais / 1_000_000)} mi`
  if (abs >= 1000) return `${one(reais / 1000)} mil`
  if (abs >= 10 || Number.isInteger(reais)) return Math.round(reais).toLocaleString('pt-BR')
  return reais.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

/**
 * O que foi digitado no campo de valor → centavos (ou null se não é um valor válido).
 * Aceita o jeito brasileiro e o com ponto: "52", "52,3", "52,30", "R$ 1.234,56",
 * "1234.56", "1.234" (mil e duzentos e trinta e quatro), "0,99".
 */
export function parseAmount(input: string): number | null {
  let text = input.replace(/R\$|\s| /gi, '')
  if (!text) return null
  if (!/^[\d.,]+$/.test(text)) return null
  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  let decimal: ',' | '.' | null = null
  if (lastComma >= 0 && lastDot >= 0) decimal = lastComma > lastDot ? ',' : '.'
  else if (lastComma >= 0) decimal = ','
  else if (lastDot >= 0) {
    // Só pontos: "1.234" e "1.234.567" são milhares; "12.5" e "12.50" são centavos
    const dots = (text.match(/\./g) ?? []).length
    decimal = dots === 1 && text.length - lastDot - 1 !== 3 ? '.' : null
  }
  if (decimal) {
    const index = text.lastIndexOf(decimal)
    const whole = text.slice(0, index).replace(/[.,]/g, '')
    const fraction = text.slice(index + 1)
    if (fraction.includes(',') || fraction.includes('.') || fraction.length > 2) return null
    text = `${whole || '0'}.${fraction.padEnd(2, '0')}`
  } else {
    text = text.replace(/[.,]/g, '')
  }
  const value = Math.round(Number(text) * 100)
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) return null
  return value
}

/** Gráficos (components/timer/Timer*.vue) com valores em dinheiro: grade em valores "redondos" de reais. */
export const MONEY_FORMAT: ChartFormat = {
  full: formatMoney,
  short: formatShortMoney,
  steps: [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000, 10_000_000].map(
    (reais) => reais * 100,
  ),
}
