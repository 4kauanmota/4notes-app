/**
 * Ligação do editor com o resto do app: salvar imagens no workspace (e escolher
 * da biblioteca), abrir código em tela cheia, mostrar avisos e mencionar outras
 * notas e links.
 *
 * O MarkdownEditor fornece a implementação; as extensões do editor (lib/editor)
 * continuam sem saber de Vue, IPC ou rotas.
 */
import { Facet } from '@codemirror/state'

export interface CodeEditRequest {
  code: string
  /** Texto depois da cerca (```ts → "ts"). */
  info: string
  /** Grava o código editado de volta no bloco. */
  apply(code: string): void
}

/** Algo que pode ser mencionado: nota, mapa, tarefa, link salvo ou registro do Timer (ver mentions.ts). */
export interface MentionTarget {
  /**
   * Caminho de menção (lib/notes/mention-links.ts): "notes/Ideias.md",
   * "mindmap/Principal/Godot.md", "mindmap/Principal/mapa.json", "tasks/tasks.json#<id>",
   * "timer/timer.json#<id>" ou, nos links salvos, "links/links.json#<id>".
   */
  path: string
  title: string
  /** De onde é: "Notas · Trabalho", "Mapa · Principal", "Tarefa · Estudos · 14/10", "Timer · Estudo · 12/10 · 1 h"… */
  where: string
  /** Link salvo (módulo Links): entra na nota como um link comum, [título](endereço). */
  url?: string
}

/** Como está agora o que foi mencionado. */
export interface MentionState {
  title: string
  /** Tarefa concluída. */
  done?: boolean
  /** De onde é / detalhes para a dica do chip ("Estudo · 12/10 · 1 h 20 min"). */
  detail?: string
}

/** Menções (só nos editores em que o app liga o recurso). */
export interface MentionHost {
  /** Itens de todos os módulos para mencionar, filtrados pelo texto digitado depois do "@". */
  search(query: string): Promise<MentionTarget[]>
  /** Título e estado atuais; null se não existe mais. */
  describe(path: string): MentionState | null
  /** Abre a nota ou a tarefa mencionada. */
  open(path: string): void
  /** Muda sempre que títulos ou estados mudam (o editor redesenha os chips). */
  revision(): string
  /** Ícone do site (endereço da imagem) quando o link é um link salvo no módulo Links; null = não é. */
  linkIcon?(url: string): string | null
  /**
   * Escolher na lista do "@" sem inserir um link: devolve o texto que fica no lugar do
   * "@…" (a descrição das tarefas: o título da nota, e a nota vai para a lista "Notas
   * mencionadas" da tarefa). Sem isso, entra o link da menção.
   */
  choose?(target: MentionTarget): string
}

export interface EditorHost {
  /** Identifica o documento aberto (para não colar uma imagem na nota errada depois de salvar). */
  docKey(): string
  /** Pasta da nota dentro do workspace ("notes", "mindmap/Principal"): base dos caminhos das imagens. */
  assetBase(): string
  /** Salva a imagem no workspace e devolve o caminho dela (relativo ao workspace), ou null. */
  saveImage(data: ArrayBuffer, mime: string): Promise<string | null>
  /** Endereço para mostrar uma imagem do workspace (caminho relativo ao workspace). */
  imageUrl(workspacePath: string): string
  /** Escolhe uma imagem da biblioteca (caminho no workspace; null = cancelado). */
  pickImage?(): Promise<string | null>
  /** Abre o código em tela cheia. */
  openCode(request: CodeEditRequest): void
  /** Escolher a linguagem de um bloco de código (null = cancelado). */
  chooseLanguage?(current: string): Promise<string | null>
  /** Aviso rápido; `undo` mostra o botão "Desfazer". */
  notify(message: string, undo?: () => void): void
  /** Menções a itens dos módulos (@). Sem isso, links para notas aparecem como links comuns. */
  mentions?: MentionHost
  /** A primeira linha de uma nota vazia já começa como título (# ). Lido a cada nota vazia (pode mudar). */
  readonly titleFirstLine?: boolean
}

export const editorHost = Facet.define<EditorHost, EditorHost | null>({
  combine: (values) => values[0] ?? null,
})
