/**
 * Os módulos do 4notes num lugar só: nome, ícone, rota, atalho e o tutorial.
 *
 * O menu lateral, as Configurações (módulos ativos), os atalhos Ctrl+1…6 e os
 * Tutoriais leem esta lista. Para criar um módulo novo, basta acrescentá-lo aqui
 * (o tutorial é obrigatório) — ele aparece em todos esses lugares.
 *
 * Também ficam aqui as regras puras das preferências dos módulos (quais estão
 * ativos, em que ordem e como aparecem no menu), guardadas em .4notes/app.json
 * (stores/modules.ts). A ordem de MODULES é a ordem padrão do menu; os atalhos
 * Ctrl+1…6 continuam presos a cada módulo, qualquer que seja a ordem.
 */

export type ModuleId = 'notes' | 'tasks' | 'mindmap' | 'links' | 'timer' | 'finance'

/** Um atalho mostrado no tutorial. "Mod" vira Ctrl (Windows/Linux) ou ⌘ (macOS). */
export interface TutorialShortcut {
  keys: string[]
  label: string
}

/** Tutorial curtinho de um módulo (ou do 4notes em geral). Frases bem curtas. */
export interface ModuleTutorial {
  /** Para que serve, numa frase. */
  purpose: string
  /** O que dá para fazer (as funções principais). */
  features: string[]
  /** O que tem no botão direito (menus de contexto). */
  contextMenu: string[]
  /** O que pode passar despercebido. */
  tips: string[]
  shortcuts: TutorialShortcut[]
  /** No celular (toque): os gestos e onde ficam as ações (aparece só nas telas de toque). */
  touch?: string[]
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
        'Clique numa nota: abre na aba temporária (em itálico). Duplo clique: aba fixa.',
        'Selecione um texto para formatar: negrito, listas, link, bloco de texto ou de código…',
        'Cole prints e código: viram imagem e bloco de código.',
        'Blocos de código e de texto: copiar, remover e tela cheia (com “Quebrar linhas”).',
        'Clique no nome do bloco (Texto, JavaScript…) para trocar o tipo e a linguagem.',
        'Na lista, as notas alteradas por último ficam no topo.',
        'Categorias com cor, ícone ou foto: arraste a nota até uma delas.',
        '@ menciona notas, mapas, tarefas, links e registros do Timer; clique na menção para abrir.',
        'Arraste as abas para mudar a ordem.',
      ],
      contextMenu: [
        'Nota ou aba: categoria, duplicar, exportar TXT/PDF, Explorador, excluir.',
        'Aba: fechar a aba ou as outras; na aba temporária, “Fixar aba”.',
        'Nota na lista: “Abrir em aba fixa”.',
        'Categoria: nova nota nela, editar, recolher, excluir.',
        'Pasta: abrir a nota mais recente dela ou criar uma nota já dentro dela.',
        'Texto: inserir imagem, corretor, abrir/editar/remover link.',
      ],
      tips: [
        'A primeira linha é o título — e o nome do arquivo.',
        'Prefere começar sem o formato de título? Configurações › Módulos › Notas.',
        'Na pasta, o relógio (ao passar o mouse) abre a nota mais recente dela.',
        'Pastas sempre acima das notas na lista? Configurações › Módulos › Notas.',
        'Títulos que começam igual viram pastas na lista (“4notes 1.4.0”, “4notes 1.4.1”).',
        'Versão no título (“4notes 1.4.1”)? ‹ e › no fim das abas abrem a anterior e a próxima.',
        'Tudo salva sozinho; fechar a aba não apaga a nota.',
        'Editar a nota da aba temporária deixa a aba fixa: nada se perde ao clicar em outra.',
        '“Limpar formatação” aparece na barra quando o trecho selecionado tem formatação.',
        'As categorias são as do app: a mesma pode ser usada nas Tarefas, no Timer, nas Finanças…',
        'A lista do @ diz de onde é cada item e também busca por categoria e data: “@estudo 12/10”.',
        'Menção riscada: o item foi excluído (a nota continua funcionando).',
        'Excluir manda o arquivo para a Lixeira (no celular, para .4notes/trash).',
      ],
      shortcuts: [
        { keys: ['Mod', 'N'], label: 'Nova nota' },
        { keys: ['Mod', 'W'], label: 'Fechar a aba' },
        { keys: ['Mod', 'Tab'], label: 'Próxima aba (com Shift: anterior)' },
        { keys: ['Mod', 'Shift', 'T'], label: 'Reabrir a aba fechada' },
        { keys: ['Mod', '\\'], label: 'Mostrar/esconder a lista' },
        { keys: ['Mod', 'F'], label: 'Procurar na nota' },
        { keys: ['Mod', 'D'], label: 'Próxima ocorrência (edita todas juntas)' },
        { keys: ['Alt', 'Z'], label: 'Quebrar linhas (bloco em tela cheia)' },
        { keys: ['Mod', 'B / I / U'], label: 'Negrito / itálico / sublinhado' },
        { keys: ['Mod', 'Shift', 'X / H'], label: 'Tachado / marca-texto' },
        { keys: ['Mod', 'E'], label: 'Código na linha' },
        { keys: ['Mod', 'K'], label: 'Link' },
        { keys: ['Mod', 'Shift', 'V'], label: 'Colar sem formatação' },
        { keys: ['Mod', 'Clique'], label: 'Abrir o link no navegador' },
      ],
      touch: [
        'Toque numa nota para abrir (aba temporária); ‹ ou o “voltar” volta para a lista.',
        'A barra de formatação fica acima do teclado: B, I, títulos, listas, imagem, link…',
        'Num link, toque nele e depois em ↗ na barra para abrir no navegador.',
        'Toque prolongado numa nota, aba ou categoria abre o menu (categoria, exportar…).',
        'Toque prolongado numa pasta: abrir a nota mais recente ou criar uma nota nela.',
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
        '“Mais opções”: data, recorrência e categoria antes de criar.',
        'Clique numa tarefa para editar ao lado; clicar fora fecha.',
        'Recorrentes voltam sozinhas na próxima data.',
        'Categorias na lateral: filtre e arraste para mudar a ordem.',
        'A descrição tem a formatação das notas: selecione o texto (negrito, listas…).',
        '@ no título ou na descrição menciona notas, mapas, tarefas, links e registros do Timer.',
      ],
      contextMenu: ['Tarefa: editar, concluir, pular, mover de categoria, excluir.', 'Categoria: editar, mover para cima/baixo ou excluir.'],
      tips: [
        '“Revisar amanhã #estudos” já define a data e a categoria.',
        'Na descrição valem os atalhos das notas: Ctrl+B, listas com “- ”, “[ ]”…',
        'As menções ficam em “Menções”: clique para abrir, × para tirar. “Mencionar” busca sem digitar @.',
        'Concluídas e agendadas ficam nos links discretos no fim da lista.',
        'Categorias de outros módulos aparecem tracejadas na tarefa: um clique e ela vale aqui.',
        '“Pular” avança uma recorrente sem marcar como feita.',
        'O que venceu com o app fechado aparece ao abrir.',
      ],
      shortcuts: [
        { keys: ['Mod', 'N'], label: 'Nova tarefa' },
        { keys: ['Enter'], label: 'Abrir a tarefa selecionada' },
        { keys: ['Espaço'], label: 'Concluir a tarefa selecionada' },
        { keys: ['Esc'], label: 'Fechar o painel' },
      ],
      touch: [
        'No celular, o botão de lista ao lado do título abre Pendentes e as categorias.',
        'Toque numa tarefa para editar; o “voltar” do Android fecha o painel.',
        'Toque prolongado numa tarefa: concluir, pular, mover de categoria, excluir.',
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
        'Soltar a conexão no vazio cria uma nota já ligada.',
        'Vários mapas: crie, renomeie e troque pelo seletor no canto.',
        '“Reorganizar” arruma o mapa sem cruzamentos.',
        'Ctrl + arrastar seleciona várias notas: arraste uma delas para mover todas juntas.',
        'Mencione notas, mapas, tarefas, links e registros do Timer com @ dentro das notas.',
      ],
      contextMenu: [
        'Nota: abrir, renomear, nova nota conectada, cor, Explorador, excluir.',
        'Nota selecionada com outras: cor ou excluir para o grupo todo.',
        'Vazio: nova nota ali, selecionar área ou reorganizar o mapa.',
        'Conexão: remover.',
      ],
      tips: [
        'Duplo clique no vazio cria uma nota ali.',
        'Clique numa conexão e use o × para removê-la.',
        'Clicar no vazio tira a seleção e fecha a nota.',
        'A área soma à seleção: Ctrl + arrastar de novo junta mais notas.',
        'Excluir várias de uma vez tem Desfazer para todas.',
      ],
      shortcuts: [
        { keys: ['Mod', 'N'], label: 'Nova nota' },
        { keys: ['Mod', 'K'], label: 'Buscar no mapa' },
        { keys: ['Shift', 'Arrastar'], label: 'Conectar notas' },
        { keys: ['Mod', 'Arrastar'], label: 'Selecionar notas por área' },
        { keys: ['Mod', 'Clique'], label: 'Pôr ou tirar uma nota da seleção' },
        { keys: ['Arrastar o fundo'], label: 'Mover o mapa' },
        { keys: ['Roda do mouse'], label: 'Zoom' },
        { keys: ['Delete'], label: 'Excluir as notas ou a conexão selecionadas' },
        { keys: ['Esc'], label: 'Fechar a nota / tirar a seleção' },
      ],
      touch: [
        'Um dedo arrasta a nota ou o mapa; dois dedos (pinça) aproximam e afastam.',
        'Toque numa nota para abrir — na tela pequena, o 1º toque seleciona (e “Abrir”).',
        'Arraste a seta → da nota selecionada até outra para conectar (ou ao vazio: nota nova).',
        'Dois toques no vazio criam uma nota; segurar o dedo abre o menu.',
        'Segure no vazio › “Selecionar área” e arraste o dedo sobre as notas.',
        'Com notas selecionadas, tocar numa nota põe ou tira ela da seleção.',
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
        'Busque por título ou endereço; ordene por recentes, A–Z ou URL.',
      ],
      contextMenu: [
        'Link: abrir, copiar endereço, editar, mover, ver menções, atualizar título e ícone, excluir.',
        'Categoria: editar, mover para cima/baixo ou excluir.',
      ],
      tips: [
        'Arrastar um link do navegador para a lista também salva.',
        'Arraste as categorias para mudar a ordem.',
        '“Nova categoria” também oferece as categorias que já existem no app.',
        'O ⋯ do link abre o mesmo menu do botão direito.',
        'Links salvos podem ser mencionados nas notas e nas tarefas com @.',
        '“Ver menções” (no menu do link ou em Editar) lista onde ele foi mencionado e leva até lá.',
      ],
      shortcuts: [
        { keys: ['Mod', 'N'], label: 'Novo link' },
        { keys: ['Mod', 'V'], label: 'Salvar o endereço copiado' },
        { keys: ['Mod', 'F'], label: 'Buscar' },
        { keys: ['↑ / ↓'], label: 'Escolher um link' },
        { keys: ['Enter'], label: 'Abrir no navegador' },
        { keys: ['Mod', 'C'], label: 'Copiar o endereço' },
        { keys: ['F2'], label: 'Editar' },
        { keys: ['Delete'], label: 'Excluir' },
      ],
      touch: [
        'No celular, o botão de lista ao lado do título abre as categorias e a busca.',
        'Toque num link para abrir; toque prolongado: editar, mover, copiar, excluir.',
        'Importar no celular: o arquivo de favoritos (HTML) exportado pelo navegador.',
      ],
    },
  },
  {
    id: 'timer',
    label: 'Timer',
    name: 'Timer',
    icon: 'timer',
    route: '/timer',
    key: '5',
    description: 'Cronômetro, temporizador e Pomodoro, com histórico e estatísticas.',
    tutorial: {
      purpose: 'Acompanhe o tempo dedicado às suas atividades e veja para onde ele vai.',
      features: [
        'Sessão: cronômetro, temporizador ou Pomodoro — Iniciar e pronto.',
        'Atividade e categoria são opcionais e podem mudar durante a sessão.',
        'Pomodoro: ajuste foco, pausas e ciclos no botão ao lado dos tempos.',
        'Histórico: sessões por data, categoria ou atividade, com filtros.',
        'Estatísticas: dia, semana, mês, ano ou intervalo — e a comparação.',
        'Clique num registro para editar a atividade, a categoria ou o tempo válido.',
        'Registros podem ser mencionados com @ nas notas e nas tarefas; “Ver menções” mostra onde.',
      ],
      contextMenu: [
        'Registro do histórico: editar, ver menções ou excluir.',
        'Categoria: editar, mover para a esquerda/direita ou excluir.',
      ],
      tips: [
        'A contagem segue pelo relógio: troque de módulo ou feche o app à vontade.',
        'Finalizar salva a sessão; Cancelar não conta o tempo (fica como cancelada).',
        'Excluir uma categoria não apaga o histórico: escolha outra categoria ou deixe sem.',
        'Categorias de outros módulos aparecem tracejadas: um clique e ela vale no Timer.',
        'Na comparação, o período atual vale até agora contra o mesmo trecho do anterior.',
        'O ponto no ícone do Timer avisa que há uma sessão contando.',
        'Abrir a menção a um registro traz o Histórico até ele, destacado.',
      ],
      shortcuts: [
        { keys: ['Espaço'], label: 'Iniciar, pausar ou retomar' },
        { keys: ['Mod', 'Enter'], label: 'Finalizar a sessão' },
        { keys: ['Mod', 'N'], label: 'Nova sessão (vai para a atividade)' },
        { keys: ['← / →'], label: 'Período anterior / próximo (estatísticas e histórico)' },
      ],
      touch: [
        'As abas Sessão, Histórico e Estatísticas ficam no topo.',
        'Toque num registro para editar; toque prolongado numa categoria: editar, excluir.',
        'No celular, com o app em segundo plano, o aviso de fim aparece ao voltar.',
      ],
    },
  },
  {
    id: 'finance',
    label: 'Finanças',
    name: 'Finanças',
    icon: 'wallet',
    route: '/finance',
    key: '6',
    description: 'Controle de gastos, com histórico, categorias e gráficos.',
    tutorial: {
      purpose: 'Registre seus gastos e veja para onde vai o seu dinheiro.',
      features: [
        'Valor, descrição e Enter: o gasto entra com a data de hoje.',
        'Data, categoria e observações no próprio formulário (todos opcionais).',
        'Histórico por dia, com período, categoria, busca e ordem por data ou valor.',
        'Clique num gasto para ver, editar, repetir hoje ou excluir.',
        'Painel: evolução, por categoria, dias e maiores gastos, e a comparação.',
        'Gastos podem ser mencionados com @ nas notas e nas tarefas; “Ver menções” mostra onde.',
      ],
      contextMenu: ['Gasto: abrir, repetir hoje, mudar a categoria, ver menções, excluir.', 'Categoria: editar, mover para a esquerda/direita ou excluir.'],
      tips: [
        'O valor aceita “52,30”, “52.30” ou “1.234,56”.',
        'As categorias são as do app: use a mesma das Notas, Tarefas ou Timer.',
        'O total aparece no topo do histórico, com os filtros escolhidos.',
        'Excluir pede confirmação, e o aviso ainda tem Desfazer.',
        'Na comparação, o período atual vale até hoje contra o mesmo trecho do anterior.',
        'Abrir a menção a um gasto leva até ele no histórico, destacado.',
      ],
      shortcuts: [
        { keys: ['Mod', 'N'], label: 'Novo gasto (vai para o valor)' },
        { keys: ['Enter'], label: 'Registrar o gasto' },
        { keys: ['Mod', 'F'], label: 'Buscar no histórico' },
        { keys: ['← / →'], label: 'Período anterior / próximo' },
      ],
      touch: [
        'As áreas Gastos e Painel ficam no topo.',
        'Toque num gasto para abrir; toque prolongado: repetir, categoria, excluir.',
        'No celular, o teclado numérico abre no campo do valor.',
      ],
    },
  },
]

/** O 4notes em geral (tutorial "Geral": workspace, módulos e atalhos de qualquer lugar). */
export const GENERAL_TUTORIAL: ModuleTutorial = {
  purpose: 'Tudo fica no seu workspace: uma pasta comum, fácil de copiar e de fazer backup.',
  features: [
    'Abra ou crie workspaces pelo nome no canto superior esquerdo.',
    'Arraste os módulos do menu lateral para mudar a ordem.',
    'Ative, desative e ajuste módulos em Configurações › Módulos.',
    'Tema claro ou escuro pelo sol/lua do menu lateral.',
    'Biblioteca de imagens e “Iniciar com o computador” em Configurações › Geral.',
    'Ver categorias (etiqueta no menu lateral): as mesmas categorias em todos os módulos.',
    'Em Ver categorias: onde cada uma é usada, editar, juntar duas e excluir.',
  ],
  contextMenu: [
    'Módulo no menu lateral: mover para cima/baixo ou desativar.',
    'Menu lateral: ligar/desligar módulos, mostrar os nomes e ver categorias.',
    'Texto: desfazer, copiar, colar e sugestões do corretor.',
  ],
  tips: [
    'Desativar um módulo só o esconde: os dados continuam guardados.',
    'Renomear uma categoria vale em todos os módulos (nas Notas, a pasta acompanha).',
    'Excluir uma categoria em uso pede o destino dos registros: outra categoria ou nenhuma.',
    'Backup: basta copiar a pasta do workspace.',
    'Mudou algo em outro programa ou aparelho? O 4notes relê ao voltar e a cada minuto.',
    'Versão nova? O 4notes pergunta ao abrir; “Agora não” deixa ela em Configurações › Geral.',
    'O tema e as configurações ficam no workspace: valem no computador e no celular.',
  ],
  shortcuts: [
    // Acompanha a lista de módulos (um módulo novo entra aqui sozinho)
    { keys: ['Mod', MODULES.map((module) => module.key).join(' / ')], label: `Ir para ${MODULES.map((module) => module.label).join(' / ')}` },
    { keys: ['F1'], label: 'Abrir ou fechar o tutorial' },
    { keys: ['Mod', ','], label: 'Configurações' },
    { keys: ['Mod', '+ / − / 0'], label: 'Zoom da interface' },
  ],
  touch: [
    'Módulos na barra de baixo (com o celular aberto, ao lado); o resto fica em “Mais”.',
    'Categorias do app: em “Mais” › Categorias.',
    'Toque prolongado = clique direito: abre o menu do que estiver embaixo do dedo.',
    'O “voltar” do Android fecha menus e painéis e volta para a tela anterior.',
    'Com a pasta sincronizada (Google Drive…), o workspace é o mesmo nos dois aparelhos.',
    'Atualizar no celular: na 1ª vez, permita o 4notes instalar apps e confirme no Android.',
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
  /**
   * Ordem do menu lateral (ids). Sempre tem todos os módulos: um módulo novo entra no
   * fim. Ids desconhecidos (de outra versão do 4notes) são mantidos no lugar.
   */
  order: string[]
  navStyle: NavStyle
}

export const DEFAULT_PREFS: Readonly<ModulePrefs> = { disabled: [], order: [...MODULE_IDS], navStyle: 'icon-label' }

const idList = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && !!id))] : []

/** Lê as preferências do app.json, tolerando arquivos editados à mão. */
export function normalizePrefs(raw: unknown): ModulePrefs {
  const data = (raw && typeof raw === 'object' ? raw : {}) as { modules?: unknown }
  const modules = (data.modules && typeof data.modules === 'object' ? data.modules : {}) as { disabled?: unknown; order?: unknown; navStyle?: unknown }
  const saved = idList(modules.order)
  const order = [...saved, ...MODULE_IDS.filter((id) => !saved.includes(id))]
  const disabled = idList(modules.disabled)
  // Todos desativados (arquivo editado à mão): o primeiro do menu volta a ficar ativo
  const first = order.find(isModuleId)!
  const usable = MODULE_IDS.some((id) => !disabled.includes(id)) ? disabled : disabled.filter((id) => id !== first)
  return { disabled: usable, order, navStyle: modules.navStyle === 'icon' ? 'icon' : 'icon-label' }
}

export const isEnabledIn = (prefs: ModulePrefs, id: ModuleId) => !prefs.disabled.includes(id)

/** Todos os módulos, na ordem do menu (ativos ou não). */
export function orderedModules(prefs: ModulePrefs): ModuleDefinition[] {
  return prefs.order.filter(isModuleId).map(moduleById)
}

/** Módulos ativos, na ordem do menu. */
export function enabledModules(prefs: ModulePrefs): ModuleDefinition[] {
  return orderedModules(prefs).filter((module) => isEnabledIn(prefs, module.id))
}

/**
 * A ordem completa depois de reorganizar só uma parte dos módulos (ex.: os do menu):
 * os lugares ocupados pelos ids de `moved` recebem esses ids na nova ordem; os outros
 * (desativados, desconhecidos) ficam onde estavam. null = não muda.
 */
export function reorderedIds(order: readonly string[], moved: readonly string[]): string[] | null {
  const set = new Set(moved)
  if (set.size !== moved.length || order.filter((id) => set.has(id)).length !== moved.length) return null
  let next = 0
  const result = order.map((id) => (set.has(id) ? moved[next++]! : id))
  return result.some((id, i) => id !== order[i]) ? result : null
}

/** Ids de `list` com `id` andando `delta` posições (−1 = para cima). null = não dá. */
export function movedBy(list: readonly string[], id: string, delta: number): string[] | null {
  const from = list.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length || to === from) return null
  const result = [...list]
  result.splice(to, 0, ...result.splice(from, 1))
  return result
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
