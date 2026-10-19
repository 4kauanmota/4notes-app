/**
 * Notas: a primeira linha é o título da nota (e da aba). Numa nota vazia, ela já
 * começa como título do Markdown ("# "): é só digitar. Para tirar, Backspace no
 * começo da linha, como em qualquer título.
 *
 * Não vira título quando o texto já começa com outra marcação (lista, citação,
 * código, imagem, menção…) nem quando um texto de várias linhas é colado.
 *
 * Desligável (1.6.3, Configurações › Módulos › Notas › Título na primeira linha): o
 * editor pergunta ao app (EditorHost.titleFirstLine) a cada nota vazia, então mudar a
 * configuração vale na hora, também para as abas já abertas.
 */
import { EditorState, type Extension } from '@codemirror/state'
import { editorHost } from './host'

/** Começos que já são outra coisa no Markdown (ou espaço). */
const OTHER_MARKUP = /^[\s#>*+\-`~|[!<@]/

/** Prefixo "# " no primeiro texto digitado (ou colado em uma linha) numa nota vazia. */
export function titleFor(inserted: string): string | null {
  if (!inserted || inserted.includes('\n') || OTHER_MARKUP.test(inserted)) return null
  return `# ${inserted}`
}

export const titleFirstLine: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.startState.doc.length !== 0) return tr
  if (!tr.startState.facet(editorHost)?.titleFirstLine) return tr
  if (!tr.isUserEvent('input.type') && !tr.isUserEvent('input.paste')) return tr
  if (!titleFor(tr.newDoc.toString())) return tr
  return [tr, { changes: { from: 0, insert: '# ' }, sequential: true }]
})
