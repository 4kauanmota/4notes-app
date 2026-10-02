/**
 * Linguagens dos blocos de código (```js … ```).
 *
 * Vêm do pacote @codemirror/language-data — cada linguagem só é carregada quando
 * aparece num bloco — mais o GDScript (Godot), que não faz parte do pacote.
 */
import { languages } from '@codemirror/language-data'
import { LanguageDescription, LanguageSupport, StreamLanguage, type StringStream } from '@codemirror/language'

// ── GDScript ─────────────────────────────────────────────────────────────────

const GD_KEYWORDS = new Set(
  'if elif else for while match when break continue pass return class class_name extends is in as and or not signal func static const enum var breakpoint preload await yield super tool onready export setget void self'.split(
    ' ',
  ),
)
const GD_ATOMS = new Set(['true', 'false', 'null', 'PI', 'TAU', 'INF', 'NAN'])
const GD_TYPE = /^(?:bool|int|float|String|StringName|NodePath|Vector[234]i?|Rect2i?|Transform[23]D|Plane|Quaternion|AABB|Basis|Projection|Color|RID|Object|Callable|Signal|Dictionary|Array|Packed\w+Array|[A-Z]\w*(?:2D|3D)|Node|Control|Resource|PackedScene|Timer|Tween|Input|Engine|OS)$/

const gdscriptLanguage = StreamLanguage.define<{ tripleQuote: string | null }>({
  name: 'gdscript',
  startState: () => ({ tripleQuote: null }),
  token(stream: StringStream, state) {
    if (state.tripleQuote) {
      if (stream.skipTo(state.tripleQuote)) {
        stream.match(state.tripleQuote)
        state.tripleQuote = null
      } else {
        stream.skipToEnd()
      }
      return 'string'
    }
    if (stream.eatSpace()) return null
    if (stream.match('#')) {
      stream.skipToEnd()
      return 'comment'
    }
    const triple = stream.match(/^("""|''')/) as RegExpMatchArray | null
    if (triple) {
      state.tripleQuote = triple[0]
      return 'string'
    }
    if (stream.match(/^(?:&|\^)?"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string'
    if (stream.match(/^@\w+/)) return 'meta'
    if (stream.match(/^[$%](?:"[^"]*"|[\w/]+)/)) return 'variableName.special'
    if (stream.match(/^(?:0x[\da-f_]+|0b[01_]+|\d[\d_]*(?:\.[\d_]*)?(?:e[+-]?\d+)?)/i)) return 'number'
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current()
      if (GD_KEYWORDS.has(word)) return 'keyword'
      if (GD_ATOMS.has(word)) return 'atom'
      if (GD_TYPE.test(word)) return 'typeName'
      if (stream.peek() === '(') return 'variableName.function'
      return 'variableName'
    }
    if (stream.match(/^(?:->|:=|[-+*/%=<>!&|^~]+)/)) return 'operator'
    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '#' }, indentOnInput: /^\s*(?:else|elif)\b/ },
})

export const codeLanguages: LanguageDescription[] = [
  ...languages,
  LanguageDescription.of({ name: 'GDScript', alias: ['gdscript', 'gd'], extensions: ['gd'], support: new LanguageSupport(gdscriptLanguage) }),
]

// ── Consultas ────────────────────────────────────────────────────────────────

/** Linguagem pelo texto depois da cerca (```ts, ```python…). */
export function findLanguage(info: string): LanguageDescription | null {
  const name = info.trim().split(/\s+/)[0] ?? ''
  return name ? LanguageDescription.matchLanguageName(codeLanguages, name, true) : null
}

/** Nome mostrado no cabeçalho do bloco. */
export function languageLabel(info: string): string {
  return findLanguage(info)?.name ?? (info.trim().split(/\s+/)[0] || 'Código')
}

/**
 * O VS Code põe na área de transferência a linguagem do arquivo de onde o texto foi
 * copiado ("vscode-editor-data"). Aqui viram o nome usado no bloco; null = não é código.
 */
const VSCODE_MODES: Record<string, string | null> = {
  javascript: 'javascript',
  javascriptreact: 'jsx',
  typescript: 'typescript',
  typescriptreact: 'tsx',
  vue: 'vue',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  python: 'python',
  gdscript: 'gdscript',
  csharp: 'csharp',
  cpp: 'cpp',
  c: 'c',
  java: 'java',
  kotlin: 'kotlin',
  go: 'go',
  rust: 'rust',
  php: 'php',
  ruby: 'ruby',
  lua: 'lua',
  swift: 'swift',
  dart: 'dart',
  shellscript: 'bash',
  powershell: 'powershell',
  sql: 'sql',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  xml: 'xml',
  dockerfile: 'dockerfile',
  diff: 'diff',
  markdown: null,
  plaintext: null,
}

export function fenceFromVsCodeMode(mode: string | undefined): string | null | undefined {
  if (!mode) return undefined
  if (mode in VSCODE_MODES) return VSCODE_MODES[mode]
  return findLanguage(mode) ? mode : ''
}
