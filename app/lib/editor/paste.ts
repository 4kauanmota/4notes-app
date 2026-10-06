/**
 * Colar e soltar no editor:
 *  - imagens (print da tela, arquivo de imagem) são salvas em attachments/ do
 *    workspace e entram na nota como ![](…);
 *  - um endereço web colado sobre um texto selecionado transforma o texto em link;
 *  - código vira um bloco ```linguagem (Ctrl+Shift+V cola como texto puro);
 *  - qualquer outro texto (comum, listas, trechos longos) entra como texto — nunca
 *    num bloco de texto (esse só pela barra de formatação, text-blocks.ts).
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { detectCode, normalizeCode } from './code-detect'
import { relativeTo } from '../files/workspace-path'
import { editorHost } from './host'
import { normalizeLinkUrl, setLink } from './formatting'
import { fenceFromVsCodeMode, isTextBlockInfo } from './languages'

const EMPTY_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?$/

/** Ctrl+Shift+V acabou de ser pressionado: a próxima colagem é texto puro. */
let plainPaste = false

export function isInsideCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') return true
  }
  return false
}

/**
 * Insere um bloco (imagem, código) em linhas próprias no lugar da seleção, com o
 * cursor logo depois dele.
 */
function insertBlock(view: EditorView, text: string, at?: { from: number; to: number }): void {
  const { state } = view
  const range = at ?? state.selection.main
  const to = range.to
  let from = range.from
  const line = state.doc.lineAt(from)
  const endLine = state.doc.lineAt(to)
  // Num item de lista vazio ("- " recém-criado pelo Enter), o bloco ocupa a linha no lugar do item
  if (to === endLine.to && EMPTY_ITEM.test(state.sliceDoc(line.from, from))) from = line.from
  const before = from > line.from ? '\n' : ''
  const atLineEnd = to === endLine.to && endLine.number < state.doc.lines
  const after = atLineEnd ? '' : '\n'
  view.dispatch({
    changes: { from, to, insert: before + text + after },
    selection: { anchor: from + before.length + text.length + 1 },
    userEvent: 'input.paste',
    scrollIntoView: true,
  })
}

/** Insere imagens do workspace (caminhos como "attachments/foto.png") na nota, cada uma na sua linha. */
export function insertImagePaths(view: EditorView, paths: string[], at?: number): void {
  const host = view.state.facet(editorHost)
  if (!host || !paths.length) return
  const base = host.assetBase()
  const text = paths.map((path) => `![](${relativeTo(base, path)})`).join('\n')
  insertBlock(view, text, at === undefined ? undefined : { from: at, to: at })
}

/** Salva as imagens no workspace e insere os links na nota. */
async function insertImages(view: EditorView, files: File[], at?: number): Promise<void> {
  const host = view.state.facet(editorHost)
  if (!host) return
  const key = host.docKey()
  const saved: string[] = []
  for (const file of files) {
    const path = await host.saveImage(await file.arrayBuffer(), file.type)
    if (path) saved.push(path)
  }
  // A nota mudou enquanto salvava (trocou de aba): não cola na nota errada
  if (!saved.length || host.docKey() !== key) return
  insertImagePaths(view, saved, at)
}

/**
 * "Inserir imagem…" (menu do clique direito): escolhe na biblioteca de imagens e
 * insere onde foi o clique (`at`; sem ele, no cursor). false = este editor não tem a biblioteca.
 */
export function insertImageFromLibrary(view: EditorView, at?: number): boolean {
  const host = view.state.facet(editorHost)
  if (!host?.pickImage) return false
  const key = host.docKey()
  const pos = at ?? view.state.selection.main.head
  void host.pickImage().then((path) => {
    // Trocou de nota enquanto escolhia: não insere na nota errada
    if (!path || host.docKey() !== key) return
    view.focus()
    insertImagePaths(view, [path], Math.min(pos, view.state.doc.length))
  })
  return true
}

/** Linguagem do texto copiado do VS Code (ele grava isso na área de transferência). */
function vscodeMode(data: DataTransfer): string | undefined {
  try {
    const raw = data.getData('vscode-editor-data')
    return raw ? (JSON.parse(raw) as { mode?: string }).mode : undefined
  } catch {
    return undefined
  }
}

/**
 * Decide se o texto colado é código e em qual linguagem (null = colar como texto).
 * Só código reconhecido vira bloco: nada é colado dentro de um bloco de texto
 * (```text) — esse só é criado pela barra de formatação.
 */
function codeLanguage(text: string, data: DataTransfer): string | null {
  const fromVsCode = fenceFromVsCodeMode(vscodeMode(data))
  if (fromVsCode === null) return null
  let language: string | null
  if (fromVsCode !== undefined) {
    language = text.split('\n').filter((line) => line.trim()).length >= 2 ? fromVsCode : null
  } else {
    language = detectCode(text)?.language ?? null
  }
  return language !== null && isTextBlockInfo(language) ? null : language
}

function insertCode(view: EditorView, text: string, language: string): void {
  const code = normalizeCode(text)
  const fence = code.includes('```') ? '~~~' : '```'
  insertBlock(view, `${fence}${language}\n${code}\n${fence}`)
}

const imageFiles = (list: FileList | undefined | null) => [...(list ?? [])].filter((file) => file.type.startsWith('image/'))

export const pasteHandling = EditorView.domEventHandlers({
  keydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') plainPaste = true
    return false
  },
  paste(event, view) {
    const plain = plainPaste
    plainPaste = false
    const data = event.clipboardData
    if (!data) return false
    const images = imageFiles(data.files)
    if (images.length) {
      event.preventDefault()
      void insertImages(view, images)
      return true
    }
    const text = data.getData('text/plain')
    if (plain || !text || isInsideCode(view.state, view.state.selection.main.from)) return false
    // Endereço colado sobre um texto selecionado (numa linha só): vira link
    const { main } = view.state.selection
    const url = /^\s*(?:https?:\/\/|mailto:|www\.)\S+\s*$/i.test(text) ? normalizeLinkUrl(text) : null
    if (url && !main.empty && view.state.selection.ranges.length === 1 && view.state.doc.lineAt(main.from).number === view.state.doc.lineAt(main.to).number) {
      event.preventDefault()
      setLink(view, url)
      return true
    }
    const language = codeLanguage(text, data)
    if (language === null) return false
    event.preventDefault()
    insertCode(view, text, language)
    return true
  },
  drop(event, view) {
    const images = imageFiles(event.dataTransfer?.files)
    if (!images.length) return false
    event.preventDefault()
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
    void insertImages(view, images, pos)
    return true
  },
})
