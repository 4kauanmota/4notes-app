/**
 * Formatar código (1.7.2): recuo e espaçamento de um bloco de código pela linguagem dele,
 * com o Prettier (carregado só quando você formata; nada sai do aparelho).
 *
 * - Só linguagens com um formatador que não muda o que o código faz: JavaScript, JSX,
 *   TypeScript, TSX, JSON, CSS, SCSS, LESS, HTML, Vue, YAML, Markdown e GraphQL. As outras
 *   (Python, GDScript, C#…) ficam como estão: recuar Python errado mudaria o programa.
 * - O estilo do próprio código é mantido: o tamanho do recuo (2 ou 4 espaços, ou tabs), as
 *   aspas (simples ou duplas) e o ponto e vírgula (com ou sem).
 * - Código com erro de sintaxe não é mexido: volta o motivo (com a linha).
 *
 * Sem Vue e sem a tela: quem chama (code-blocks.ts, CodeFullscreen.vue) aplica o
 * resultado numa transação, que o Ctrl+Z desfaz.
 */
import type { Options, Plugin } from 'prettier'
import { detectIndentUnit, indentWidth } from './code-structure'
import { findLanguage } from './languages'

type PluginName = 'babel' | 'estree' | 'typescript' | 'postcss' | 'html' | 'markdown' | 'yaml' | 'graphql'

interface Formatter {
  parser: string
  plugins: PluginName[]
}

const JS: PluginName[] = ['babel', 'estree']
const TS: PluginName[] = ['typescript', 'estree']
const WEB: PluginName[] = ['html', 'babel', 'estree', 'postcss', 'typescript']

/** Nome da linguagem (o de @codemirror/language-data) → como o Prettier lê. */
const FORMATTERS: Record<string, Formatter> = {
  JavaScript: { parser: 'babel', plugins: JS },
  JSX: { parser: 'babel', plugins: JS },
  TypeScript: { parser: 'typescript', plugins: TS },
  TSX: { parser: 'typescript', plugins: TS },
  JSON: { parser: 'json', plugins: JS },
  'JSON-LD': { parser: 'json', plugins: JS },
  CSS: { parser: 'css', plugins: ['postcss'] },
  SCSS: { parser: 'scss', plugins: ['postcss'] },
  LESS: { parser: 'less', plugins: ['postcss'] },
  HTML: { parser: 'html', plugins: WEB },
  Vue: { parser: 'vue', plugins: WEB },
  YAML: { parser: 'yaml', plugins: ['yaml'] },
  Markdown: { parser: 'markdown', plugins: ['markdown'] },
  GraphQL: { parser: 'graphql', plugins: ['graphql'] },
}

/** Nomes usados no texto do bloco que o language-data não acha sozinho. */
const ALIASES: Record<string, string> = { graphql: 'GraphQL', gql: 'GraphQL', jsonc: 'JSON', json5: 'JSON' }

/** O nome da linguagem do bloco (```ts → TypeScript), ou null. */
function languageName(info: string): string | null {
  const word = (info.trim().split(/\s+/)[0] ?? '').toLowerCase()
  if (!word) return null
  return ALIASES[word] ?? findLanguage(info)?.name ?? null
}

/** Dá para formatar esse bloco? (null = linguagem sem formatador seguro, ou sem linguagem). */
export function formatterFor(info: string): Formatter | null {
  const name = languageName(info)
  return name ? (FORMATTERS[name] ?? null) : null
}

export const canFormat = (info: string) => !!formatterFor(info)

/** As linguagens que dá para formatar (para o "escolha a linguagem"). */
export const FORMATTABLE = Object.keys(FORMATTERS)

const loaders: Record<PluginName, () => Promise<unknown>> = {
  babel: () => import('prettier/plugins/babel'),
  estree: () => import('prettier/plugins/estree'),
  typescript: () => import('prettier/plugins/typescript'),
  postcss: () => import('prettier/plugins/postcss'),
  html: () => import('prettier/plugins/html'),
  markdown: () => import('prettier/plugins/markdown'),
  yaml: () => import('prettier/plugins/yaml'),
  graphql: () => import('prettier/plugins/graphql'),
}

async function loadPlugins(names: PluginName[]): Promise<Plugin[]> {
  const modules = await Promise.all(names.map((name) => loaders[name]()))
  return modules.map((module) => ((module as { default?: Plugin }).default ?? module) as Plugin)
}

/** O estilo que o código já usa (recuo, aspas, ponto e vírgula). */
export function detectStyle(code: string, parser: string): Pick<Options, 'tabWidth' | 'useTabs' | 'singleQuote' | 'semi'> {
  const lines = code.split('\n')
  const indented = lines.filter((line) => indentWidth(line) !== null && /^[ \t]/.test(line))
  const tabs = indented.filter((line) => line.startsWith('\t')).length
  const useTabs = indented.length > 0 && tabs / indented.length > 0.5
  const unit = detectIndentUnit(lines)
  // Sem nenhuma linha recuada (código colado numa linha só): 2 espaços, o padrão do Prettier
  const tabWidth = useTabs ? 4 : indented.length && (unit === 4 || unit === 8) ? 4 : 2
  const style: Pick<Options, 'tabWidth' | 'useTabs' | 'singleQuote' | 'semi'> = { useTabs, tabWidth }
  if (parser === 'babel' || parser === 'typescript' || parser === 'vue') {
    const single = (code.match(/'(?:[^'\\\n]|\\.)*'/g) ?? []).length
    const double = (code.match(/"(?:[^"\\\n]|\\.)*"/g) ?? []).length
    style.singleQuote = single > double
    // Linhas que terminam uma instrução: com ";" × sem
    const statements = lines.map((line) => line.trim()).filter((line) => line && !/[{}(,[:]$/.test(line) && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
    const withSemi = statements.filter((line) => line.endsWith(';')).length
    style.semi = statements.length === 0 || withSemi / statements.length >= 0.5
  }
  return style
}

export type FormatResult = { ok: true; code: string; changed: boolean; language: string } | { ok: false; reason: string }

/** Formata o código de um bloco (`info` = o texto depois da cerca: ts, json, vue…). */
export async function formatCode(code: string, info: string): Promise<FormatResult> {
  const name = languageName(info)
  const formatter = name ? FORMATTERS[name] : null
  if (!formatter || !name) {
    return { ok: false, reason: name ? `Não há formatação automática para ${name}: o código ficou como estava.` : 'Escolha a linguagem do bloco para formatar.' }
  }
  if (!code.trim()) return { ok: true, code, changed: false, language: name }
  try {
    const [{ format }, plugins] = await Promise.all([import('prettier/standalone'), loadPlugins(formatter.plugins)])
    // JSON: cada objeto em várias linhas, como os editores formatam JSON (o Prettier deixa um
    // objeto numa linha só quando ele já veio assim; uma quebra depois do "{" pede o contrário)
    const source = formatter.parser === 'json' ? expandJsonObjects(code) : code
    const formatted = await format(source, {
      parser: formatter.parser,
      plugins,
      printWidth: 100,
      endOfLine: 'lf',
      ...detectStyle(code, formatter.parser),
    })
    const next = formatted.replace(/\s+$/, '')
    return { ok: true, code: next, changed: next !== code.replace(/\s+$/, ''), language: name }
  } catch (error) {
    // No JSON a linha do erro contaria as quebras acrescentadas acima: sem linha
    return { ok: false, reason: syntaxReason(formatter.parser === 'json' ? null : error, name) }
  }
}

/** Põe uma quebra de linha depois de cada "{" fora das strings (só espaço: o JSON é o mesmo). */
export function expandJsonObjects(code: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < code.length; i++) {
    const char = code[i]!
    out += char
    if (inString) {
      if (char === '\\') {
        out += code[i + 1] ?? ''
        i++
      } else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === '{') out += '\n'
  }
  return out
}

/** O erro do Prettier em português (a linha, quando ele diz). */
function syntaxReason(error: unknown, language: string): string {
  const loc = (error as { loc?: { start?: { line?: number } } } | null)?.loc?.start?.line
  const where = loc ? ` (linha ${loc})` : ''
  return `O código parece ter um erro de sintaxe de ${language}${where}: ficou como estava.`
}
