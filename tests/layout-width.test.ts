// Aproveitamento da largura (4notes 1.6.3): as telas dos módulos ocupam toda a largura
// da janela. Até a 1.6.2, Tarefas, Links e Timer limitavam o conteúdo (width: min(820px,
// 100%)…) e sobrava um vazio grande à direita em janelas largas. Este teste confere a
// regra no código das páginas, para o problema não voltar numa tela nova.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pagesDir = fileURLToPath(new URL('../app/pages/', import.meta.url))
const baseCss = readFileSync(fileURLToPath(new URL('../app/assets/css/base.css', import.meta.url)), 'utf8')

/** Páginas dos módulos (index.vue só redireciona). */
const pages = readdirSync(pagesDir)
  .filter((name) => name.endsWith('.vue') && name !== 'index.vue')
  .map((name) => ({ name, source: readFileSync(pagesDir + name, 'utf8') }))

const styleOf = (source: string) => [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')

describe('largura das telas dos módulos', () => {
  it('existe a regra comum (.module-content) ocupando a largura toda', () => {
    const rule = /\.module-content\s*\{([^}]*)\}/.exec(baseCss)?.[1] ?? ''
    expect(rule).toMatch(/width:\s*100%/)
    expect(rule).not.toMatch(/max-width/)
  })

  it('as páginas com conteúdo rolável usam .module-content', () => {
    for (const name of ['tasks.vue', 'links.vue', 'timer.vue']) {
      const page = pages.find((item) => item.name === name)!
      expect(page.source, name).toMatch(/class="[^"]*\bmodule-content\b/)
    }
  })

  it('nenhuma página limita a largura do conteúdo (width: min(Npx…) ou max-width em px)', () => {
    for (const { name, source } of pages) {
      const css = styleOf(source)
      expect(css, name).not.toMatch(/width:\s*min\(\s*\d{3,}px/)
      // (as media queries, "@media (max-width: 980px)", não contam)
      expect(css, name).not.toMatch(/(?<!\()max-width:\s*\d{3,}px/)
    }
  })
})
