/**
 * Reconhece código colado no editor (para virar um bloco ```) e tenta descobrir a
 * linguagem. As regras são conservadoras: na dúvida, o texto é colado como texto.
 */

/** Comandos de terminal comuns (duas linhas com eles já indicam um bloco de comandos). */
const SHELL_COMMANDS = '(?:sudo|apt|apt-get|brew|npm|npx|yarn|pnpm|node|git|cd|ls|mkdir|rm|cp|mv|echo|export|curl|wget|chmod|docker|pip|python3?|godot)'

interface LanguageRule {
  language: string
  /** Sinais fortes: um só já basta. */
  strong?: RegExp[]
  /** Sinais comuns: precisa de dois ou mais. */
  hints: RegExp[]
}

const RULES: LanguageRule[] = [
  {
    language: 'gdscript',
    strong: [/^\s*extends\s+[A-Z]\w*\s*$/m, /^\s*@(?:export|onready|tool)\b/m, /\bfunc\s+_(?:ready|process|physics_process|input|unhandled_input)\s*\(/],
    hints: [/^\s*func\s+\w+\s*\([^)]*\)\s*(?:->\s*\w+\s*)?:\s*$/m, /^\s*var\s+\w+\s*(?::=|:\s*\w+)/m, /\$[A-Z]\w*/, /\b(?:get_node|queue_free|emit_signal|preload)\s*\(/, /^\s*signal\s+\w+/m],
  },
  {
    language: 'python',
    strong: [/^\s*if __name__ == ['"]__main__['"]\s*:/m, /^\s*from\s+[\w.]+\s+import\s+[\w*, ]+$/m],
    hints: [/^\s*def\s+\w+\s*\(.*\)\s*(?:->\s*[\w[\], .]+)?:\s*$/m, /^\s*import\s+[\w.]+(?:\s+as\s+\w+)?\s*$/m, /^\s*class\s+\w+(?:\(.*\))?:\s*$/m, /\bself\.\w+/, /^\s*(?:elif|except|finally)\b.*:\s*$/m, /\bprint\(/, /^\s*(?:for|while|if)\s+.+:\s*$/m],
  },
  {
    language: 'typescript',
    strong: [/^\s*(?:export\s+)?interface\s+\w+(?:<[^>]*>)?\s*(?:extends\s+[\w<>, ]+)?\{/m, /^\s*(?:export\s+)?type\s+\w+(?:<[^>]*>)?\s*=/m],
    hints: [/\w\s*:\s*(?:string|number|boolean|void|any|unknown|never)(?:\[\])?\s*[,;)=]/, /\b(?:private|public|readonly)\s+\w+\s*:/, /\bas\s+(?:const|string|number|unknown)\b/, /<[A-Z]\w*>\(/],
  },
  {
    language: 'javascript',
    strong: [/^\s*import\s+.+\s+from\s+['"][^'"]+['"];?\s*$/m, /\bconsole\.(?:log|error|warn)\(/, /\brequire\(['"][^'"]+['"]\)/],
    hints: [/^\s*(?:const|let|var)\s+[\w{[\]},\s]+=/m, /=>/, /\bfunction\s*\w*\s*\(/, /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\b/m, /\b(?:document|window)\.\w+/, /\bawait\s+\w+/, /;\s*$/m],
  },
  {
    language: 'html',
    strong: [/<!DOCTYPE html>/i, /<html[\s>]/i],
    hints: [/<(?:head|body|div|span|p|a|ul|ol|li|script|style|section|button|input|img|form|table|h[1-6])\b[^>]*>/i, /<\/(?:div|span|p|a|ul|li|section|button|form|table|h[1-6])>/i],
  },
  {
    language: 'vue',
    strong: [/^<template>\s*$/m],
    hints: [/^<script(?:\s+setup)?(?:\s+lang=["']ts["'])?>\s*$/m, /^<style(?:\s+scoped)?>\s*$/m],
  },
  {
    language: 'css',
    strong: [/^\s*@media\s.+\{/m, /^\s*:root\s*\{/m],
    hints: [/^[\w.#:\-[\]="'>+~,*() ]+\{\s*$/m, /^\s*[\w-]+\s*:\s*[^;{}]+;\s*$/m, /^\s*\}\s*$/m],
  },
  {
    language: 'sql',
    strong: [/\bSELECT\b[\s\S]+?\bFROM\s+\w+/i, /\bINSERT\s+INTO\b/i, /\bCREATE\s+(?:TABLE|INDEX|VIEW|DATABASE)\b/i, /\bDELETE\s+FROM\b/i, /\bUPDATE\s+\w+\s+SET\b/i],
    hints: [/\bWHERE\b/, /\b(?:INNER|LEFT|RIGHT)\s+JOIN\b/, /\bGROUP BY\b|\bORDER BY\b/],
  },
  {
    language: 'bash',
    strong: [/^#!\/(?:usr\/)?bin\/(?:env\s+)?(?:ba|z)?sh\b/m, new RegExp(`^\\s*(?:\\$\\s+)?${SHELL_COMMANDS}\\s+\\S.*\\n\\s*(?:\\$\\s+)?${SHELL_COMMANDS}\\s+\\S`, 'm')],
    hints: [/^\s*\$\s+\S/m, new RegExp(`^\\s*${SHELL_COMMANDS}\\s+\\S`, 'm'), /\|\s*(?:grep|awk|sed|xargs|sort)\b/, /^\s*(?:if|then|fi|done|do)\b/m],
  },
  {
    language: 'powershell',
    strong: [/\b(?:Get|Set|New|Remove|Write|Start|Stop)-[A-Z]\w+/, /\$env:\w+/],
    hints: [/^\s*\$\w+\s*=/m, /\|\s*(?:Where|Select|ForEach)-Object/],
  },
  {
    language: 'csharp',
    strong: [/^\s*using\s+(?:System|Godot|UnityEngine)(?:\.\w+)*;/m, /\bConsole\.Write(?:Line)?\(/, /\bGD\.Print\(/],
    hints: [/\bnamespace\s+[\w.]+/, /\b(?:public|private|protected|internal)\s+(?:static\s+|override\s+|async\s+|partial\s+)*(?:class|void|int|string|bool|float|Task)\b/, /\bvar\s+\w+\s*=\s*new\s+\w+/],
  },
  {
    language: 'java',
    strong: [/\bpublic\s+static\s+void\s+main\s*\(/, /\bSystem\.out\.print(?:ln)?\(/, /^\s*import\s+java\./m],
    hints: [/^\s*package\s+[\w.]+;/m, /\b(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:class|void|int|String|boolean)\b/],
  },
  {
    language: 'cpp',
    strong: [/^\s*#include\s*[<"]/m, /\bstd::\w+/],
    hints: [/\bint\s+main\s*\(/, /\b(?:cout|cin)\s*(?:<<|>>)/, /->\w+/, /\b(?:void|int|char|float|double)\s+\w+\s*\([^)]*\)\s*\{/],
  },
  {
    language: 'rust',
    strong: [/\bfn\s+main\s*\(\)/, /\bprintln!\(/, /\blet\s+mut\s+/],
    hints: [/\bfn\s+\w+\s*(?:<[^>]*>)?\s*\(/, /\bimpl\b/, /::new\(/, /\bmatch\s+\w+\s*\{/],
  },
  {
    language: 'go',
    strong: [/^\s*package\s+main\s*$/m, /\bfmt\.Print/],
    hints: [/\bfunc\s+(?:\(\w+\s+\*?\w+\)\s*)?\w+\s*\(/, /:=/, /^\s*import\s+\(/m],
  },
  {
    language: 'php',
    strong: [/<\?php/],
    hints: [/\$\w+\s*=/, /->\w+\(/, /\becho\s+/],
  },
  {
    language: 'xml',
    strong: [/^<\?xml\b/],
    hints: [],
  },
]

/** JSON de verdade (objeto ou lista, com mais de uma linha). */
function isJson(text: string): boolean {
  const trimmed = text.trim()
  if (!/^[[{]/.test(trimmed) || !trimmed.includes('\n')) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

/** Cada linha parece código? (pontuação típica no fim, operadores, indentação…) */
function codeLineScore(line: string): number {
  const text = line.trim()
  if (!text) return 0
  let score = 0
  if (/[;{}()[\]]\s*$/.test(text) || /^[}\])]/.test(text)) score += 1
  if (/[=!<>]=|=>|->|::|&&|\|\||\+\+|\w\.\w+\(/.test(text)) score += 1
  if (/^\s{2,}|\t/.test(line) && !/^\s*[-*+]\s/.test(line)) score += 0.5
  if (/^(?:\/\/|#|--|\/\*|\*)\s?/.test(text) && text.length < 120) score += 0.3
  return score
}

/** A linha parece texto corrido (frase com várias palavras terminando em pontuação)? */
function isProse(line: string): boolean {
  const text = line.trim()
  return /^[A-ZÀ-Úa-zà-ú"“(]/.test(text) && text.split(/\s+/).length >= 6 && /[.!?:…"”]$/.test(text) && !/[;{}=]/.test(text)
}

/** Parece Markdown/lista comum (itens, títulos, citações)? */
function isMarkdownLine(line: string): boolean {
  return /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>\s?)/.test(line)
}

export interface DetectedCode {
  /** Nome para a cerca (```js); '' quando não deu para saber a linguagem. */
  language: string
}

/** Descobre a linguagem pelo conteúdo (null = não reconheceu nenhuma). */
export function guessLanguage(text: string): string | null {
  if (isJson(text)) return 'json'
  let best: { language: string; score: number } | null = null
  for (const rule of RULES) {
    const strong = rule.strong?.some((re) => re.test(text)) ? 2 : 0
    const hints = rule.hints.filter((re) => re.test(text)).length
    const score = strong + hints
    if (score >= 2 && (!best || score > best.score)) best = { language: rule.language, score }
  }
  // TypeScript também tem todos os sinais de JavaScript
  if (best?.language === 'javascript' && RULES.find((rule) => rule.language === 'typescript')!.hints.some((re) => re.test(text))) {
    return 'typescript'
  }
  return best?.language ?? null
}

/**
 * Decide se um texto colado é código. Só textos com duas ou mais linhas contam
 * (uma palavra ou frase copiada do VS Code continua sendo colada como texto).
 */
export function detectCode(text: string): DetectedCode | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim())
  if (lines.length < 2) return null
  const language = guessLanguage(text)
  const markdownLines = lines.filter(isMarkdownLine).length
  const proseLines = lines.filter(isProse).length
  if (language) {
    // Uma lista ou um texto que só cita um comando não vira código
    if (proseLines / lines.length > 0.5 || (markdownLines / lines.length > 0.6 && language !== 'python' && language !== 'gdscript' && language !== 'bash')) {
      return null
    }
    return { language }
  }
  if (proseLines / lines.length > 0.25 || markdownLines / lines.length > 0.3) return null
  const average = lines.reduce((sum, line) => sum + codeLineScore(line), 0) / lines.length
  return average >= 0.9 ? { language: '' } : null
}

/**
 * Tira a indentação comum de todas as linhas (código copiado do meio de um arquivo)
 * e as linhas vazias das pontas.
 */
export function normalizeCode(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && !lines[0]!.trim()) lines.shift()
  while (lines.length && !lines.at(-1)!.trim()) lines.pop()
  const indents = lines.filter((line) => line.trim()).map((line) => /^[ \t]*/.exec(line)![0].length)
  const common = indents.length ? Math.min(...indents) : 0
  return lines.map((line) => line.slice(Math.min(common, /^[ \t]*/.exec(line)![0].length)).replace(/\s+$/, '')).join('\n')
}
