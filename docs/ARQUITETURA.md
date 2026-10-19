# Arquitetura do 4notes

Este documento explica, de forma didática, como o 4notes funciona por dentro: como o **Nuxt** é usado, o que transforma o projeto em um **aplicativo desktop** — e, desde a 1.5.0, num **app Android** (item 17) —, como os **arquivos** são lidos e salvos e como funcionam **tarefas recorrentes**, o **Mapa Mental**, os **Links** e, desde a 1.6.0, o **Timer** (item 18). Na 1.6.1, as **menções** passaram a achar itens de todos os módulos (item 10) e o mapa ganhou a **seleção de várias notas** (item 9); na 1.6.2, as **atualizações automáticas** pelo GitHub Releases (item 19). Na 1.6.3: telas dos módulos na **largura toda** (item 1), notas **mais recentes no topo** e **abrir a mais recente** de uma pasta (item 6), **título na primeira linha** desligável (item 6), **blocos de código pela barra** com troca de tipo e linguagem (item 6) e um workspace novo começando com as **configurações padrão** (item 17).

---

## Visão geral

O 4notes é um app **Electron** cuja interface é um app **Nuxt**. O Electron junta duas coisas num executável:

- **Chromium** — o "navegador" que desenha a interface (HTML, CSS, Vue);
- **Node.js** — que tem acesso ao sistema operacional (arquivos, janelas, menus).

Cada um roda em um **processo** separado, e eles conversam por mensagens (**IPC**):

```
┌──────────────────────────────── 4notes.exe ─────────────────────────────────┐
│                                                                              │
│  PROCESSO PRINCIPAL (Node.js)                PROCESSO DA INTERFACE (Chromium)│
│  electron/                                   app/  ← o app Nuxt (Vue 3)      │
│  ├─ main.ts       ciclo de vida do app       ├─ pages/       Notas, Tarefas, │
│  ├─ window.ts     janela, fechar seguro      │                Mapa, Links,   │
│  │                                           │                Timer          │
│  ├─ protocol.ts   interface + imagens        ├─ components/  telas e peças   │
│  ├─ ipc.ts        atende os pedidos  ◀─IPC─▶ ├─ stores/      estado          │
│  ├─ files.ts      lê/grava arquivos          ├─ lib/         regras + disco  │
│  ├─ data-dir.ts   workspaces                 │                               │
│  ├─ library.ts    biblioteca de imagens      │                               │
│  ├─ export.ts     exportar TXT/PDF           │                               │
│  ├─ links.ts      sites e favoritos          │                               │
│  ├─ system.ts     iniciar com o computador   │                               │
│  └─ config.ts     preferências da máquina    └─ window.fourNotes  ◀── preload│
│         │                                         (electron/preload.ts)      │
└─────────┼────────────────────────────────────────────────────────────────────┘
          ▼
   WORKSPACE (pasta criada/escolhida por você)  %APPDATA%\4notes\config.json
   ├── notes/ (.md soltos e pastas de categorias) (qual workspace abrir, tema, janela)
   ├── tasks/tasks.json
   ├── mindmap/<mapa>/ (.md + mapa.json)
   ├── links/links.json (+ icons/, os ícones dos sites)
   ├── timer/timer.json (categorias, histórico e a sessão em andamento — 1.6.0)
   ├── attachments/ (biblioteca de imagens)
   └── .4notes/ (settings.json: configurações; mindmap.json: posições dos nós)
```

No **celular** (1.5.0), a mesma interface roda dentro do **Capacitor** (um app Android com um WebView), e no lugar do processo principal do Electron entra a camada `app/lib/mobile/`, que oferece a mesma `window.fourNotes` — ver item 17.

### Camadas

| Camada                       | Onde                                                          | Responsabilidade                                                                 |
| ---------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Interface                    | `app/pages`, `app/components`                                 | O que você vê e clica. Não sabe onde os arquivos ficam.                          |
| Estado da aplicação          | `app/stores/*.ts`                                             | Dados em memória de cada módulo + ações (criar, editar, salvar…).                |
| Lógica pura                  | `app/lib/dates.ts`, `app/lib/tasks/`, `app/lib/notes/` (título, categoria automática, exportar), `app/lib/mindmap/`, `app/lib/editor/`, `app/lib/links/`, `shared/link-meta.ts`, `shared/bookmarks.ts` | Regras sem Vue e sem disco (títulos, recorrência, formatação, marcação escondida, prévia do Markdown, listas, detecção de código, menções, conexões, layout do mapa, endereços, título/ícone de páginas, favoritos dos navegadores — Chromium, Firefox/Zen e HTML —, texto e HTML das notas exportadas). Testadas em `tests/`. |
| Persistência                 | `app/lib/*/repository.ts`, `app/lib/storage/`                 | Sabe **onde** e **em que formato** cada coisa é salva.                           |
| Sistema de arquivos          | `electron/files.ts`, `electron/data-dir.ts`, `electron/library.ts`, `electron/export.ts` | Leitura/escrita real no disco (Node.js), protegida: notas, workspaces, biblioteca de imagens, arquivos exportados. |
| Rede e navegadores (Links)   | `electron/links.ts`                                           | Busca o título e o ícone de um site e lê os favoritos dos navegadores instalados. |
| Sistema operacional          | `electron/system.ts`                                          | Iniciar o 4notes junto com o computador.                                         |
| Renderização do mapa         | `app/lib/mindmap/graph-view.ts`                               | Desenho em `<canvas>`, câmera, arrastar/conectar, animações.                     |
| Camada desktop               | `electron/`                                                   | Janela, protocolo, menus, IPC, segurança.                                        |
| Camada Android (1.5.0)       | `app/lib/mobile/`, `android/`, `capacitor.config.ts`          | A mesma API do desktop no celular: arquivos, permissão, seletor de pastas, links, PDF (item 17). |
| Tamanho de tela e toque (1.5.0) | `composables/useLayoutSize.ts`, `lib/touch/long-press.ts`, `composables/useBackButton.ts`, `assets/css/mobile.css` | Celular, dobrável e tablet: layout por tamanho, toque prolongado, "voltar" do Android (item 17). |

### Independência dos módulos

Cada módulo tem seu próprio store, repositório, pasta e componentes:

```
Notas        → stores/notes.ts   → lib/notes/   → notes/*.md, notes/<categoria>/*.md + categorias.json
Tarefas      → stores/tasks.ts   → lib/tasks/   → tasks/tasks.json
Mapa Mental  → stores/mindmap.ts → lib/mindmap/ → mindmap/<mapa>/*.md + mapa.json (conexões e cores)
Links        → stores/links.ts   → lib/links/   → links/links.json + links/icons/ (ícones dos sites)
Timer        → stores/timer.ts   → lib/timer/   → timer/timer.json (categorias, histórico, sessão em andamento)
```

Os módulos não importam uns aos outros. Eles compartilham **infraestrutura** (editor de Markdown, ícones, diálogos, a API de arquivos) e `stores/app.ts` conhece os cinco só para tarefas gerais: carregar tudo ao abrir, salvar tudo antes de fechar e reler os arquivos quando você volta para a janela. A **lista dos módulos** (nome, ícone, rota, atalho e tutorial) fica num lugar só, `lib/modules.ts`, e quais estão ativos em `stores/modules.ts` (item 16).

A **única ligação** entre módulos é a que foi pedida: **menções** — tarefas mencionam notas (1.1.0); notas das Notas mencionam notas (1.1.1) e tarefas (1.2.0); notas do Mapa Mental mencionam notas e tarefas (1.2.0); notas (das Notas e do Mapa) mencionam **links salvos** (1.3.1); na 1.6.1, notas e tarefas mencionam itens de **todos os módulos** — notas, notas dos mapas, mapas inteiros, tarefas, links salvos e registros do Timer —, e o Timer e os Links ganharam o **"Ver menções"**. Ela é explícita e fica num lugar só (ver item 10):

```
Notas / Mapa Mental ──(avisam "nota renomeada / movida")──▶ lib/note-events.ts
                                                                │
stores/mentions.ts  ◀───────────────────────────────────────────┘   um provedor por tipo de item: lista para o "@",
       │        ◀── (títulos das tarefas) ─────────── stores/tasks.ts     descreve o mencionado, abre no módulo dele,
       │        ◀── (links salvos: títulos, ícones, endereços) stores/links.ts   procura onde foi mencionado
       │        ◀── (registros: atividade, categoria, data) stores/timer.ts      ("Ver menções") e corrige as menções
       ▼
stores/tasks.ts   → tasks.json ("mentions": [...])
stores/notes.ts   → links no texto das Notas (rewriteContents)
stores/mindmap.ts → links no texto do mapa aberto (rewriteContents) e dos outros mapas, nos arquivos (rewriteAllMaps)
stores/timer.ts   → revealSession (o Histórico mostra o registro mencionado)
```

Notas e Mapa Mental não sabem quem os menciona: só publicam o aviso de renomeação (e oferecem funções genéricas para reescrever o texto das notas, que a ponte usa). Tarefas e registros do Timer não sabem que são mencionados: a ponte observa os títulos deles.

O módulo **Links** não sabe que é mencionado: a ponte só lê a lista de links salvos (para o `@`, para o ícone do site na frente de um link mencionado e para acompanhar um endereço trocado). Ele também compartilha a infraestrutura (o seletor de ícones, o avatar das categorias e a **biblioteca de imagens**, que é de todo o app — ver item 12). O Timer e os Links só chamam a ponte para abrir o "Ver menções" (`showMentionsOf`).

---

## 1. Como o Nuxt está sendo utilizado

O Nuxt roda em modo **SPA** (Single Page Application), configurado em `nuxt.config.ts`:

```ts
ssr: false
```

Isso significa:

- **Não existe servidor em produção.** `nuxt generate` gera arquivos estáticos (`.output/public/index.html` + JavaScript/CSS em `_nuxt/`). O Electron carrega esses arquivos.
- O Nuxt continua oferecendo o que tem de melhor para organizar a interface:
  - **Rotas por arquivo**: `app/pages/notes.vue` → `/notes`, `tasks.vue` → `/tasks`, `mindmap.vue` → `/mindmap`, `links.vue` → `/links`, `timer.vue` → `/timer`. O `<NuxtPage :keepalive>` mantém as telas dos módulos vivas ao alternar (o editor não perde o histórico de desfazer e o mapa não recalcula).
  - **Componentes automáticos**: qualquer `.vue` em `app/components/` pode ser usado pelo nome (`<TaskItem />`), sem importar.
  - **Plugins** (`app/plugins/theme.client.ts` aplica o tema antes da tela aparecer).
  - **Transições de página**, `app.vue` como "casca", `error.vue`, tela de carregamento.
- O que **não** é usado: renderização no servidor, `server/`, rotas de API, Nitro em produção. Quem faz o papel de "backend" é o processo principal do Electron.

No **modo de desenvolvimento** (`npm run dev`), o `scripts/dev.mjs`:

1. inicia o servidor do Nuxt (`nuxt dev`, porta 3141) com recarregamento instantâneo (HMR);
2. compila `electron/*.ts` com o esbuild em modo "watch";
3. abre o Electron apontando para `http://127.0.0.1:3141` (variável `FOURNOTES_DEV_SERVER_URL`).

Na **produção**, a interface vem do protocolo `app://4notes/` (ver item 2).

> Detalhe importante: como é uma SPA, os *stores* são módulos JavaScript comuns com `reactive()` do Vue (sem Pinia). Em apps com SSR isso seria perigoso (estado compartilhado entre usuários), mas aqui existe um único usuário e uma única janela.

**Largura das telas** (1.6.3): o conteúdo das telas dos módulos ocupa **toda a largura** da janela, com as mesmas margens — a classe `.module-content` (`assets/css/base.css`, margem lateral `--page-pad-x` em `tokens.css`), usada por Tarefas, Links e Timer. Até a 1.6.2 cada tela limitava o conteúdo (`width: min(820px, 100%)`, 860 e 1080 px) e sobrava um vazio grande à direita em janelas largas. O que precisa de uma largura confortável (um campo, um texto) limita só a si mesmo; uma tela nova usa a mesma classe, e `tests/layout-width.test.ts` confere que nenhuma página volta a limitar a largura. No Timer, a sessão e o resumo de **Hoje** dividem a largura na proporção 2:1, e o cartão da sessão, quando fica largo (≥ 760 px, *container query*), põe o relógio e os controles de um lado e a atividade e a categoria do outro. Nas Tarefas, com o painel de edição aberto numa janela larga, a lista deixa exatamente a largura dele (420 px).

---

## 2. Qual tecnologia transforma o projeto em um app desktop

**Electron** (janela nativa + Chromium + Node.js) e **electron-builder** (gera o instalador `.exe`).

O que acontece quando você abre o 4notes (`electron/main.ts`):

1. Garante **uma única instância** (`requestSingleInstanceLock`) — dois processos nunca gravam os mesmos arquivos.
2. Lê `config.json` e aplica o tema ao Windows (`nativeTheme`), para menus e diálogos combinarem.
3. Registra o protocolo **`app://4notes/`** (`electron/protocol.ts`): cada pedido (`app://4notes/_nuxt/x.js`) é respondido com o arquivo correspondente de `.output/public`. Rotas da SPA (`/tasks`, `/mindmap`) recebem o `index.html`. Também aplica uma *Content-Security-Policy* que só permite scripts do próprio app.
4. Registra os **handlers IPC** (`electron/ipc.ts`).
5. Cria a janela (`electron/window.ts`) com:
   - barra de título desenhada pelo Vue + botões nativos do Windows (`titleBarOverlay` — inclusive o Snap Layouts do Windows 11);
   - tamanho/posição lembrados;
   - a janela só aparece quando a interface avisa que terminou de montar (sem "piscar");
   - clique direito em texto: o processo principal manda para a interface os dados do menu (sugestões do corretor em português, o que dá para copiar/colar) e a interface desenha o menu (ver abaixo);
   - links externos abrem no navegador padrão.

**Resposta ao clique nos ícones** (1.4.2, `app/plugins/icon-tap.client.ts`): um listener de `pointerdown` na janela (e de `click` vindo do teclado) anima o ícone (`<svg>`) do controle clicado — `button`, link, `role="button"` ou `role="tab"` — com o mesmo movimento em todo o app: afunda até 80% e volta com um leve quique (320 ms, Web Animations API na propriedade `scale`, que não briga com `transform` de ícones girados ou em transição). Só o ícone do próprio controle (clicar numa aba de nota não mexe no × dela; linhas de lista não são controles); não anima controles desativados, os que têm animação própria (`.task-checkbox`, ou `[data-no-tap]`) nem com "reduzir movimento". Os `:active` que encolhiam alguns botões de ícone saíram para não haver dois movimentos diferentes. Um ícone que muda depois do clique (o "Copiado" dos blocos de código) troca o desenho dentro do mesmo `<svg>`, para a animação continuar.

**Menus do clique direito**: todos são desenhados pela interface (`components/shell/ContextMenuHost.vue` + `composables/useContextMenu.ts`), com o tema do app, submenus, atalhos e teclado (↑ ↓ → ← Enter Esc) — não há mais menus nativos. O menu de texto do editor chega pelo canal `menu:text` (com as sugestões do corretor) e a ação escolhida volta por `menu:text-action` (o Electron executa recortar/copiar/colar e o corretor; desfazer/refazer usam o histórico do próprio editor). O menu não tira o foco de onde ele está, então "Colar" cola no lugar certo.

Por que um protocolo próprio em vez de `file://`? Com `file://`, caminhos como `/_nuxt/app.js` apontariam para a raiz do disco e as rotas quebrariam. O `app://` se comporta como um site normal, mas lendo arquivos de dentro do app instalado.

Um segundo protocolo, **`workspace://files/<caminho>`**, mostra as **imagens das notas** (`attachments/…`), as imagens das categorias e os **ícones dos sites** (`links/icons/…`). Ele só entrega arquivos de imagem (`png`, `jpg`, `gif`, `webp`, `bmp`, `avif`, `svg`, `ico`) e só de dentro do workspace aberto — a interface continua sem acesso livre ao disco. A *Content-Security-Policy* libera esse endereço apenas para imagens (`img-src`).

### Por que Electron e não Tauri?

| | Electron (escolhido) | Tauri |
| --- | --- | --- |
| Linguagem do "backend" | TypeScript/Node.js (a mesma do resto do projeto) | Rust |
| Ferramentas para compilar no Windows | Só Node.js | Rust + Visual Studio Build Tools |
| Tamanho do instalador | ~80–100 MB | ~5–10 MB |
| Maturidade/documentação | Muito alta | Alta |

Para um app pessoal mantido por quem já trabalha com Nuxt/Vue, ter **tudo em TypeScript** e compilar com `npm` pesa mais do que o tamanho do instalador.

---

## 3. Como a aplicação acessa o sistema de arquivos

A interface **não tem acesso direto ao disco** (nem ao Node.js). Ela pede ao processo principal. O caminho de um salvamento:

```
editor (Vue)  →  stores/notes.ts  →  lib/notes/repository.ts  →  window.fourNotes.files.write(...)
                                                                        │  (preload.ts)
                                                                        ▼  ipcRenderer.invoke('files:write')
                                                     electron/ipc.ts  →  electron/files.ts  →  disco
```

Peças:

- **`shared/ipc.ts`** — o contrato (`FourNotesApi`) e os nomes dos canais. É importado pelos dois lados, então o TypeScript avisa se algo não bater.
- **`electron/preload.ts`** — roda antes da página, em um contexto isolado, e expõe só as funções do contrato como `window.fourNotes` (`contextBridge`).
- **`electron/ipc.ts`** — um *handler* por canal. Antes de tudo, confere se o pedido veio da própria interface do 4notes.
- **`electron/files.ts`** — faz o trabalho real com `fs` do Node.js (inclusive `saveImage`, que grava as imagens coladas em `attachments/` com nome único e limite de 40 MB, e `copyImage`, que copia uma imagem da biblioteca para a pasta de uma categoria das Notas).
- **`electron/library.ts`** — a biblioteca de imagens (item 12): lista, envia, exclui e "adota" imagens; **`electron/export.ts`** — salva as notas exportadas (TXT/PDF) onde você escolher; **`electron/system.ts`** — iniciar com o computador (item 13).
- **`electron/links.ts`** — o único lugar que usa a rede (módulo Links, ver item 11). A interface não ganha acesso livre à internet nem ao disco: ela só pede "o título e o ícone deste endereço" ou "os favoritos do navegador X" (da lista que o próprio processo principal encontrou).

Proteções:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`: mesmo que algum texto malicioso fosse renderizado, ele não teria acesso ao Node.js.
- **Todos os caminhos são relativos à pasta de dados** e validados por `resolveInside()`: `../../Windows/...` é recusado.
- **Escrita atômica**: o conteúdo vai para um arquivo temporário oculto e só depois substitui o original. Se a energia cair no meio, o arquivo antigo continua inteiro.
- **Novas tentativas** quando o arquivo está travado (antivírus, OneDrive sincronizando).
- **Excluir = Lixeira do Windows** (`shell.trashItem`), com fallback para `.4notes/trash/` (no Android, sempre `.4notes/trash/`: não há Lixeira para essas pastas).
- Arquivos com BOM (comum no Bloco de Notas antigo) são lidos corretamente.

---

## 4. Onde os dados são armazenados

**Seus dados** ficam no workspace — a pasta que você criou (com o nome que deu) ou escolheu:

```
Pessoal/
├── notes/                      Notas rápidas
│   ├── Ideias de jogo.md       (sem categoria)
│   ├── Lista de compras.md
│   ├── categorias.json         ordem, cor, ícone e imagem das categorias
│   └── Trabalho/               uma pasta por categoria, com as notas dela
│       ├── Trabalho.png        foto da categoria (cópia da imagem da biblioteca, com o nome da categoria)
│       └── Reunião.md
├── tasks/
│   └── tasks.json              Tarefas + categorias (um arquivo só)
├── mindmap/                    Mapas mentais — uma pasta por mapa
│   ├── Principal/
│   │   ├── mapa.json           conexões (setas) e cores das notas deste mapa
│   │   ├── Godot.md            cada nó é uma nota .md, só com o texto
│   │   ├── Game Design.md
│   │   └── Programação.md
│   └── Estudos/
│       └── …
├── links/
│   ├── links.json              Links salvos + categorias (um arquivo só)
│   └── icons/                  ícones dos sites, um por site (nuxt.com.png, store.steampowered.com.ico…)
├── timer/
│   └── timer.json              Timer (1.6.0): categorias, histórico das sessões e a sessão em andamento
├── attachments/                Biblioteca de imagens: coladas nas notas (imagem-20261002-141503.png), enviadas, fotos das categorias
└── .4notes/
    ├── settings.json           configurações (1.5.0): tema, módulos, Notas, Mapa Mental, ordem dos links, Timer — as mesmas em todos os aparelhos
    ├── mindmap.json            posições dos nós de cada mapa
    ├── trash/                  no Android: o que foi excluído (não há Lixeira)
    └── backups/                tasks-segunda.json … tasks-domingo.json, links-segunda.json … e timer-segunda.json … (7 dias), conversões do mapa e, em 1.5.0/, os arquivos de estado da 1.4.3
```

Formatos escolhidos:

| Conteúdo | Formato | Por quê |
| --- | --- | --- |
| Notas rápidas e permanentes | Markdown (`.md`) | Texto puro, abre em qualquer editor, é o padrão do Obsidian, fácil de versionar e fazer backup. |
| Tarefas | JSON | Dados estruturados (datas, regras de recorrência, histórico). JSON é robusto de ler/gravar e ainda editável à mão. Markdown com metadados seria frágil. |
| Conexões e cores do mapa | JSON (`mapa.json`, um por mapa) | O texto das notas fica limpo (sem `[[referências]]`) e as setas ficam num lugar só, fácil de ler. |
| Imagens das notas | Arquivos em `attachments/` + `![](../attachments/x.png)` na nota | A imagem fica no workspace (backup = copiar a pasta) e o caminho relativo também funciona no Obsidian/VS Code. |
| Categorias das Notas | Pastas em `notes/` + `notes/categorias.json` (ordem, cor, ícone, imagem) | A categoria de uma nota é a pasta onde o arquivo está: aparece igual no Explorador e no Obsidian, sem cadastro paralelo que possa ficar diferente. |
| Links | JSON (`links/links.json`) + ícones em `links/icons/` | Uma lista de registros (endereço, título, categoria): JSON é o formato natural e continua editável à mão. Os ícones ficam no workspace para aparecer sem internet e ir junto no backup. |
| Timer (1.6.0) | JSON (`timer/timer.json`) | Registros com datas, durações e trechos de tempo; a sessão em andamento fica no mesmo arquivo, para continuar depois de reabrir o app (ou em outro aparelho). |
| Descrição das tarefas (1.6.0) | Markdown dentro do `tasks.json` (`"notes"`) | A mesma formatação das notas, num campo de texto do JSON — o arquivo continua um só. |
| Configurações (tema e módulos) | `.4notes/settings.json` (1.5.0) | Valem para o workspace (cada workspace com as suas) e vão junto com a pasta: as mesmas no computador e no celular. |
| Estado da interface (abas abertas, último módulo, mapa aberto) | No aparelho (`localStorage` do app, por workspace — 1.5.0) | É de cada aparelho; perder não perde nada importante. |

Exemplo de `tasks.json`:

```json
{
  "app": "4notes",
  "version": 1,
  "categories": [{ "id": "estudos", "name": "Estudos", "color": "purple", "createdAt": "…" }],
  "tasks": [
    {
      "id": "t_k3j9x0a2qm",
      "title": "Estudar Godot",
      "notes": "",
      "categoryId": "estudos",
      "date": "2026-10-05",
      "recurrence": { "interval": 7, "unit": "day", "anchor": "2026-10-05", "basis": "schedule" },
      "done": false,
      "completedAt": null,
      "history": [],
      "mentions": [
        { "kind": "note", "path": "notes/Ideias de jogo.md", "title": "Ideias de jogo" },
        { "kind": "map", "map": "Principal", "note": "Godot.md", "title": "Godot" }
      ],
      "createdAt": "…",
      "updatedAt": "…"
    }
  ]
}
```

O app começa **sem categorias**: as que você cria ficam nesse mesmo `tasks.json`, dentro da sua pasta de dados.

Exemplo de `mapa.json`:

```json
{
  "app": "4notes",
  "version": 1,
  "connections": [{ "from": "Godot", "to": "Game Design" }],
  "colors": { "Godot": "blue" }
}
```

As notas são referenciadas pelo título (nome do arquivo sem `.md`). A conexão guarda o sentido da seta (`from` → `to`), mas duas notas têm no máximo uma conexão. Se um `.md` for renomeado por fora, a conexão antiga continua no arquivo (só não aparece) — nada é apagado sozinho.

**Preferências desta máquina** (não são dados) ficam em `%APPDATA%\4notes\config.json` (`electron/config.ts`): qual workspace abrir, zoom, tamanho/posição da janela e uma cópia do tema (para a janela abrir já com a cor certa). No Android, qual workspace abrir e a cópia do tema ficam no próprio app.

---

## 5. Workspaces: criar, abrir e trocar

Um **workspace é uma pasta de dados**, e o **nome do workspace é o nome da pasta** — não existe um segundo cadastro de nomes que possa ficar diferente do que você vê no Explorador. O nome aparece no canto superior esquerdo (`components/shell/TitleBar.vue`); clicar nele abre o menu **Abrir outro workspace… / Criar workspace… / Mostrar no Explorador**. As mesmas ações ficam em **Configurações → Geral → Workspace**.

**Primeira execução** — não existe `dataDir` no `config.json`, então aparece a tela de boas-vindas (`components/shell/WelcomeScreen.vue`) com **Criar workspace** e **Abrir workspace existente**. Não existe pasta sugerida nem pré-definida.

**Criar workspace** (`stores/app.ts → createWorkspace`):

1. `dataDir.pick()` abre o seletor de pastas nativo para você escolher **onde** criar.
2. Um diálogo pede o **nome**. A validação (`workspaceNameProblem` em `shared/ipc.ts`) é a mesma nos dois lados: nada de `< > : " / \ | ? *`, ponto/espaço no fim ou nomes reservados do Windows (`CON`, `NUL`…).
3. `dataDir.create(local, nome)` → `electron/data-dir.ts → createWorkspace` cria `<local>/<nome>/` com `notes/`, `tasks/`, `mindmap/`, `links/`, `attachments/` e `.4notes/` e grava o caminho no `config.json`. Se já existir uma pasta com esse nome **e com arquivos**, nada é tocado: aparece um aviso e o nome é pedido de novo.
4. A interface recarrega lendo o workspace novo.

**Abrir workspace** (`openWorkspace → applyDataFolder`) — escolha **qualquer pasta**:

- `dataDir.inspect()` examina a pasta: existe? está vazia? já tem dados do 4notes? dá para gravar?
- já tem dados do 4notes → passa a usá-los (o workspace anterior continua onde está);
- tem **outros arquivos** (ex.: `Documentos`) → oferece **criar um workspace dentro dela** (para não misturar) ou usar assim mesmo;
- está **vazia** e já existe um workspace aberto → pergunta se quer começar vazio ou **copiar** os dados do atual (nada é sobrescrito nem apagado).

Antes de trocar, tudo que estiver pendente é salvo. Se a pasta configurada sumir (pendrive desconectado, OneDrive desligado), o app mostra uma tela para recriá-la, criar outro workspace ou abrir outro — ele nunca cria dados em outro lugar sem você saber.

**Vindo da 1.0.1**: a pasta de dados que você já usava simplesmente vira um workspace (o nome mostrado é o nome dela); nada é movido.

---

## 6. Como as notas temporárias são salvas

Arquivo: `app/stores/notes.ts` (+ regras em `app/lib/notes/title.ts`).

**Título**: a primeira linha com texto, sem a marcação Markdown (nem a formatação de sublinhado/cor).

```
# Minha primeira nota        → título "Minha primeira nota"
**Lista** de compras          → "Lista de compras"
- [ ] ligar para o João       → "ligar para o João"
(vazia)                       → "Sem título"
```

**Nome do arquivo = título**, adaptado ao que o Windows aceita (`lib/files/filename.ts`): remove `<>:"/\|?*`, pontos/espaços no fim, nomes reservados (`CON`, `NUL`…) e limita a 80 caracteres. Títulos repetidos (na mesma pasta) viram `Ideias (2).md`.

**A primeira linha já é um título** (1.2.0, `lib/editor/title-line.ts`): numa nota vazia, o primeiro texto digitado (ou colado em uma linha só) ganha `# ` na frente — a nota fica com um título de verdade no Markdown. Não acontece quando o texto já começa com outra marcação (`-`, `>`, `` ` ``, `[`, `@`…). Para tirar o título, `Backspace` no começo da linha. Ao abrir uma nota, o cursor fica depois do `# ` (que continua escondido).

- **Desligável** (1.6.3): **Título na primeira linha** (Configurações › Módulos › Notas, `notes.titleFirstLine` no `settings.json`, ligado por padrão). Desligado, a nota nova começa como texto comum — sem o `# ` automático e com o texto de espera "Comece a escrever…" no lugar de "Título da nota" — e o **+** de uma pasta começa com `4notes ` (sem `# `). A primeira linha continua sendo o título da nota e o nome do arquivo. O editor pergunta ao app a cada nota vazia (`EditorHost.titleFirstLine`, um *getter*), então mudar a configuração vale na hora, também nas abas abertas; o `MarkdownEditor` refaz só o estado de uma nota vazia aberta, para trocar o texto de espera.

**Linha do tempo de um salvamento**:

1. Você digita → a nota fica "com alterações pendentes" (ponto roxo na aba).
2. 0,6 s depois da última tecla, o salvamento acontece.
3. Se o título mudou, o arquivo é **renomeado** antes de gravar (`notes/Rascunho.md` → `notes/Ideias.md`).
4. Uma fila por nota garante que dois salvamentos nunca se atropelem.

Também salva **na hora**: ao fechar a aba, com `Ctrl+S` e **ao fechar o app** — a janela só fecha depois que a interface confirma que gravou tudo (com limite de 4 s para nunca travar).

Outros detalhes:

- O **X da aba** de uma nota **sem categoria** pergunta o que fazer: **Guardar nota** (fecha só a aba; a nota continua na lista) ou **Apagar nota** (vai para a Lixeira, com Desfazer). Uma nota que está numa **categoria** fecha direto, guardada (1.3.0, `NotesTabs.vue → requestClose`) — para apagá-la há a lixeira ao lado dela na lista lateral. `Ctrl+W` e o clique do meio fecham a aba guardando a nota, como antes.
- Com muitas abas, a faixa rola na horizontal (roda do mouse ou a barra fina no topo) e o botão **+** fica sempre visível.
- Uma aba nova e vazia **não cria arquivo** (como no Bloco de Notas).
- As abas abertas ficam guardadas no aparelho (1.5.0, `lib/storage/device-state.ts`; até a 1.4.3, em `.4notes/notes.json`) e são restauradas na próxima vez — cada aparelho com as suas.
- Excluir manda o arquivo para a **Lixeira**, com botão **Desfazer**.
- Editou o `.md` em outro programa? Ao voltar para a janela do 4notes, o conteúdo é recarregado (se você não tinha alterações pendentes naquela nota). Arquivos criados por fora aparecem na lista.
- O nome do arquivo na barra de status inclui a pasta da categoria (`Trabalho/Reunião.md`), e o caminho no topo mostra a categoria (`Notas / Trabalho / Reunião`).

### Categorias — `lib/notes/categories.ts`, `stores/notes.ts`, `NoteCategoryDialog.vue`

Cada categoria é uma **pasta** em `notes/`; as notas dela ficam lá dentro (`notes/Trabalho/Reunião.md`). O nome da categoria é o nome da pasta (as regras de nome são as de pastas do Windows). O `notes/categorias.json` guarda o que a pasta não guarda — a ordem, a **cor**, o **ícone** e a **imagem**:

```json
{ "app": "4notes", "version": 1, "categories": [{ "name": "Trabalho", "color": "blue", "icon": "briefcase", "image": null }] }
```

- **Categorias = categorias.json + pastas com notas.** Uma pasta criada fora do app (com notas) também aparece, com uma cor escolhida pelo nome (sempre a mesma), até você editar; uma categoria sem notas existe pelo `categorias.json`. Um `categorias.json` com erro é copiado para `.4notes/backups/` e as pastas continuam valendo.
- **Ícone** (1.3.0): um dos ícones prontos de `lib/category-icons.ts` (desenhados em `lib/icons.ts`, na cor da categoria), escolhido no `components/ui/IconPicker.vue`. Ícone e imagem se excluem: escolher um tira o outro; sem nenhum dos dois, aparece a inicial do nome (`CategoryAvatar.vue`). O mesmo seletor e o mesmo avatar servem para as categorias dos Links.
- **Imagem** (1.3.1): escolhida na **biblioteca de imagens** (item 12 — dá para enviar uma nova por lá). Uma cópia vai para `notes/<Categoria>/<Categoria>.<ext>` (`images.copy`, só extensões de imagem, dentro do workspace), mantendo a estrutura de antes: a categoria continua sendo uma pasta com tudo dela. Trocar ou tirar a imagem manda a cópia antiga para a Lixeira — mas antes ela é "adotada" pela biblioteca (`library.adopt`: se não existir uma igual em `attachments/`, uma cópia vai para lá), então continua disponível para usar de novo. Excluir a categoria faz o mesmo com a foto dela.
- **Mover uma nota** (submenu "Categoria" da aba ou da lista, ou arrastando a aba/nota até a categoria — o arrastar leva o id da nota no tipo `application/x-4notes-note`): na fila da nota, o arquivo é renomeado para a outra pasta (com `(2)` se o nome já existir lá), os links relativos dela são refeitos para a pasta nova (`rebaseLinks`: `../attachments/x.png` → `../../attachments/x.png`, `Ideias.md` → `../Ideias.md`) e o aviso `note-renamed` corrige as menções a ela. O aviso de "foi para…" tem **Desfazer**.
- **Renomear a categoria** renomeia a pasta (e a imagem, que acompanha o nome) com as filas de todas as notas dela paradas; as notas mudam de caminho e o aviso `notes-folder-renamed` corrige as menções.
- **Excluir a categoria** move as notas de volta para `notes/` (com os links refeitos) e manda a pasta para a Lixeira — só se não sobrar nenhum outro arquivo nela (senão a pasta fica e um aviso explica).
- Operações de categoria acontecem uma de cada vez (`§categories` na fila); as das notas esperam por elas.

### Categoria automática pelo título — `lib/notes/auto-category.ts`, `stores/notes.ts`

Configuração das Notas (desligada no começo, item 13). Uma nota **nova** criada por você fora das categorias (`createNote(…, { autoCategory: true })`, só nesta sessão — duplicar ou desfazer uma exclusão não contam) vai para a categoria que já tem notas com o mesmo começo de título — o mesmo critério das pastas pelo título:

```
Dev: "4notes 1.1.1", "4notes 1.2.0"        nova: "4notes 1.2.1"  →  Dev
```

- `matchCategory` compara as palavras do começo do título (sem diferenciar maiúsculas): vale a categoria com o começo em comum mais comprido; empatando, a que tem mais notas com esse começo; empate de novo, a nota fica onde está.
- A decisão acontece **uma vez**, quando o título fica pronto: `Enter` depois do título (`titleLineFinished`) ou ao sair da nota (outra aba, fechar a aba). Assim, digitar o título aos poucos não leva a nota para o lugar errado no meio do caminho.
- Mover usa o mesmo caminho do "Categoria" do menu (`moveToCategory`), com o aviso "foi para Dev (categoria em comum)" e **Desfazer**. Com a opção desligada, nada muda — e ligar depois não mexe nas notas que já existem.

### Lista lateral: categorias no topo e pastas pelo título — `NotesSidebar.vue`, `lib/notes/title-tree.ts`

A lista mostra primeiro as **categorias** (imagem ou inicial na cor dela, contagem, recolher/expandir) e, embaixo, as **notas sem categoria**. Dentro de cada grupo, as notas aparecem em **pastas pelo título** — só na lista; os arquivos não mudam:

```
4notes 1.1.1           📁 4notes
4notes 1.2.0      →       📁 1.2.0      (a pasta é a nota "4notes 1.2.0")
4notes 1.2.0 bugs             bugs
Lista de compras          1.1.1
                       Lista de compras
```

- A primeira palavra vira pasta quando **2 ou mais notas** (com títulos diferentes) começam com ela; uma nota sozinha continua com o título inteiro.
- A segunda palavra vira subpasta quando 2+ notas começam com as mesmas duas palavras e alguma tem texto depois. Não há terceiro nível.
- A nota com o título exatamente igual ao da pasta é a própria pasta: clicar nela abre a nota (a setinha abre/fecha a pasta).
- Maiúsculas não importam para agrupar; o nome da pasta usa a grafia da nota da pasta (ou a mais comum).
- **As mais recentes no topo** (1.6.3): a ordem é a da **data da última alteração** (`mtimeMs`, a data mostrada na linha) — a mais nova primeiro; uma pasta vale pela nota mais recente dela (`latest`, contando subpastas e a nota da própria pasta), e pastas e notas se misturam nessa ordem. Empate (mesma data): pastas antes, em ordem alfabética com números na ordem certa (`1.9` antes de `1.10`) — a ordem de antes da 1.6.3. Editar uma nota leva ela para o topo do grupo dela. A mesma ordem vale no celular, na busca, nos "Recentes" da tela vazia e, entre as notas, na lista do `@` (item 10).
- **Abrir a mais recente** (1.6.3): cada pasta sabe a nota mais nova dela (`latestId` em `title-tree.ts`, `latest` na linha). O **relógio** da pasta (aparece ao passar o mouse, ao lado do **+**) e o primeiro item do menu da pasta — **Abrir a mais recente (“…”)**, também no toque prolongado — abrem essa nota; as pastas até ela abrem sozinhas e a lista rola até ela.
- As pastas começam fechadas; as que levam até a nota ativa abrem sozinhas. Categorias recolhidas e pastas abertas ficam guardadas no aparelho, junto das abas. Buscando, tudo aparece aberto.
- **Exibição das pastas pelo título** (1.3.1, configuração das Notas): **Padrão** (como foi digitado) ou **CAIXA ALTA** — só CSS (`text-transform` no nome das pastas); o título das notas e os arquivos não mudam.
- O título **"Notas"** em cima das notas sem categoria só aparece quando existe alguma nota sem categoria (ou enquanto você arrasta uma nota até ali, para tirar a categoria).
- O **+** de uma pasta (1.3.0, aparece ao passar o mouse) cria uma nota na mesma categoria que já começa com o título da pasta — `# 4notes ` (`titlePath` da pasta, em `title-tree.ts`; `4notes ` com o título na primeira linha desligado) —, com o cursor no fim. Completando o título, a nota cai na pasta. Esse começo é só uma sugestão (`createNote(…, { template: true })`): enquanto você não digita mais nada, a nota não vira arquivo e fechar a aba a descarta.

A aba de uma nota com categoria fica marcada com a **cor da categoria** (na aba ativa, o indicador de baixo inteiro; nas outras, um traço discreto).

### Versões de uma nota (anterior e próxima) — `lib/notes/versions.ts`, `stores/notes.ts › previousVersionOf/nextVersionOf`, `NotesTabs.vue` (1.4.1 · 1.4.3)

Notas com o mesmo título a não ser por um **número de versão** são versões umas das outras:

```
4notes 1.3.2  ‹  4notes 1.4.0  ‹  4notes 1.4.1  ›  4notes 1.4.2  ›  (nenhuma: sem botão)
Aula 3        →  Aula 2
4notes 1.2.0 bugs  →  4notes 1.1.1 bugs   (o texto depois da versão também conta)
```

- A versão é a **última palavra** do título que é um número (`3`, `1.4.0`, `v2.1`), com pelo menos uma palavra antes. As outras palavras precisam ser iguais (sem diferenciar maiúsculas) — as mesmas palavras de `titleWords` que montam as pastas pelo título, então as versões ficam sempre na mesma pasta da lista.
- A anterior é a **maior versão menor que a atual** e a próxima (1.4.3), a **menor versão maior que a atual**, comparando parte por parte (`1.10` > `1.9`; `1.4` = `1.4.0`, que não conta nem como anterior nem como próxima). Pulos na numeração são seguidos (`1.4.1` sem `1.4.0` → `1.3.9`). As duas usam a mesma função (`neighborVersion`, uma para cada sentido).
- O grupo é o da organização da lista: **a mesma categoria** (ou as notas sem categoria) — `sameDir`. Uma `1.3.9` em outra categoria não entra.
- Os botões ficam no **fim da barra das abas**, não no editor: **‹ 1.4.0** (anterior) e **1.4.2 ›** (próxima), o balão mostra o título; cada um abre a versão numa aba (`openNote`) e só aparece se ela existir (nenhum numa nota sem versão). São calculados da lista de notas (sem ler arquivos), então acompanham na hora uma nota nova, renomeada ou movida.

### Formatação do texto (Notas e Mapa Mental)

Arquivos: `app/lib/editor/elements.ts` (lê os trechos formatados), `app/lib/editor/formatting.ts` (comandos e desenho), `app/lib/editor/hidden-markup.ts` (edição com as marcações escondidas), `app/components/editor/FormatToolbar.vue` (barra) e `app/lib/editor/setup.ts` (monta o editor com todas as extensões abaixo).

Ao selecionar um trecho aparece a barra de formatação: negrito, itálico, sublinhado, tachado, cor do texto, marca-texto, título, lista, lista de tarefas, código, **bloco de texto** (1.3.2, ver "Blocos de texto" abaixo), **bloco de código** (1.6.3, ver "Blocos de código"), link e "limpar formatação". Com várias ocorrências selecionadas (`Ctrl+D`) a barra não aparece — ela cobriria as outras seleções —, mas os atalhos (`Ctrl+B`…) formatam todas. O arquivo continua sendo Markdown comum:

```
**negrito**   *itálico*   ~~tachado~~   ==marca-texto==   `código`
<u>sublinhado</u>   <span style="color: red">colorido</span>
```

Sublinhado e cor não existem no Markdown; o HTML simples é o jeito mais compatível (o Obsidian também mostra). As cores são as da paleta do app (`lib/colors.ts`), gravadas com nomes que também são cores válidas do CSS, e no editor seguem o tema claro/escuro.

**Marcação sempre escondida** (1.3.0): nenhuma marcação aparece no editor — nem `**`, `*`, `~~`, `==`, `` ` ``, nem as tags de sublinhado e cor, nem o endereço dos links. O texto só aparece formatado, como num editor visual; para tirar um formato, selecione o texto e desligue-o na barra ou no atalho. (Até a 1.2.0 as marcações do Markdown apareciam quando o cursor encostava no trecho.) Como quem edita não vê as marcações, o editor cuida delas (`hidden-markup.ts`):

- o cursor passa por cima delas (←/→ andam sempre um caractere visível);
- digitar, colar ou apagar mexe só no texto em volta, nunca em parte de uma marcação (`protectMarkup`);
- `Backspace`/`Delete` encostados numa marcação apagam o caractere visível do outro lado;
- `Enter` no meio de um trecho fecha o formato nesta linha e o reabre na próxima;
- um trecho que fica sem texto some junto com as marcações;
- copiar parte de um trecho leva as marcações completas;
- **marcações sempre válidas**: no Markdown, `**olá **` não é negrito (espaço encostado por dentro); o editor deixa o espaço do lado de fora e o próximo texto digitado continua formatado (`keepMarkupValid`);
- **formatos guardados, como no Word**: `Ctrl+B` sem seleção não escreve `****` — o negrito fica guardado para o que você digitar em seguida (também com acentos compostos, como `~` + `a`); clicar logo depois de um trecho em negrito (ou `End`) e digitar continua em negrito. Links e código não "continuam": o texto digitado depois deles fica fora (`gravityCursor`).

**Links no texto**: o botão 🔗 da barra (ou `Ctrl+K`) abre um campo para o endereço; com o cursor num link, o mesmo campo edita ou remove (`setLink`/`removeLink`). O clique direito sobre um link tem Abrir, Copiar endereço, Editar link e Remover link (`ContextMenuHost.vue`, com o link achado por `linkAtContextMenu`). `Ctrl+clique` abre o endereço; parado sobre o link, um balão mostra o endereço.

Aplicar um formato em parte de um trecho já formatado divide o trecho; aplicar em trechos vizinhos junta tudo (`**ab**cd` + negrito em `cd` → `**abcd**`). Tirar ou trocar um formato respeita os outros formatos do trecho (`<span…><u>texto</u></span>` sem a cor vira `<u>texto</u>`).

O **marca-texto** usa um verde translúcido (`--mark` em `tokens.css`), bem diferente do roxo da **seleção** (`--selection`), para não confundir texto destacado com texto selecionado.

### Títulos, listas e checklists — `markdown-preview.ts`, `lists.ts`

A marcação do começo da linha (`#`, `>`, `-`, `1.`, `- [ ]`) é lida da árvore de sintaxe do Markdown (`lineMarkerAt`) e trocada por um desenho: nada (títulos e citações), um marcador `•` / `1.` (listas) ou uma **caixa clicável** (tarefas). Ela **nunca aparece** como texto (1.3.0): o cursor nunca fica antes dela (`Home` vai para o começo do texto; `←` no começo do texto vai para a linha de cima). Para criar, digite o atalho do Markdown no começo da linha (`# `, `- `, `1. `, `- [ ] `, `> `) ou use a barra; para tirar, `Backspace` no começo do texto.

- **Enter** continua a lista (a tarefa nova começa desmarcada); **Enter** num item vazio sai da lista; **Tab** transforma o item em subitem do item de cima e **Shift+Tab** volta um nível — a indentação acompanha o marcador de cima (2 espaços para `-`, 3 para `1.`, senão o Markdown não aninha) e o item leva os subitens junto; **Backspace** no começo do texto sobe um nível ou transforma o item em texto comum; **Home** vai primeiro para o começo do texto.
- **Clicar na caixa** troca `[ ]` ↔ `[x]` no arquivo (`toggleTaskAt`), sem mexer no cursor; a tarefa feita fica riscada.
- Links `[texto](endereço)` mostram só o texto (ver "Links no texto" acima); `---` vira uma linha horizontal.

O arquivo continua sendo Markdown puro — a prévia só muda o desenho.

**Listas numeradas em sequência** (`lists.ts`): depois de cada edição sua, as listas numeradas que a edição alcançou são renumeradas na mesma transação (um Ctrl+Z desfaz tudo junto). O número inicial é o que você digitou no primeiro item; se você não mexeu nele (ex.: apagou o item 1), vale o número com que a lista começava. Um detalhe do Markdown: logo depois de um parágrafo, só "1." começa uma lista — por isso, quando apagar o item 1 faz o resto "deixar de ser lista", a numeração é refeita a partir da lista de antes. Desfazer/refazer e mudanças vindas do disco não são renumeradas.

### Blocos de código — `code-detect.ts`, `code-blocks.ts`, `languages.ts`

- **Colar código** (`paste.ts`) cria um bloco ` ```linguagem `. Se o texto veio do VS Code, a linguagem vem junto na área de transferência; senão `code-detect.ts` decide por pontuação de padrões (palavras-chave, símbolos, indentação) com proteções contra falsos positivos (texto comum, Markdown, listas). Precisa de pelo menos 2 linhas; `Ctrl+Shift+V` cola como texto comum.
- O bloco é um **cartão** (widget do CodeMirror) com a linguagem, os botões **Copiar**, **Tela cheia** e **Remover bloco**, e o código colorido com **altura máxima e rolagem interna**. As cercas ` ``` ` nunca aparecem.
- **Editor dentro do cartão** (1.4.3, `block-editor.ts`): o corpo do cartão é um segundo CodeMirror, só com o código (cores da linguagem, `Tab`, fechar parênteses; no bloco de texto, a fonte do texto e linhas que quebram), com a mesma altura máxima e rolagem. Clicar no código edita ali mesmo e **o cartão não cresce** — até a 1.4.2, clicar "abria" o cartão (as linhas viravam linhas do editor da nota, sem altura máxima). Como é um editor de verdade, o duplo clique, arrastar para selecionar e o `Ctrl+D` funcionam como num editor de código.
  - **Uma fonte de verdade**: cada mudança do editor do bloco vira uma transação no editor da nota (as posições somadas ao começo do código, com o mesmo `userEvent`, para o histórico agrupar a digitação); `Ctrl+Z`/`Ctrl+Y` (teclado e menu do botão direito — `historyViewOf`) usam o histórico da nota. Mudanças vindas da nota (desfazer, tela cheia, arquivo mudado por fora) voltam pelo `updateDOM` do widget, que mantém o mesmo editor (e o cursor) — o widget só é recriado quando o bloco troca de tipo (texto ↔ código).
  - **Seleção espelhada**: a seleção principal do bloco é copiada para o editor da nota (sem foco), então a barra de status mostra a linha/coluna certa, o desfazer volta o cursor para o lugar certo e a busca da nota continua dali. Ao contrário: uma seleção da nota que cai dentro do código (`↑`/`↓` entrando no bloco, `Enter` em ` ```py `, desfazer, `Ctrl+F` achando algo no código) aparece no editor do bloco (`revealInBlocks`), com o foco se a nota estava com ele.
  - **Sair**: `↑`/`←` no começo e `↓`/`→` no fim voltam para a nota (antes/depois do bloco; no começo/fim da nota ganha uma linha vazia); `Esc` (com um cursor só) vai para depois do bloco; `Backspace` no começo de um bloco vazio remove o bloco; `Ctrl+F` abre a busca da nota.
  - **A cerca cresce**: digitar dentro do bloco uma linha que o fecharia antes da hora (` ``` `) troca as duas cercas por uma maior (` ```` `) na mesma transação (`longerFences`).
  - **Aparência**: as regras do tema da nota também alcançam o editor de dentro (ele fica dentro da nota); por isso o `blockEditorTheme` usa seletores que começam pelo próprio editor (`&.cm-editor …`), que valem mais. Ele também esconde a seleção e o cursor nativos (o CodeMirror da nota mostraria os de um campo focado dentro dele), e a seleção fica mais clara quando o foco volta para o texto da nota.
  - Só os cartões na tela têm editor (o CodeMirror da nota só desenha o que está perto da tela): uma nota com 40 blocos abre em ~0,2 s.
- Digitar ` ``` ` (ou ` ```linguagem `) numa linha e apertar `Enter` cria um bloco; a linguagem muda clicando no nome dela no cabeçalho (menu com as linguagens, `chooseLanguage`); `Backspace` num bloco vazio o remove.
- **Pela barra de formatação** (1.6.3): o botão **Bloco de código**, ao lado do **Bloco de texto**, transforma a seleção num bloco de código com as mesmas regras do bloco de texto (`codeBlockChange` em `text-blocks.ts`: linhas inteiras, o texto como aparece na tela, nada dentro de outro bloco). A linguagem vem do conteúdo (`guessLanguage` de `code-detect.ts`: ` ```javascript `, ` ```python `, ` ```gdscript `…) ou fica sem linguagem (` ``` `, "Código").
- **Tipo e linguagem pelo nome do bloco** (1.6.3): o nome no cabeçalho é um botão nos dois tipos de bloco. O menu tem **Bloco de texto**, **Sem linguagem**, as linguagens mais usadas (JavaScript, TypeScript, Vue, HTML, CSS, JSON, GDScript, Python, C#, C++, Java, Shell, SQL, YAML, Markdown) e **Outra…** (qualquer linguagem do `@codemirror/language-data`, pelo nome ou pela extensão). Trocar só muda o texto depois da cerca (`setBlockLanguage`): texto ↔ código refaz o cartão com o editor do tipo novo e o conteúdo continua igual; `Ctrl+Z` desfaz a troca. A linguagem fica no próprio Markdown, então é a mesma ao reabrir a nota (e em outros editores).
- **Tela cheia** (`components/editor/CodeFullscreen.vue`) é um segundo editor com a linguagem do bloco; cada alteração é gravada de volta no bloco (`replaceBlockCode`), então desfazer/salvar funcionam como no resto da nota. **Remover bloco** apaga o bloco inteiro de uma vez, com **Desfazer** no aviso.
- As cores vêm de `@codemirror/language-data`: a lista oficial de linguagens do CodeMirror, que **carrega cada linguagem só quando ela aparece** numa nota. GDScript (Godot) não está na lista e foi adicionado em `languages.ts` como um modo simples.

### Blocos de texto — `text-blocks.ts`, `code-blocks.ts`, `languages.ts` (1.3.2)

Um bloco de texto é um bloco cercado com ` ```text ` — Markdown comum (o Obsidian/VS Code mostram como texto pré-formatado):

````
Olá
```text
mundo
```
bonito
````

- **Só manual**: o botão **Bloco de texto** da barra de formatação (`wrapInTextBlock` → `textBlockChange`). Nada vira bloco de texto sozinho: colar só cria bloco para **código reconhecido** (como antes); texto comum, listas e trechos longos entram como texto. `fenceFromVsCodeMode` e `codeLanguage` (em `paste.ts`) nunca devolvem `text`.
- **O conteúdo é o que aparece na tela**, sem tratamento: dentro de uma cerca não existe formatação, então o trecho é convertido pelas mesmas regras do **Exportar TXT** (`noteToPlainText` sobre `balancedSlice` da seleção): sai a marcação escondida (`**`, `<u>`, o endereço dos links; as menções ficam com o título), os itens de lista ficam com o marcador da tela (`•`, `1.`, `☐`/`☑`) e indentação/espaços continuam. Nenhuma linguagem, nenhuma cor, nada de "normalizar" o texto.
- **Um bloco ocupa linhas inteiras**: o que sobra antes e depois da seleção, na mesma linha, continua no lugar, em linhas próprias. Formatos cortados pelo bloco fecham antes dele e reabrem depois (`**abcd**` com `bc` selecionado → `**a**`, bloco `bc`, `**d**`); os espaços encostados no corte saem (para o Markdown continuar valendo). Parte de um item de lista: o item continua com o resto do texto. Várias linhas a partir do começo do texto de uma linha: a primeira entra inteira (com o marcador da lista). Seleção que corta um bloco de código leva o bloco inteiro; dentro de um bloco, o botão não aparece (`canWrapInTextBlock`).
- A cerca usa mais crases que qualquer linha do texto que comece com crases (` ```` ` quando precisa), para não fechar antes da hora.
- **Cartão**: o mesmo dos blocos de código (`code-blocks.ts` reconhece `isTextBlock`), com o cabeçalho **Texto** (desde a 1.6.3, um botão: o mesmo menu dos blocos de código, para virar código numa linguagem), **Copiar**, **Tela cheia** e **Remover** (com **Desfazer** no aviso), altura máxima e rolagem interna — mas com a fonte do texto e linhas que quebram (`.cm-textblock` e `.cm-block-text` em `theme.ts`; o editor do cartão usa `lineWrapping` e o corretor). A **tela cheia** (`CodeFullscreen.vue`) abre como texto: fonte do texto, linhas que quebram, corretor ligado, sem números de linha nem recursos de código. Desde a 1.4.1 o texto usa a **largura toda** da janela, com a mesma margem lateral do editor de notas (`--editor-padding-x`, em `textEditorTheme`), em vez de uma coluna centralizada com espaço vazio dos lados.
- `text` é reservado: `findLanguage('text')` não devolve linguagem (a busca aproximada do CodeMirror acharia o LaTeX pelo apelido `tex`) e o Markdown do editor usa `findLanguage` para colorir o código dos blocos. No PDF exportado o bloco sai com a fonte do texto (`.code.text`).

### Várias ocorrências — `Ctrl+D` — `multi-select.ts` (1.3.2)

- `Ctrl+D` (`⌘D`) com um trecho selecionado acrescenta à seleção a **próxima ocorrência** do mesmo texto, sem diferenciar maiúsculas (como o VS Code); de novo, a seguinte — chegando ao fim da nota, continua do começo. A ocorrência nova vira a seleção principal (a próxima busca continua depois dela). Sem nada selecionado, o primeiro `Ctrl+D` seleciona a palavra do cursor e os próximos só pegam a mesma palavra inteira, com as mesmas maiúsculas (`wordModeField`).
- Digitar, colar, apagar e os atalhos de formatação agem em todas as seleções juntas (os comandos de formatação já usavam `changeByRange`); um `Ctrl+Z` desfaz tudo de uma vez; `Esc` volta para um cursor só.
- Ocorrências que começam ou terminam dentro de algo escondido ficam de fora: o endereço de um link, o título de uma menção, imagens, marcadores de linha e marcações (lido do texto por `hiddenRanges`, valendo também fora da parte visível da nota, e das partes atômicas do editor). Desde a 1.4.3, o código dos blocos também: o bloco é um cartão atômico na nota e tem o próprio editor.
- **Nos blocos e na tela cheia** (1.4.3): `plainMultipleSelections` é o mesmo `Ctrl+D` para texto puro (nada escondido — o facet `plainText`), usado pelo editor do cartão (`block-editor.ts`) e pela tela cheia (`CodeFullscreen.vue`, que antes não aceitava várias seleções). As outras ocorrências do texto selecionado (`highlightSelectionMatches`) ficam só com um contorno (`.cm-selectionMatch`), para não se confundirem com as selecionadas.
- O editor passou a aceitar várias seleções (`EditorState.allowMultipleSelections`), mas **só o `Ctrl+D` cria seleções extras** (`onlyCtrlDAddsRanges`): `Ctrl+clique` continua abrindo links (`clickAddsSelectionRange` desligado) e outros comandos do CodeMirror que criariam cursores (`Ctrl+Shift+L`, `Ctrl+Alt+↑`…) continuam como antes. Vale nas Notas e nas notas do Mapa Mental.

### Imagens — `images.ts`, `paste.ts`, `host.ts`

1. Colar um print (ou soltar um arquivo de imagem) chama `attachments.saveImage` → o Electron grava `attachments/imagem-AAAAMMDD-HHMMSS.png` no workspace (a biblioteca de imagens, item 12). **Inserir imagem…** (1.3.1, botão direito no editor, fora dos blocos de código) abre a biblioteca e insere a escolhida no lugar do clique (`insertImageFromLibrary` → `host.pickImage`).
2. A nota recebe `![](../attachments/imagem-….png)` — caminho **relativo à pasta da nota** (`relativeTo`), por isso a nota também abre certo no Obsidian/VS Code e o workspace pode mudar de lugar.
3. Para mostrar, `resolveFromNote` transforma o caminho da nota em caminho do workspace (recusando endereços que saiam dele) e a imagem é carregada por `workspace://files/…`.

No editor aparece só a imagem — o texto `![](…)` nunca aparece (1.3.0). Clicar seleciona a imagem (com contorno; `Backspace`/`Delete` tiram da nota, `Ctrl+C` copia), e o que for digitado logo antes ou depois de uma imagem sozinha na linha vai para uma linha própria.

**Remover** (botão sobre a imagem) tira a imagem **só da nota** (1.3.1): o arquivo continua na biblioteca, para usar de novo — ele só sai de lá pela própria biblioteca, quando nada mais o usa. **Desfazer** (no aviso ou com Ctrl+Z) devolve a imagem para a nota. (Até a 1.3.0, Remover mandava o arquivo para a Lixeira.)

### Menções a itens de todos os módulos — `mentions.ts`, `lib/notes/mention-links.ts`

Nas Notas e nas notas do Mapa Mental, digitar **`@`** abre a lista: notas das Notas (de todas as categorias), notas de todos os mapas (sem a própria nota), **mapas inteiros** (1.6.1), **tarefas** (as concluídas no fim), **links salvos** (1.3.1) e **registros do histórico do Timer** (1.6.1, os mais recentes primeiro). Cada item mostra de onde é — módulo, categoria, data, duração (`Timer · Estudo · 12/10 · 1 h`, `Tarefa · Estudos · 14/10`, `Link · Dev · nuxt.com`, `Mapa mental · 12 notas`) — para diferenciar nomes iguais; a busca procura no título e nesse "de onde é", palavra por palavra (`@estudo 12/10`). O escolhido entra como um **link Markdown comum**, relativo à pasta da nota, então o arquivo continua legível e o link funciona no Obsidian/VS Code:

```
[Ideias](Ideias.md)                                nota das Notas (na mesma pasta)
[Reunião](Trabalho/Reuni%C3%A3o.md)                  nota de uma categoria
[Godot](../mindmap/Principal/Godot.md)             nota de um mapa (vista das Notas)
[Principal](../mindmap/Principal/mapa.json)        o mapa inteiro (1.6.1)
[Estudar Godot](../tasks/tasks.json#t_k3j9x0)      tarefa: o tasks.json + o id dela depois do "#"
[Estudando Godot](../timer/timer.json#s_k3j9x0)    registro do Timer: o timer.json + o id (1.6.1)
[Nuxt](https://nuxt.com/)                          link salvo: um link comum
```

Um link salvo **não vira chip**: ele é um link como os outros (o texto continua editável) e ganha o **ícone do site** na frente (`formatting.ts → LinkIconWidget`, pelo `MentionHost.linkIcon`). Vale para qualquer link do texto cujo endereço é um link salvo no módulo Links (`savedLinkIcon` em `stores/mentions.ts`, comparando com `urlKey`); quando os ícones chegam ou mudam, o `revision()` da ponte muda e os editores redesenham.

No editor, o link vira um **chip** com o título atual (um bloco só: o cursor passa por cima e Backspace apaga a menção inteira): roxo para notas e mapas, amarelo para tarefas e registros do Timer — a tarefa concluída aparece riscada; a dica do chip diz o que o clique faz e de onde é o item. Clicar abre o item no módulo dele: a nota (trocando de mapa se precisar), o mapa, a tarefa no painel das Tarefas, o registro no Histórico do Timer (destacado). O que não existe mais aparece riscado e cinza; clicar só avisa — nada quebra e a nota continua igual. Os chips são redesenhados quando um título ou estado muda fora do editor (o `revision()` da ponte muda e o editor recebe o efeito `refreshMentions`). Mudanças vindas de fora (menção corrigida, arquivo editado em outro programa) não entram no Desfazer.

Os caminhos dos links codificam só o que quebraria o link (espaços, parênteses, `#`…) e mantêm os acentos legíveis (`lib/files/workspace-path.ts`).

As extensões do editor não conhecem Vue nem IPC: tudo que precisa do app (salvar imagens e escolher da biblioteca, endereço da imagem, abrir a tela cheia, mostrar aviso, listar e abrir notas mencionadas, ícone dos links salvos) passa pela interface `EditorHost` (`host.ts`), que o `MarkdownEditor.vue` fornece.

### Exportar como TXT ou PDF — `lib/notes/export.ts`, `composables/useNoteExport.ts`, `electron/export.ts`

No menu da nota (lista lateral e aba): **Exportar → TXT / PDF**. O Markdown é lido pelas **mesmas regras do editor** (`findElements`, `lineMarkerAt`, `codeBlocks`, num `EditorState` só para isso — `parseNote` completa a árvore até o fim, mesmo em notas grandes), então o que sai é o que você vê:

- **TXT** (`noteToPlainText`): sai toda a formatação e toda a sintaxe do Markdown — `#`, `**`, `==`, `<u>`, a cor, o endereço dos links (fica o texto), as menções (fica o título), as imagens e as cercas dos blocos de código (fica o código). Cada linha da nota é uma linha do arquivo; os itens de lista ficam com o marcador que aparece na tela (`•`, `1.`, `☐`/`☑`) e a indentação do nível. No Windows, as quebras de linha são as do Windows.
- **PDF** (`noteToPdfHtml`): um HTML com a mesma aparência da nota (títulos, formatos, links clicáveis só para `http(s)`/`mailto`, chips das menções, listas, checklists, citações, linhas horizontais, imagens e blocos de código **coloridos** — a linguagem é carregada na hora, com as mesmas cores do editor), no tema claro. O processo principal (`exportPdf`) troca as imagens do workspace pela imagem embutida (`data:`, `inlineWorkspaceImages`), grava o HTML numa pasta temporária, abre uma janela escondida (sem JavaScript; a *Content-Security-Policy* do HTML bloqueia qualquer acesso à rede) e usa `printToPDF` (A4).
- O "Salvar como" começa com o título da nota como nome do arquivo e lembra a última pasta usada na sessão. O aviso tem **Mostrar** (abre no Explorador — só arquivos exportados nesta sessão).

---

## 7. Como as notas permanentes do Mapa Mental são salvas

Arquivo: `app/stores/mindmap.ts` (+ `app/lib/mindmap/model.ts` e `repository.ts`).

- Você pode ter **vários mapas**: cada um é uma pasta em `mindmap/`, com as próprias notas e conexões. O seletor no canto superior esquerdo do mapa cria, renomeia (renomeia a pasta), mostra no Explorador e exclui mapas (a pasta vai para a Lixeira; sempre sobra pelo menos um). Só o mapa aberto fica na memória; trocar de mapa salva tudo antes.
- Cada **nó é um arquivo** `mindmap/<Mapa>/<Título>.md`, só com o texto. Aqui o **título é o nome do arquivo**, então ele é único dentro do mapa — o próprio sistema de arquivos garante isso.
- As **conexões e cores** ficam no `mapa.json` do mapa (salvo 0,3 s depois de cada mudança).
- Clicar em um nó abre o **painel da nota** à direita: a cor (bolinha ao lado do título), o título (editável), o editor (com **menções** a notas e tarefas, como nas Notas) e a lista de conexões (clique para abrir, × para remover). Clicar no vazio do mapa tira a seleção e fecha o painel (como o `Esc`).
- Salvamento automático **0,5 s** após parar de digitar, com a mesma escrita atômica e a mesma fila por nota.
- **Renomear**: renomeia o arquivo e atualiza as conexões, a cor e a posição do nó.
- **Excluir** (menu do nó, painel ou `Delete` com a nota selecionada no mapa): o arquivo vai para a Lixeira e as conexões dela saem do `mapa.json` (o Desfazer devolve tudo).

**Vindo da 1.0.0**: na 1.0.0 as notas ficavam soltas em `mindmap/` e as conexões eram `[[links]]` dentro do texto. Na primeira abertura da 1.0.1, `repository.migrateLegacy()` copia as notas originais para `.4notes/backups/mindmap-1.0.0-<data>/`, move tudo para o mapa `Principal`, transforma cada `[[link]]` para uma nota existente numa conexão do `mapa.json` e tira a marcação do texto (`Veja [[Godot]]` → `Veja Godot`; linhas que eram só links saem). As posições dos nós são aproveitadas. As regras ficam em `lib/mindmap/migration.ts` (testadas).

---

## 8. Como funcionam as tarefas recorrentes

> **Painel de edição** (1.3.2, `pages/tasks.vue` + `TaskDrawer.vue`): clicar fora do painel — na lista, nas categorias, no cabeçalho — fecha o painel, como o clique no vazio do Mapa Mental fecha o painel da nota. O clique continua fazendo o que faria (concluir, trocar de lista…): a página observa o clique (`pointerdown`/`click` na fase de captura) e só fecha o painel **depois** dele, se ele mesmo não mexeu no painel — clicar em outra tarefa abre a outra, "Nova tarefa" abre a criação. Não contam: cliques dentro do painel, o que abre por cima dele (lista de notas para mencionar, diálogo de categoria, menus — ficam fora da tela de Tarefas), arrastar para selecionar texto do painel até fora dele, o "clique" do teclado (`Enter` num botão) e um painel de **Nova tarefa** com algo já escrito (para não perder o rascunho).

Arquivos: `app/lib/tasks/recurrence.ts` (regras puras), `app/lib/tasks/model.ts` (concluir/pular/agrupar) e `app/stores/tasks.ts`.

> **Descrição formatada** (1.6.0, `TaskDrawer.vue` + `lib/tasks/description.ts`): a descrição é o **mesmo editor das notas** (`MarkdownEditor.vue`, com todas as extensões de `lib/editor/setup.ts`), não um editor separado — negrito, itálico, sublinhado, cor, marca-texto, títulos, listas que se renumeram, checklists, código, blocos de texto, links, imagens coladas e `Ctrl+D`. O texto é salvo em Markdown no `"notes"` da tarefa (descrições antigas, texto simples, continuam iguais; `trimDescription` só tira as linhas vazias do começo e os espaços do fim). Cada tarefa é um documento do editor (`docKey` `task:<id>`; "Nova tarefa", `task-new:<n>`), então o desfazer de uma não mistura com o de outra. A pasta "da descrição" é `tasks/` (`DESCRIPTION_DIR`): uma imagem colada vira `![](../attachments/x.png)`, e a biblioteca de imagens conta as descrições das tarefas como uso (item 12).
> - **Painel estreito**: o campo cresce com o texto (o painel rola) e a barra de formatação pode sair dos limites do editor (`toolbarOverflow`); quando o editor é mais estreito que a barra, os botões quebram em duas fileiras (`maxWidth` no `FormatToolbar`) em vez de serem cortados — isso vale para qualquer editor estreito. No toque, a barra fica fixa embaixo do campo, como nas notas.
> - **`@` na descrição**: a lista do editor (`MentionHost.search` → `searchNoteMentions`) mostra só as notas (das Notas e dos mapas); escolher (`MentionHost.choose`) deixa o título no texto e põe a nota em "Notas mencionadas" — a mesma menção estruturada do título e da barra rápida (`tasks.json → "mentions"`). Nenhuma ligação nova entre os módulos.
> - **Na lista**, a primeira linha aparece como no editor, sem a marcação (`descriptionPreview`, com as regras do Exportar TXT: `**` some, itens de lista viram •, ☐/☑).
> - **`Esc`** fecha o painel, menos quando é de algo aberto nele ou por cima dele: a lista do `@`, a tela cheia de um bloco, o campo do link na barra, a lista de notas ou um diálogo (`escapeBelongsElsewhere` em `pages/tasks.vue`). Com isso, o `Esc` com "Nova categoria" ou "Mencionar nota" abertos fecha só eles (antes fechava o painel junto).
> - O `Enter` escolhe a menção da lista do `@` mesmo dentro de um trecho formatado (`breakOutOfMarkup` deixa o `Enter` para a lista aberta) — valia também nas Notas.

### A ideia central

Uma tarefa recorrente guarda **uma regra** e **uma data**:

```json
"date": "2026-10-05",
"recurrence": { "interval": 7, "unit": "day", "anchor": "2026-10-05", "basis": "schedule" }
```

- `date` = a **próxima ocorrência** (quando ela deve estar na lista).
- A regra descreve uma série a partir da âncora: 05/10, 12/10, 19/10, 26/10…

**Em que lista ela aparece** é calculado na hora, comparando `date` com **hoje**:

| Situação | Lista |
| --- | --- |
| `date` ≤ hoje | **Pendentes** (em "Hoje" ou "Atrasadas") |
| `date` > hoje | **Agendadas** (esperando) — pelo link discreto "Ver tarefas agendadas", no fim da lista de Pendentes |

### Ao concluir

1. A conclusão é registrada no `history` (aparece em "Concluídas").
2. `date` avança para a **próxima ocorrência depois de hoje**.
3. Como `date` > hoje, a tarefa sai de Pendentes e vai para Agendadas.

### Por que funciona com o app fechado

Não existe nenhum processo rodando em segundo plano nem "alarme". A única coisa salva é a data. Exemplo real (testado automaticamente):

```
05/10  você conclui "Estudar Godot" (a cada 7 dias)  → date = 12/10, app fechado
...    (app fechado de 05/10 a 12/10)
12/10  você abre o app → 12/10 ≤ hoje → aparece em Pendentes › Hoje
```

Se você só abrir no dia 20/10, ela aparece em **Atrasadas**. Ao concluir, as ocorrências perdidas são **puladas** (a próxima vira 26/10, e não 12/10 ou 19/10). E se o app ficar aberto durante a virada do dia, um relógio interno (`composables/useToday.ts`) percebe a mudança e a tarefa entra na lista sozinha.

### Opções

- **Frequência**: todos os dias, toda semana, a cada 2 semanas, todo mês, todo ano ou personalizada ("a cada N dias/semanas/meses/anos").
- **Contar a partir da**:
  - _data programada_ (padrão): segue o calendário — "toda segunda" continua sendo segunda;
  - _conclusão_: a próxima data é contada a partir do dia em que você concluiu ("regar as plantas 7 dias depois da última vez").
- **Pular**: avança para a próxima ocorrência sem registrar conclusão.
- **Meses com dias diferentes**: uma tarefa mensal no dia 31 vai para 28/29 em fevereiro e **volta para 31** em março (a âncora guarda o dia original).

Tarefas **não recorrentes** concluídas vão para "Concluídas" (link "Ver concluídas", com opção de reabrir). O contador "X/Y hoje" considera as concluídas hoje e as pendentes para hoje — atrasadas, de hoje **e sem data**. Toda a lógica de datas tem testes em `tests/recurrence.test.ts` e `tests/tasks.test.ts`.

Segurança extra: se o `tasks.json` for editado à mão e ficar inválido, o módulo mostra um aviso e **não grava nada** até você corrigir — e existe um backup por dia da semana em `.4notes/backups/`.

---

## 9. Como o Mapa Mental encontra as relações entre as notas permanentes

As relações ficam **explícitas** no `mapa.json` de cada mapa: uma conexão é um par de títulos (`from` → `to`). O texto das notas não tem nenhuma referência escondida — a conexão é só a linha/seta no mapa.

### 1) Criar e remover conexões

- **Shift + arrastar** a partir de uma nota desenha uma seta; **soltar sobre outra nota** cria a conexão (`connectNotes`). Notas já conectadas não ganham uma segunda conexão. (Arrastar sem Shift move a nota.)
- **Soltar a seta no vazio** pede um nome ("Nova nota conectada") e cria a nota **onde a seta foi solta**, já conectada à de origem (`connectToNew` → `pages/mindmap.vue → onConnectToNew`). Cancelar não cria nada; a prévia da seta mostra um nó fantasma enquanto você arrasta.
- **Clicar numa conexão** a seleciona: aparece um **×** no meio da linha. Clicar no × (ou `Delete`) remove; o botão direito na linha também oferece "Remover conexão". Sempre com **Desfazer**.
- **`Delete` com uma nota selecionada** exclui a nota (vai para a Lixeira, com **Desfazer**).
- "Nova nota conectada" (botão do painel ou clique direito no nó) cria a nota e a conexão de uma vez.

### 2) Montar o grafo — `app/lib/mindmap/graph.ts`

- **Nós**: uma nota = um nó, com a cor escolhida (paleta das categorias de tarefas).
- **Arestas**: as conexões do `mapa.json` cujas duas notas existem (comparação sem diferenciar maiúsculas/minúsculas, como no Windows).
- **Tamanho do nó**: cresce com o número de conexões.

O componente do mapa só repassa os dados ao renderizador quando algo visível muda — digitar no texto não mexe no desenho.

### 3) Posições e "Reorganizar o mapa" — `app/lib/mindmap/layout.ts`

Os nós **ficam onde você os deixa** (arrastar move uma nota). Nota nova aparece num espaço livre perto da nota ligada a ela (ou onde você clicou com o botão direito). As posições ficam em `.4notes/mindmap.json`, por mapa — no workspace, então são as mesmas no computador e no celular (relidas ao voltar para o app, item 17).

"Reorganizar o mapa" calcula um layout limpo, no estilo de um mapa mental:

1. cada grupo de notas ligadas é organizado separadamente;
2. a nota mais conectada vai para o centro e as outras ficam em anéis ao redor, seguindo uma árvore; cada ramo ganha uma fatia do círculo proporcional ao seu tamanho — por isso as ligações da árvore não se cruzam;
3. conexões extras (que fecham ciclos) podem cruzar: uma busca local troca ramos de lugar e fica com a ordem de **menos cruzamentos** e menos linhas passando por cima de outros nós (com limite de tempo);
4. **compactação**: o grupo é encolhido (na horizontal e na vertical — escalar não cria cruzamentos) até o limite em que as notas não se encostam, cada linha mostra pelo menos um pedaço visível e nenhuma linha passa a cruzar outra ou a passar por cima de uma nota; depois, cada ramo é puxado ao longo da própria linha para perto da nota de cima, com as mesmas regras. Assim as linhas ficam curtas e só ficam longas quando isso é necessário;
5. os grupos são arrumados em linhas, do maior para o menor, e os nós deslizam até a nova posição.

### 4) Desenhar — `app/lib/mindmap/graph-view.ts`

- **Canvas 2D** desenha tudo a cada quadro (rápido mesmo com centenas de nós). O laço de animação para sozinho quando nada se mexe.
- Interações: zoom com a roda (em direção ao cursor), arrastar o fundo para mover a câmera, arrastar um nó para movê-lo, Shift + arrastar para conectar, clique abre a nota, clique no vazio tira a seleção, duplo clique ou botão direito no vazio criam uma nota ali, botão direito no nó abre o menu (renomear, cor, excluir…).
- Com o mouse sobre uma nota, ela e as conexões dela ganham destaque; as **setas que saem dela** ficam com a **cor da nota** (`Edge.tint`).
- Ao abrir/fechar o painel, a câmera desliza para manter o centro; se você pega o mapa no meio desse ajuste, ele termina na hora (abrir e fechar rápido não deixa o mapa deslocado).
- **Seleção de várias notas** (1.6.1): **Ctrl + arrastar** desenha uma área (um retângulo discreto na cor da seleção) e seleciona as notas que ela toca, somando às que já estavam; **Ctrl + clique** põe ou tira uma nota; no toque, "Selecionar área" fica no menu do vazio (segurar o dedo) e, com notas selecionadas, tocar numa nota põe ou tira ela. **Arrastar uma das selecionadas move todas** pelo mesmo tanto (as posições entre elas e as conexões não mudam). Uma barra embaixo mostra quantas estão selecionadas, com **Cor** e **Excluir** (Delete também); o botão direito numa delas tem cor e "Excluir N notas…" para o grupo. Excluir em lote (`mindmap.deleteNotes`) manda os arquivos para a Lixeira e tira as conexões delas, com **um Desfazer** que traz todas de volta com conexões, cores e posições. Clicar numa nota sem Ctrl volta ao normal (abre a nota e desfaz a seleção); clicar no vazio ou `Esc` limpam. A seleção fica na `GraphView` (`multi`) e é avisada à página (`selectionChange`); a área testa cada nó contra o retângulo (rápido mesmo com centenas de notas).
- Ajustes (desde a 1.3.1 em **Configurações → Módulos → Mapa Mental**, `components/mindmap/GraphSettings.vue`; desde a 1.4.2 não há mais um atalho para elas na barra do mapa): esconder notas sem conexões e nós em **cards** (padrão, com o nome dentro) ou **círculos** (estilo Obsidian). Nos círculos, os nomes aparecem **só na nota selecionada** (padrão), conforme o zoom ou sempre. **Reorganizar o mapa** continua no próprio mapa: botão na barra e no clique direito do fundo. A barra do mapa (`GraphToolbar.vue`) tem só o seletor de mapas, a busca (o atalho `Ctrl+K` funciona, mas só aparece no tutorial), **Nova nota** e **Reorganizar**; o rodapé mostra o resumo do mapa, o zoom e, com uma conexão selecionada, como removê-la (a dica fixa "Arraste para mover…" saiu na 1.4.2 — está no tutorial).
- Os ajustes ficam na seção `mindmap` do `.4notes/settings.json` (até a 1.4.3, no `.4notes/mindmap.json`) com `settingsVersion`: na primeira abertura da 1.1.0, os ajustes gravados pelas versões anteriores (que sempre salvavam os padrões antigos) passam para os novos padrões — cards e nomes ao selecionar — uma única vez.

---

## 10. Menções (entre todos os módulos)

Arquivos: `app/stores/mentions.ts` (a ponte: provedores, busca, abrir, "Ver menções", correções), `app/lib/mentions/refs.ts` (menções guardadas nas tarefas), `app/lib/mentions/catalog.ts` (ícone e textos de cada tipo, ordem da lista), `app/lib/notes/mention-links.ts` (links nas notas), `app/lib/note-events.ts` (avisos de renomeação), `components/tasks/MentionPicker.vue`, `MentionChip.vue` e `components/shell/MentionsDialog.vue`.

- **O que dá para mencionar** (1.6.1): notas das Notas, notas dos mapas, mapas inteiros, tarefas, links salvos e registros do histórico do Timer. Na lista do `@`, as notas das Notas vêm das mais recentes para as mais antigas (1.6.3, `order` pela data da última alteração), como na lista lateral. **Onde**: nas Notas, nas notas do Mapa Mental e nas Tarefas (barra de criação rápida, título, descrição e o botão **Mencionar**). Os Links e o Timer não têm campo de texto: neles entra o **"Ver menções"**.
- **Um provedor por tipo** (`PROVIDERS` em `stores/mentions.ts`): cada um lista os itens para o `@` (título, "de onde é", palavras extras para a busca e a fila), descreve um item mencionado (título atual, concluída, ou `null` = não existe mais) e abre o item no módulo dele. O `@` das notas, o das tarefas, os chips e o "Ver menções" usam os mesmos provedores — **um módulo novo mencionável** entra com um provedor e uma linha em `lib/mentions/catalog.ts` (`MENTION_KINDS`), sem integração separada.
- **Caminho de menção**: todo item tem um identificador em texto, o mesmo das notas — o caminho da nota (`notes/Ideias.md`, `mindmap/Principal/Godot.md`), o `mapa.json` do mapa (`mindmap/Principal/mapa.json`) ou, para quem tem id, o arquivo + `#id` (`tasks/tasks.json#t_x1`, `timer/timer.json#s_x1`, `links/links.json#l_x1`). Tarefas, registros e links são achados **pelo id**, que nunca muda; notas e mapas, pelo caminho, que a ponte corrige quando muda.
- **Nas tarefas**, a menção fica no `tasks.json`, numa lista estruturada (`"mentions"`), com o último título conhecido: `{ "kind": "note", "path": … }`, `{ "kind": "map", "map": …, "note": … }` (nota de mapa) e, na 1.6.1, `{ "kind": "mindmap", "map": … }`, `{ "kind": "task", "id": … }`, `{ "kind": "timer", "id": … }`, `{ "kind": "link", "id": …, "url": … }`. As de antes continuam iguais. O texto da tarefa fica limpo (`@ide` vira `Ideias de jogo`); a menção aparece como um chip na seção **Menções** (e na lista de tarefas). A lista do `@` não mostra a própria tarefa nem o que já está mencionado.
- **Clicar** abre o item no módulo dele (`openMentionPath`/`openRef`): nota (troca de mapa se precisar), mapa, tarefa (painel), link (no navegador), registro (**Histórico do Timer**: `timer.revealSession` tira os filtros que o escondem, vai para o período dele, rola até ele e o destaca). Módulo desativado: aviso com "Ativar". Item que não existe mais: chip riscado e um aviso ao clicar — nada quebra.
- **"Ver menções"** (Timer: menu do registro e diálogo de edição; Links: menu do link e diálogo de edição): `findMentionPlaces` procura nas Notas, nas notas de **todos os mapas** (os fechados são lidos da pasta) e nas tarefas (lista de menções e descrição); o diálogo lista os lugares e leva até eles. Para um link salvo, também contam os links comuns para o mesmo endereço.
- **Renomear ou mover no app** (título de uma nota rápida, nota movida de categoria, categoria renomeada, nota ou mapa do Mapa Mental) publica um aviso em `note-events.ts` (`note-renamed`, `notes-folder-renamed`, `map-note-renamed`, `map-renamed`). O store de menções:
  - corrige as tarefas afetadas (o `tasks.json` é salvo);
  - reescreve os links das Notas e do mapa aberto na hora (`renameMentionLinks`, com a pasta de cada nota; o texto do link acompanha o novo título — e, num mapa renomeado, o novo nome do mapa);
  - reescreve os arquivos dos **outros mapas** em lote, 1,2 s depois (`mindmap.rewriteAllMaps`, que não roda junto com a troca de mapa). Antes de o app fechar, o que estiver pendente é aplicado.
- **Título novo de tarefa ou de registro do Timer**: a ponte observa os títulos e, 1 s depois que você para de digitar, atualiza o texto das menções nas notas (`retitleIdLinks`). O link aponta pelo id, então nunca quebra; o texto só fica igual ao título.
- **Link salvo com endereço novo** (1.6.1): os links das notas para o endereço antigo passam para o novo (`relinkUrl`) e as menções das tarefas guardam o endereço novo.
- Por isso as referências continuam funcionando depois de fechar e reabrir o app. Arquivos renomeados **por fora** do app não têm como ser acompanhados: o chip mostra o último título conhecido e avisa ao clicar.

---

## 11. Links: salvar, ícones dos sites e importar do navegador

Arquivos: `app/stores/links.ts` (estado e ações), `app/lib/links/model.ts` (endereços, busca, ordem, `links.json`), `app/lib/links/import.ts` (plano da importação), `app/lib/links/repository.ts` (disco), `electron/links.ts` (rede e navegadores), `shared/link-meta.ts` e `shared/bookmarks.ts` (leitura de HTML e de favoritos, usadas pelo processo principal e pelos testes), `app/pages/links.vue` e `components/links/`.

**Dados** — um arquivo só, `links/links.json` (gravado 0,25 s depois de cada mudança, com escrita atômica e uma cópia por dia da semana em `.4notes/backups/`):

```json
{
  "app": "4notes",
  "version": 1,
  "folders": [{ "id": "dev", "name": "Dev", "color": "purple", "icon": "code", "image": null, "createdAt": "…" }],
  "links": [
    { "id": "l_k3j9x0a2qm", "url": "https://nuxt.com/docs", "title": "Nuxt Docs", "folderId": "dev", "icon": "nuxt.com.png", "createdAt": "…", "updatedAt": "…" }
  ]
}
```

Na interface elas se chamam **categorias** (1.3.1; no arquivo continuam `folders`/`folderId`, para não quebrar nada): um nível só, com nome, cor e um ícone pronto **ou uma foto** (1.3.1: `image`, uma imagem da biblioteca — sempre de dentro de `attachments/`; uma foto antiga de categoria das Notas ganha uma cópia lá ao ser escolhida, `library.adopt`). Um link sem categoria tem `"folderId": null`; um `links.json` editado à mão é lido de forma tolerante (endereços inválidos, categorias inexistentes e fotos fora da biblioteca são ignorados); um arquivo com JSON inválido não é sobrescrito — a tela mostra o erro, como nas Tarefas.

**Salvar um link** (`addLink`):

1. `normalizeUrl` completa o que foi colado ou digitado (`nuxt.com/docs` → `https://nuxt.com/docs`, `localhost:3000` → `http://…`) e recusa o que não é endereço de site. `urlKey` acha repetidos (maiúsculas no domínio e `/` no fim não contam): um link repetido não entra — o aviso diz em que categoria ele está.
2. O link entra na hora, com o domínio como título provisório, na categoria aberta.
3. Em segundo plano, `links.fetchMeta` pede ao processo principal o título e o ícone. `electron/links.ts` baixa só o começo da página (`net.fetch`, que usa o proxy e os certificados do sistema; até 768 KB e 9 s), lê o `<title>` (ou `og:title`) e os `<link rel="icon">` (`parseHead`), escolhe o melhor ícone para mostrar pequeno (`iconUrls`: SVG, depois tamanhos médios; o `/favicon.ico` do site por último), confere pelos primeiros bytes que é mesmo uma imagem (`sniffImage`) e grava `links/icons/<site>.<ext>`. O ícone vale para todos os links do mesmo site.
4. Sem internet ou com o site fora do ar, o link fica com o domínio e a inicial dele numa cor fixa por site; **Atualizar título e ícone** tenta de novo. Ao abrir a tela, os ícones que faltam são procurados uma vez por sessão, três sites por vez.

**Tela** (`pages/links.vue`): lista lateral com busca, "Todos os links", "Sem categoria" e as categorias (arraste um link até uma categoria para movê-lo — o arrastar leva o id no tipo `application/x-4notes-link` — e arraste as categorias para reordenar). "Sem categoria" só aparece quando existe algum link sem categoria, quando ela está aberta ou enquanto um link da lista é arrastado (para poder soltar ali). No centro, o campo de salvar (com o ícone de link, igual ao da barra de nova tarefa) e a lista — **Recentes**, **A–Z** ou **URL** (1.3.1: pelo endereço, `urlSortKey`: o domínio sem `www.` e com acentos, depois o caminho), lembrado em `.4notes/settings.json` (`links.sort`; até a 1.4.3, `.4notes/links.json`). Colar com `Ctrl+V` fora de um campo e soltar um link vindo do navegador também salvam. Clicar abre no navegador padrão (`shell.openExternal`). Mover, excluir e excluir categoria têm **Desfazer**; excluir uma categoria não apaga links — eles ficam sem categoria.

**Milhares de links** (favoritos importados): a lista desenha 150 linhas e mais ao rolar perto do fim (um `IntersectionObserver` no fim da lista; teclado e link recém-salvo garantem que a linha deles exista), as linhas fora da tela não são calculadas pelo navegador (`content-visibility: auto`) e listas com mais de 300 links não animam (a animação mediria todas as linhas a cada mudança). A busca guarda o texto já normalizado de cada link, e os links "buscando ícone" ficam num `Set` reativo — só a linha do link muda quando a busca dele começa ou termina. Testado com 3.000 links: buscar, ordenar e salvar levam frações de segundo.

**Importar do navegador** (`LinkImportDialog.vue`):

1. `links.browsers()` → `findBrowserSources` procura o arquivo `Bookmarks` (JSON) dos navegadores baseados no Chromium nas pastas padrão de cada sistema — Brave, Opera GX, Opera, Chrome, Edge, Vivaldi —, um item por **perfil** (os nomes vêm do `Local State`). A interface recebe só ids (`b1`, `b2`…); o caminho do arquivo fica no processo principal.
2. **Firefox e Zen** (1.3.1): o Zen é feito a partir do Firefox e guarda os favoritos do mesmo jeito, então os dois usam o mesmo caminho. Os perfis vêm do `profiles.ini` (`parseProfilesIni`; o padrão primeiro) da pasta de cada navegador — Windows `%APPDATA%\Mozilla\Firefox` e `%APPDATA%\zen`; macOS `~/Library/Application Support/Firefox` e `…/zen`; Linux `~/.mozilla/firefox`, `~/.config/mozilla/firefox`, `~/.zen` (e as versões Snap/Flatpak). Os favoritos estão no banco **`places.sqlite`** do perfil (tabelas `moz_bookmarks` + `moz_places`): como o navegador aberto trava o banco, o 4notes copia o arquivo (e o `-wal`, onde ficam as mudanças mais recentes) para uma pasta temporária e lê a cópia com o SQLite do próprio Node.js (`node:sqlite`, sem dependência nova); `geckoBookmarksFromRows` monta as pastas (Barra de favoritos, Menu de favoritos, Outros favoritos, Favoritos do celular; marcadores, separadores e consultas `place:` ficam de fora). Se não der para ler o banco, vale a **cópia automática** mais recente de `bookmarkbackups/` (`.jsonlz4`: `"mozLz40\0"` + tamanho + um bloco LZ4 — `decodeMozLz4` e `parseGeckoBackup`).
3. Para os outros navegadores (Safari…), **Arquivo de favoritos** abre o seletor do sistema e lê o HTML exportado (o formato "Netscape", que todos exportam — `parseBookmarksHtml`, inclusive os ícones embutidos `data:image/…`).
4. A árvore aparece com tudo marcado (pastas vazias somem; pastas grandes mostram 150 links e "mostrar mais"). `planImport` decide o resultado: **uma categoria para cada pasta do navegador** (a pasta de dentro vale; pastas com o mesmo nome se juntam, inclusive com as categorias que já existem; links soltos numa raiz ficam sem categoria) ou **tudo numa categoria**. Links que já estão salvos não entram de novo; o botão mostra quantos vão entrar de fato.
5. Os links entram de uma vez; os ícones embutidos no arquivo HTML são gravados e os outros chegam em segundo plano (a tela mostra "Buscando ícones dos sites… n/total"). Nada é alterado no navegador.

---

## 12. Biblioteca de imagens

Arquivos: `electron/library.ts` (processo principal), `components/shell/ImageLibraryDialog.vue` + `composables/useImageLibrary.ts` (interface: `pickLibraryImage()` abre a biblioteca para escolher e devolve o caminho; `openImageLibrary()` abre só para ver, enviar e excluir).

Toda imagem enviada ao 4notes fica em **`attachments/`** — coladas nas notas, enviadas pela biblioteca (**Enviar imagens…**, com o nome original do arquivo, até 40 MB) e escolhidas como foto de categoria — e pode ser usada de novo sem enviar outra vez: **Escolher imagem/foto…** nas categorias das Notas e dos Links, **Inserir imagem…** no editor e **Configurações → Geral → Biblioteca de imagens…**.

- **Sem repetidas**: `listLibrary` junta as imagens de `attachments/` e as fotos das categorias das Notas que estão só na pasta da categoria (de antes da biblioteca), e imagens com o mesmo conteúdo aparecem uma vez só (compara o tamanho e, só quando ele empata, um hash SHA-1). Enviar de novo uma imagem que já está lá devolve a que existe, sem criar outra cópia.
- **Onde é usada**: cada imagem mostra o uso — notas (`.md` em `notes/` e `mindmap/` que citam o arquivo: `referencedFiles` lê os links e imagens do texto e resolve os caminhos relativos), a descrição das tarefas (1.6.0: o `"notes"` de cada tarefa do `tasks.json`, com os caminhos relativos a `tasks/`), foto de categoria das Notas (`categorias.json`) e dos Links (`links.json`). Antes de listar, o app grava o que estiver pendente (`flushEverything`), para o "em uso" ficar certo.
- **Excluir** só aparece nas imagens sem uso (e só em `attachments/`); o arquivo — e as cópias iguais a ele — vão para a Lixeira (`removeFromLibrary` confere o uso de novo antes). Tirar uma imagem de uma nota ou de uma categoria nunca apaga o arquivo da biblioteca.
- **Adotar** (`library.adopt`): uma foto que está fora de `attachments/` (a foto antiga de uma categoria) ganha uma cópia na biblioteca quando é escolhida para outro lugar ou quando sai da categoria.
- **Modais empilhados** (`composables/useModalStack.ts`): a biblioteca abre por cima de outro diálogo (a categoria, as Configurações); o `Esc` fecha só o de cima e o aberto por último fica por cima, mesmo que tenha sido montado antes.

---

## 13. Configurações (e iniciar com o computador)

`components/shell/SettingsDialog.vue`, em duas abas (`app.openSettings(aba, módulo)`):

- **Geral**: tema; **Tutoriais e atalhos** (abre o painel do item 16); **Iniciar com o computador**; workspace (pasta, abrir/criar outro) e a biblioteca de imagens.
- **Módulos**: primeiro as **configurações gerais dos módulos** (1.4.0, item 16) — módulos ativos (arraste para mudar a ordem, 1.4.1) e **Menu lateral** (ícone e nome / só o ícone). Depois, os ajustes de cada módulo **ativo** que fazem sentido como configuração permanente, guardados **no workspace** (`.4notes/settings.json`, uma seção por módulo — 1.5.0): Notas (`NotesSettings.vue`: título na primeira linha — 1.6.3 —, categoria automática pelo título, exibição das pastas pelo título), Mapa Mental (`GraphSettings.vue`: notas sem conexões, estilo dos nós, nomes), Timer (1.6.0, `TimerSettings.vue`: som ao terminar, aviso do sistema — só no computador — e o dia em que a semana começa) e Tarefas e Links com "Sem nenhuma configuração disponível no momento.". As de um módulo desativado somem da lista (continuam guardadas). **Critério**: o que se usa toda hora fica na tela do próprio módulo — ordenar os links, as opções de criação das tarefas, reorganizar o mapa, a duração do temporizador e os ciclos do Pomodoro.
- Os **atalhos** de teclado saíram das Configurações (até a 1.3.2 havia uma aba "Atalhos"): ficam nos tutoriais de cada módulo (item 16).

**Desfoque só atrás do painel** (1.4.1): o fundo do `UiModal` (escurecido + `backdrop-filter`) é um `::before` com `inset` configurável (`scrimInset`). Na aba **Módulos**, ele começa abaixo da barra de título e à direita do menu lateral (`var(--titlebar-h) 0 0 var(--rail-w)`), então o nome do workspace e o menu ficam nítidos enquanto você liga, desliga e reorganiza; o resto da janela continua bloqueado para cliques. Na aba Geral, a janela inteira fica embaçada, como nos outros diálogos.

Cada configuração é um `components/ui/SettingRow.vue`: nome, o **?** com uma explicação bem curta (balão ao passar o mouse ou focar com o teclado) e o controle.

**Iniciar com o computador** (`electron/system.ts`): `app.setLoginItemSettings({ openAtLogin })` — no Windows, a mesma lista do Gerenciador de Tarefas › Inicializar (desligado por lá conta como desligado aqui; ligar aqui religa lá). É uma configuração **da máquina** (não do workspace) e só existe no app instalado (Windows e macOS): em desenvolvimento ela abriria o Electron "puro", então o switch fica desativado com o aviso "Disponível no 4notes instalado". Nos testes automatizados só simula. No Android não existe (`capabilities.launchAtLogin` falso) e a linha não aparece.

No celular, as Configurações abrem em **Mais** e ocupam a tela inteira; o tema também fica em **Mais**. Como tudo fica no `settings.json` do workspace, mudar uma configuração no celular muda no computador (item 17).

---

## 14. Como gerar uma nova versão/build

1. Aumente a versão no `package.json` (ex.: `"version": "1.3.1"`).
2. Rode:

   ```bash
   npm run dist:win
   ```

3. O instalador aparece em `release/1.3.1/4notes-Setup-1.3.1.exe`.

O que acontece por baixo (`package.json` → scripts):

```
nuxt generate                 → .output/public/   (interface: HTML + JS + CSS)
node scripts/build-electron   → dist-electron/     (main.cjs + preload.cjs, via esbuild)
electron-builder --win        → release/<versão>/  (empacota tudo + instalador NSIS)
```

**Instalador** (`electron-builder.yml` → `nsis`): telas para escolher para quem instalar, a pasta e os **atalhos**. A tela "Atalhos" vem de `build/installer.nsh` (incluído pelo electron-builder): uma caixa "Criar um atalho na área de trabalho" — marcada na primeira instalação; numa reinstalação, marcada só se o atalho já existe (se você o apagou, o instalador respeita). O atalho do Menu Iniciar é sempre criado, e desinstalar remove o da área de trabalho.

O app empacotado leva só `dist-electron/`, `.output/public/` e `package.json` (cerca de 1 MB de código); o resto do tamanho é o próprio Electron/Chromium. Não há `node_modules` dentro do app: as dependências já foram embutidas nos arquivos gerados — por isso todas ficam em `devDependencies`.

Para instalar a nova versão por cima da antiga, basta executar o novo instalador (feche o 4notes antes). Seus dados não são tocados, porque ficam no workspace, fora do app.

Para testar a versão de produção sem instalar: `npm start`.

**App Android** (1.5.0) — `npm run build:android` (`scripts/android.mjs`):

```
nuxt generate                     → .output/public/           (a MESMA interface do Windows)
npx cap sync android              → android/app/src/main/assets/public/ (+ plugins do Capacitor)
gradlew assembleRelease           → android/app/build/outputs/apk/release/app-release.apk
(cópia)                           → release/android/4notes-<versão>.apk
```

- Precisa do **Android Studio** (o script acha o Java — a pasta `jbr` dele — e o Android SDK nos lugares padrão, ou usa `JAVA_HOME`/`ANDROID_HOME`, e grava o `android/local.properties`). Na primeira vez o Gradle baixa o que precisa (internet).
- A versão do app é a do `package.json` (`versionName` 1.5.0, `versionCode` 10500 — `android/app/build.gradle`), então um número só vale para as duas plataformas.
- Assinatura: com `android/keystore.properties` (fora do Git), a sua chave; sem ele, a chave de testes do Android Studio deste computador. O Android só atualiza um app com um APK assinado pela mesma chave.
- `npm run android:run` instala direto no celular ligado no cabo (depuração USB); `npm run android:open` abre o projeto no Android Studio; `npm run android:sync` só atualiza o `android/`.
- `npm run build:windows` é o mesmo que `npm run dist:win`; `npm run build:ios` explica por que o iOS ainda não está incluído (item 17).

---

## 15. Como instalar em outro computador

1. Leve o arquivo `4notes-Setup-<versão>.exe` (pendrive, nuvem…) e execute.
   - O instalador não é **assinado digitalmente** (isso exige um certificado pago). O Windows SmartScreen pode avisar: clique em **Mais informações → Executar assim mesmo**.
   - A instalação é por usuário (não pede administrador), cria atalhos na Área de Trabalho e no Menu Iniciar e permite escolher a pasta de instalação.
2. Na primeira abertura:
   - **Começar do zero**: **Criar workspace** (escolha o local e dê um nome);
   - **Levar seus dados**: copie a pasta do workspace para o outro computador e use **Abrir workspace existente**;
   - **Usar nos dois computadores**: deixe o workspace numa pasta sincronizada (OneDrive, Google Drive…) e abra-o nos dois. Use um computador de cada vez para evitar conflitos de sincronização.

Para gerar o instalador em outra máquina (para desenvolver lá), instale o Node.js 22+, copie o projeto (sem `node_modules`) e rode `npm install` + `npm run dist:win`.

**No celular** (1.5.0): copie o `4notes-<versão>.apk` para o Android e toque nele (permita "instalar apps desconhecidos" para o app que abriu o arquivo). Na primeira abertura, crie ou abra o workspace — o 4notes pede o **Acesso a todos os arquivos** — e, para usar o mesmo workspace do computador, deixe a pasta sincronizada pelo Google Drive (item 17, "Sincronização"; o passo a passo está no README).

---

## 16. Módulos: ativar, desativar, reorganizar, menu lateral e tutoriais (1.4.0 · 1.4.1)

Arquivos: `app/lib/modules.ts` (lista dos módulos + tutoriais + regras puras das preferências), `app/stores/modules.ts` (preferências no workspace), `components/shell/NavRail.vue` (menu lateral e animação), `composables/useSortableList.ts` (arrastar para reorganizar, 1.4.1), `lib/sounds.ts` (sons de ligar/desligar, 1.4.1), `components/shell/TutorialPanel.vue` + `composables/useTutorial.ts` (tutoriais), `SettingsDialog.vue` (configurações gerais dos módulos).

**Uma lista só** (`MODULES` em `lib/modules.ts`): id, nome curto (menu) e completo, ícone, rota, tecla do atalho (`Ctrl+1…5`), uma linha de descrição e o **tutorial** (obrigatório no tipo). O menu lateral, os atalhos do `app.vue`, as Configurações, o título e os Tutoriais leem essa lista — um módulo novo entra em todos esses lugares (inclusive no atalho "Ir para …" do tutorial Geral) só sendo acrescentado ali.

**Ativar/desativar = preferência de exibição**, guardada na seção `modules` do `.4notes/settings.json` (`stores/modules.ts`; até a 1.4.3 ficava em `.4notes/app.json`, junto do último módulo aberto — que agora é de cada aparelho):

```json
{ "modules": { "disabled": ["links"], "order": ["notes", "mindmap", "tasks", "links"], "navStyle": "icon-label" } }
```

- Guarda só os **desativados**: um módulo novo começa ativo; ids desconhecidos (de outra versão) e outras chaves do arquivo são mantidos. Pelo menos um módulo fica ativo (`canDisable`; um arquivo editado à mão com todos desligados reativa o primeiro).
- **Nada muda nos dados**: todos os stores continuam carregando, salvando e relendo os arquivos (menções, biblioteca de imagens e "salvar antes de fechar" seguem iguais). O módulo só sai do menu; ao ativar, volta com tudo.
- Módulo aberto desativado → `app.vue` vai para o último módulo ativo (ou o primeiro). Ao abrir o app, idem.
- `Ctrl+<n>` ou uma **menção** para um módulo desativado não abre uma tela fora do menu: um aviso oferece **Ativar** (`requireModule`), que ativa e segue para o que foi pedido.
- Onde mudar: **Configurações › Módulos › Geral** (switches por módulo) ou **botão direito no menu lateral** (no módulo clicado: "Mover para cima/baixo" e "Desativar <módulo>"; depois as caixas por módulo, "Mostrar os nomes", "Configurações dos módulos…", "Tutorial").

**Ordem do menu** (1.4.1): `order` guarda **todos** os ids (os desativados também, no lugar deles). `normalizePrefs` tolera arquivo editado à mão: ids repetidos ou inválidos saem, módulos que faltam entram no fim na ordem padrão, ids desconhecidos (de outra versão) ficam no lugar. Reorganizar mexe só nos módulos mostrados: `reorderedIds(order, mostrados)` põe a nova sequência nos lugares que eles ocupavam e deixa os outros onde estavam — um módulo desativado volta, ao ser ativado, ao lugar em que estava. As Configurações, os tutoriais e o menu leem `ordered`/`enabled` (já na ordem); os atalhos `Ctrl+1…5` continuam presos a cada módulo (a tecla é do módulo, não da posição). Um módulo novo (o Timer, na 1.6.0) entra no fim do menu, já ativo, num workspace que tinha uma ordem guardada. Só a exibição muda: nada nos dados nem nas configurações dos módulos.

**Arrastar** (`useSortableList.ts`, usado no menu lateral e na lista das Configurações): eventos de ponteiro, não o arrastar-e-soltar do navegador (os itens do menu são links). Passando de 5 px o item "levanta" e segue o mouse (preso dentro da lista); os outros abrem espaço quando a borda dele passa do meio do vizinho; ao soltar, `onReorder` grava a ordem e um FLIP faz cada item deslizar até o lugar novo. O clique que encerra um arraste é engolido (não abre o módulo); um clique sem arrastar continua normal; `Esc` cancela. Nas Configurações, os switches não iniciam arraste. No menu, não dá para arrastar durante a animação de ligar/desligar; "Mover para cima/baixo" usa o mesmo FLIP.

**Menu lateral** (`NavRail.vue`): **Ícone e nome** (padrão, 64 px) ou **Só o ícone** (54 px; o nome fica no balão). A largura é a variável `--rail-w` do app inteiro, então a logo da barra de título continua centralizada sobre o menu. O indicador do módulo aberto segue o item medindo a posição dele (também durante as animações e o arraste). Embaixo: tema, **?** (tutorial) e Configurações. Com as Configurações abertas em **Módulos**, o desfoque do fundo começa depois do menu e da barra de título (`scrimInset`, item 13), que ficam nítidos para mostrar as mudanças ao vivo (até a 1.4.0, o menu subia por cima do fundo com a classe `.preview`).

**Animação de ligar** (~2,2 s desde a 1.4.1; era ~1,3 s, `stores/modules.ts › EFFECT_MS`): o espaço do módulo abre; um **fio** (roxo→amarelo, na borda do menu) cresce a partir dele até o primeiro e o último módulo; a ligação dele com o fio se estende até o ícone, que entra de lado e **encaixa** com um anel de luz; um **sinal** (ponto amarelo) corre pelo fio até cada um dos outros módulos, que respondem (a ligação deles pisca e o ícone dá um leve pulo); tudo some. **Desligar** (~1,4 s; era ~0,9 s) é o contrário: os outros mandam o sinal até ele, o anel se fecha, a ligação se solta, o ícone sai de lado e o espaço fecha. Só CSS (keyframes com variáveis por item: posição, atraso, distância), sem travar o uso; com "reduzir movimento" do sistema, não há animação. Nas Configurações, o card do módulo também "encaixa".

**Sons** (1.4.1, `lib/sounds.ts`): sintetizados com a Web Audio API (sem arquivos de áudio) e tocados no momento certo da animação (`SOUND_AT_MS`: ligando, no encaixe do ícone; desligando, quando ele se solta). Ligar: um clique suave e duas notas subindo; desligar: um "pop" abafado e duas notas descendo. Pico perto de −22 dBFS e menos de 0,4 s audível; saem pela saída padrão do sistema, então seguem o volume e o mudo dele. Nada se acumula: se a animação foi trocada antes do som (liga/desliga seguidos), ele não toca, e há um intervalo mínimo entre dois sons; nada toca em repetição. O `AudioContext` é criado só no primeiro som e suspenso logo depois (o app não fica segurando o áudio). Com "reduzir movimento", o som toca na hora (sem animação). `renderModuleSound` gera o mesmo som num `OfflineAudioContext` para os testes.

**Tutoriais** (`TutorialPanel.vue`): o **?** no fim do menu lateral ou **F1** (também com o cursor no editor) abre um painel ao lado do menu, por cima do módulo e **sem fundo escurecido** — dá para ler e testar. Abre no módulo atual e acompanha a troca de módulo; abas para os outros módulos (os desativados aparecem apagados, com **Ativar**) e o **Geral**. Cada tutorial: para que serve, o que dá para fazer, **Botão direito** (o que tem nos menus de contexto, 1.4.1 — campo `contextMenu`, obrigatório no tipo), "Você sabia?" e os atalhos (`Mod` vira Ctrl/⌘), em frases curtas (o teste limita a 100 caracteres). As abas seguem a ordem do menu. Fecha com ×, **?**, F1, Esc (o Esc não fecha se você estiver digitando fora do painel) ou **clicando fora** (1.4.1): um clique (botão esquerdo) que começa e termina fora do painel o fecha depois de fazer o que faria normalmente; clicar dentro não fecha, e não contam os botões que já abrem/fecham o tutorial (`[data-tutorial-toggle]`: o **?** e o "Abrir" das Configurações), o fim de um arraste de módulo e o "clique" do teclado. Também em Configurações › Geral › Tutoriais e atalhos.

---

## 17. O app Android (1.5.0)

**A ideia: o mesmo app, outra "casca".** No computador, o Electron dá à interface uma janela e o acesso aos arquivos. No celular, quem faz esse papel é o **Capacitor**: um app Android de verdade (instalado pelo APK, com ícone, permissões e o "voltar"), que mostra a interface num **WebView** (o Chromium do Android) e oferece plugins nativos (arquivos, HTTP, barras do sistema). Páginas, componentes, stores, editor e mapa são a **mesma pasta `app/`** — uma mudança no código vale para as duas plataformas; só a camada que fala com o sistema muda.

```
                 app/  (Nuxt + Vue) — a MESMA interface nas duas plataformas
                           │   window.fourNotes  (contrato FourNotesApi, shared/ipc.ts)
           ┌───────────────┴──────────────────┐
   COMPUTADOR (Electron)               CELULAR (Capacitor)
   electron/preload.ts                 app/lib/mobile/   (instalada por plugins/00.platform.client.ts)
   electron/files.ts                   ├─ api.ts         a API inteira, com as mesmas regras do desktop
   electron/data-dir.ts                ├─ workspace.ts   arquivos do workspace   (= electron/files.ts)
   electron/library.ts …               ├─ data-dir.ts    criar/abrir workspaces  (= electron/data-dir.ts)
   (Node.js: fs, shell, net)           ├─ fs.ts          @capacitor/filesystem (+ disco na memória p/ testes)
                                       ├─ native.ts      plugin do 4notes (android/…/FourNotesPlugin.java)
           │                           └─ pick-files.ts  escolher arquivos do celular
           │                                   │
           └──── WORKSPACE: a mesma pasta, mantida igual por um app de sincronização ────┘
```

### 1) Uma API, duas plataformas

- A interface não sabe em que plataforma está: ela chama `window.fourNotes.files.write(...)`, como sempre. No desktop, o preload do Electron instala essa API; no Android, `plugins/00.platform.client.ts` (que roda antes de tudo — `enforce: 'pre'`) chama `installMobilePlatform()` (`lib/mobile/install.ts`), que monta a mesma API com `createMobileApi`. O código do Android é carregado sob demanda (import dinâmico): o desktop nunca o carrega.
- As regras que precisam ser **iguais nos dois lados** saíram de `electron/` para `shared/`: `shared/files.ts` (nomes das imagens coladas, limite de 40 MB, texto sem BOM e com `\n`, imagens embutidas no PDF…) e `shared/library.ts` (biblioteca de imagens: uso, cópias iguais, excluir). O Electron e o celular chamam as mesmas funções — e passam pelos mesmos testes.
- **O que o celular não tem** chega em `bootstrap.capabilities` (`PlatformCapabilities`): `reveal` (Mostrar no Explorador), `launchAtLogin`, `browserBookmarks` (ler os favoritos dos navegadores instalados), `window` (barra de título e zoom próprios) e `systemTrash` (Lixeira do sistema). A interface pergunta (`capabilities()`, `canReveal()` e `trashPlace()` em `lib/platform.ts`; `revealItem()` nos menus) e esconde o que não existe — nada de botão que não funciona. No desktop tudo é `true` (`DESKTOP_CAPABILITIES`).

### 2) Arquivos e permissão

- O workspace fica numa pasta do **armazenamento interno** escolhida por você (`/storage/emulated/0/…`), e não na pasta privada do app: assim você vê os arquivos, e um app de sincronização (Autosync, FolderSync…) os leva ao Google Drive. No Android 11 ou mais recente, gravar numa pasta qualquer exige a permissão **Acesso a todos os arquivos** (`MANAGE_EXTERNAL_STORAGE`). O `FourNotesPlugin.java` diz se ela está ativa (`storageInfo`) e abre a tela do Android para ativá-la (`requestStorageAccess`); o 4notes explica antes. Se ela for desligada depois, a tela inicial mostra **Permitir acesso** (`DataDirProblem` `'no-permission'`).
  - Alternativa descartada: o seletor de pastas do Android (SAF, `content://`). Ele dá acesso a uma pasta sem a permissão ampla, mas sem caminhos de verdade, com operações bem mais lentas e sem o renomear da escrita atômica. Para um app pessoal, instalado por você, a permissão ampla é mais simples, mais rápida e funciona com qualquer app de sincronização.
- `fs.ts` (`capacitorFs`) usa o plugin `@capacitor/filesystem` a partir da raiz do armazenamento (`Directory.ExternalStorage`). `workspace.ts` (`WorkspaceFiles`) faz o que `electron/files.ts` faz: caminhos sempre relativos ao workspace e validados (`resolve` recusa `../`), escrita atômica (arquivo temporário + renomear), itens ocultos fora das listas. Diferenças do Android: o armazenamento não diferencia maiúsculas (`nota.md` e `Nota.md` são o mesmo arquivo — renomear só as maiúsculas passa por um nome temporário) e excluir vai para `.4notes/trash/` (não há Lixeira).
- **Escolher pastas**: o 4notes tem o próprio seletor (`FolderPickerDialog.vue` + `useFolderPicker.ts`): navega pelo armazenamento interno, cria pastas e devolve um caminho — o mesmo formato que o seletor do Windows devolve, então criar/abrir workspace (`stores/app.ts`) não mudou. **Escolher arquivos** (enviar imagens, arquivo de favoritos): o seletor do Android (`pick-files.ts`).
- **Imagens** (das notas, das categorias, ícones dos sites): o WebView mostra arquivos do aparelho por um endereço do servidor local do Capacitor (`Capacitor.convertFileSrc`), configurado com `setWorkspaceFileUrlBase` — o papel do protocolo `workspace://` do desktop.
- **Links**: título e ícone dos sites buscados pelo HTTP nativo (`CapacitorHttp`, sem as restrições de uma página) e lidos com as mesmas regras (`shared/link-meta.ts`). **Importar** aceita o arquivo HTML de favoritos.
- **Exportar**: o TXT vai para a pasta que você escolher; o PDF sai pela impressão do Android (`printHtml` → "Salvar como PDF"), com o mesmo HTML que o desktop imprime.

### 3) Configurações iguais, telas de cada aparelho

Com a mesma pasta em dois aparelhos, aparece a pergunta: o que deve ser igual e o que é de cada um? Até a 1.4.3, `.4notes/` misturava as duas coisas (as configurações das Notas ficavam junto das abas abertas no `notes.json`) e o tema ficava no computador. Na 1.5.0:

| O quê | Onde | Por quê |
| --- | --- | --- |
| Tema, módulos (ativos, ordem, menu lateral), ajustes das Notas e do Mapa, ordem dos links | `.4notes/settings.json` (`stores/settings.ts`) | É configuração da pessoa: vai junto com a pasta e vale em todos os aparelhos. |
| Abas abertas, aba ativa, lista lateral, pastas abertas, último módulo, mapa aberto | No aparelho (`lib/storage/device-state.ts`: `localStorage` do app, uma chave por workspace) | O celular não deve abrir as abas que você deixou no computador — e dois aparelhos gravando o mesmo arquivo de estado gerariam conflitos de sincronização a toda hora. |
| Posições dos nós dos mapas | `.4notes/mindmap.json` (só `layouts`) | Faz parte do mapa: ele tem a mesma cara nos dois aparelhos. |
| Qual workspace abrir | No aparelho (`config.json` no desktop; `localStorage` no Android) | Cada aparelho tem o próprio caminho até a pasta. |

```json
{
  "version": 1,
  "theme": "system",
  "modules": { "disabled": [], "order": ["notes", "tasks", "mindmap", "links"], "navStyle": "icon-label" },
  "notes": { "autoCategory": false, "folderCase": "typed", "titleFirstLine": true },
  "mindmap": { "settingsVersion": 2, "showOrphans": true, "nodeStyle": "card", "labels": "selected" },
  "links": { "sort": "recent" }
}
```

- Cada parte do app lê e grava só a sua seção (`settingsSection` / `updateSettingsSection`) e valida o que leu: um arquivo editado à mão não quebra nada, e chaves desconhecidas (de outra versão) continuam no arquivo. A gravação espera 0,25 s e só acontece quando algo mudou.
- **Mudou no outro aparelho?** O app relê o workspace quando você volta para ele (`focus` e `visibilitychange` da janela, `resume` do Android) e a cada 60 s com ele aberto (`stores/app.ts`). `refreshSettings` compara o arquivo com o último lido ou gravado e avisa só as seções que mudaram (`onSettingsChange`): o tema troca, um módulo some do menu, o mapa muda de estilo. As posições dos nós são relidas do mesmo jeito (`mindmap.refreshFromDisk`, que espera as gravações pendentes) e o mapa desliza para elas (`GraphCanvas` → `setPositions`).
- **Tema**: é do workspace, mas o aparelho guarda uma cópia para abrir já com a cor certa, antes de ler a pasta (no desktop, no `config.json`, que também aplica o `nativeTheme` aos menus do Windows).
- **Cada workspace com as suas** (1.6.3): todas as configurações dos módulos, o tema e o menu ficam no `settings.json` do workspace; trocar de workspace recarrega a interface, que lê as do outro, e voltar restaura as dele. Um **workspace novo** (sem nenhum arquivo da 1.4.3) começa com as configurações **padrão** — tema "system", nenhuma seção — em vez de herdar o tema do workspace aberto antes no aparelho, como até a 1.6.2. Ficam fora do workspace só o que é do aparelho por natureza: **Iniciar com o computador** (é do sistema operacional), o **zoom** da janela (`Ctrl` + `+`/`-`, `config.json`), o "Agora não" das atualizações e o estado da tela.
- **Passagem da 1.4.3** (`lib/storage/settings-migration.ts`): ao abrir um workspace sem `settings.json`, as configurações saem de `notes.json` (`settings`), `mindmap.json` (`settings` + `settingsVersion`), `links.json` (`sort`) e `app.json` (`modules`), e o tema vem do aparelho (só para um workspace que veio da 1.4.3); o estado da tela (abas, último módulo, mapa aberto) vai para o aparelho — só se ele ainda não tiver um. Depois de gravado o `settings.json`, os arquivos antigos vão para `.4notes/backups/1.5.0/` e o `mindmap.json` fica só com as posições. Um `settings.json` com erro ganha uma cópia em `.4notes/backups/` e as configurações voltam ao padrão, com aviso.

### 4) Tamanhos de tela (o Galaxy Z Fold e os outros)

`composables/useLayoutSize.ts` classifica a janela em três tamanhos — a ideia das "classes de tamanho" do Android — e marca o `<html>` com `data-layout`, `data-touch` (tela de toque, sem mouse), `data-keyboard` (teclado aberto) e `data-platform`. O CSS de cada componente reage a essas marcas (`html[data-layout='compact'] .x` no `<style scoped>`); `assets/css/mobile.css` tem só o que vale para o app inteiro (margens seguras, barra de baixo, toque).

| Tamanho | Quando | Exemplos | Como fica |
| --- | --- | --- | --- |
| `compact` | largura ≤ 599 px | celular em pé, tela externa do Fold (344–412 px) | uma coisa por vez: módulos na barra de baixo (`MobileNav.vue`, com **Mais**), Notas alternando entre lista e nota, listas das Tarefas e dos Links em gavetas (`MobileDrawer.vue`), menus e opções em folhas que sobem de baixo (`UiSheet.vue`, `ContextMenuHost` em modo folha), painéis em tela cheia |
| `medium` | com toque e largura ≤ 839 px, ou altura ≤ 479 px | tela interna do Fold, em pé e deitado (690–832 px); celular deitado | menu lateral, lista e conteúdo lado a lado, com listas e painéis mais estreitos; sem a barra de status das Notas quando a altura é pequena |
| `expanded` | o resto | tablet grande, computador | o layout do desktop |

- Com o **teclado aberto**, o WebView encolhe (o plugin `SystemBars` tira a altura do teclado): para o layout não "pular" no meio da digitação, a classificação usa a altura de antes do teclado, e `data-keyboard` esconde a barra de baixo.
- Girar ou abrir/fechar o Fold **não recria a tela**: o `AndroidManifest.xml` declara `configChanges` (tamanho, orientação, densidade…), então o Android só informa o novo tamanho e a interface se reorganiza — o que você estava digitando continua lá. A gaveta aberta fecha sozinha quando a tela deixa de ser `compact`.
- **Margens seguras**: o app vai de ponta a ponta (atrás da barra de status e da barra de gestos). O `SystemBars` informa as medidas em `--safe-area-inset-*`, que viram `--safe-top/right/bottom/left` no padding das barras, gavetas e folhas.

### 5) Toque

- **Toque prolongado = clique direito** (`lib/touch/long-press.ts`): segurar ~0,5 s sem mexer o dedo (até 10 px) dispara um `contextmenu` no que está embaixo do dedo — e o app inteiro, que já tratava o clique direito, abre o mesmo menu. Não vale em textos editáveis (lá o toque prolongado é do Android: selecionar, colar); o toque que termina o gesto não vira clique; uma vibração curta confirma.
- **Voltar do Android** (`composables/useBackButton.ts`): primeiro manda um `Esc` — tudo que fecha com Esc no desktop (menus, diálogos, painéis, gavetas, tutorial) fecha com o voltar; se nada tratou, as telas registradas com `onBackButton()` voltam um passo (da nota para a lista de notas; tirar a seleção do mapa); no fim, o app vai para o fundo (`App.minimizeApp`), sem fechar nada.
- **Sem depender do mouse por cima**: o que só aparecia com o mouse (× das abas, ações das tarefas e das linhas) fica visível no toque, vai para o toque prolongado ou vira botão. Os alvos de toque têm cerca de 40 px ou mais.
- **Reorganizar arrastando** (`useSortableList.ts`): no toque, só pela alça (`touchHandle`, o ⠿ das Configurações), para não brigar com a rolagem. O arrastar-e-soltar do HTML5 (abas, notas, links) não começa por toque: os menus têm **Mover para…** e **Mover para cima/baixo** (categorias das Notas, das Tarefas e dos Links; módulos).
- **Editor**: no toque, a barra de formatação fica fixa acima do teclado enquanto a nota tem o foco (`FormatToolbar` `docked`), com **Inserir imagem** e, com o cursor num link, **Abrir o link**.
- **Tutoriais**: no toque, cada tutorial ganha a seção **No toque** (campo `touch` em `lib/modules.ts`), e os atalhos aparecem como "com teclado físico".

### 6) Mapa Mental no toque — `graph-view.ts`

O mapa é um `<canvas>` com eventos de ponteiro (mouse, toque e caneta chegam pelo mesmo caminho):

- **Um dedo** arrasta a nota ou o mapa; só vira arraste depois de 9 px (o dedo treme mais que o mouse).
- **Dois dedos (pinça)**: zoom e movimento juntos — o ponto do mapa que estava entre os dedos continua entre eles (`startPinch` / `updatePinch`).
- **Conectar sem Shift**: a nota selecionada ganha uma **alça com seta** ao lado (`handleCenter`, `drawConnectHandle`); arrastar a alça faz o mesmo que Shift + arrastar — soltar numa nota conecta, no vazio pede o nome e cria uma nota conectada.
- **Toque duplo no vazio** cria uma nota (o duplo clique do desktop); **segurar** abre o menu da nota ou do fundo.
- No `compact`, o primeiro toque numa nota **seleciona** (barra com **Abrir** e **⋯**) e o segundo abre; a nota aberta ocupa a tela inteira e o voltar retorna ao mapa.
- O `pointerdown` do toque chama `preventDefault()`: assim o navegador não gera, depois do toque, os eventos de mouse "de compatibilidade", que fechariam o diálogo recém-aberto pelo toque duplo.

### 7) O projeto Android — `android/`

Gerado pelo Capacitor (`npx cap add android`) e ajustado para o 4notes:

- `AndroidManifest.xml`: permissões (`INTERNET` para os links, `VIBRATE`, `MANAGE_EXTERNAL_STORAGE` e as antigas de armazenamento para o Android ≤ 10, com `requestLegacyExternalStorage`), `configChanges` e `resizeableActivity` (dobráveis e tela dividida).
- `FourNotesPlugin.java` (registrado no `MainActivity.java`): a permissão de arquivos, a impressão (PDF) e abrir links no navegador.
- Ícone adaptativo (com a versão monocromática dos ícones temáticos), tela de abertura e cores dos temas claro e escuro (`res/values*/`).
- `app/build.gradle`: a versão vem do `package.json` (`1.5.0` → `versionCode` 10500); o APK de release é assinado com `android/keystore.properties`, se existir, ou com a chave de testes do Android Studio.
- `capacitor.config.ts`: `appId` `com.kauan.fournotes`, `webDir` `.output/public` (a mesma saída do `nuxt generate` que o Electron usa) e o `SystemBars` de ponta a ponta.
- Ficam fora do Git, porque o `cap sync` os gera: `app/src/main/assets/public` (a interface), `capacitor.config.json`, `capacitor.plugins.json` e `capacitor-cordova-android-plugins/`.

**Build** (`scripts/android.mjs`, item 14): `nuxt generate` → `npx cap sync android` → `gradlew assembleRelease` → `release/android/4notes-<versão>.apk`.

**Por que Capacitor?** Ele usa exatamente a interface que já existe (o `nuxt generate` gera arquivos estáticos, que é tudo de que ele precisa), o código continua em TypeScript (o Java se resume a um plugin pequeno) e arquivos, HTTP, barras do sistema e o "voltar" vêm prontos. Alternativas: um PWA (site instalável) não grava numa pasta qualquer do celular nem tem as permissões e o "voltar" de um app; o Tauri Mobile exigiria Rust e o NDK do Android; React Native ou Flutter obrigariam a reescrever a interface inteira.

**iOS**: o mesmo código serviria (`@capacitor/ios`), mas o build exige um Mac com o Xcode, e o iOS não deixa um app usar uma pasta qualquer como workspace (só a pasta do próprio app ou pastas escolhidas pelo app Arquivos) — a camada `lib/mobile` precisaria de um modo para isso. `npm run build:ios` explica os passos.

### 8) Sincronização

O 4notes **não sincroniza**: ele lê e grava a pasta, e quem a mantém igual nos aparelhos é um serviço de sincronização — no Windows, o Google Drive para computador (modo "Espelhar arquivos"); no Android, um app como o Autosync ou o FolderSync (o app do Google Drive para Android não sincroniza pastas). Assim o app continua 100% local, sem conta nem servidor, e funciona com qualquer serviço. O que o 4notes faz para conviver bem com isso:

- arquivos pequenos e separados (uma nota por arquivo) gravados de forma atômica — o sincronizador nunca pega um arquivo pela metade;
- o estado de cada tela fica fora da pasta (item 3): nada de dois aparelhos disputando o mesmo arquivo de abas;
- releitura ao voltar e a cada minuto, sem passar por cima do que você está editando (uma nota com mudanças ainda não gravadas não é recarregada);
- o mesmo arquivo mudado nos dois aparelhos antes de sincronizar é um conflito que o sincronizador resolve — por isso a recomendação é usar um aparelho de cada vez.


---

## 18. Timer (1.6.0)

Arquivos: `app/lib/timer/` — `model.ts` (dados, `timer.json`, categorias, atividades), `engine.ts` (o relógio), `stats.ts` (períodos, estatísticas, comparação), `format.ts` (tempos escritos), `settings.ts` (seção `timer` do `settings.json`), `repository.ts` (disco) —, `app/stores/timer.ts` (estado, relógio, avisos), `app/pages/timer.vue` e `app/components/timer/`.

### 1) Dados — `timer/timer.json`

```json
{
  "app": "4notes",
  "version": 1,
  "categories": [{ "id": "estudo", "name": "Estudo", "color": "purple", "createdAt": "…" }],
  "sessions": [
    {
      "id": "s_k3j9x0a2qm",
      "mode": "pomodoro",
      "activity": "Estudando Godot",
      "categoryId": "estudo",
      "start": "2026-10-09T13:00:00.000Z",
      "end": "2026-10-09T15:10:00.000Z",
      "duration": 6000,
      "measured": 6000,
      "status": "completed",
      "target": 1500,
      "cycles": 4,
      "breaks": 1200,
      "notes": "",
      "spans": [["2026-10-09T13:00:00.000Z", "2026-10-09T13:25:00.000Z"], "…"]
    }
  ],
  "active": null
}
```

- `duration` é o **tempo válido** (segundos) — o que conta nas estatísticas; `measured`, o tempo medido (sem pausas e sem as pausas do Pomodoro). Uma sessão cancelada tem `duration` 0 (a não ser os ciclos de foco completos do Pomodoro, ou um tempo que você der editando o registro). `duration` nunca passa de `end − start`.
- `spans` são os **trechos de tempo efetivo**: é com eles que as estatísticas dividem o tempo pelos dias e horas em que ele aconteceu (uma sessão que passa da meia-noite conta um pouco em cada dia).
- `status`: `completed`, `interrupted` (temporizador parado antes do fim; Pomodoro finalizado no meio de um foco — o tempo feito conta) ou `canceled`.
- `active` é a **sessão em andamento** (modo, atividade, categoria, `startedAt`, trechos já fechados, `runningSince` e, no Pomodoro, a etapa, os ciclos e a configuração com que começou). Ela fica no arquivo para continuar depois de fechar e abrir o app — ou no outro aparelho, com a pasta sincronizada.
- **Sem duplicar**: finalizar passa a sessão para o histórico **com o mesmo id**; um id repetido no arquivo (cópia manual, conflito de sincronização) fica uma vez só, e uma sessão "em andamento" que já está no histórico não volta.
- **Categorias** são só do Timer (as das Tarefas continuam no `tasks.json`). Excluir uma categoria **não apaga o histórico**: as sessões dela (e a em andamento) ficam sem categoria (`withoutCategory`). O diálogo é o mesmo das Tarefas (`CategoryDialog.vue` com `source`, `lib/category-source.ts`).
- Gravação: na hora (iniciar, pausar, retomar, trocar de etapa, finalizar, excluir) ou 0,3 s depois de editar um texto — **nunca a cada segundo**. Escrita atômica, uma cópia por dia da semana em `.4notes/backups/timer-<dia>.json`, e um arquivo com JSON inválido não é sobrescrito (a tela mostra o erro, como nas Tarefas). O arquivo só é criado quando há algo para guardar.

### 2) O relógio — `engine.ts`

Nada depende de um contador somado a cada segundo. A sessão guarda **quando** cada trecho começou e terminou, e o tempo é sempre calculado a partir de `Date.now()`:

```
tempo efetivo = soma dos trechos fechados + (agora − runningSince, se estiver contando)
```

- O **tique** da tela (`stores/timer.ts`, 4 por segundo) só atualiza o que aparece — e só com a janela visível. Um **alarme** (`setTimeout` único, não repetido — o Chromium não o atrasa com a janela minimizada) marca o fim do temporizador ou da etapa do Pomodoro. Ao voltar para a janela (`visibilitychange`, `focus`), o relógio recalcula na hora.
- `advance(sessão, agora)` leva a sessão até agora: o temporizador que acabou (fechado no **horário do fim**, não na hora em que você olhou) e as etapas do Pomodoro que terminaram. Com o **início automático**, a próxima etapa começa exatamente quando a outra acabou — se isso aconteceu há pouco (até 15 s, `AUTO_START_TOLERANCE_MS`). Uma etapa que terminou há mais tempo (computador suspenso) espera você: senão, o tempo em que você não estava ali contaria como foco.
- **Ao abrir o app** (`recover`): a sessão em andamento continua (o cronômetro contou o tempo com o app fechado, como um cronômetro de verdade); um temporizador que acabou com o app fechado é registrado no horário certo, com o aviso "terminou às 14:32, com o 4notes fechado"; uma etapa do Pomodoro que terminou com o app fechado **nunca** puxa a próxima sozinha.
- **Pomodoro**: uma sessão só, com a atividade principal. Etapas `focus` → `short` → … → `long` a cada `rounds` focos; só o foco vira trecho efetivo (as pausas somam em `breaks`). "Pular pausa" começa o próximo foco na hora. A configuração (foco, pausa curta, pausa longa, focos até a longa, início automático) é copiada para a sessão quando ela começa: mudar os ciclos não mexe na sessão em andamento.
- **Finalizar** e **Cancelar** (`finish`) devolvem o registro do histórico — ou nada: um clique sem querer (menos de 1 s) e uma sessão cancelada com menos de 1 minuto e sem tempo válido não são registrados. Os dois têm **Desfazer** (a sessão volta como estava, e o registro sai).

### 3) Avisos

Quando o temporizador ou uma etapa termina: a tela do Timer mostra o aviso (até você dispensar), um **som** curto (`lib/sounds.ts`, `timer-end`/`phase-end`, sintetizado como os sons dos módulos, desligável) e, com o 4notes minimizado ou em segundo plano, um **aviso do Windows** (`Notification` da própria interface, desligável; não existe no Android). O áudio é "preparado" no clique em Iniciar (`primeAudio`), porque o navegador só deixa tocar som depois de uma interação — assim o aviso toca mesmo minimizado. No ícone do Timer (menu lateral e barra do celular), um ponto amarelo mostra que há uma sessão contando (cinza = pausada).

### 4) Estatísticas — `stats.ts`

- **Períodos** do calendário (fuso local): dia, semana (começando na segunda ou no domingo — Configurações), mês, ano ou um intervalo; ‹ › (ou `←`/`→`) vão para o anterior e o próximo do mesmo tamanho.
- `aggregate` junta o tempo **válido** de um trecho de tempo: espalha o `duration` de cada sessão pelos `spans` dela (proporcionalmente — uma sessão editada para menos conta menos em cada trecho) e divide cada pedaço pelas horas do relógio: por dia, por hora do dia, por dia da semana, dias × horas (o mapa de calor), por categoria (uma categoria excluída conta como "sem categoria") e por atividade (a mesma atividade escrita de jeitos diferentes — maiúsculas, espaços — é uma só).
- `evolution` monta as colunas: horas (dia), dias (semana, mês, intervalo de até 62 dias) ou meses (ano, intervalos maiores), marcando o que ainda não chegou.
- **Comparação** (`comparisonRanges` + `compare`): com o período **em andamento**, compara só o mesmo trecho dos dois — de segunda até agora × de segunda até a mesma hora da semana passada (um mês mais curto fica inteiro, sem invadir o mês seguinte); períodos que já acabaram comparam inteiros. Variação percentual só quando o anterior tem tempo (`variation` → null; a tela mostra "novo" ou "antes: nada registrado", nunca "+∞%"); dois períodos vazios mostram uma mensagem, sem gráfico.
- Só **dados reais**: sem nenhuma sessão, a tela explica e oferece começar uma; um período vazio mostra "Nenhum tempo registrado…" no lugar do gráfico. A sessão em andamento entra quando for finalizada (o resumo de **Hoje**, na aba Sessão, já soma ela).

### 5) A tela — `pages/timer.vue` e `components/timer/`

- **Menções** (1.6.1): os registros do histórico podem ser mencionados nas notas e nas tarefas (item 10). Abrir uma menção chama `timer.revealSession(id)`: a aba vira **Histórico**, os filtros que esconderiam o registro saem, o período vai para o dele e a linha é destacada. "Ver menções" fica no menu do registro e no diálogo de edição.

- Três áreas em abas: **Sessão** (`TimerSession.vue`: modo, mostrador `TimerDial.vue`, controles, atividade e categoria opcionais — `TimerCategoryPicker.vue` —, durações do temporizador, ciclos do Pomodoro em `PomodoroDialog.vue`, atividades recentes e o resumo de hoje), **Histórico** (`TimerHistory.vue` + `TimerSessionDialog.vue`) e **Estatísticas** (`TimerStats.vue`). A aba escolhida e o modo ficam no aparelho (`device-state`, "timer"); a duração do temporizador e os ciclos do Pomodoro, no `settings.json` (seção `timer`).
- **Período**: `PeriodNav.vue`, o mesmo no Histórico (com "Tudo") e nas Estatísticas.
- **Gráficos** próprios, em SVG/HTML (sem biblioteca): colunas (`TimerColumns.vue`, até 24 px, canto arredondado só em cima, grade fina, o maior valor escrito, balão por posição — mouse, toque ou teclado — e, comparando, o anterior em cinza ao lado, com legenda), rosca por categoria com a lista de nomes, tempos e porcentagens (`TimerDonut.vue`, no máximo 6 fatias, separadas por 2 px), barras horizontais com o valor escrito (`TimerBarList.vue`), mapa dias × horas numa cor só, do claro ao forte (`TimerHeatmap.vue`), comparação lado a lado (`TimerCompare.vue`) e, para cada gráfico de colunas, a **Tabela**. As cores das categorias são as que você escolhe; o nome aparece sempre junto (a cor nunca é o único jeito de saber qual é qual).
- **Resumo / Detalhado**: o Detalhado acrescenta quando você registra tempo (dias × horas, partes do dia, dias da semana) e a tabela por categoria (tempo, %, sessões, média).
- **Atalhos**: `Espaço` (iniciar, pausar, retomar — fora de campos e botões), `Ctrl+Enter` (finalizar), `Ctrl+N` (vai para a atividade), `←`/`→` (período). Celular: abas no topo, toque prolongado nos registros e nas categorias.
- **Android**: com o app em segundo plano, o Android pode pausar a interface; a contagem continua certa (vem do relógio) e o aviso de fim aparece quando você volta. Um aviso do sistema no celular precisaria de um plugin de notificações (não incluído).

---

## 19. Atualizações automáticas (1.6.2)

Arquivos: `shared/updates.ts` (regras e tipos: versões, Release → versão disponível, APK do Release), `electron/updates.ts` (Windows, `electron-updater`), `app/lib/mobile/updates.ts` + `android/…/UpdaterPlugin.java` (Android), `app/stores/updates.ts` (pergunta, "Agora não", instalar), `components/shell/UpdateSettings.vue` (Configurações › Geral › Atualizações) e `scripts/release.mjs` + `scripts/release-lib.mjs` (`npm run release`).

- **De onde vêm as versões**: um repositório **público** do GitHub (só com os instaladores), configurado num lugar só — `package.json` → `"updates": { "github": "usuario/repositorio" }`. O Electron lê do `package.json` empacotado; a interface do Android recebe pelo `runtimeConfig.public.updatesRepository` (nuxt.config.ts). Vazio = a procura fica desligada (as Configurações dizem o que falta).
- **Publicar** (`npm run release`): confere o repositório (existe, é público, tem commit), o token (`GH_TOKEN` no `.env`) e a chave do Android; roda `dist:win` e `build:android`; gera o `latest.yml` (versão, nome, tamanho e SHA-512 do instalador — o formato do `electron-updater`); cria o Release `v<versão>` como **rascunho**, envia os arquivos e só então publica. Não republica uma versão; dá para acrescentar a plataforma que faltou.
- **Procurar**: na abertura (2,5 s depois de o workspace carregar, em segundo plano) e no botão das Configurações. Windows: `autoUpdater.checkForUpdates()` (feed `github` montado a partir do `package.json`, com o `app-update.yml` escrito na pasta de configuração do app). Android: `api.github.com/repos/…/releases/latest` (CapacitorHttp) — vale se a tag for mais nova e o Release tiver o APK. Rascunhos e pré-lançamentos ficam de fora. Sem internet: nada aparece; as Configurações mostram o motivo.
- **Perguntar**: `confirmDialog` com a versão e as notas (sem Markdown). "Agora não" guarda a versão no aparelho (`localStorage`, não no workspace) e não pergunta de novo para ela; ela continua nas Configurações e um ponto discreto aparece na engrenagem (no celular, em "Mais"). Uma versão ainda mais nova pergunta de novo.
- **Instalar**: primeiro salva tudo (`flushEverything`). Windows: baixa com o andamento e chama `quitAndInstall(silencioso, abrir depois)` — o fechamento normal da janela salva de novo, o NSIS atualiza na mesma pasta (os atalhos seguem `build/installer.nsh`) e o 4notes abre. Android: o `UpdaterPlugin` baixa o APK para `cache/updates/` (redirecionamentos do GitHub seguidos, arquivo `.part` até completar) e abre o instalador do sistema pelo `FileProvider`; sem a permissão "instalar apps desconhecidos" (`REQUEST_INSTALL_PACKAGES`, Android 8+), abre a tela de permissão e, ao voltar para o app, tenta de novo sem baixar outra vez. O Android só aceita o APK assinado pela mesma chave (`android/keystore.properties`).
- **Desenvolvimento e testes**: com `npm run dev` a procura fica desligada (`electron-updater` só roda no app instalado). `FOURNOTES_FAKE_UPDATE=<versão>` (com `FOURNOTES_TEST=1`) finge uma versão no Electron; no navegador de testes do Android, o GitHub é simulado e o plugin é o `fakeUpdater`.

---

## Decisões de arquitetura (resumo)

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Camada desktop | Electron + electron-builder | Tudo em TypeScript; compila no Windows só com Node.js. |
| Nuxt | SPA (`ssr: false`) servida por `app://` | Não há servidor; rotas e caminhos funcionam como num site. |
| Comunicação | IPC com contrato tipado (`shared/ipc.ts`) | Interface isolada do Node.js; erros de contrato pegos pelo TypeScript. |
| Notas | `.md`, nome do arquivo = título da primeira linha | Arquivos que fazem sentido ao abrir a pasta; sem formato proprietário. |
| Categorias das Notas | Uma pasta por categoria em `notes/` + `categorias.json` (ordem, cor, ícone pronto ou imagem `<Categoria>.<ext>` na pasta) | A categoria aparece igual no Explorador e no Obsidian; mover entre categorias move o arquivo e refaz os links relativos. |
| Pastas pelo título | Calculadas na hora, só na lista (1ª e 2ª palavra, com 2+ notas) | Organiza sem mexer nos arquivos nem guardar nada a mais. |
| Notas permanentes | Uma pasta por mapa: `.md` (só texto) + `mapa.json` (conexões e cores) | Texto limpo; conexões explícitas, fáceis de criar arrastando e de remover. |
| Formatação | Markdown + HTML simples (`<u>`, `<span style="color">`), marcações **sempre** escondidas no editor, protegidas e mantidas válidas por ele | Continua texto puro e compatível com o Obsidian, com a experiência de um editor visual (formatos guardados como no Word, nada de `**` à vista). |
| Links | `links/links.json` + ícones gravados em `links/icons/`; título/ícone buscados pelo processo principal | Abre sem internet e vai junto no backup; a interface continua sem acesso à rede (a CSP só permite imagens do próprio workspace). |
| Importar favoritos | Ler o `Bookmarks` dos navegadores Chromium e o `places.sqlite` do Firefox/Zen (de uma cópia, com `node:sqlite`; plano B: a cópia `.jsonlz4`) direto da pasta deles + arquivo HTML para os outros | Brave, Opera GX, Firefox e Zen (e Chrome, Edge…) importam com um clique, sem exportar nada; o HTML cobre qualquer navegador. Só leitura: o navegador nunca é alterado. |
| Workspaces | Workspace = pasta de dados; nome = nome da pasta | Nada de cadastro paralelo de nomes; qualquer pasta abre; backup continua sendo copiar a pasta. |
| Imagens | `attachments/` + caminho relativo + protocolo `workspace://` só para imagens | Imagens junto dos dados, notas compatíveis com outros editores, interface sem acesso livre ao disco. |
| Blocos de código | Detecção própria por padrões + `@codemirror/language-data` | Sem serviço externo; cores para dezenas de linguagens, cada uma carregada só quando usada. |
| Edição dos blocos | Um CodeMirror dentro do cartão (`block-editor.ts`), espelhando as mudanças no editor da nota | O bloco mantém o tamanho ao editar e ganha seleção, duplo clique e `Ctrl+D` de editor de código; o arquivo e o desfazer continuam sendo um só (o da nota). |
| Blocos de texto | ` ```text ` (Markdown comum), criado só pelo botão da barra; conteúdo = o texto da tela (regras do Exportar TXT); mesmo cartão dos blocos de código | Continua legível em qualquer editor; nada vira bloco de texto sem você pedir; nenhuma marcação aparece dentro do bloco. |
| `Ctrl+D` | Seleções múltiplas do CodeMirror, criadas só pelo `Ctrl+D`; busca no texto do arquivo pulando o que fica escondido | Funciona como nos editores de código sem mudar o resto do editor (Ctrl+clique continua abrindo links). |
| Tarefas | Um `tasks.json` | Dados estruturados; gravação atômica de tudo de uma vez; fácil de fazer backup. |
| Menções | Tarefas: referência estruturada no `tasks.json`. Notas (das Notas e do Mapa): link Markdown relativo para o `.md` ou para `tasks.json#<id>`. Renomear no app avisa a ponte, que corrige tudo (inclusive os arquivos dos mapas fechados) | Abre a nota/tarefa certa depois de reabrir o app; o texto das notas continua Markdown comum; a ligação entre módulos fica explícita e num lugar só. |
| Animação de clique nos ícones | Um plugin global (`icon-tap.client.ts`) que anima o `<svg>` do controle clicado | O mesmo movimento em todo lugar, sem tocar em cada componente; componentes novos ganham a animação sozinhos. |
| Menus | Componente próprio (`ContextMenuHost.vue`); o Electron só manda os dados do menu de texto | Visual do 4notes no claro e no escuro, com submenus e teclado; foco continua no editor. |
| Imagens removidas | Saem só da nota (ou da categoria); o arquivo fica na biblioteca até ser excluído por lá, sem uso | Uma imagem enviada pode ser usada de novo em qualquer lugar; nada some sem você pedir. |
| Biblioteca de imagens | `attachments/` + o uso calculado na hora (notas, `categorias.json`, `links.json`), sem cadastro paralelo | Continua uma pasta comum de imagens; nada a manter sincronizado. As fotos das categorias das Notas continuam dentro da pasta da categoria (cópia), como antes. |
| Exportar | TXT e PDF montados pela interface com as regras do editor; o PDF impresso por uma janela escondida (`printToPDF`) | Sai o que você vê, sem dependência nova; imagens embutidas e nada buscado na internet. |
| Configurações | Abas Geral / Módulos; as dos módulos no workspace (`.4notes/`), "iniciar com o computador" na máquina | Cada workspace com os seus ajustes; o que se usa toda hora continua na tela do módulo. |
| Módulos | Lista única em `lib/modules.ts` (com o tutorial de cada um); ativos/menu em `.4notes/app.json` guardando só os desativados | Ativar/desativar nunca toca nos dados; um módulo novo aparece no menu, nos atalhos, nas Configurações e nos tutoriais sem mais nada. |
| Tutoriais | Painel ao lado do menu (`?`/F1), não modal, com os atalhos de cada módulo | Ajuda rápida sem sair do módulo; os atalhos ficam junto do módulo, num lugar só. |
| Recorrência | Data da próxima ocorrência + regra, calculado ao abrir | Funciona com o app fechado, sem processo em segundo plano. |
| Descrição das tarefas (1.6.0) | O mesmo `MarkdownEditor` das notas, salvando Markdown no `"notes"` do `tasks.json`; o `@` põe a nota na lista estruturada da tarefa | Um editor só para manter; a formatação é idêntica à das notas; nada muda no formato do arquivo nem nas menções das tarefas. |
| Timer: contagem (1.6.0) | Horários de início/fim de cada trecho + `Date.now()`; um alarme `setTimeout` para o fim; `advance` ao voltar | Certo com o app minimizado, em outro módulo, suspenso ou fechado — nunca depende de um contador da tela. |
| Timer: dados (1.6.0) | `timer/timer.json` com categorias, histórico (com os trechos) e a sessão em andamento | Um arquivo legível; a sessão em andamento sobrevive a fechar o app e vai junto na sincronização; o id único evita registros duplicados. |
| Timer: gráficos (1.6.0) | SVG/HTML próprios + tabela | Sem dependência nova; tema claro/escuro pelas variáveis CSS; leves no celular. |
| Menções entre todos os módulos (1.6.1) | Um provedor por tipo de item na ponte (`stores/mentions.ts`); itens com id (tarefas, registros, links) pelo id, notas e mapas pelo caminho corrigido nas renomeações; nas notas continua um link Markdown comum | Um lugar só para o `@`, os chips e o "Ver menções"; um módulo novo entra sem integração separada; os arquivos continuam legíveis fora do app. Notas não ganharam um id próprio: isso mudaria o formato dos arquivos, e as renomeações feitas no app já são acompanhadas. |
| Seleção de várias notas no mapa (1.6.1) | Ctrl + arrastar (área) e Ctrl + clique; no toque, "Selecionar área" no menu do vazio | Não briga com arrastar nota, Shift + arrastar (conectar) e arrastar o fundo (mover o mapa). |
| Atualizações (1.6.2) | GitHub Releases num repositório público; `electron-updater` no Windows; API do GitHub + plugin próprio (baixar e abrir o instalador) no Android; `npm run release` publica | Sem servidor próprio; um comando publica as duas plataformas; o app nunca baixa nada sem você pedir; a versão só aparece completa (rascunho até o fim do envio). |
| Estado da interface | `.4notes/` | Separado dos dados; pode ser apagado. |
| Editor | CodeMirror 6 | Editor de Markdown "de verdade" (o mesmo motor do Obsidian), com busca, desfazer e prévia ao vivo da formatação, listas, código e imagens. |
| Grafo | Canvas próprio + layout radial próprio | Posições estáveis (o mapa não "flutua") e um "Reorganizar" que evita cruzamentos; sem biblioteca de física. |
| Estado/estilo | `reactive()` do Vue + CSS com variáveis | Sem Pinia/Tailwind: menos dependências; tema claro/escuro por variáveis CSS. |
| Ícones | SVG próprios | Sem biblioteca de ícones. |
| Celular (1.5.0) | Capacitor (app Android com WebView) + `app/lib/mobile/` oferecendo a mesma `FourNotesApi` do Electron | Uma interface só para Windows e Android, toda em TypeScript (o Java é um plugin pequeno); uma mudança no código vale para os dois. |
| Pasta do workspace no Android | "Acesso a todos os arquivos" + caminhos de verdade no armazenamento interno | O workspace fica numa pasta escolhida por você, visível para os apps de sincronização, com escrita atômica e rápida (o seletor do Android — SAF — não tem caminhos nem renomear atômico). |
| Sincronização | Fora do app: Google Drive para computador + Autosync/FolderSync no Android | Continua 100% local, sem conta nem servidor; qualquer serviço que sincronize pastas serve. |
| Configurações × estado da tela | `.4notes/settings.json` no workspace × `localStorage` de cada aparelho | O que é da pessoa vai junto com a pasta; o que é da tela fica em cada aparelho (sem abas "pulando" entre aparelhos nem conflitos de sincronização). |
| Workspace novo (1.6.3) | Começa com as configurações padrão (nada vem do workspace aberto antes) | Cada workspace com as suas configurações, sem um interferir no outro. |
| Largura das telas (1.6.3) | `.module-content` (largura toda + margens comuns) e um teste que confere as páginas | Sem vazio à direita em janelas largas; uma tela nova já nasce certa. |
| Ordem da lista das notas (1.6.3) | Pela data da última alteração (a pasta vale pela nota mais nova), pastas e notas misturadas | As mais recentes ficam no topo, como pedido; a data já aparece em cada linha. |
| Blocos de código pela barra (1.6.3) | O mesmo caminho do bloco de texto (`blockChange`), com a linguagem pelo conteúdo; tipo e linguagem trocados pelo nome do bloco | Criar código é tão fácil quanto criar texto; um menu só para texto ↔ código e a linguagem, guardados no Markdown. |
| Tamanhos de tela | Três classes (`compact` / `medium` / `expanded`) marcadas no `<html>` + CSS de cada componente | Um layout certo para cada tela do Fold (e para celulares e tablets) sem duplicar componentes. |
| Toque | Toque prolongado gera o `contextmenu`; o "voltar" do Android manda `Esc` | O app inteiro já tratava o clique direito e o Esc: menus, diálogos e painéis funcionam no toque sem reescrever cada um. |

Dependências usadas no app: `nuxt`/`vue`, `@codemirror/*` (editor — na 1.1.0 entrou `@codemirror/language-data`, para colorir o código dos blocos), `electron`, `electron-builder` e `esbuild` (build). Para testes: `vitest`. (O `d3-force` da 1.0.0 saiu: o mapa não usa mais física.) A 1.3.1 não trouxe dependências: o SQLite que lê os favoritos do Firefox/Zen é o do próprio Node.js do Electron (`node:sqlite`), o LZ4 das cópias `.jsonlz4` é um descompactador de ~40 linhas e o PDF é impresso pelo próprio Chromium do Electron. A 1.6.0 não trouxe dependências (Timer e gráficos feitos com o que o projeto já tinha). A 1.6.2 trouxe o `electron-updater` (atualizações do Windows; empacotado no `main.cjs` pelo esbuild, como o resto). A 1.5.0 trouxe só o Capacitor: `@capacitor/core`, `@capacitor/cli` e `@capacitor/android` (o app Android), `@capacitor/app` (voltar, voltar para o app, versão) e `@capacitor/filesystem` (arquivos) — o resto (HTTP nativo, barras do sistema) já vem no `@capacitor/core`. O desktop não carrega nada disso.

## Testes

- `npm test` — testes unitários das regras puras (datas, recorrência, tarefas, títulos, nomes de arquivo, formatação, marcação de listas/tarefas, níveis e numeração automática das listas, blocos de código e detecção de linguagem, caminhos das imagens, menções em tarefas e notas (inclusive a tarefas), links refeitos ao mover uma nota de pasta, categorias e `categorias.json`, pastas pelo título, primeira linha como título, nomes de workspace, `mapa.json`, conversão da 1.0.0, grafo, layout sem cruzamentos e compactação, marcação escondida (proteção, formatos guardados, marcações válidas, links), endereços e links repetidos, título e ícone de páginas, favoritos do Chromium/Opera e HTML, `links.json` e plano da importação; na 1.3.1: categoria automática pelo título, exportar TXT e PDF, biblioteca de imagens (uso, cópias iguais, adotar, excluir), favoritos do Firefox/Zen — `profiles.ini`, `places.sqlite`, `.jsonlz4` com LZ4 —, foto das categorias dos Links e ordem pela URL; na 1.3.2: bloco de texto — linhas próprias, formatos cortados, listas, cerca maior, dentro de blocos — e `Ctrl+D` — maiúsculas, palavra inteira, volta ao começo, partes escondidas, só o `Ctrl+D` cria seleções — em `tests/text-blocks-and-multiselect.test.ts`; na 1.4.0: lista dos módulos e tutoriais completos, preferências dos módulos — leitura tolerante, só desativados, nunca todos desligados — em `tests/modules.test.ts`; na 1.4.1: ordem dos módulos — guardada, completa, tolerante, desativados no lugar ao reorganizar, mover para cima/baixo — e o "Botão direito" de cada tutorial em `tests/modules.test.ts`, e versões das notas — número no título, comparação, anterior com pulos, mesma categoria no store — em `tests/note-versions.test.ts`; na 1.4.3: a próxima versão (regra e store) e o `Ctrl+D` — o código dos blocos fora da seleção da nota, e a variante de texto puro dos blocos e da tela cheia; na 1.5.0: `tests/settings-sync.test.ts` — passagem da 1.4.3 para o `settings.json`, estado da tela por aparelho e por workspace, seção gravada mantendo chaves de outras versões, releitura do que mudou em outro aparelho, arquivo com erro —, `tests/mobile-platform.test.ts` — a API do Android sobre um disco na memória com as regras do Android: maiúsculas, nada escapando do workspace, renomear, lixeira do workspace, imagens, criar/abrir/copiar workspace, permissão, biblioteca de imagens —, `tests/layout-size.test.ts` — os tamanhos do Fold, de celulares e de tablets — e as dicas de toque dos tutoriais; na 1.6.0: `tests/timer.test.ts` — cronômetro com pausas, temporizador que termina com o app fechado no horário certo, Pomodoro (etapas, pausa longa, início automático, etapa que terminou com o app fechado esperando você, pular pausa, interrompida, cancelada com os ciclos completos), `timer.json` (ida e volta, arquivo editado à mão, sem duplicar, categoria excluída sem perder o histórico), atividades recentes, configurações, períodos (semana na segunda ou no domingo, anterior/próximo, nomes), estatísticas (sessão que passa da meia-noite, pausas fora, tempo editado, filtro de categoria, evolução, comparação com o mesmo trecho, mês mais curto, variação sem "+∞%"), textos e durações digitadas — em três fusos —, a descrição das tarefas (Markdown guardado, prévia sem marcação) e as imagens das descrições na biblioteca; na 1.6.1: `tests/mentions-all-modules.test.ts` — caminhos de menção de todos os tipos, links das notas para registros do Timer e mapas, título novo de registro/tarefa, mapa renomeado, link salvo com endereço novo, links de um texto, menções das tarefas de todos os tipos (ida e volta, leitura tolerante, renomeações, `tasks.json`) e a ordem da lista do `@` (palavra por palavra, mais recentes primeiro)); na 1.6.2: `tests/updates.test.ts` — versões, repositório, Release → versão disponível (rascunho, pré-lançamento, sem APK), notas sem Markdown, a procura e a instalação no Android (permissão e depois o instalador, sem baixar de novo; sem internet; sem versão publicada) e o `npm run release` (`.env`, `latest.yml`, opções); na 1.6.3: as mais recentes no topo e a nota mais recente de cada pasta (`tests/categories-and-folders.test.ts`), o título na primeira linha ligando e desligando com a nota vazia, o bloco de código pela barra — linguagem pelo conteúdo, sem linguagem, as regras do bloco de texto — (`tests/text-blocks-and-multiselect.test.ts`), cada workspace com as suas configurações e o workspace novo sem herdar o tema (`tests/settings-sync.test.ts`) e a regra da largura das telas (`tests/layout-width.test.ts`)).
- `npm run typecheck` — TypeScript estrito na interface e no Electron.
- Durante o desenvolvimento, o app também foi testado de ponta a ponta dirigindo o Electron real (workspaces, notas, abas, formatação, listas, checklists e numeração automática, código e imagens colados e apagados, menus do clique direito, tarefas recorrentes com datas simuladas e app fechado, menções em tarefas e notas depois de reabrir, categorias criadas/renomeadas/excluídas com imagem e cor nas abas, notas arrastadas para categorias, pastas pelo título, menções a tarefas nas Notas e no Mapa, mapas mentais com conversão da 1.0.0, conexões e notas novas por arraste, cores, vários mapas, layout salvo, fechamento seguro; na 1.3.0: ícones nas categorias, + nas pastas pelo título, fechar notas de categoria sem pergunta, Markdown escondido com teclado, mouse e acentos compostos, links e blocos de código no editor, e o módulo Links inteiro com sites locais de teste e perfis falsos do Brave/Opera; na 1.3.1: as abas das Configurações com o "?", iniciar com o computador (simulado), configurações dos módulos gravadas no workspace, categoria automática pelo título, CAIXA ALTA nas pastas, exportar TXT/PDF (conferido com `pdftotext`), biblioteca de imagens — enviar, escolher, inserir, remover da nota, excluir, `Esc` com modais empilhados —, fotos nas categorias das Notas e dos Links, "Sem categoria", ordem pela URL, importação de perfis falsos do Zen — `places.sqlite` com `-wal` — e do Firefox — só a cópia `.jsonlz4` —, menções a links com o ícone do site, e o tema escuro; na 1.3.2: bloco de texto pela barra — cartão, copiar, editar no cartão, tela cheia, remover e desfazer, listas e negrito, bloco grande com rolagem, tema escuro —, colar texto/listas/trechos longos sem virar bloco (e código continuando a virar), `Ctrl+D` com duplo clique, digitação, `Ctrl+Z`, `Esc`, `Ctrl+clique` e `Ctrl+B`, nas Notas e no Mapa Mental, e o painel das Tarefas fechando ao clicar fora — com os casos que não podem fechar; na 1.4.0: ligar/desligar módulos pelo botão direito e pelas Configurações (quadros da animação, prévia do menu por cima do fundo, último módulo não desliga), dados intactos, `app.json`, "só o ícone", desligar o módulo aberto, `Ctrl+2` e menção para módulo desligado com "Ativar", tutoriais por F1, "?", Configurações e trocando de módulo, tema escuro e reinício do app; na 1.4.1: tela cheia do bloco de texto com a margem do editor, a corrente de versões (`1.4.1` → `1.4.0` → `1.3.2`, ignorando outra categoria) e o botão sumindo, desfoque das Configurações › Módulos começando depois da barra de título e do menu, arrastar no menu lateral e nas Configurações — com módulo desativado, só ícone, `Esc`, clique simples ainda abrindo o módulo —, "Mover para cima" no botão direito, ordem depois de reiniciar, `Ctrl+2` preso às Tarefas, os sons na hora certa e um só em liga/desliga seguidos — e renderizados para medir volume e duração —, o tutorial fechando ao clicar fora e não fechando ao clicar dentro, no **?**, no "Abrir" das Configurações ou arrastando um módulo; na 1.4.2: barra e rodapé do mapa sem o botão de configurações, sem o `Ctrl K` e sem a dica fixa — com `Ctrl+K` ainda indo para a busca —, a engrenagem, e a animação de clique em 14 tipos de ícone (módulos, tema, tutorial, configurações, abas, fechar, reorganizar, zoom, +, blocos de código, lista, opções), pelo teclado, medida quadro a quadro, e os casos que não animam — × de aba, caixa de concluir tarefa, "reduzir movimento"; na 1.4.3: o cartão do bloco sem crescer ao clicar, ao dar duplo clique e digitando, com rolagem interna; duplo clique e seleção destacada (código e texto, no cartão e na tela cheia), `Ctrl+D` e edição das ocorrências juntas, `Ctrl+Z` pelo histórico da nota (teclado e menu), outras ocorrências só contornadas, `↑`/`↓`/`Esc` entrando e saindo, `Ctrl+D` da nota sem entrar nos blocos, `Ctrl+F` da nota mostrando o achado no bloco, `Enter` em ` ```py `, a cerca crescendo, `Backspace` num bloco vazio, botões do cabeçalho, o mesmo no painel da nota do Mapa Mental, texto mudado por fora, nota com 40 blocos, tema escuro e os botões de versão anterior/próxima). O instalador do Windows foi testado no Wine (tela "Atalhos", reinstalação e desinstalação).
- Na 1.5.0, a interface do Android foi testada num Chromium com toque de verdade (vários dedos, pelo protocolo do Chrome) e o disco do Android na memória, nos tamanhos do Galaxy Z Fold — tela externa 344×882 e deitada, interna 690×829 e deitada — e de um celular comum, nos temas claro e escuro: criar o workspace pelo seletor de pastas, Notas (lista ↔ nota, barra de formatação fixa, voltar), toque prolongado e menus em folha, Tarefas e Links nas gavetas, **Mais**, tema gravado no workspace, abrir e fechar o Fold no meio do uso; no mapa, pinça, arrastar nota e mapa, alça de conexão, soltar no vazio, toque duplo, menu, abrir e voltar. No Electron real: a passagem de um workspace da 1.4.3 (configurações, backups, `mindmap.json` só com as posições), configurações mudadas "em outro aparelho" aplicadas ao voltar para a janela e o desktop igual a antes (menus, Shift+arrastar, F1 sem a parte do toque, abas e último módulo restaurados depois de reiniciar). O APK em si é compilado no computador de quem gera (`npm run build:android`).
- Na 1.6.0, no Electron real: a descrição das tarefas (texto antigo, `Ctrl+B`, listas, checklist, barra de formatação dentro do painel e quebrando em fileiras, itálico pela barra, `@` com só notas, `Esc` fechando só a lista, `Enter` escolhendo dentro de um trecho em itálico, menção indo para "Notas mencionadas", reabrir, trocar de tarefa, título, clicar fora, nova tarefa formatada, prévia na lista, tema escuro) e o Timer inteiro (cronômetro com troca de módulo, pausa e retomada, ponto no menu, finalizar/Desfazer/`Ctrl+Enter`; temporizador de 5 s pela tela e terminando com o app fechado; cronômetro contando com o app fechado; cancelar curto; Pomodoro com a etapa terminada com o app fechado, pausa, pular pausa e finalizar no meio do foco; categoria nova e excluída sem perder o histórico; histórico com busca, agrupamentos, edição do tempo válido e limite, excluir/Desfazer e `←`; estatísticas — total, colunas, rosca, comparação com o mesmo trecho, colunas lado a lado, tabela, detalhado, filtro de categoria, mês, dia, período vazio —; configurações do Timer no workspace e o tutorial pelo F1). Num Chromium com toque e o disco do Android na memória, nos tamanhos do Fold (344×882 e 690×829): o Timer em **Mais**, iniciar e finalizar pelo toque, as três áreas sem rolagem para o lado, toque prolongado num registro e a barra de formatação fixa na descrição da tarefa.
- Na 1.6.3, no Electron real: a lista das notas pela recência (sem categoria, categorias, dentro das pastas, a nota editada subindo), o relógio e o menu da pasta abrindo a mais recente, o título na primeira linha (padrão ligado, desligando nas Configurações, gravado no workspace, nota nova e + da pasta sem `# `, religando com a nota vazia aberta, depois de reiniciar), o bloco de código pela barra (JavaScript reconhecido, cores, menu do nome, Python, código → texto, texto → GDScript, `Ctrl+Z`/`Ctrl+Y`, "Outra…" com rust, TypeScript gravado e depois de reiniciar, o bloco de texto continuando igual, tema escuro), as configurações por workspace (Pessoal com tema escuro, menu só com ícones, Notas, Mapa e ordem dos links; o Trabalho criado com tudo no padrão e uma configuração própria; de volta ao Pessoal e depois de reiniciar, cada um com as suas), a largura toda em 1920×1080, 1366×768 e 1024×720 (Tarefas, Links e Timer, sem rolagem para o lado; o painel das Tarefas sem cobrir a lista; o Timer em duas colunas só quando cabe) e uma passada pelos módulos (criar e concluir tarefa, salvar link, sessão do Timer, mapa). Num Chromium com toque, nos tamanhos do celular e do Fold (344, 390, 690 e 832 px): as telas sem rolagem para o lado e o toque prolongado na pasta com "Abrir a mais recente".
- Na 1.6.2, no Electron real: rodando sem instalar, nada pergunta e as Configurações explicam; com uma versão nova simulada, a pergunta com as notas, "Agora não" (o ponto na engrenagem, a versão nas Configurações, não pergunta de novo ao reabrir), Instalar pelas Configurações e pela pergunta, e uma versão ainda mais nova perguntando de novo. Num Chromium com toque (Fold fechado) e o GitHub simulado: a pergunta ao abrir, o download do APK do Release, a permissão de instalar apps e, ao voltar, o instalador sem baixar de novo. O `npm run release` contra um GitHub simulado: publicar (rascunho → arquivos → publicado, com o `latest.yml`), recusar versão repetida, mais antiga, repositório privado e falta da chave, acrescentar o APK a uma versão publicada e deixar como rascunho. Não testados aqui: a instalação de verdade no Windows e no Android (exigem os aparelhos).
- Na 1.6.1, no Electron real: a seleção de várias notas do mapa (Ctrl + arrastar, Ctrl + clique para pôr e tirar, Ctrl + clique no vazio mantendo a seleção, mover o grupo com as posições relativas e as conexões iguais e gravadas, menu do grupo, Delete em lote com um Desfazer que traz notas, conexões, cor e posições, Esc, convivência com Shift + arrastar, arrastar uma nota sozinha, mover o mapa e clicar para abrir, "Selecionar área" pelo menu, cor para o grupo, mapa com 400 notas, tema escuro) e as menções (lista do `@` nas notas com registros do Timer, mapas, links e tarefas — com "de onde é" e busca por categoria + data —, chips, abrir no módulo certo com o registro destacado no Histórico, título novo de registro, registro excluído e Desfazer, endereço novo de link, mapa renomeado, `@` no título, no "Mencionar" e na descrição das tarefas sem a própria tarefa, `@` nas notas do mapa, "Ver menções" no Timer — menu e diálogo — e nos Links levando até a tarefa e a nota, depois de reiniciar o app). Num Chromium com toque, no Fold fechado: "Selecionar área" segurando o dedo, tocar para pôr e tirar, mover o grupo com o dedo, excluir e Desfazer pela barra, e o `@` de uma nota do mapa listando registros do Timer.

## Onde mexer para…

| Quero… | Arquivo |
| --- | --- |
| Mudar a descrição das tarefas (editor, prévia na lista) | `app/components/tasks/TaskDrawer.vue`, `app/lib/tasks/description.ts` |
| Mudar como o Timer conta o tempo (pausas, Pomodoro, fim) | `app/lib/timer/engine.ts` (regras), `app/stores/timer.ts` (relógio, avisos, gravação) |
| Mudar o `timer.json` (formato, categorias, sem duplicar) | `app/lib/timer/model.ts`, `app/lib/timer/repository.ts` |
| Mudar as estatísticas / a comparação / os períodos | `app/lib/timer/stats.ts`, `app/components/timer/TimerStats.vue`, `TimerCompare.vue`, `PeriodNav.vue` |
| Mudar os gráficos do Timer | `app/components/timer/TimerColumns.vue`, `TimerDonut.vue`, `TimerBarList.vue`, `TimerHeatmap.vue`, `ChartTip.vue` |
| Mudar a tela de sessão / o histórico do Timer | `app/components/timer/TimerSession.vue`, `TimerDial.vue`, `TimerHistory.vue`, `TimerSessionDialog.vue` |
| Mudar as configurações ou o som do Timer | `app/lib/timer/settings.ts`, `app/components/timer/TimerSettings.vue`, `app/lib/sounds.ts` (`timer-end`, `phase-end`) |
| Mudar cores/tema | `app/assets/css/tokens.css` |
| Mudar a regra do título das notas | `app/lib/notes/title.ts` (e `app/lib/editor/title-line.ts`, a primeira linha como título) |
| Mudar as categorias das Notas | `app/lib/notes/categories.ts` (regras e `categorias.json`), `app/stores/notes.ts` (mover, renomear, excluir), `app/components/notes/NoteCategoryDialog.vue` |
| Mudar a lista lateral / as pastas pelo título | `app/components/notes/NotesSidebar.vue`, `NoteTreeRow.vue`, `app/lib/notes/title-tree.ts` |
| Mudar a ordem da lista das notas / o "Abrir a mais recente" | `sortNodes` e `latestId` em `app/lib/notes/title-tree.ts`, `openLatestInFolder` em `NotesSidebar.vue`, o relógio em `NoteTreeRow.vue` |
| Mudar a largura das telas dos módulos | `.module-content` em `app/assets/css/base.css`, `--page-pad-x` em `tokens.css`, `tests/layout-width.test.ts` |
| Mudar o título na primeira linha (configuração) | `app/lib/editor/title-line.ts`, `titleFirstLine` em `app/lib/notes/repository.ts`, `NotesSettings.vue`, `app/pages/notes.vue` |
| Mudar como a recorrência calcula datas | `app/lib/tasks/recurrence.ts` |
| Mudar a aparência/interações do mapa | `app/lib/mindmap/graph-view.ts` |
| Mudar o "Reorganizar o mapa" | `app/lib/mindmap/layout.ts` |
| Mudar a barra/regras de formatação | `app/components/editor/FormatToolbar.vue`, `app/lib/editor/formatting.ts` (inclusive os links no texto) |
| Mudar títulos/listas/checklists no editor | `app/lib/editor/markdown-preview.ts` (desenho), `app/lib/editor/line-markers.ts` (leitura da marcação) |
| Ajustar a detecção de código colado | `app/lib/editor/code-detect.ts` (linguagens: `languages.ts`) |
| Mudar o cartão do bloco de código / as cores do código | `app/lib/editor/code-blocks.ts`, `app/lib/editor/theme.ts` (`--code-*` em `tokens.css`) |
| Mudar o bloco de texto | `app/lib/editor/text-blocks.ts` (criar a partir da seleção), `app/lib/editor/code-blocks.ts` (cartão), `.cm-textblock` em `app/lib/editor/theme.ts`, `CodeFullscreen.vue` (tela cheia) |
| Mudar o bloco de código pela barra / o menu do nome do bloco | `codeBlockChange` em `app/lib/editor/text-blocks.ts`, o botão em `FormatToolbar.vue`, `chooseLanguage` (lista das linguagens) em `MarkdownEditor.vue`, `header` em `code-blocks.ts` |
| Mudar o `Ctrl+D` (várias ocorrências) | `app/lib/editor/multi-select.ts` (`plainMultipleSelections` nos blocos e na tela cheia) |
| Mudar como o código é editado no cartão do bloco | `app/lib/editor/block-editor.ts` (editor de dentro: teclas, saída, tema), `app/lib/editor/code-blocks.ts` (ponte com a nota: `blockHost`, `revealInBlocks`, `longerFences`), `blockEditorTheme` em `app/lib/editor/theme.ts` |
| Mudar quando o painel das Tarefas fecha | `app/pages/tasks.vue` (`onPagePointerDown`/`onPageClick`), `app/components/tasks/TaskDrawer.vue` (`contains`, `hasDraft`) |
| Mudar como as imagens são salvas/mostradas | `electron/files.ts` (`saveImage`), `app/lib/editor/images.ts`, `app/lib/editor/paste.ts` |
| Mudar a biblioteca de imagens | `electron/library.ts` (listar, uso, enviar, excluir), `app/components/shell/ImageLibraryDialog.vue`, `app/composables/useImageLibrary.ts` |
| Mudar o TXT/PDF exportado | `app/lib/notes/export.ts` (texto, HTML e estilo do PDF), `electron/export.ts` (salvar, imprimir), `app/composables/useNoteExport.ts` (menu) |
| Mudar as Configurações | `app/components/shell/SettingsDialog.vue`, `app/components/ui/SettingRow.vue`, `NotesSettings.vue`, `GraphSettings.vue`; iniciar com o computador: `electron/system.ts` |
| Acrescentar um módulo / mudar nome, ícone, atalho ou tutorial | `app/lib/modules.ts` (e a página em `app/pages/`, o store e o repositório do módulo) |
| Mudar quais módulos estão ativos / como ficam guardados | `app/stores/modules.ts`, regras em `app/lib/modules.ts` (`normalizePrefs`, `canDisable`) |
| Mudar o menu lateral ou a animação de ligar/desligar | `app/components/shell/NavRail.vue` (tempos em `EFFECT_MS`, `stores/modules.ts`) |
| Mudar os sons de ligar/desligar | `app/lib/sounds.ts` (som e volume), `SOUND_AT_MS` em `app/stores/modules.ts` (quando toca) |
| Mudar o arrastar para reorganizar | `app/composables/useSortableList.ts`; a ordem: `reorderedIds`/`movedBy` em `app/lib/modules.ts` |
| Mudar a versão anterior/próxima das notas | `app/lib/notes/versions.ts` (regra), `previousVersionOf`/`nextVersionOf` em `app/stores/notes.ts` (grupo), `NotesTabs.vue` (botões) |
| Mudar o painel dos tutoriais | `app/components/shell/TutorialPanel.vue`, `app/composables/useTutorial.ts` |
| Mudar a categoria automática pelo título | `app/lib/notes/auto-category.ts` (regra), `app/stores/notes.ts` (`considerAutoCategory`) |
| Mudar as menções | `app/stores/mentions.ts` (provedores: listar, descrever, abrir; "Ver menções"; correções), `app/lib/mentions/refs.ts` (menções das tarefas), `app/lib/mentions/catalog.ts` (ícones, textos, ordem do `@`), `app/lib/editor/mentions.ts` + `app/lib/notes/mention-links.ts` (notas), `MentionPicker.vue`/`MentionChip.vue` (tarefas), `MentionsDialog.vue` |
| Deixar um módulo novo ser mencionado | um provedor em `PROVIDERS` (`app/stores/mentions.ts`) + uma linha em `MENTION_KINDS` (`app/lib/mentions/catalog.ts`) + o tipo em `lib/notes/mention-links.ts`/`lib/mentions/refs.ts` |
| Mudar a seleção de várias notas do mapa | `app/lib/mindmap/graph-view.ts` (área, Ctrl + clique, mover o grupo), `app/pages/mindmap.vue` (barra, menu do grupo, Delete), `deleteNotes`/`setColors` em `app/stores/mindmap.ts` |
| Mudar as atualizações (pergunta, Configurações) | `app/stores/updates.ts`, `app/components/shell/UpdateSettings.vue`; regras em `shared/updates.ts` |
| Mudar como o Windows/Android baixam e instalam | `electron/updates.ts`; `app/lib/mobile/updates.ts` + `android/app/src/main/java/com/kauan/fournotes/UpdaterPlugin.java` |
| Mudar a publicação das versões | `scripts/release.mjs` (`npm run release`), `scripts/release-lib.mjs` (latest.yml, .env) |
| Mudar Tab/Shift+Tab ou a numeração das listas | `app/lib/editor/lists.ts` |
| Mudar a animação de clique dos ícones | `app/plugins/icon-tap.client.ts` (movimento, quais controles, exceções) |
| Mudar os desenhos dos ícones (engrenagem das Configurações etc.) | `app/lib/icons.ts` |
| Mudar os menus do clique direito | `app/components/shell/ContextMenuHost.vue`, `app/composables/useContextMenu.ts` |
| Mudar a criação/abertura de workspaces | `app/stores/app.ts`, `electron/data-dir.ts` |
| Adicionar um novo pedido ao "lado desktop" | `shared/ipc.ts` → `electron/preload.ts` → `electron/ipc.ts` |
| Mudar o instalador | `electron-builder.yml`, `build/installer.nsh` (tela "Atalhos") |
| Mudar os ícones prontos das categorias | `app/lib/category-icons.ts` (lista), `app/lib/icons.ts` (desenhos), `app/components/ui/IconPicker.vue` |
| Mudar como as marcações escondidas se comportam | `app/lib/editor/hidden-markup.ts` (edição), `app/lib/editor/elements.ts` (leitura dos trechos) |
| Mudar a tela de Links | `app/pages/links.vue`, `app/components/links/` |
| Mudar como o título/ícone dos sites é buscado | `electron/links.ts` (rede), `shared/link-meta.ts` (leitura do HTML e escolha do ícone) |
| Adicionar um navegador à importação | `electron/links.ts` (`browserDirs` para os Chromium, `geckoBrowsers` para os derivados do Firefox), `shared/bookmarks.ts` (formatos) |
| Adicionar um pedido à plataforma (desktop **e** Android) | `shared/ipc.ts` (contrato) → `electron/preload.ts` + `electron/ipc.ts` (desktop) e `app/lib/mobile/api.ts` (Android) |
| Mudar o que o celular faz com os arquivos | `app/lib/mobile/workspace.ts` (regras), `app/lib/mobile/fs.ts` (plugin de arquivos), regras comuns em `shared/files.ts` e `shared/library.ts` |
| Esconder algo que uma plataforma não tem | `PlatformCapabilities` em `shared/ipc.ts`; `capabilities()`/`canReveal()`/`trashPlace()` em `app/lib/platform.ts` |
| Mudar a permissão de arquivos, a impressão ou abrir links no Android | `android/app/src/main/java/com/kauan/fournotes/FourNotesPlugin.java`, `app/lib/mobile/native.ts` |
| Mudar permissões, nome, ícone ou cores do app Android | `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/`, `capacitor.config.ts` |
| Mudar o build do Android ou do iOS | `scripts/android.mjs`, `scripts/ios.mjs`, `android/app/build.gradle` (versão e assinatura) |
| Mudar uma configuração / o que vai para o `settings.json` | `app/stores/settings.ts` (arquivo), a seção no store do módulo; a passagem da 1.4.3: `app/lib/storage/settings-migration.ts` |
| Mudar o que fica guardado em cada aparelho | `app/lib/storage/device-state.ts` |
| Mudar os tamanhos de tela (compact/medium/expanded) | `app/composables/useLayoutSize.ts` (limites), `app/assets/css/mobile.css` e o `<style>` de cada componente |
| Mudar a barra de baixo, as gavetas ou as folhas do celular | `app/components/shell/MobileNav.vue`, `app/components/ui/MobileDrawer.vue`, `app/components/ui/UiSheet.vue`, modo folha do `ContextMenuHost.vue` |
| Mudar o toque prolongado ou o "voltar" do Android | `app/lib/touch/long-press.ts`, `app/composables/useBackButton.ts` |
| Mudar os gestos do mapa no toque | `app/lib/mindmap/graph-view.ts` (pinça, alça de conexão, toque duplo), `app/pages/mindmap.vue` (selecionar e abrir no compact) |
