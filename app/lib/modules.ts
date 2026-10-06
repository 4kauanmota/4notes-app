/**
 * Os módulos do 4notes num lugar só: nome, ícone, rota, atalho e o tutorial.
 *
 * O menu lateral, as Configurações (módulos ativos), os atalhos Ctrl+1…4 e os
 * Tutoriais leem esta lista. Para criar um módulo novo, basta acrescentá-lo aqui
 * (o tutorial é obrigatório) — ele aparece em todos esses lugares.
 *
 * Também ficam aqui as regras puras das preferências dos módulos (quais estão
 * ativos e como aparecem no menu), guardadas em .4notes/app.json (stores/modules.ts).
 */

export type ModuleId = 'notes' | 'tasks' | 'mindmap' | 'links'

/** Um atalho mostrado no tutorial. "Mod" vira Ctrl (Windows/Linux) ou ⌘ (macOS). */
export interface TutorialShortcut {
  keys: string[]
  label: string
}

/** Tutorial curtinho de um módulo (ou do 4notes em geral). */
export interface ModuleTutorial {
  /** Para que serve, numa frase. */
  purpose: string
  /** O que dá para fazer (as funções principais). */
  features: string[]
  /** O que pode passar despercebido. */
  tips: string[]
  shortcuts: TutorialShortcut[]
}

export interface ModuleDefinition {
  id: ModuleId
  /** Nome curto (menu lateral). */
  label: string
  /** Nome completo (Configurações, tutoriais, título). */
  name: string
  icon: string
  /** Rota da página do módulo. */
  route: `/${string}`
  /** Tecla do atalho Ctrl+<tecla>. */
  key: string
  /** Uma linha sobre o módulo (Configurações). */
  description: string
  tutorial: ModuleTutorial
}

export const MODULES: readonly ModuleDefinition[] = [
  {
    id: 'notes',
    label: 'Notas',
    name: 'Notas',
    icon: 'notes',
    route: '/notes',
    key: '1',
    description: 'Anotações rápidas em abas, com categorias e formatação.',
    tutorial: {
      purpose: 'Anotações rápidas em abas, como um Bloco de Notas organizado. Cada nota é um arquivo .md no seu workspace.',
      features: [
        'Selecione um texto para formatar: negrito, cores, listas, link, bloco de texto…',
        'Organize em categorias com cor, ícone ou foto (botão direito na nota).',
        'Cole prints e código: viram imagem e bloco de código.',
        'Mencione notas, tarefas e links com @.',
      ],
      tips: [
        'A primeira linha é o título — e o nome do arquivo.',
        'Notas que começam com as mesmas palavras se agrupam em pastas na lista.',
        'Tudo salva sozinho; fechar a aba não apaga a nota.',
        'Botão direito na nota: exportar como TXT ou PDF.',
      ],
      shortcuts: [
        { keys: ['Mod', 'N'], label: 'Nova nota' },
        { keys: ['Mod', 'W'], label: 'Fechar a aba' },
        { keys: ['Mod', 'Tab'], label: 'Próxima aba' },
        { keys: ['Mod', 'Shift', 'T'], label: 'Reabrir a aba fechada' },
        { keys: ['Mod', 'F'], label: 'Procurar na nota' },
        { keys: ['Mod', 'D'], label: 'Selecionar a próxima ocorrência (edita todas juntas)' },
        { keys: ['Mod', 'B / I / U'], label: 'Negrito / itálico / sublinhado' },
        { keys: ['Mod', 'K'], label: 'Transformar a seleção em link' },
        { keys: ['Mod', 'Shift', 'V'], label: 'Colar sem formatação' },
      ],
    },
  },
  {
    id: 'tasks',
    label: 'Tarefas',
    name: 'Tarefas',
    icon: 'tasks',
    route: '/tasks',
    key: '2',
    description: 'Lista de tarefas com categorias, datas e repetição.',
    tutorial: {
      purpose: 'Sua lista de tarefas, com categorias, datas e tarefas que se repetem.',
      features: [
        'Digite na barra de cima e aperte Enter para criar.',
        'Clique numa tarefa para editar no painel ao lado.',
        'Recorrentes voltam sozinhas na próxima data.',
        'Mencione notas com @ no título ou nos detalhes.',
      ],
      tips: [
        '“Revisar amanhã #estudos” já define a data e a categoria.',
        'Concluídas e agendadas ficam nos links discretos no fim da lista.',
        '“Pular” avança uma recorrente sem marcar como feita.',
        'Funciona com o app fechado: o que venceu aparece ao abrir.',
      ],
      shortcuts: [
        { keys: ['Mod', 'N'], label: 'Nova tarefa' },
        { keys: ['Enter'], label: 'Abrir a tarefa selecionada' },
        { keys: ['Espaço'], label: 'Concluir a tarefa selecionada' },
        { keys: ['Esc'], label: 'Fechar o painel' },
      ],
    },
  },
  {
    id: 'mindmap',
    label: 'Mapa',
    name: 'Mapa Mental',
    icon: 'graph',
    route: '/mindmap',
    key: '3',
    description: 'Notas permanentes ligadas entre si, num mapa.',
    tutorial: {
      purpose: 'Notas permanentes ligadas entre si, como o Graph View do Obsidian.',
      features: [
        'Cada nó é uma nota: clique para abrir e editar ao lado.',
        'Shift + arrastar de uma nota até outra cria uma conexão.',
        'Vários mapas: troque e crie pelo seletor no canto.',
        '“Reorganizar” arruma o mapa sem cruzamentos.',
      ],
      tips: [
        'Soltar a conexão no vazio cria uma nota já ligada.',
        'Duplo clique no vazio cria uma nota ali.',
        'Clique numa conexão e use o × para removê-la.',
        'Botão direito no nó: cor, renomear, nova nota conectada.',
      ],
      shortcuts: [
        { keys: ['Mod', 'N'], label: 'Nova nota' },
        { keys: ['Mod', 'K'], label: 'Buscar no mapa' },
        { keys: ['Shift', 'Arrastar'], label: 'Conectar notas' },
        { keys: ['Delete'], label: 'Excluir a nota ou a conexão selecionada' },
        { keys: ['Esc'], label: 'Fechar a nota / tirar a seleção' },
      ],
    },
  },
  {
    id: 'links',
    label: 'Links',
    name: 'Links',
    icon: 'link',
    route: '/links',
    key: '4',
    description: 'Links salvos com o ícone do site, em categorias.',
    tutorial: {
      purpose: 'Seus links salvos, com o ícone de cada site, organizados em categorias.',
      features: [
        'Cole um endereço no campo de cima para salvar.',
        'O título e o ícone do site aparecem sozinhos.',
        'Arraste um link até uma categoria para movê-lo.',
        'Importe os favoritos do navegador (Chrome, Edge, Brave, Opera, Firefox, Zen…).',
      ],
      tips: [
        'Arrastar um link do navegador para a lista também salva.',
        'Ordene por recentes, A–Z ou URL.',
        'Links salvos podem ser mencionados nas notas com @.',
      ],
      shortcuts: [
        { keys: ['Mod', 'N'], label: 'Novo link' },
        { keys: ['Mod', 'V'], label: 'Salvar o endereço copiado' },
        { keys: ['Mod', 'F'], label: 'Buscar' },
        { keys: ['↑ / ↓'], label: 'Escolher um link' },
        { keys: ['Enter'], label: 'Abrir no navegador' },
        { keys: ['F2'], label: 'Editar' },
        { keys: ['Delete'], label: 'Excluir' },
      ],
    },
  },
]

/** O 4notes em geral (tutorial "Geral": workspace, módulos e atalhos de qualquer lugar). */
export const GENERAL_TUTORIAL: ModuleTutorial = {
  purpose: 'Tudo fica no seu workspace: uma pasta comum, fácil de copiar e de fazer backup.',
  features: [
    'Ative ou desative módulos em Configurações › Módulos (ou botão direito no menu lateral).',
    'Troque de workspace pelo nome no canto superior esquerdo.',
    'Tema claro ou escuro pelo botão do sol/lua.',
  ],
  tips: [
    'Desativar um módulo só o esconde: os dados dele continuam guardados.',
    'Editou um arquivo em outro programa? O 4notes relê ao voltar para a janela.',
  ],
  shortcuts: [
    // Acompanha a lista de módulos (um módulo novo entra aqui sozinho)
    { keys: ['Mod', MODULES.map((module) => module.key).join(' / ')], label: `Ir para ${MODULES.map((module) => module.label).join(' / ')}` },
    { keys: ['F1'], label: 'Abrir ou fechar o tutorial' },
    { keys: ['Mod', ','], label: 'Configurações' },
    { keys: ['Mod', '+ / − / 0'], label: 'Zoom da interface' },
  ],
}

export const MODULE_IDS: readonly ModuleId[] = MODULES.map((module) => module.id)

export const isModuleId = (value: unknown): value is ModuleId => typeof value === 'string' && (MODULE_IDS as readonly string[]).includes(value)

export function moduleById(id: ModuleId): ModuleDefinition {
  return MODULES.find((module) => module.id === id)!
}

/** Módulo da rota ("/tasks" → Tarefas); null fora dos módulos. */
export function moduleForPath(path: string): ModuleDefinition | null {
  return MODULES.find((module) => path === module.route || path.startsWith(`${module.route}/`)) ?? null
}

// ── Preferências dos módulos (.4notes/app.json) ─────────────────────────────

/** Como os módulos aparecem no menu lateral. */
export type NavStyle = 'icon-label' | 'icon'

export interface ModulePrefs {
  /**
   * Módulos desativados (só ficam fora do menu; os dados continuam no workspace).
   * Guarda só os desligados: um módulo novo começa ativo. Ids desconhecidos (de
   * outra versão do 4notes) são mantidos.
   */
  disabled: string[]
  navStyle: NavStyle
}

export const DEFAULT_PREFS: ModulePrefs = { disabled: [], navStyle: 'icon-label' }

/** Lê as preferências do app.json, tolerando arquivos editados à mão. */
export function normalizePrefs(raw: unknown): ModulePrefs {
  const data = (raw && typeof raw === 'object' ? raw : {}) as { modules?: unknown }
  const modules = (data.modules && typeof data.modules === 'object' ? data.modules : {}) as { disabled?: unknown; navStyle?: unknown }
  const disabled = Array.isArray(modules.disabled) ? [...new Set(modules.disabled.filter((id): id is string => typeof id === 'string' && !!id))] : []
  // Todos desativados (arquivo editado à mão): o primeiro volta a ficar ativo
  const usable = MODULE_IDS.some((id) => !disabled.includes(id)) ? disabled : disabled.filter((id) => id !== MODULE_IDS[0])
  return { disabled: usable, navStyle: modules.navStyle === 'icon' ? 'icon' : 'icon-label' }
}

export const isEnabledIn = (prefs: ModulePrefs, id: ModuleId) => !prefs.disabled.includes(id)

/** Módulos ativos, na ordem do menu. */
export function enabledModules(prefs: ModulePrefs): ModuleDefinition[] {
  return MODULES.filter((module) => isEnabledIn(prefs, module.id))
}

/** Dá para desativar? Pelo menos um módulo continua ativo. */
export function canDisable(prefs: ModulePrefs, id: ModuleId): boolean {
  return isEnabledIn(prefs, id) && enabledModules(prefs).length > 1
}

/** A lista de desativados depois de ligar/desligar `id` (null = não muda). */
export function withModuleEnabled(prefs: ModulePrefs, id: ModuleId, enabled: boolean): string[] | null {
  if (enabled) return isEnabledIn(prefs, id) ? null : prefs.disabled.filter((item) => item !== id)
  return canDisable(prefs, id) ? [...prefs.disabled, id] : null
}
