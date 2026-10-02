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
  /** Imagens coladas nas notas (Notas e Mapa Mental). */
  attachmentsDir: 'attachments',

  /** Estado da interface (pode ser apagado sem perder dados). */
  metaDir: '.4notes',
  notesUiState: '.4notes/notes.json',
  mindmapUiState: '.4notes/mindmap.json',
  appUiState: '.4notes/app.json',
  /** Cópias automáticas (tasks.json de cada dia da semana, conversões do mapa mental). */
  backupsDir: '.4notes/backups',
} as const
