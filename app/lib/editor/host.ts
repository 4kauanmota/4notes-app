/**
 * Ligação do editor com o resto do app: salvar e apagar imagens do workspace,
 * abrir código em tela cheia, mostrar avisos e mencionar outras notas.
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

/** Nota ou tarefa que pode ser mencionada (ver mentions.ts). */
export interface MentionTarget {
  /**
   * Caminho no workspace: "notes/Ideias.md", "mindmap/Principal/Godot.md" ou,
   * para tarefas, "tasks/tasks.json#<id>".
   */
  path: string
  title: string
  /** De onde é: "Notas", "Notas · Trabalho", "Mapa · Principal", "Tarefa"… */
  where: string
}

/** Como está agora o que foi mencionado. */
export interface MentionState {
  title: string
  /** Tarefa concluída. */
  done?: boolean
}

/** Menções a notas e tarefas (só nos editores em que o app liga o recurso). */
export interface MentionHost {
  /** Notas e tarefas para mencionar, filtradas pelo texto digitado depois do "@". */
  search(query: string): Promise<MentionTarget[]>
  /** Título e estado atuais; null se não existe mais. */
  describe(path: string): MentionState | null
  /** Abre a nota ou a tarefa mencionada. */
  open(path: string): void
  /** Muda sempre que títulos ou estados mudam (o editor redesenha os chips). */
  revision(): string
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
  /** A imagem saiu da nota pelo botão Remover: apaga o arquivo (se nenhuma outra nota o usa). `undo` devolve o texto. */
  removeImage(workspacePath: string, undo: () => void): void
  /** Devolve uma imagem apagada nesta sessão (a remoção foi desfeita com Ctrl+Z). */
  restoreImage(workspacePath: string): Promise<boolean>
  /** Abre o código em tela cheia. */
  openCode(request: CodeEditRequest): void
  /** Escolher a linguagem de um bloco de código (null = cancelado). */
  chooseLanguage?(current: string): Promise<string | null>
  /** Aviso rápido; `undo` mostra o botão "Desfazer". */
  notify(message: string, undo?: () => void): void
  /** Menções a notas e tarefas (@). Sem isso, links para notas aparecem como links comuns. */
  mentions?: MentionHost
  /** A primeira linha de uma nota vazia já começa como título (# ). */
  titleFirstLine?: boolean
}

export const editorHost = Facet.define<EditorHost, EditorHost | null>({
  combine: (values) => values[0] ?? null,
})
