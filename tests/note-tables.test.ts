// 1.7.3: tabelas simples nas notas (o formato no arquivo, as somas e a exportação).
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  insertColumn,
  insertRow,
  moveColumn,
  newTable,
  parseCellNumber,
  parseTable,
  parseTableConfig,
  removeColumn,
  removeRow,
  serializeTable,
  setCell,
  setColumnTotal,
  setColumnType,
  splitRow,
  sumColumn,
  totalRow,
} from '~/lib/editor/table-model'
import { noteTables } from '~/lib/editor/tables'
import { noteToPlainText } from '~/lib/notes/export'

const EXPENSES = `<!-- 4notes-table {"columns":[{"type":"text"},{"type":"number","total":true}]} -->
| Descrição | Valor |
| --- | ---: |
| Mercado | 150 |
| Internet | 100 |
| Energia | 200 |
| **Total** | **450** |`

const stateOf = (doc: string) => {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state.update({}).state
}

describe('números das células', () => {
  it('lê o jeito brasileiro e o outro', () => {
    expect(parseCellNumber('150')?.value).toBe(150)
    expect(parseCellNumber('1.234,56')?.value).toBe(1234.56)
    expect(parseCellNumber('1,234.56')?.value).toBe(1234.56)
    expect(parseCellNumber('12,5')?.value).toBe(12.5)
    expect(parseCellNumber('1.5')?.value).toBe(1.5)
    expect(parseCellNumber('1.234')?.value).toBe(1234)
    expect(parseCellNumber('R$ 52,30')?.value).toBe(52.3)
    expect(parseCellNumber('-3')?.value).toBe(-3)
    expect(parseCellNumber('(10)')?.value).toBe(-10)
    expect(parseCellNumber('**450**')?.value).toBe(450)
  })

  it('vazio = nada; texto = não é número', () => {
    expect(parseCellNumber('')).toBeNull()
    expect(parseCellNumber('   ')).toBeNull()
    expect(parseCellNumber('abc')?.value).toBeNaN()
    expect(parseCellNumber('1,2,3')?.value).toBeNaN()
    expect(parseCellNumber('12 reais')?.value).toBeNaN()
  })

  it('soma sem erro com células vazias e textos; escreve como os valores', () => {
    const rows = [['150'], [''], ['abc'], ['100,50'], ['0,1'], ['0,2']]
    expect(sumColumn(rows, 0)).toEqual({ value: 250.8, text: '250,80', invalid: 1, count: 4 })
    expect(sumColumn([['1.000'], ['2.500']], 0).text).toBe('3.500')
    expect(sumColumn([['1.5'], ['2.25']], 0).text).toBe('3.75')
    expect(sumColumn([[''], ['']], 0)).toMatchObject({ value: 0, text: '0', count: 0 })
    expect(sumColumn([['10'], ['-12,5']], 0).text).toBe('-2,5')
  })
})

describe('tabela no arquivo', () => {
  it('lê o exemplo: tipos pelo comentário, linha Total fora dos dados', () => {
    const lines = EXPENSES.split('\n')
    const table = parseTable(lines.slice(1), parseTableConfig(lines[0]!))!
    expect(table.columns).toEqual([
      { name: 'Descrição', type: 'text', total: false },
      { name: 'Valor', type: 'number', total: true },
    ])
    expect(table.rows).toEqual([['Mercado', '150'], ['Internet', '100'], ['Energia', '200']])
    expect(totalRow(table)).toEqual(['Total', '450'])
  })

  it('grava de volta igual, e a linha Total acompanha as mudanças', () => {
    const lines = EXPENSES.split('\n')
    const table = parseTable(lines.slice(1), parseTableConfig(lines[0]!))!
    expect(serializeTable(table)).toBe(EXPENSES)
    const changed = setCell(table, 1, 1, '120')
    expect(serializeTable(changed).split('\n').at(-1)).toBe('| **Total** | **470** |')
    const removed = removeRow(changed, 0)
    expect(serializeTable(removed).split('\n').at(-1)).toBe('| **Total** | **320** |')
    const added = setCell(insertRow(removed, 2), 2, 1, '30')
    expect(serializeTable(added).split('\n').at(-1)).toBe('| **Total** | **350** |')
  })

  it('tabela sem tipos nem total: só a tabela (sem comentário)', () => {
    const text = serializeTable(newTable(2, 2))
    expect(text).toBe('| Coluna 1 | Coluna 2 |\n| --- | --- |\n|  |  |\n|  |  |')
    expect(parseTable(text.split('\n'), null)!.rows).toEqual([['', ''], ['', '']])
  })

  it('o usuário escolhe quais colunas somam', () => {
    let table = newTable(3, 1)
    table = setColumnType(table, 1, 'number')
    table = setColumnType(table, 2, 'number')
    table = setColumnTotal(table, 2, false)
    table = setCell(setCell(table, 0, 1, '5'), 0, 2, '7')
    expect(totalRow(table)).toEqual(['Total', '5', ''])
    const text = serializeTable(table)
    expect(text.split('\n')[0]).toBe('<!-- 4notes-table {"columns":[{"type":"text"},{"type":"number","total":true},{"type":"number"}]} -->')
    expect(text.split('\n')[2]).toBe('| --- | ---: | ---: |')
    // Voltar a texto tira a soma (e o comentário, quando não sobra nada)
    const plain = setColumnType(setColumnType(table, 1, 'text'), 2, 'text')
    expect(serializeTable(plain).startsWith('| Coluna 1')).toBe(true)
  })

  it('barras dentro da célula, colunas faltando e colunas a mais', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
    const table = parseTable(['| A | B |', '|---|---|', '| só uma |', '| 1 | 2 | 3 |'], null)!
    expect(table.rows).toEqual([['só uma', ''], ['1', '2']])
    expect(serializeTable(setCell(table, 0, 1, 'x|y'))).toContain('| só uma | x\\|y |')
  })

  it('inserir, mover e remover colunas leva as células junto; sempre fica uma coluna e uma linha', () => {
    let table = newTable(2, 1)
    table = setCell(setCell(table, 0, 0, 'a'), 0, 1, 'b')
    expect(insertColumn(table, 1).rows[0]).toEqual(['a', '', 'b'])
    expect(moveColumn(table, 0, 1).rows[0]).toEqual(['b', 'a'])
    expect(removeColumn(table, 0).rows[0]).toEqual(['b'])
    expect(removeColumn(removeColumn(table, 0), 0).columns).toHaveLength(1)
    expect(removeRow(table, 0).rows).toEqual([['', '']])
  })

  it('a linha Total escrita à mão sem total configurado continua sendo dado', () => {
    const table = parseTable(['| A | B |', '| --- | --- |', '| x | 1 |', '| **Total** | **1** |'], null)!
    expect(table.rows).toHaveLength(2)
  })
})

describe('na nota', () => {
  it('acha a tabela com o comentário; não acha em bloco de código', () => {
    const doc = `# Gastos\n\n${EXPENSES}\n\nfim\n\n\`\`\`\n| a | b |\n| - | - |\n\`\`\``
    const tables = noteTables(stateOf(doc))
    expect(tables).toHaveLength(1)
    expect(doc.slice(tables[0]!.from, tables[0]!.to)).toBe(EXPENSES)
  })

  it('Exportar TXT: colunas alinhadas e a linha Total, sem o comentário', () => {
    const text = noteToPlainText(`Antes\n\n${EXPENSES}\n\nDepois`, 'notes')
    expect(text).toBe(
      ['Antes', '', 'Descrição   Valor', '---------   -----', 'Mercado       150', 'Internet      100', 'Energia       200', 'Total         450', '', 'Depois', ''].join('\n'),
    )
  })
})
