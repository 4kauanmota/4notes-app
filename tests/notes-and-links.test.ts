import { describe, expect, it } from 'vitest'
import { stripHtmlFormatting, toPlainText } from '~/lib/editor/markup'
import { sanitizeFileName, uniqueName } from '~/lib/files/filename'
import { parseWikiLinks } from '~/lib/mindmap/wikilinks'
import { countWords, deriveTitle, notePreview } from '~/lib/notes/title'

describe('título das notas', () => {
  it('usa a primeira linha sem a marcação Markdown', () => {
    expect(deriveTitle('# Minha primeira nota\n\nConteúdo da nota...')).toBe('Minha primeira nota')
    expect(deriveTitle('\n\n  **Lista** de compras\n- pão')).toBe('Lista de compras')
    expect(deriveTitle('- [ ] ligar para o João')).toBe('ligar para o João')
    expect(deriveTitle('---\ntags: x\n---\n## Título real')).toBe('Título real')
    expect(deriveTitle('```js\nconst a = 1\n```\nDepois do código')).toBe('Depois do código')
    expect(deriveTitle('#\n\nSegunda linha')).toBe('Segunda linha')
    expect(deriveTitle('   ')).toBe('')
  })

  it('ignora a formatação (sublinhado, cor, marca-texto) no título', () => {
    expect(deriveTitle('# <u>Plano</u> de <span style="color: red">estudos</span>\ntexto')).toBe('Plano de estudos')
    expect(deriveTitle('==Importante== **mesmo**')).toBe('Importante mesmo')
    expect(stripHtmlFormatting('a <u>b</u> <span style=\'color: #ff0000\'>c</span>')).toBe('a b c')
    expect(toPlainText('## Título\n**negrito** e <u>sublinhado</u>')).toBe('Título negrito e sublinhado')
  })

  it('gera prévia e contagem de palavras', () => {
    expect(notePreview('# Título\nlinha um\n\nlinha **dois**')).toBe('linha um · linha dois')
    expect(countWords('  olá   mundo \n teste ')).toBe(3)
    expect(countWords('')).toBe(0)
    expect(countWords('um <span style="color: red">dois</span> <u>três</u>')).toBe(3)
  })
})

describe('nomes de arquivo', () => {
  it('remove caracteres inválidos no Windows', () => {
    expect(sanitizeFileName('Reunião: 10/10 <importante>?')).toBe('Reunião 10 10 importante')
    expect(sanitizeFileName('  termina com ponto...  ')).toBe('termina com ponto')
    expect(sanitizeFileName('CON')).toBe('CON_')
    expect(sanitizeFileName('')).toBe('Sem título')
    expect(sanitizeFileName('Godot [[motor]] #1', { forWikilinks: true })).toBe('Godot motor 1')
    expect(Array.from(sanitizeFileName('a'.repeat(200))).length).toBe(80)
  })

  it('cria nomes únicos', () => {
    const taken = new Set(['ideia', 'ideia (2)'])
    expect(uniqueName('Ideia', (n) => taken.has(n.toLowerCase()))).toBe('Ideia (3)')
  })
})

describe('[[links]] da versão 1.0.0', () => {
  it('interpreta apelidos, seções e embeds e ignora código', () => {
    const links = parseWikiLinks('Veja [[Godot]], [[Game Design|GD]] e ![[Arte#Paleta]].\n`[[NaoConta]]`\n```\n[[Tambem nao]]\n```\n[[Programação.md]]')
    expect(links.map((l) => l.target)).toEqual(['Godot', 'Game Design', 'Arte', 'Programação'])
    expect(links[1]!.alias).toBe('GD')
    expect(links[2]!.heading).toBe('Paleta')
    expect(links[2]!.embed).toBe(true)
  })
})
