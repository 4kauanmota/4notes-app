import { describe, expect, it } from 'vitest'
import { syntaxTree } from '@codemirror/language'
import { matchCategory, titleLineFinished } from '~/lib/notes/auto-category'
import { noteToHtml, noteToPdfHtml, noteToPlainText, parseNote } from '~/lib/notes/export'

describe('categoria automática pelo título', () => {
  const groups = [
    { category: 'Dev', titles: ['4notes 1.1.1', '4notes 1.2.0', 'Godot'] },
    { category: 'Pessoal', titles: ['Lista de compras', 'Viagem'] },
  ]

  it('vai para a categoria que tem notas com o mesmo começo de título', () => {
    expect(matchCategory('4notes 1.2.1', groups)).toBe('Dev')
    expect(matchCategory('4NOTES ideias', groups)).toBe('Dev') // sem diferenciar maiúsculas
    expect(matchCategory('Lista de tarefas', groups)).toBe('Pessoal')
    expect(matchCategory('Godot', groups)).toBe('Dev')
  })

  it('sem começo em comum (ou sem título), fica onde está', () => {
    expect(matchCategory('Receitas', groups)).toBeNull()
    expect(matchCategory('', groups)).toBeNull()
    expect(matchCategory('4notesx', groups)).toBeNull() // a palavra inteira precisa ser igual
    expect(matchCategory('4notes', [])).toBeNull()
  })

  it('vale o começo mais comprido; depois, quem tem mais notas assim; empate não decide', () => {
    const many = [
      { category: 'A', titles: ['Projeto x alfa'] },
      { category: 'B', titles: ['Projeto x beta', 'Projeto y'] },
      { category: 'C', titles: ['Projeto z', 'Projeto w', 'Projeto k'] },
    ]
    // "Projeto x" tem 2 palavras em comum com A e B; B tem mais notas assim? Não: uma cada → empate
    expect(matchCategory('Projeto x gama', many)).toBeNull()
    expect(matchCategory('Projeto x alfa 2', many)).toBe('A') // 3 palavras em comum
    // Só a primeira palavra em comum: C tem mais notas com ela
    expect(matchCategory('Projeto novo', many)).toBe('C')
  })

  it('o título está pronto depois do Enter', () => {
    expect(titleLineFinished('# 4notes 1.2.1')).toBe(false)
    expect(titleLineFinished('# 4notes 1.2.1\n')).toBe(true)
    expect(titleLineFinished('\n\n# Título\ntexto')).toBe(true)
    expect(titleLineFinished('\n\n# Título')).toBe(false)
  })
})

const NOTE = [
  '# Plano do **projeto**',
  '',
  'Texto com *itálico*, <u>sublinhado</u>, ~~riscado~~, ==marca-texto==, `código` e <span style="color: red">cor</span>.',
  'Veja o [site do Nuxt](https://nuxt.com/docs) e a nota [Ideias](Ideias.md) e a tarefa [Estudar](../tasks/tasks.json#t_1).',
  'Escape: 2 \\* 3',
  '',
  '## Lista',
  '- item um',
  '  - item aninhado',
  '1. primeiro',
  '- [ ] a fazer',
  '- [x] feito',
  '> citação',
  '---',
  '![](../attachments/foto%20nova.png)',
  '```js',
  'const a = 1 // comentário',
  '```',
  'fim',
].join('\n')

describe('exportar como TXT', () => {
  it('tira toda a formatação e a sintaxe do Markdown', () => {
    expect(noteToPlainText(NOTE, 'notes').split('\n')).toEqual([
      'Plano do projeto',
      '',
      'Texto com itálico, sublinhado, riscado, marca-texto, código e cor.',
      'Veja o site do Nuxt e a nota Ideias e a tarefa Estudar.',
      'Escape: 2 * 3',
      '',
      'Lista',
      '• item um',
      '  • item aninhado',
      '1. primeiro',
      '☐ a fazer',
      '☑ feito',
      'citação',
      '',
      'const a = 1 // comentário',
      'fim',
      '',
    ])
  })

  it('quebra de linha com "\\" no fim: a barra é sintaxe e sai', () => {
    expect(noteToPlainText('linha\\\nsegunda', 'notes')).toBe('linha\nsegunda\n')
  })

  it('nota vazia ou só com espaços vira um arquivo vazio', () => {
    expect(noteToPlainText('', 'notes')).toBe('')
    expect(noteToPlainText('\n\n  \n', 'notes')).toBe('')
  })

  it('bloco de código sem fechar continua como texto (igual ao editor)', () => {
    expect(noteToPlainText('```js\nconst a', 'notes')).toBe('```js\nconst a\n')
  })
})

describe('exportar como PDF (HTML com a formatação)', () => {
  it('mantém títulos, formatos, links, menções, listas, imagens e blocos de código', async () => {
    const html = await noteToHtml(NOTE, 'notes')
    expect(html).toContain('<h1 class="line">Plano do <span class="b">projeto</span></h1>')
    expect(html).toContain('<span class="i">itálico</span>')
    expect(html).toContain('<span class="u">sublinhado</span>')
    expect(html).toContain('<span class="s">riscado</span>')
    expect(html).toContain('<span class="hl">marca-texto</span>')
    expect(html).toContain('<code>código</code>')
    expect(html).toContain('<span style="color: var(--cat-red)">cor</span>')
    expect(html).toContain('<a href="https://nuxt.com/docs">site do Nuxt</a>')
    expect(html).toContain('<span class="mention note">Ideias</span>')
    expect(html).toContain('<span class="mention task">Estudar</span>')
    expect(html).toContain('Escape: 2 * 3')
    expect(html).toContain('<h2 class="line">Lista</h2>')
    expect(html).toContain('<div class="line li" style="--level: 1"><span class="marker bullet">•</span>item aninhado</div>')
    expect(html).toContain('<span class="marker ordered">1.</span>primeiro')
    expect(html).toContain('<span class="checkbox"></span></span>a fazer')
    expect(html).toContain('<span class="checkbox checked"></span></span><span class="task-done">feito</span>')
    expect(html).toContain('<div class="line quote">citação</div>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<div class="image"><img class="img" src="workspace://files/attachments/foto%20nova.png" alt=""></div>')
    // Código colorido (a linguagem é carregada na hora)
    expect(html).toMatch(/<div class="code"><div class="code-head">JavaScript<\/div><pre><span class="tk">const<\/span> <span class="td">a<\/span> <span class="to">=<\/span> <span class="tn">1<\/span> <span class="tc">\/\/ comentário<\/span><\/pre><\/div>/)
    expect(html).toContain('<div class="line">fim</div>')
  })

  it('marca-texto colorido (1.7.1): tom claro no PDF e texto limpo no TXT', async () => {
    const note = '- <mark style="background-color: #fef08a">amarelo</mark> e <span style="color: red"><mark style="background-color: #bfdbfe">duas</mark></span>'
    const html = await noteToHtml(note, 'notes')
    expect(html).toContain('<span class="hl" style="background: #fef08a">amarelo</span>')
    expect(html).toContain('<span class="hl" style="color: var(--cat-red); background: #bfdbfe">duas</span>')
    expect(noteToPlainText(note, 'notes').trim()).toBe('• amarelo e duas')
  })

  it('linhas vazias continuam no lugar; links para arquivos e endereços estranhos não viram links', async () => {
    const html = await noteToHtml('a\n\nb [x](javascript:alert(1)) [y](arquivo.pdf)', 'notes')
    expect(html.split('\n')[1]).toBe('<div class="line">&nbsp;</div>')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('<span class="link">x</span>')
    expect(html).toContain('<span class="link">y</span>')
  })

  it('escapa o HTML digitado na nota', async () => {
    const html = await noteToHtml('<script>alert(1)</script> & <b>x</b>', 'notes')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  })

  it('o documento do PDF bloqueia qualquer coisa de fora', async () => {
    const page = await noteToPdfHtml('# Oi', 'notes', 'Título <x>')
    expect(page).toContain(`default-src 'none'; img-src data:`)
    expect(page).toContain('<title>Título &lt;x&gt;</title>')
  })

  it('lê notas grandes inteiras (a árvore fica completa até o fim)', () => {
    const big = `${'Parágrafo com **negrito** e texto suficiente para pesar.\n'.repeat(6000)}# Último título`
    const state = parseNote(big)
    expect(syntaxTree(state).length).toBe(state.doc.length)
    expect(noteToPlainText(big, 'notes').trimEnd().split('\n').at(-1)).toBe('Último título')
  })
})
