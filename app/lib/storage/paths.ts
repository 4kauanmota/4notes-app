/**
 * Onde cada coisa fica dentro da pasta de dados (o workspace) escolhida por você.
 */
export const DATA_PATHS = {
  /** Notas rápidas (aba Notas): um .md por nota. */
  notesDir: 'notes',
  /** Tarefas e categorias. */
  tasksFile: 'tasks/tasks.json',
  /** Mapas mentais: uma pasta por mapa, com um .md por nó e o mapa.json (conexões e cores). */
  mindmapDir: 'mindmap',
  /** Biblioteca de imagens: coladas nas notas (Notas e Mapa Mental), enviadas pela biblioteca, fotos das categorias. */
  attachmentsDir: 'attachments',
  /** Links salvos e as categorias deles. */
  linksFile: 'links/links.json',
  /** Ícones dos sites (um por site), mostrados ao lado de cada link. */
  linkIconsDir: 'links/icons',
  /** Timer: categorias das atividades, histórico de sessões e a sessão em andamento. */
  timerFile: 'timer/timer.json',

  metaDir: '.4notes',
  /**
   * Configurações do workspace (tema, módulos, Notas, Mapa Mental, Links): as mesmas
   * em todos os aparelhos que abrirem esta pasta (stores/settings.ts).
   */
  settingsFile: '.4notes/settings.json',
  /** Posições dos nós de cada mapa mental (o mapa fica igual em todos os aparelhos). */
  mindmapUiState: '.4notes/mindmap.json',
  /**
   * Até a 1.4.3: configurações misturadas com o estado da tela (abas abertas…). Lidos uma
   * vez, ao passar para o settings.json (lib/storage/settings-migration.ts).
   */
  notesUiState: '.4notes/notes.json',
  appUiState: '.4notes/app.json',
  linksUiState: '.4notes/links.json',
  /** Cópias automáticas (tasks.json, links.json e timer.json de cada dia da semana, conversões do mapa mental). */
  backupsDir: '.4notes/backups',
} as const
