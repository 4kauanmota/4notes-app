// Tamanhos de tela (composables/useLayoutSize.ts): o layout vem do tamanho e do tipo de
// tela, não do aparelho — Galaxy Z Fold fechado e aberto, celular deitado, desktop.
import { describe, expect, it } from 'vitest'
import { classifyLayout } from '~/composables/useLayoutSize'

describe('classes de tamanho', () => {
  it('tela externa do Fold (fechado) e celulares: compact', () => {
    expect(classifyLayout(344, 882, true)).toBe('compact')
    expect(classifyLayout(412, 915, true)).toBe('compact')
    expect(classifyLayout(599, 900, true)).toBe('compact')
  })

  it('tela interna do Fold (aberto), em pé e deitado: medium', () => {
    expect(classifyLayout(690, 829, true)).toBe('medium')
    expect(classifyLayout(750, 832, true)).toBe('medium')
    expect(classifyLayout(829, 690, true)).toBe('medium')
  })

  it('celular deitado (largo, mas baixo): medium, não o layout do desktop', () => {
    expect(classifyLayout(882, 344, true)).toBe('medium')
    expect(classifyLayout(915, 412, true)).toBe('medium')
  })

  it('tablet grande com toque e desktop com mouse: expanded', () => {
    expect(classifyLayout(1024, 768, true)).toBe('expanded')
    expect(classifyLayout(760, 520, false)).toBe('expanded')
    expect(classifyLayout(1280, 820, false)).toBe('expanded')
  })
})
