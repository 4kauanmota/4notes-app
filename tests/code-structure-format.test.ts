import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { detectIndentUnit, guideLevels, indentFoldRange, indentWidth } from '../app/lib/editor/code-structure'
import { canFormat, detectStyle, formatCode, formatterFor } from '../app/lib/editor/format-code'

describe('recuo e guias de indentação', () => {
  it('largura do recuo (tabs contam como 4); linha vazia = null', () => {
    expect(indentWidth('    a')).toBe(4)
    expect(indentWidth('\ta')).toBe(4)
    expect(indentWidth('  \ta')).toBe(4)
    expect(indentWidth('a')).toBe(0)
    expect(indentWidth('   ')).toBeNull()
  })

  it('tamanho do nível descoberto pelo código', () => {
    expect(detectIndentUnit(['a', '  b', '    c', '  d'])).toBe(2)
    expect(detectIndentUnit(['a', '    b', '        c'])).toBe(4)
    expect(detectIndentUnit(['a', '\tb', '\t\tc'])).toBe(4)
    expect(detectIndentUnit(['a', 'b'])).toBe(4)
  })

  it('guias por linha; vazias no meio continuam a guia', () => {
    const lines = ['function a() {', '  if (x) {', '    y()', '', '    z()', '  }', '}']
    const levels = guideLevels((n) => lines[n - 1]!, lines.length, 1, lines.length, 2)
    expect(levels).toEqual([0, 1, 2, 2, 2, 1, 0])
  })

  it('vazias no fim de um trecho seguem a menor das vizinhas', () => {
    const lines = ['a:', '    b', '', 'c']
    expect(guideLevels((n) => lines[n - 1]!, lines.length, 1, 4, 4)).toEqual([0, 1, 0, 0])
  })
})

describe('recolher pela indentação (linguagens sem estrutura, ex.: GDScript)', () => {
  const doc = ['func _ready():', '\tvar a = 1', '', '\tif a:', '\t\tprint(a)', '', 'func outra():', '\tpass'].join('\n')
  const state = EditorState.create({ doc })

  it('a linha e as seguintes mais recuadas, sem as vazias do fim', () => {
    const range = indentFoldRange(state, state.doc.line(1).from)!
    expect(state.sliceDoc(range.from, range.to)).toBe('\n\tvar a = 1\n\n\tif a:\n\t\tprint(a)')
    const inner = indentFoldRange(state, state.doc.line(4).from)!
    expect(state.sliceDoc(inner.from, inner.to)).toBe('\n\t\tprint(a)')
  })

  it('linha sem filhos não recolhe', () => {
    expect(indentFoldRange(state, state.doc.line(2).from)).toBeNull()
    expect(indentFoldRange(state, state.doc.line(8).from)).toBeNull()
  })
})

describe('formatar código', () => {
  it('só linguagens com formatador seguro', () => {
    expect(canFormat('json')).toBe(true)
    expect(canFormat('ts')).toBe(true)
    expect(canFormat('javascript')).toBe(true)
    expect(canFormat('vue')).toBe(true)
    expect(canFormat('css')).toBe(true)
    expect(canFormat('yaml')).toBe(true)
    expect(canFormat('python')).toBe(false)
    expect(canFormat('gdscript')).toBe(false)
    expect(canFormat('text')).toBe(false)
    expect(canFormat('')).toBe(false)
    expect(formatterFor('tsx')?.parser).toBe('typescript')
  })

  it('JSON: recuo e espaços, mesmo conteúdo', async () => {
    const result = await formatCode('{"a":1,"b":[1,2,{"c":true}]}', 'json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)
    expect(JSON.parse(result.code)).toEqual({ a: 1, b: [1, 2, { c: true }] })
    expect(result.code.split('\n').length).toBeGreaterThan(1)
  })

  it('mantém o estilo do código: aspas simples, sem ponto e vírgula, 2 espaços', async () => {
    const code = "function soma(a,b){\n  const x = 'oi'\n  return a+b\n}"
    expect(detectStyle(code, 'babel')).toMatchObject({ singleQuote: true, semi: false, tabWidth: 2, useTabs: false })
    const result = await formatCode(code, 'js')
    expect(result.ok && result.code).toBe("function soma(a, b) {\n  const x = 'oi'\n  return a + b\n}")
  })

  it('com ponto e vírgula e aspas duplas, 4 espaços', async () => {
    const code = 'const a = {x:"1",y:2};\nif (a) {\n    console.log(a);\n}'
    const result = await formatCode(code, 'javascript')
    expect(result.ok && result.code).toBe('const a = { x: "1", y: 2 };\nif (a) {\n    console.log(a);\n}')
  })

  it('TypeScript', async () => {
    const result = await formatCode('interface A{a:number;b?:string}\nconst f=(x:A):number=>x.a', 'ts')
    expect(result.ok && result.code).toBe('interface A {\n  a: number\n  b?: string\n}\nconst f = (x: A): number => x.a')
  })

  it('CSS', async () => {
    const result = await formatCode('a{color:red;margin:0 auto}', 'css')
    expect(result.ok && result.code).toBe('a {\n  color: red;\n  margin: 0 auto;\n}')
  })

  it('já formatado: changed = false', async () => {
    const result = await formatCode('{\n  "a": 1\n}', 'json')
    expect(result).toMatchObject({ ok: true, changed: false })
  })

  it('erro de sintaxe: não mexe e diz a linha', async () => {
    const result = await formatCode('const a = {\nconst b = 2', 'js')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/erro de sintaxe de JavaScript \(linha \d+\)/)
  })

  it('linguagem sem formatador ou sem linguagem: explica', async () => {
    const python = await formatCode('def a():\n  pass', 'python')
    expect(python.ok).toBe(false)
    if (!python.ok) expect(python.reason).toContain('Python')
    const none = await formatCode('x', '')
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.reason).toContain('Escolha a linguagem')
  })
})
