# Arquitetura do 4notes

Este documento explica, de forma didática, como o 4notes funciona por dentro: como o **Nuxt** é usado, o que transforma o projeto em um **aplicativo desktop**, como os **arquivos** são lidos e salvos e como funcionam **tarefas recorrentes**, o **Mapa Mental** e os **Links**.

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
│  ├─ window.ts     janela, fechar seguro      │                Mapa, Links    │
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
   ├── attachments/ (biblioteca de imagens)
   └── .4notes/
```

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

### Independência dos módulos

Cada módulo tem seu próprio store, repositório, pasta e componentes:

```
Notas        → stores/notes.ts   → lib/notes/   → notes/*.md, notes/<categoria>/*.md + categorias.json
Tarefas      → stores/tasks.ts   → lib/tasks/   → tasks/tasks.json
Mapa Mental  → stores/mindmap.ts → lib/mindmap/ → mindmap/<mapa>/*.md + mapa.json (conexões e cores)
Links        → stores/links.ts   → lib/links/   → links/links.json + links/icons/ (ícones dos sites)
```

Os módulos não importam uns aos outros. Eles compartilham **infraestrutura** (editor de Markdown, ícones, diálogos, a API de arquivos) e `stores/app.ts` conhece os quatro só para tarefas gerais: carregar tudo ao abrir, salvar tudo antes de fechar e reler os arquivos quando você volta para a janela. A **lista dos módulos** (nome, ícone, rota, atalho e tutorial) fica num lugar só, `lib/modules.ts`, e quais estão ativos em `stores/modules.ts` (item 16).

A **única ligação** entre módulos é a que foi pedida: **menções** — tarefas mencionam notas (1.1.0); notas das Notas mencionam notas (1.1.1) e tarefas (1.2.0); notas do Mapa Mental mencionam notas e tarefas (1.2.0); notas (das Notas e do Mapa) mencionam **links salvos** (1.3.1). Ela é explícita e fica num lugar só (ver item 10):

```
Notas / Mapa Mental ──(avisam "nota renomeada / movida")──▶ lib/note-events.ts
                                                                │
stores/mentions.ts  ◀───────────────────────────────────────────┘   lista notas, tarefas e links, abre o que foi
       │        ◀── (observa os títulos das tarefas) ── stores/tasks.ts  mencionado, corrige as menções
       │        ◀── (lê os links salvos e os ícones) ── stores/links.ts
       ▼
stores/tasks.ts   → tasks.json ("mentions": [...])
stores/notes.ts   → links no texto das Notas (rewriteContents)
stores/mindmap.ts → links no texto do mapa aberto (rewriteContents) e dos outros mapas, nos arquivos (rewriteAllMaps)
```

Notas e Mapa Mental não sabem quem os menciona: só publicam o aviso de renomeação (e oferecem funções genéricas para reescrever o texto das notas, que a ponte usa). Tarefas não sabem que são mencionadas: a ponte observa os títulos delas.

O módulo **Links** não sabe que é mencionado: a ponte só lê a lista de links salvos (para o `@` e para o ícone do site na frente de um link mencionado). Ele também compartilha a infraestrutura (o seletor de ícones, o avatar das categorias e a **biblioteca de imagens**, que é de todo o app — ver item 12).

---

## 1. Como o Nuxt está sendo utilizado

O Nuxt roda em modo **SPA** (Single Page Application), configurado em `nuxt.config.ts`:

```ts
ssr: false
```

Isso significa:

- **Não existe servidor em produção.** `nuxt generate` gera arquivos estáticos (`.output/public/index.html` + JavaScript/CSS em `_nuxt/`). O Electron carrega esses arquivos.
- O Nuxt continua oferecendo o que tem de melhor para organizar a interface:
  - **Rotas por arquivo**: `app/pages/notes.vue` → `/notes`, `tasks.vue` → `/tasks`, `mindmap.vue` → `/mindmap`, `links.vue` → `/links`. O `<NuxtPage :keepalive>` mantém as quatro telas vivas ao alternar (o editor não perde o histórico de desfazer e o mapa não recalcula).
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
- **Excluir = Lixeira do Windows** (`shell.trashItem`), com fallback para `.4notes/trash/`.
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
├── attachments/                Biblioteca de imagens: coladas nas notas (imagem-20261002-141503.png), enviadas, fotos das categorias
└── .4notes/                    Estado da interface (pode ser apagado sem perder dados)
    ├── notes.json              abas abertas, aba ativa, lista lateral, categorias recolhidas, pastas abertas e as configurações das Notas
    ├── mindmap.json            mapa aberto, posições dos nós de cada mapa e as configurações do Mapa Mental
    ├── links.json              ordem da lista de links (recentes, A–Z ou URL)
    ├── app.json                último módulo aberto, módulos ativos e como aparecem no menu lateral
    └── backups/                tasks-segunda.json … tasks-domingo.json e links-segunda.json … (7 dias) e conversões do mapa
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
| Configurações dos módulos | JSON em `.4notes/` (no arquivo de estado de cada módulo) | Valem para o workspace (cada workspace com as suas) e não misturam com os dados. |
| Estado da interface | JSON em `.4notes/` | Separado dos dados: apagar não perde nada importante. |

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

**Preferências desta máquina** (não são dados) ficam em `%APPDATA%\4notes\config.json` (`electron/config.ts`): qual workspace abrir, tema, zoom e tamanho/posição da janela.

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
- As abas abertas ficam em `.4notes/notes.json` e são restauradas na próxima vez.
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
- Maiúsculas não importam para agrupar; o nome da pasta usa a grafia da nota da pasta (ou a mais comum). Pastas primeiro, depois as notas, em ordem alfabética com números na ordem certa (`1.9` antes de `1.10`).
- As pastas começam fechadas; as que levam até a nota ativa abrem sozinhas. Categorias recolhidas e pastas abertas ficam em `.4notes/notes.json`. Buscando, tudo aparece aberto.
- **Exibição das pastas pelo título** (1.3.1, configuração das Notas): **Padrão** (como foi digitado) ou **CAIXA ALTA** — só CSS (`text-transform` no nome das pastas); o título das notas e os arquivos não mudam.
- O título **"Notas"** em cima das notas sem categoria só aparece quando existe alguma nota sem categoria (ou enquanto você arrasta uma nota até ali, para tirar a categoria).
- O **+** de uma pasta (1.3.0, aparece ao passar o mouse) cria uma nota na mesma categoria que já começa com o título da pasta — `# 4notes ` (`titlePath` da pasta, em `title-tree.ts`) —, com o cursor no fim. Completando o título, a nota cai na pasta. Esse começo é só uma sugestão (`createNote(…, { template: true })`): enquanto você não digita mais nada, a nota não vira arquivo e fechar a aba a descarta.

A aba de uma nota com categoria fica marcada com a **cor da categoria** (na aba ativa, o indicador de baixo inteiro; nas outras, um traço discreto).

### Versão anterior de uma nota — `lib/notes/versions.ts`, `stores/notes.ts › previousVersionOf`, `NotesTabs.vue` (1.4.1)

Notas com o mesmo título a não ser por um **número de versão** são versões umas das outras:

```
4notes 1.4.1  →  4notes 1.4.0  →  4notes 1.3.2  →  (nenhuma: sem botão)
Aula 3        →  Aula 2
4notes 1.2.0 bugs  →  4notes 1.1.1 bugs   (o texto depois da versão também conta)
```

- A versão é a **última palavra** do título que é um número (`3`, `1.4.0`, `v2.1`), com pelo menos uma palavra antes. As outras palavras precisam ser iguais (sem diferenciar maiúsculas) — as mesmas palavras de `titleWords` que montam as pastas pelo título, então as versões ficam sempre na mesma pasta da lista.
- A anterior é a **maior versão menor que a atual**, comparando parte por parte (`1.10` > `1.9`; `1.4` = `1.4.0`, que não conta como anterior). Pulos na numeração são seguidos (`1.4.1` sem `1.4.0` → `1.3.9`).
- O grupo é o da organização da lista: **a mesma categoria** (ou as notas sem categoria) — `sameDir`. Uma `1.3.9` em outra categoria não entra.
- O botão fica no **fim da barra das abas** (ícone de histórico + o número, ex.: `1.4.0`; o balão mostra o título), não no editor; abre a anterior numa aba (`openNote`). Sem versão anterior (ou numa nota sem versão), não aparece. É calculado da lista de notas (sem ler arquivos), então acompanha na hora uma nota nova, renomeada ou movida.

### Formatação do texto (Notas e Mapa Mental)

Arquivos: `app/lib/editor/elements.ts` (lê os trechos formatados), `app/lib/editor/formatting.ts` (comandos e desenho), `app/lib/editor/hidden-markup.ts` (edição com as marcações escondidas), `app/components/editor/FormatToolbar.vue` (barra) e `app/lib/editor/setup.ts` (monta o editor com todas as extensões abaixo).

Ao selecionar um trecho aparece a barra de formatação: negrito, itálico, sublinhado, tachado, cor do texto, marca-texto, título, lista, lista de tarefas, código, **bloco de texto** (1.3.2, ver "Blocos de texto" abaixo), link e "limpar formatação". Com várias ocorrências selecionadas (`Ctrl+D`) a barra não aparece — ela cobriria as outras seleções —, mas os atalhos (`Ctrl+B`…) formatam todas. O arquivo continua sendo Markdown comum:

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
- Fora da edição, o bloco é um **cartão** (widget do CodeMirror) com a linguagem, os botões **Copiar**, **Tela cheia** e **Remover bloco**, e o código colorido com **altura máxima e rolagem interna**. Clicar no código (ou chegar nele pelas setas) **abre o cartão**: as linhas do código ficam editáveis ali mesmo, entre o cabeçalho e o rodapé do cartão, que tomam o lugar das cercas ` ``` ` — as cercas nunca aparecem e o cursor nunca para nelas (1.3.0).
- Digitar ` ``` ` (ou ` ```linguagem `) numa linha e apertar `Enter` cria um bloco; a linguagem muda clicando no nome dela no cabeçalho (menu com as linguagens, `chooseLanguage`); `Backspace` num bloco vazio o remove.
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
- **Cartão**: o mesmo dos blocos de código (`code-blocks.ts` reconhece `isTextBlock`), com o cabeçalho **Texto** (sem trocar linguagem), **Copiar**, **Tela cheia** e **Remover** (com **Desfazer** no aviso), altura máxima e rolagem interna — mas com a fonte do texto e linhas que quebram (`.cm-textblock` em `theme.ts`; editando, as linhas ganham `cm-md-textblock` em `setup.ts`). A **tela cheia** (`CodeFullscreen.vue`) abre como texto: fonte do texto, linhas que quebram, corretor ligado, sem números de linha nem recursos de código. Desde a 1.4.1 o texto usa a **largura toda** da janela, com a mesma margem lateral do editor de notas (`--editor-padding-x`, em `textEditorTheme`), em vez de uma coluna centralizada com espaço vazio dos lados.
- `text` é reservado: `findLanguage('text')` não devolve linguagem (a busca aproximada do CodeMirror acharia o LaTeX pelo apelido `tex`) e o Markdown do editor usa `findLanguage` para colorir o código dos blocos. No PDF exportado o bloco sai com a fonte do texto (`.code.text`).

### Várias ocorrências — `Ctrl+D` — `multi-select.ts` (1.3.2)

- `Ctrl+D` (`⌘D`) com um trecho selecionado acrescenta à seleção a **próxima ocorrência** do mesmo texto, sem diferenciar maiúsculas (como o VS Code); de novo, a seguinte — chegando ao fim da nota, continua do começo. A ocorrência nova vira a seleção principal (a próxima busca continua depois dela). Sem nada selecionado, o primeiro `Ctrl+D` seleciona a palavra do cursor e os próximos só pegam a mesma palavra inteira, com as mesmas maiúsculas (`wordModeField`).
- Digitar, colar, apagar e os atalhos de formatação agem em todas as seleções juntas (os comandos de formatação já usavam `changeByRange`); um `Ctrl+Z` desfaz tudo de uma vez; `Esc` volta para um cursor só.
- Ocorrências que começam ou terminam dentro de algo escondido ficam de fora: o endereço de um link, o título de uma menção, imagens, marcadores de linha e marcações (lido do texto por `hiddenRanges`, valendo também fora da parte visível da nota, e das partes atômicas do editor). Dentro do código de um bloco vale — o cartão se abre para mostrar a seleção.
- O editor passou a aceitar várias seleções (`EditorState.allowMultipleSelections`), mas **só o `Ctrl+D` cria seleções extras** (`onlyCtrlDAddsRanges`): `Ctrl+clique` continua abrindo links (`clickAddsSelectionRange` desligado) e outros comandos do CodeMirror que criariam cursores (`Ctrl+Shift+L`, `Ctrl+Alt+↑`…) continuam como antes. Vale nas Notas e nas notas do Mapa Mental.

### Imagens — `images.ts`, `paste.ts`, `host.ts`

1. Colar um print (ou soltar um arquivo de imagem) chama `attachments.saveImage` → o Electron grava `attachments/imagem-AAAAMMDD-HHMMSS.png` no workspace (a biblioteca de imagens, item 12). **Inserir imagem…** (1.3.1, botão direito no editor, fora dos blocos de código) abre a biblioteca e insere a escolhida no lugar do clique (`insertImageFromLibrary` → `host.pickImage`).
2. A nota recebe `![](../attachments/imagem-….png)` — caminho **relativo à pasta da nota** (`relativeTo`), por isso a nota também abre certo no Obsidian/VS Code e o workspace pode mudar de lugar.
3. Para mostrar, `resolveFromNote` transforma o caminho da nota em caminho do workspace (recusando endereços que saiam dele) e a imagem é carregada por `workspace://files/…`.

No editor aparece só a imagem — o texto `![](…)` nunca aparece (1.3.0). Clicar seleciona a imagem (com contorno; `Backspace`/`Delete` tiram da nota, `Ctrl+C` copia), e o que for digitado logo antes ou depois de uma imagem sozinha na linha vai para uma linha própria.

**Remover** (botão sobre a imagem) tira a imagem **só da nota** (1.3.1): o arquivo continua na biblioteca, para usar de novo — ele só sai de lá pela própria biblioteca, quando nada mais o usa. **Desfazer** (no aviso ou com Ctrl+Z) devolve a imagem para a nota. (Até a 1.3.0, Remover mandava o arquivo para a Lixeira.)

### Menções a notas, tarefas e links — `mentions.ts`, `lib/notes/mention-links.ts`

Nas Notas e nas notas do Mapa Mental, digitar **`@`** abre a lista: notas das Notas (de todas as categorias), notas de todos os mapas (sem a própria nota), **tarefas** (as concluídas no fim) e **links salvos** (1.3.1, depois das notas e tarefas; a busca procura no título e no endereço do link). A escolhida entra como um **link Markdown comum**, relativo à pasta da nota, então o arquivo continua legível e o link funciona no Obsidian/VS Code:

```
[Ideias](Ideias.md)                              nota das Notas (na mesma pasta)
[Reunião](Trabalho/Reuni%C3%A3o.md)                nota de uma categoria
[Godot](../mindmap/Principal/Godot.md)           nota de um mapa (vista das Notas)
[Estudar Godot](../tasks/tasks.json#t_k3j9x0)    tarefa: o tasks.json + o id dela depois do "#"
[Nuxt](https://nuxt.com/)                        link salvo: um link comum
```

Um link salvo **não vira chip**: ele é um link como os outros (o texto continua editável) e ganha o **ícone do site** na frente (`formatting.ts → LinkIconWidget`, pelo `MentionHost.linkIcon`). Vale para qualquer link do texto cujo endereço é um link salvo no módulo Links (`savedLinkIcon` em `stores/mentions.ts`, comparando com `urlKey`); quando os ícones chegam ou mudam, o `revision()` da ponte muda e os editores redesenham.

No editor, o link vira um **chip** com o título atual (um bloco só: o cursor passa por cima e Backspace apaga a menção inteira): roxo para notas, amarelo para tarefas — a tarefa concluída aparece riscada. Clicar abre a nota no módulo dela ou a tarefa no painel das Tarefas. O que não existe mais aparece riscado e cinza. Os chips são redesenhados quando um título ou estado muda fora do editor (o `revision()` da ponte muda e o editor recebe o efeito `refreshMentions`). Mudanças vindas de fora (menção corrigida, arquivo editado em outro programa) não entram no Desfazer.

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

Os nós **ficam onde você os deixa** (arrastar move uma nota). Nota nova aparece num espaço livre perto da nota ligada a ela (ou onde você clicou com o botão direito). As posições ficam em `.4notes/mindmap.json`, por mapa.

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
- Ajustes (desde a 1.3.1 em **Configurações → Módulos → Mapa Mental**, `components/mindmap/GraphSettings.vue`; desde a 1.4.2 não há mais um atalho para elas na barra do mapa): esconder notas sem conexões e nós em **cards** (padrão, com o nome dentro) ou **círculos** (estilo Obsidian). Nos círculos, os nomes aparecem **só na nota selecionada** (padrão), conforme o zoom ou sempre. **Reorganizar o mapa** continua no próprio mapa: botão na barra e no clique direito do fundo. A barra do mapa (`GraphToolbar.vue`) tem só o seletor de mapas, a busca (o atalho `Ctrl+K` funciona, mas só aparece no tutorial), **Nova nota** e **Reorganizar**; o rodapé mostra o resumo do mapa, o zoom e, com uma conexão selecionada, como removê-la (a dica fixa "Arraste para mover…" saiu na 1.4.2 — está no tutorial).
- Os ajustes ficam em `.4notes/mindmap.json` com `settingsVersion`: na primeira abertura da 1.1.0, os ajustes gravados pelas versões anteriores (que sempre salvavam os padrões antigos) passam para os novos padrões — cards e nomes ao selecionar — uma única vez.

---

## 10. Menções (tarefas, Notas e Mapa Mental)

Arquivos: `app/lib/tasks/mentions.ts` (menções nas tarefas), `app/lib/notes/mention-links.ts` (links nas notas), `app/stores/mentions.ts` (ponte entre os módulos), `app/lib/note-events.ts` (avisos de renomeação), `components/tasks/NotePicker.vue` e `MentionChip.vue`.

- Digitar **`@`** na barra de criação rápida, no título ou nos detalhes da tarefa abre a lista de notas (`composables/useMentionTrigger.ts`); o botão **Mencionar nota** do painel abre a mesma lista com busca. Entram as notas das Notas e de **todos os mapas** (as dos mapas fechados são listadas direto da pasta, sem carregá-los).
- A menção é salva **na tarefa**, no `tasks.json`, como uma referência estruturada — onde a nota está + o último título conhecido:
  `{ "kind": "note", "path": "notes/Ideias.md", "title": "Ideias" }` ou `{ "kind": "map", "map": "Principal", "note": "Godot.md", "title": "Godot" }`.
  O texto da tarefa fica limpo (`@ide` vira `Ideias de jogo`); a menção aparece como um chip.
- **Clicar no chip** abre a nota no módulo dela (troca de mapa se precisar). Se a nota não existir mais, aparece um aviso — a tarefa não é alterada.
- **Dentro das notas** (Notas e Mapa Mental), a menção é um link Markdown no texto (ver "Menções a notas, tarefas e links" no item 6). Os links salvos entram como links comuns, com o ícone do site.
- **Renomear ou mover no app** (título de uma nota rápida, nota movida de categoria, categoria renomeada, nota ou mapa do Mapa Mental) publica um aviso em `note-events.ts` (`note-renamed`, `notes-folder-renamed`, `map-note-renamed`, `map-renamed`). O store de menções:
  - corrige as tarefas afetadas (o `tasks.json` é salvo);
  - reescreve os links das Notas e do mapa aberto na hora (`renameMentionLinks`, com a pasta de cada nota; o texto do link acompanha o novo título);
  - reescreve os arquivos dos **outros mapas** em lote, 1,2 s depois (`mindmap.rewriteAllMaps`, que não roda junto com a troca de mapa). Antes de o app fechar, o que estiver pendente é aplicado.
- **Título de tarefa mudou**: a ponte observa os títulos e, 1 s depois que você para de digitar, atualiza o texto das menções àquela tarefa nas notas (`retitleTaskLinks`). O link aponta pelo id, então ele nunca quebra; o texto só fica igual ao título.
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

**Tela** (`pages/links.vue`): lista lateral com busca, "Todos os links", "Sem categoria" e as categorias (arraste um link até uma categoria para movê-lo — o arrastar leva o id no tipo `application/x-4notes-link` — e arraste as categorias para reordenar). "Sem categoria" só aparece quando existe algum link sem categoria, quando ela está aberta ou enquanto um link da lista é arrastado (para poder soltar ali). No centro, o campo de salvar (com o ícone de link, igual ao da barra de nova tarefa) e a lista — **Recentes**, **A–Z** ou **URL** (1.3.1: pelo endereço, `urlSortKey`: o domínio sem `www.` e com acentos, depois o caminho), lembrado em `.4notes/links.json`. Colar com `Ctrl+V` fora de um campo e soltar um link vindo do navegador também salvam. Clicar abre no navegador padrão (`shell.openExternal`). Mover, excluir e excluir categoria têm **Desfazer**; excluir uma categoria não apaga links — eles ficam sem categoria.

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
- **Onde é usada**: cada imagem mostra o uso — notas (`.md` em `notes/` e `mindmap/` que citam o arquivo: `referencedFiles` lê os links e imagens do texto e resolve os caminhos relativos), foto de categoria das Notas (`categorias.json`) e dos Links (`links.json`). Antes de listar, o app grava o que estiver pendente (`flushEverything`), para o "em uso" ficar certo.
- **Excluir** só aparece nas imagens sem uso (e só em `attachments/`); o arquivo — e as cópias iguais a ele — vão para a Lixeira (`removeFromLibrary` confere o uso de novo antes). Tirar uma imagem de uma nota ou de uma categoria nunca apaga o arquivo da biblioteca.
- **Adotar** (`library.adopt`): uma foto que está fora de `attachments/` (a foto antiga de uma categoria) ganha uma cópia na biblioteca quando é escolhida para outro lugar ou quando sai da categoria.
- **Modais empilhados** (`composables/useModalStack.ts`): a biblioteca abre por cima de outro diálogo (a categoria, as Configurações); o `Esc` fecha só o de cima e o aberto por último fica por cima, mesmo que tenha sido montado antes.

---

## 13. Configurações (e iniciar com o computador)

`components/shell/SettingsDialog.vue`, em duas abas (`app.openSettings(aba, módulo)`):

- **Geral**: tema; **Tutoriais e atalhos** (abre o painel do item 16); **Iniciar com o computador**; workspace (pasta, abrir/criar outro) e a biblioteca de imagens.
- **Módulos**: primeiro as **configurações gerais dos módulos** (1.4.0, item 16) — módulos ativos (arraste para mudar a ordem, 1.4.1) e **Menu lateral** (ícone e nome / só o ícone). Depois, os ajustes de cada módulo **ativo** que fazem sentido como configuração permanente, guardados **no workspace** (no arquivo de estado do módulo em `.4notes/`): Notas (`NotesSettings.vue`: categoria automática pelo título, exibição das pastas pelo título), Mapa Mental (`GraphSettings.vue`: notas sem conexões, estilo dos nós, nomes), e Tarefas e Links com "Sem nenhuma configuração disponível no momento.". As de um módulo desativado somem da lista (continuam guardadas). **Critério**: o que se usa toda hora fica na tela do próprio módulo — ordenar os links, as opções de criação das tarefas, reorganizar o mapa.
- Os **atalhos** de teclado saíram das Configurações (até a 1.3.2 havia uma aba "Atalhos"): ficam nos tutoriais de cada módulo (item 16).

**Desfoque só atrás do painel** (1.4.1): o fundo do `UiModal` (escurecido + `backdrop-filter`) é um `::before` com `inset` configurável (`scrimInset`). Na aba **Módulos**, ele começa abaixo da barra de título e à direita do menu lateral (`var(--titlebar-h) 0 0 var(--rail-w)`), então o nome do workspace e o menu ficam nítidos enquanto você liga, desliga e reorganiza; o resto da janela continua bloqueado para cliques. Na aba Geral, a janela inteira fica embaçada, como nos outros diálogos.

Cada configuração é um `components/ui/SettingRow.vue`: nome, o **?** com uma explicação bem curta (balão ao passar o mouse ou focar com o teclado) e o controle.

**Iniciar com o computador** (`electron/system.ts`): `app.setLoginItemSettings({ openAtLogin })` — no Windows, a mesma lista do Gerenciador de Tarefas › Inicializar (desligado por lá conta como desligado aqui; ligar aqui religa lá). É uma configuração **da máquina** (não do workspace) e só existe no app instalado (Windows e macOS): em desenvolvimento ela abriria o Electron "puro", então o switch fica desativado com o aviso "Disponível no 4notes instalado". Nos testes automatizados só simula.

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

---

## 16. Módulos: ativar, desativar, reorganizar, menu lateral e tutoriais (1.4.0 · 1.4.1)

Arquivos: `app/lib/modules.ts` (lista dos módulos + tutoriais + regras puras das preferências), `app/stores/modules.ts` (preferências no workspace), `components/shell/NavRail.vue` (menu lateral e animação), `composables/useSortableList.ts` (arrastar para reorganizar, 1.4.1), `lib/sounds.ts` (sons de ligar/desligar, 1.4.1), `components/shell/TutorialPanel.vue` + `composables/useTutorial.ts` (tutoriais), `SettingsDialog.vue` (configurações gerais dos módulos).

**Uma lista só** (`MODULES` em `lib/modules.ts`): id, nome curto (menu) e completo, ícone, rota, tecla do atalho (`Ctrl+1…4`), uma linha de descrição e o **tutorial** (obrigatório no tipo). O menu lateral, os atalhos do `app.vue`, as Configurações, o título e os Tutoriais leem essa lista — um módulo novo entra em todos esses lugares (inclusive no atalho "Ir para …" do tutorial Geral) só sendo acrescentado ali.

**Ativar/desativar = preferência de exibição**, guardada em `.4notes/app.json` (o mesmo arquivo do último módulo aberto, agora de `stores/modules.ts`):

```json
{ "lastModule": "notes", "modules": { "disabled": ["links"], "order": ["notes", "mindmap", "tasks", "links"], "navStyle": "icon-label" } }
```

- Guarda só os **desativados**: um módulo novo começa ativo; ids desconhecidos (de outra versão) e outras chaves do arquivo são mantidos. Pelo menos um módulo fica ativo (`canDisable`; um arquivo editado à mão com todos desligados reativa o primeiro).
- **Nada muda nos dados**: todos os stores continuam carregando, salvando e relendo os arquivos (menções, biblioteca de imagens e "salvar antes de fechar" seguem iguais). O módulo só sai do menu; ao ativar, volta com tudo.
- Módulo aberto desativado → `app.vue` vai para o último módulo ativo (ou o primeiro). Ao abrir o app, idem.
- `Ctrl+<n>` ou uma **menção** para um módulo desativado não abre uma tela fora do menu: um aviso oferece **Ativar** (`requireModule`), que ativa e segue para o que foi pedido.
- Onde mudar: **Configurações › Módulos › Geral** (switches por módulo) ou **botão direito no menu lateral** (no módulo clicado: "Mover para cima/baixo" e "Desativar <módulo>"; depois as caixas por módulo, "Mostrar os nomes", "Configurações dos módulos…", "Tutorial").

**Ordem do menu** (1.4.1): `order` guarda **todos** os ids (os desativados também, no lugar deles). `normalizePrefs` tolera arquivo editado à mão: ids repetidos ou inválidos saem, módulos que faltam entram no fim na ordem padrão, ids desconhecidos (de outra versão) ficam no lugar. Reorganizar mexe só nos módulos mostrados: `reorderedIds(order, mostrados)` põe a nova sequência nos lugares que eles ocupavam e deixa os outros onde estavam — um módulo desativado volta, ao ser ativado, ao lugar em que estava. As Configurações, os tutoriais e o menu leem `ordered`/`enabled` (já na ordem); os atalhos `Ctrl+1…4` continuam presos a cada módulo (a tecla é do módulo, não da posição). Só a exibição muda: nada nos dados nem nas configurações dos módulos.

**Arrastar** (`useSortableList.ts`, usado no menu lateral e na lista das Configurações): eventos de ponteiro, não o arrastar-e-soltar do navegador (os itens do menu são links). Passando de 5 px o item "levanta" e segue o mouse (preso dentro da lista); os outros abrem espaço quando a borda dele passa do meio do vizinho; ao soltar, `onReorder` grava a ordem e um FLIP faz cada item deslizar até o lugar novo. O clique que encerra um arraste é engolido (não abre o módulo); um clique sem arrastar continua normal; `Esc` cancela. Nas Configurações, os switches não iniciam arraste. No menu, não dá para arrastar durante a animação de ligar/desligar; "Mover para cima/baixo" usa o mesmo FLIP.

**Menu lateral** (`NavRail.vue`): **Ícone e nome** (padrão, 64 px) ou **Só o ícone** (54 px; o nome fica no balão). A largura é a variável `--rail-w` do app inteiro, então a logo da barra de título continua centralizada sobre o menu. O indicador do módulo aberto segue o item medindo a posição dele (também durante as animações e o arraste). Embaixo: tema, **?** (tutorial) e Configurações. Com as Configurações abertas em **Módulos**, o desfoque do fundo começa depois do menu e da barra de título (`scrimInset`, item 13), que ficam nítidos para mostrar as mudanças ao vivo (até a 1.4.0, o menu subia por cima do fundo com a classe `.preview`).

**Animação de ligar** (~2,2 s desde a 1.4.1; era ~1,3 s, `stores/modules.ts › EFFECT_MS`): o espaço do módulo abre; um **fio** (roxo→amarelo, na borda do menu) cresce a partir dele até o primeiro e o último módulo; a ligação dele com o fio se estende até o ícone, que entra de lado e **encaixa** com um anel de luz; um **sinal** (ponto amarelo) corre pelo fio até cada um dos outros módulos, que respondem (a ligação deles pisca e o ícone dá um leve pulo); tudo some. **Desligar** (~1,4 s; era ~0,9 s) é o contrário: os outros mandam o sinal até ele, o anel se fecha, a ligação se solta, o ícone sai de lado e o espaço fecha. Só CSS (keyframes com variáveis por item: posição, atraso, distância), sem travar o uso; com "reduzir movimento" do sistema, não há animação. Nas Configurações, o card do módulo também "encaixa".

**Sons** (1.4.1, `lib/sounds.ts`): sintetizados com a Web Audio API (sem arquivos de áudio) e tocados no momento certo da animação (`SOUND_AT_MS`: ligando, no encaixe do ícone; desligando, quando ele se solta). Ligar: um clique suave e duas notas subindo; desligar: um "pop" abafado e duas notas descendo. Pico perto de −22 dBFS e menos de 0,4 s audível; saem pela saída padrão do sistema, então seguem o volume e o mudo dele. Nada se acumula: se a animação foi trocada antes do som (liga/desliga seguidos), ele não toca, e há um intervalo mínimo entre dois sons; nada toca em repetição. O `AudioContext` é criado só no primeiro som e suspenso logo depois (o app não fica segurando o áudio). Com "reduzir movimento", o som toca na hora (sem animação). `renderModuleSound` gera o mesmo som num `OfflineAudioContext` para os testes.

**Tutoriais** (`TutorialPanel.vue`): o **?** no fim do menu lateral ou **F1** (também com o cursor no editor) abre um painel ao lado do menu, por cima do módulo e **sem fundo escurecido** — dá para ler e testar. Abre no módulo atual e acompanha a troca de módulo; abas para os outros módulos (os desativados aparecem apagados, com **Ativar**) e o **Geral**. Cada tutorial: para que serve, o que dá para fazer, **Botão direito** (o que tem nos menus de contexto, 1.4.1 — campo `contextMenu`, obrigatório no tipo), "Você sabia?" e os atalhos (`Mod` vira Ctrl/⌘), em frases curtas (o teste limita a 100 caracteres). As abas seguem a ordem do menu. Fecha com ×, **?**, F1, Esc (o Esc não fecha se você estiver digitando fora do painel) ou **clicando fora** (1.4.1): um clique (botão esquerdo) que começa e termina fora do painel o fecha depois de fazer o que faria normalmente; clicar dentro não fecha, e não contam os botões que já abrem/fecham o tutorial (`[data-tutorial-toggle]`: o **?** e o "Abrir" das Configurações), o fim de um arraste de módulo e o "clique" do teclado. Também em Configurações › Geral › Tutoriais e atalhos.

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
| Estado da interface | `.4notes/` | Separado dos dados; pode ser apagado. |
| Editor | CodeMirror 6 | Editor de Markdown "de verdade" (o mesmo motor do Obsidian), com busca, desfazer e prévia ao vivo da formatação, listas, código e imagens. |
| Grafo | Canvas próprio + layout radial próprio | Posições estáveis (o mapa não "flutua") e um "Reorganizar" que evita cruzamentos; sem biblioteca de física. |
| Estado/estilo | `reactive()` do Vue + CSS com variáveis | Sem Pinia/Tailwind: menos dependências; tema claro/escuro por variáveis CSS. |
| Ícones | SVG próprios | Sem biblioteca de ícones. |

Dependências usadas no app: `nuxt`/`vue`, `@codemirror/*` (editor — na 1.1.0 entrou `@codemirror/language-data`, para colorir o código dos blocos), `electron`, `electron-builder` e `esbuild` (build). Para testes: `vitest`. (O `d3-force` da 1.0.0 saiu: o mapa não usa mais física.) A 1.3.1 não trouxe dependências: o SQLite que lê os favoritos do Firefox/Zen é o do próprio Node.js do Electron (`node:sqlite`), o LZ4 das cópias `.jsonlz4` é um descompactador de ~40 linhas e o PDF é impresso pelo próprio Chromium do Electron.

## Testes

- `npm test` — testes unitários das regras puras (datas, recorrência, tarefas, títulos, nomes de arquivo, formatação, marcação de listas/tarefas, níveis e numeração automática das listas, blocos de código e detecção de linguagem, caminhos das imagens, menções em tarefas e notas (inclusive a tarefas), links refeitos ao mover uma nota de pasta, categorias e `categorias.json`, pastas pelo título, primeira linha como título, nomes de workspace, `mapa.json`, conversão da 1.0.0, grafo, layout sem cruzamentos e compactação, marcação escondida (proteção, formatos guardados, marcações válidas, links), endereços e links repetidos, título e ícone de páginas, favoritos do Chromium/Opera e HTML, `links.json` e plano da importação; na 1.3.1: categoria automática pelo título, exportar TXT e PDF, biblioteca de imagens (uso, cópias iguais, adotar, excluir), favoritos do Firefox/Zen — `profiles.ini`, `places.sqlite`, `.jsonlz4` com LZ4 —, foto das categorias dos Links e ordem pela URL; na 1.3.2: bloco de texto — linhas próprias, formatos cortados, listas, cerca maior, dentro de blocos — e `Ctrl+D` — maiúsculas, palavra inteira, volta ao começo, partes escondidas, só o `Ctrl+D` cria seleções — em `tests/text-blocks-and-multiselect.test.ts`; na 1.4.0: lista dos módulos e tutoriais completos, preferências dos módulos — leitura tolerante, só desativados, nunca todos desligados — em `tests/modules.test.ts`; na 1.4.1: ordem dos módulos — guardada, completa, tolerante, desativados no lugar ao reorganizar, mover para cima/baixo — e o "Botão direito" de cada tutorial em `tests/modules.test.ts`, e versões das notas — número no título, comparação, anterior com pulos, mesma categoria no store — em `tests/note-versions.test.ts`).
- `npm run typecheck` — TypeScript estrito na interface e no Electron.
- Durante o desenvolvimento, o app também foi testado de ponta a ponta dirigindo o Electron real (workspaces, notas, abas, formatação, listas, checklists e numeração automática, código e imagens colados e apagados, menus do clique direito, tarefas recorrentes com datas simuladas e app fechado, menções em tarefas e notas depois de reabrir, categorias criadas/renomeadas/excluídas com imagem e cor nas abas, notas arrastadas para categorias, pastas pelo título, menções a tarefas nas Notas e no Mapa, mapas mentais com conversão da 1.0.0, conexões e notas novas por arraste, cores, vários mapas, layout salvo, fechamento seguro; na 1.3.0: ícones nas categorias, + nas pastas pelo título, fechar notas de categoria sem pergunta, Markdown escondido com teclado, mouse e acentos compostos, links e blocos de código no editor, e o módulo Links inteiro com sites locais de teste e perfis falsos do Brave/Opera; na 1.3.1: as abas das Configurações com o "?", iniciar com o computador (simulado), configurações dos módulos gravadas no workspace, categoria automática pelo título, CAIXA ALTA nas pastas, exportar TXT/PDF (conferido com `pdftotext`), biblioteca de imagens — enviar, escolher, inserir, remover da nota, excluir, `Esc` com modais empilhados —, fotos nas categorias das Notas e dos Links, "Sem categoria", ordem pela URL, importação de perfis falsos do Zen — `places.sqlite` com `-wal` — e do Firefox — só a cópia `.jsonlz4` —, menções a links com o ícone do site, e o tema escuro; na 1.3.2: bloco de texto pela barra — cartão, copiar, editar no cartão, tela cheia, remover e desfazer, listas e negrito, bloco grande com rolagem, tema escuro —, colar texto/listas/trechos longos sem virar bloco (e código continuando a virar), `Ctrl+D` com duplo clique, digitação, `Ctrl+Z`, `Esc`, `Ctrl+clique` e `Ctrl+B`, nas Notas e no Mapa Mental, e o painel das Tarefas fechando ao clicar fora — com os casos que não podem fechar; na 1.4.0: ligar/desligar módulos pelo botão direito e pelas Configurações (quadros da animação, prévia do menu por cima do fundo, último módulo não desliga), dados intactos, `app.json`, "só o ícone", desligar o módulo aberto, `Ctrl+2` e menção para módulo desligado com "Ativar", tutoriais por F1, "?", Configurações e trocando de módulo, tema escuro e reinício do app; na 1.4.1: tela cheia do bloco de texto com a margem do editor, a corrente de versões (`1.4.1` → `1.4.0` → `1.3.2`, ignorando outra categoria) e o botão sumindo, desfoque das Configurações › Módulos começando depois da barra de título e do menu, arrastar no menu lateral e nas Configurações — com módulo desativado, só ícone, `Esc`, clique simples ainda abrindo o módulo —, "Mover para cima" no botão direito, ordem depois de reiniciar, `Ctrl+2` preso às Tarefas, os sons na hora certa e um só em liga/desliga seguidos — e renderizados para medir volume e duração —, o tutorial fechando ao clicar fora e não fechando ao clicar dentro, no **?**, no "Abrir" das Configurações ou arrastando um módulo; na 1.4.2: barra e rodapé do mapa sem o botão de configurações, sem o `Ctrl K` e sem a dica fixa — com `Ctrl+K` ainda indo para a busca —, a engrenagem, e a animação de clique em 14 tipos de ícone (módulos, tema, tutorial, configurações, abas, fechar, reorganizar, zoom, +, blocos de código, lista, opções), pelo teclado, medida quadro a quadro, e os casos que não animam — × de aba, caixa de concluir tarefa, "reduzir movimento"). O instalador do Windows foi testado no Wine (tela "Atalhos", reinstalação e desinstalação).

## Onde mexer para…

| Quero… | Arquivo |
| --- | --- |
| Mudar cores/tema | `app/assets/css/tokens.css` |
| Mudar a regra do título das notas | `app/lib/notes/title.ts` (e `app/lib/editor/title-line.ts`, a primeira linha como título) |
| Mudar as categorias das Notas | `app/lib/notes/categories.ts` (regras e `categorias.json`), `app/stores/notes.ts` (mover, renomear, excluir), `app/components/notes/NoteCategoryDialog.vue` |
| Mudar a lista lateral / as pastas pelo título | `app/components/notes/NotesSidebar.vue`, `NoteTreeRow.vue`, `app/lib/notes/title-tree.ts` |
| Mudar como a recorrência calcula datas | `app/lib/tasks/recurrence.ts` |
| Mudar a aparência/interações do mapa | `app/lib/mindmap/graph-view.ts` |
| Mudar o "Reorganizar o mapa" | `app/lib/mindmap/layout.ts` |
| Mudar a barra/regras de formatação | `app/components/editor/FormatToolbar.vue`, `app/lib/editor/formatting.ts` (inclusive os links no texto) |
| Mudar títulos/listas/checklists no editor | `app/lib/editor/markdown-preview.ts` (desenho), `app/lib/editor/line-markers.ts` (leitura da marcação) |
| Ajustar a detecção de código colado | `app/lib/editor/code-detect.ts` (linguagens: `languages.ts`) |
| Mudar o cartão do bloco de código / as cores do código | `app/lib/editor/code-blocks.ts`, `app/lib/editor/theme.ts` (`--code-*` em `tokens.css`) |
| Mudar o bloco de texto | `app/lib/editor/text-blocks.ts` (criar a partir da seleção), `app/lib/editor/code-blocks.ts` (cartão), `.cm-textblock` em `app/lib/editor/theme.ts`, `CodeFullscreen.vue` (tela cheia) |
| Mudar o `Ctrl+D` (várias ocorrências) | `app/lib/editor/multi-select.ts` |
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
| Mudar a versão anterior das notas | `app/lib/notes/versions.ts` (regra), `previousVersionOf` em `app/stores/notes.ts` (grupo), `NotesTabs.vue` (botão) |
| Mudar o painel dos tutoriais | `app/components/shell/TutorialPanel.vue`, `app/composables/useTutorial.ts` |
| Mudar a categoria automática pelo título | `app/lib/notes/auto-category.ts` (regra), `app/stores/notes.ts` (`considerAutoCategory`) |
| Mudar as menções | `app/lib/tasks/mentions.ts` (tarefas), `app/lib/editor/mentions.ts` + `app/lib/notes/mention-links.ts` (notas), `app/stores/mentions.ts` (ponte) |
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
