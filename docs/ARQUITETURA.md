# Arquitetura do 4notes

Este documento explica, de forma didática, como o 4notes funciona por dentro: como o **Nuxt** é usado, o que transforma o projeto em um **aplicativo desktop**, como os **arquivos** são lidos e salvos e como funcionam **tarefas recorrentes** e o **Mapa Mental**.

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
│  ├─ window.ts     janela, fechar seguro      │                Mapa Mental    │
│  ├─ protocol.ts   interface + imagens        ├─ components/  telas e peças   │
│  ├─ ipc.ts        atende os pedidos  ◀─IPC─▶ ├─ stores/      estado          │
│  ├─ files.ts      lê/grava arquivos          ├─ lib/         regras + disco  │
│  ├─ data-dir.ts   workspaces                 │                               │
│  └─ config.ts     preferências da máquina    └─ window.fourNotes  ◀── preload│
│         │                                         (electron/preload.ts)      │
└─────────┼────────────────────────────────────────────────────────────────────┘
          ▼
   WORKSPACE (pasta criada/escolhida por você)  %APPDATA%\4notes\config.json
   ├── notes/*.md                               (qual workspace abrir, tema, janela)
   ├── tasks/tasks.json
   ├── mindmap/<mapa>/ (.md + mapa.json)
   ├── attachments/ (imagens das notas)
   └── .4notes/
```

### Camadas

| Camada                       | Onde                                                          | Responsabilidade                                                                 |
| ---------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Interface                    | `app/pages`, `app/components`                                 | O que você vê e clica. Não sabe onde os arquivos ficam.                          |
| Estado da aplicação          | `app/stores/*.ts`                                             | Dados em memória de cada módulo + ações (criar, editar, salvar…).                |
| Lógica pura                  | `app/lib/dates.ts`, `app/lib/tasks/`, `app/lib/notes/title.ts`, `app/lib/mindmap/`, `app/lib/editor/` | Regras sem Vue e sem disco (títulos, recorrência, formatação, prévia do Markdown, listas, detecção de código, menções, conexões, layout do mapa). Testadas em `tests/`. |
| Persistência                 | `app/lib/*/repository.ts`, `app/lib/storage/`                 | Sabe **onde** e **em que formato** cada coisa é salva.                           |
| Sistema de arquivos          | `electron/files.ts`, `electron/data-dir.ts`                   | Leitura/escrita real no disco (Node.js), protegida.                              |
| Renderização do mapa         | `app/lib/mindmap/graph-view.ts`                               | Desenho em `<canvas>`, câmera, arrastar/conectar, animações.                     |
| Camada desktop               | `electron/`                                                   | Janela, protocolo, menus, IPC, segurança.                                        |

### Independência dos módulos

Cada módulo tem seu próprio store, repositório, pasta e componentes:

```
Notas        → stores/notes.ts   → lib/notes/   → notes/*.md
Tarefas      → stores/tasks.ts   → lib/tasks/   → tasks/tasks.json
Mapa Mental  → stores/mindmap.ts → lib/mindmap/ → mindmap/<mapa>/*.md + mapa.json (conexões e cores)
```

Os módulos não importam uns aos outros. Eles compartilham **infraestrutura** (editor de Markdown, ícones, diálogos, a API de arquivos) e `stores/app.ts` conhece os três só para tarefas gerais: carregar tudo ao abrir, salvar tudo antes de fechar e reler os arquivos quando você volta para a janela.

A **única ligação** entre módulos é a que foi pedida: **menções a notas** — tarefas (1.1.0) e notas rápidas (1.1.1) podem mencionar notas das Notas ou de qualquer mapa. Ela é explícita e fica num lugar só (ver item 10):

```
Notas / Mapa Mental ──(avisam "nota renomeada")──▶ lib/note-events.ts
                                                        │
stores/mentions.ts  ◀───────────────────────────────────┘   lista notas, abre a nota da menção,
       │                                                    corrige menções após renomear
       ▼
stores/tasks.ts → tasks.json ("mentions": [...])
stores/notes.ts → links [Título](Título.md) no texto das notas (rewriteContents)
```

Notas e Mapa Mental não sabem quem os menciona: só publicam o aviso de renomeação (as Notas oferecem uma função genérica para reescrever o texto das notas, que a ponte usa).

---

## 1. Como o Nuxt está sendo utilizado

O Nuxt roda em modo **SPA** (Single Page Application), configurado em `nuxt.config.ts`:

```ts
ssr: false
```

Isso significa:

- **Não existe servidor em produção.** `nuxt generate` gera arquivos estáticos (`.output/public/index.html` + JavaScript/CSS em `_nuxt/`). O Electron carrega esses arquivos.
- O Nuxt continua oferecendo o que tem de melhor para organizar a interface:
  - **Rotas por arquivo**: `app/pages/notes.vue` → `/notes`, `tasks.vue` → `/tasks`, `mindmap.vue` → `/mindmap`. O `<NuxtPage :keepalive>` mantém as três telas vivas ao alternar (o editor não perde o histórico de desfazer e o mapa não recalcula).
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

**Menus do clique direito**: todos são desenhados pela interface (`components/shell/ContextMenuHost.vue` + `composables/useContextMenu.ts`), com o tema do app, submenus, atalhos e teclado (↑ ↓ → ← Enter Esc) — não há mais menus nativos. O menu de texto do editor chega pelo canal `menu:text` (com as sugestões do corretor) e a ação escolhida volta por `menu:text-action` (o Electron executa recortar/copiar/colar e o corretor; desfazer/refazer usam o histórico do próprio editor). O menu não tira o foco de onde ele está, então "Colar" cola no lugar certo.

Por que um protocolo próprio em vez de `file://`? Com `file://`, caminhos como `/_nuxt/app.js` apontariam para a raiz do disco e as rotas quebrariam. O `app://` se comporta como um site normal, mas lendo arquivos de dentro do app instalado.

Um segundo protocolo, **`workspace://files/<caminho>`**, mostra as **imagens das notas** (`attachments/…`). Ele só entrega arquivos de imagem (`png`, `jpg`, `gif`, `webp`, `bmp`, `avif`, `svg`) e só de dentro do workspace aberto — a interface continua sem acesso livre ao disco. A *Content-Security-Policy* libera esse endereço apenas para imagens (`img-src`).

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
- **`electron/files.ts`** — faz o trabalho real com `fs` do Node.js (inclusive `saveImage`, que grava as imagens coladas em `attachments/` com nome único e limite de 40 MB, e `removeImage`/`restoreImage`, que apagam uma imagem removida da nota e a devolvem no Desfazer).

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
│   ├── Ideias de jogo.md
│   └── Lista de compras.md
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
├── attachments/                Imagens coladas nas notas (imagem-20261002-141503.png)
└── .4notes/                    Estado da interface (pode ser apagado sem perder dados)
    ├── notes.json              abas abertas, aba ativa, lista lateral visível
    ├── mindmap.json            mapa aberto, posições dos nós de cada mapa e ajustes
    ├── app.json                último módulo aberto
    └── backups/                tasks-segunda.json … tasks-domingo.json (7 dias) e conversões do mapa
```

Formatos escolhidos:

| Conteúdo | Formato | Por quê |
| --- | --- | --- |
| Notas rápidas e permanentes | Markdown (`.md`) | Texto puro, abre em qualquer editor, é o padrão do Obsidian, fácil de versionar e fazer backup. |
| Tarefas | JSON | Dados estruturados (datas, regras de recorrência, histórico). JSON é robusto de ler/gravar e ainda editável à mão. Markdown com metadados seria frágil. |
| Conexões e cores do mapa | JSON (`mapa.json`, um por mapa) | O texto das notas fica limpo (sem `[[referências]]`) e as setas ficam num lugar só, fácil de ler. |
| Imagens das notas | Arquivos em `attachments/` + `![](../attachments/x.png)` na nota | A imagem fica no workspace (backup = copiar a pasta) e o caminho relativo também funciona no Obsidian/VS Code. |
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

Um **workspace é uma pasta de dados**, e o **nome do workspace é o nome da pasta** — não existe um segundo cadastro de nomes que possa ficar diferente do que você vê no Explorador. O nome aparece no canto superior esquerdo (`components/shell/TitleBar.vue`); clicar nele abre o menu **Abrir outro workspace… / Criar workspace… / Mostrar no Explorador**. As mesmas ações ficam em **Configurações → Workspace**.

**Primeira execução** — não existe `dataDir` no `config.json`, então aparece a tela de boas-vindas (`components/shell/WelcomeScreen.vue`) com **Criar workspace** e **Abrir workspace existente**. Não existe pasta sugerida nem pré-definida.

**Criar workspace** (`stores/app.ts → createWorkspace`):

1. `dataDir.pick()` abre o seletor de pastas nativo para você escolher **onde** criar.
2. Um diálogo pede o **nome**. A validação (`workspaceNameProblem` em `shared/ipc.ts`) é a mesma nos dois lados: nada de `< > : " / \ | ? *`, ponto/espaço no fim ou nomes reservados do Windows (`CON`, `NUL`…).
3. `dataDir.create(local, nome)` → `electron/data-dir.ts → createWorkspace` cria `<local>/<nome>/` com `notes/`, `tasks/`, `mindmap/`, `attachments/` e `.4notes/` e grava o caminho no `config.json`. Se já existir uma pasta com esse nome **e com arquivos**, nada é tocado: aparece um aviso e o nome é pedido de novo.
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

**Nome do arquivo = título**, adaptado ao que o Windows aceita (`lib/files/filename.ts`): remove `<>:"/\|?*`, pontos/espaços no fim, nomes reservados (`CON`, `NUL`…) e limita a 80 caracteres. Títulos repetidos viram `Ideias (2).md`.

**Linha do tempo de um salvamento**:

1. Você digita → a nota fica "com alterações pendentes" (ponto roxo na aba).
2. 0,6 s depois da última tecla, o salvamento acontece.
3. Se o título mudou, o arquivo é **renomeado** antes de gravar (`notes/Rascunho.md` → `notes/Ideias.md`).
4. Uma fila por nota garante que dois salvamentos nunca se atropelem.

Também salva **na hora**: ao fechar a aba, com `Ctrl+S` e **ao fechar o app** — a janela só fecha depois que a interface confirma que gravou tudo (com limite de 4 s para nunca travar).

Outros detalhes:

- O **X da aba** pergunta o que fazer: **Guardar nota** (fecha só a aba; a nota continua na lista) ou **Apagar nota** (vai para a Lixeira, com Desfazer). `Ctrl+W` e o clique do meio fecham a aba guardando a nota, como antes.
- Com muitas abas, a faixa rola na horizontal (roda do mouse ou a barra fina no topo) e o botão **+** fica sempre visível.
- Uma aba nova e vazia **não cria arquivo** (como no Bloco de Notas).
- As abas abertas ficam em `.4notes/notes.json` e são restauradas na próxima vez.
- Excluir manda o arquivo para a **Lixeira**, com botão **Desfazer**.
- Editou o `.md` em outro programa? Ao voltar para a janela do 4notes, o conteúdo é recarregado (se você não tinha alterações pendentes naquela nota). Arquivos criados por fora aparecem na lista.

### Formatação do texto (Notas e Mapa Mental)

Arquivos: `app/lib/editor/formatting.ts` (regras), `app/components/editor/FormatToolbar.vue` (barra) e `app/lib/editor/setup.ts` (monta o editor com todas as extensões abaixo).

Ao selecionar um trecho aparece a barra de formatação: negrito, itálico, sublinhado, tachado, cor do texto, marca-texto, título, lista, lista de tarefas, código, link e "limpar formatação". O arquivo continua sendo Markdown comum:

```
**negrito**   *itálico*   ~~tachado~~   ==marca-texto==   `código`
<u>sublinhado</u>   <span style="color: red">colorido</span>
```

Sublinhado e cor não existem no Markdown; o HTML simples é o jeito mais compatível (o Obsidian também mostra). As cores são as da paleta do app (`lib/colors.ts`), gravadas com nomes que também são cores válidas do CSS, e no editor seguem o tema claro/escuro.

**Prévia ao vivo**: as marcações ficam escondidas. As do Markdown (`**`, `~~`…) aparecem quando o cursor encosta no trecho (como no Obsidian), então dá para editá-las como texto. As tags HTML de sublinhado e cor **nunca aparecem** — são longas, e mostrá-las ao clicar faria o texto "pular" sob o mouse. Para elas funcionarem como num editor visual, o editor as protege:

- o cursor passa por cima delas (←/→ andam sempre um caractere visível);
- digitar, colar ou apagar mexe só no texto em volta, nunca em parte de uma tag;
- `Backspace`/`Delete` encostados numa tag apagam o caractere visível do outro lado;
- `Enter` no meio de um trecho colorido fecha a cor nesta linha e a reabre na próxima;
- um trecho que fica sem texto some junto com as tags;
- copiar parte de um trecho colorido leva a cor junto.

Aplicar um formato em parte de um trecho já formatado divide o trecho; aplicar em trechos vizinhos junta tudo (`**ab**cd` + negrito em `cd` → `**abcd**`). Tirar ou trocar um formato respeita os outros formatos do trecho (`<span…><u>texto</u></span>` sem a cor vira `<u>texto</u>`).

O **marca-texto** usa um rosa translúcido (`--mark` em `tokens.css`), bem diferente do roxo da **seleção** (`--selection`), para não confundir texto destacado com texto selecionado.

### Títulos, listas e checklists — `markdown-preview.ts`, `lists.ts`

A marcação do começo da linha (`#`, `>`, `-`, `1.`, `- [ ]`) é lida da árvore de sintaxe do Markdown (`lineMarkerAt`) e trocada por um desenho: nada (títulos e citações), um marcador `•` / `1.` (listas) ou uma **caixa clicável** (tarefas). Ela só aparece como texto quando você **entra nela pelo teclado** (`Home` duas vezes, `←` no começo do texto) — clicar no texto nunca faz a linha "pular", porque seleções feitas com o mouse não revelam a marcação (e um clique antes do marcador vai para o começo do texto).

- **Enter** continua a lista (a tarefa nova começa desmarcada); **Enter** num item vazio sai da lista; **Tab** transforma o item em subitem do item de cima e **Shift+Tab** volta um nível — a indentação acompanha o marcador de cima (2 espaços para `-`, 3 para `1.`, senão o Markdown não aninha) e o item leva os subitens junto; **Backspace** no começo do texto sobe um nível ou transforma o item em texto comum; **Home** vai primeiro para o começo do texto.
- **Clicar na caixa** troca `[ ]` ↔ `[x]` no arquivo (`toggleTaskAt`), sem mexer no cursor; a tarefa feita fica riscada.
- Links `[texto](endereço)` mostram só o texto até o cursor encostar neles; `---` vira uma linha horizontal.

O arquivo continua sendo Markdown puro — a prévia só muda o desenho.

**Listas numeradas em sequência** (`lists.ts`): depois de cada edição sua, as listas numeradas que a edição alcançou são renumeradas na mesma transação (um Ctrl+Z desfaz tudo junto). O número inicial é o que você digitou no primeiro item; se você não mexeu nele (ex.: apagou o item 1), vale o número com que a lista começava. Um detalhe do Markdown: logo depois de um parágrafo, só "1." começa uma lista — por isso, quando apagar o item 1 faz o resto "deixar de ser lista", a numeração é refeita a partir da lista de antes. Desfazer/refazer e mudanças vindas do disco não são renumeradas.

### Blocos de código — `code-detect.ts`, `code-blocks.ts`, `languages.ts`

- **Colar código** (`paste.ts`) cria um bloco ` ```linguagem `. Se o texto veio do VS Code, a linguagem vem junto na área de transferência; senão `code-detect.ts` decide por pontuação de padrões (palavras-chave, símbolos, indentação) com proteções contra falsos positivos (texto comum, Markdown, listas). Precisa de pelo menos 2 linhas; `Ctrl+Shift+V` cola como texto comum.
- Fora da edição, o bloco é um **cartão** (widget do CodeMirror) com a linguagem, os botões **Copiar**, **Tela cheia** e **Remover bloco**, e o código colorido com **altura máxima e rolagem interna**. Clicar no código mostra as linhas reais (com as cercas) para editar ali mesmo.
- **Tela cheia** (`components/editor/CodeFullscreen.vue`) é um segundo editor com a linguagem do bloco; cada alteração é gravada de volta no bloco (`replaceBlockCode`), então desfazer/salvar funcionam como no resto da nota. **Remover bloco** apaga o bloco inteiro de uma vez, com **Desfazer** no aviso.
- As cores vêm de `@codemirror/language-data`: a lista oficial de linguagens do CodeMirror, que **carrega cada linguagem só quando ela aparece** numa nota. GDScript (Godot) não está na lista e foi adicionado em `languages.ts` como um modo simples.

### Imagens — `images.ts`, `paste.ts`, `host.ts`

1. Colar um print (ou soltar um arquivo de imagem) chama `attachments.saveImage` → o Electron grava `attachments/imagem-AAAAMMDD-HHMMSS.png` no workspace.
2. A nota recebe `![](../attachments/imagem-….png)` — caminho **relativo à pasta da nota** (`relativeTo`), por isso a nota também abre certo no Obsidian/VS Code e o workspace pode mudar de lugar.
3. Para mostrar, `resolveFromNote` transforma o caminho da nota em caminho do workspace (recusando endereços que saiam dele) e a imagem é carregada por `workspace://files/…`.

Com o cursor fora da linha, aparece só a imagem; com o cursor na linha, aparece também o texto Markdown.

**Remover** (botão sobre a imagem) tira a imagem da nota e chama `attachments.removeImage`: se nenhuma outra nota (.md em `notes/` e `mindmap/`) cita o arquivo, ele vai para a Lixeira — o conteúdo fica guardado na memória durante a sessão. **Desfazer** (no aviso ou com Ctrl+Z) devolve o texto e o arquivo (`restoreImage`): quando uma imagem apagada nesta sessão volta para a nota, o arquivo é regravado no mesmo lugar.

### Menções a outras notas — `mentions.ts`, `lib/notes/mention-links.ts`

Nas Notas, digitar **`@`** abre a lista de notas (Notas e todos os mapas, sem a própria nota). A escolhida entra como um **link Markdown comum** para o `.md` dela, relativo à pasta da nota — `[Ideias](Ideias.md)` ou `[Godot](../mindmap/Principal/Godot.md)` —, então o arquivo continua legível e o link funciona no Obsidian/VS Code. No editor, o link vira um **chip** com o título atual da nota (um bloco só: o cursor passa por cima e Backspace apaga a menção inteira); clicar abre a nota no módulo dela. Uma nota que não existe mais aparece riscada. O editor do Mapa Mental não tem menções (lá as relações são as setas).

Os caminhos dos links codificam só o que quebraria o link (espaços, parênteses, `#`…) e mantêm os acentos legíveis (`lib/files/workspace-path.ts`).

As extensões do editor não conhecem Vue nem IPC: tudo que precisa do app (salvar e apagar imagens, endereço da imagem, abrir a tela cheia, mostrar aviso, listar e abrir notas mencionadas) passa pela interface `EditorHost` (`host.ts`), que o `MarkdownEditor.vue` fornece.

---

## 7. Como as notas permanentes do Mapa Mental são salvas

Arquivo: `app/stores/mindmap.ts` (+ `app/lib/mindmap/model.ts` e `repository.ts`).

- Você pode ter **vários mapas**: cada um é uma pasta em `mindmap/`, com as próprias notas e conexões. O seletor no canto superior esquerdo do mapa cria, renomeia (renomeia a pasta), mostra no Explorador e exclui mapas (a pasta vai para a Lixeira; sempre sobra pelo menos um). Só o mapa aberto fica na memória; trocar de mapa salva tudo antes.
- Cada **nó é um arquivo** `mindmap/<Mapa>/<Título>.md`, só com o texto. Aqui o **título é o nome do arquivo**, então ele é único dentro do mapa — o próprio sistema de arquivos garante isso.
- As **conexões e cores** ficam no `mapa.json` do mapa (salvo 0,3 s depois de cada mudança).
- Clicar em um nó abre o **painel da nota** à direita: a cor (bolinha ao lado do título), o título (editável), o editor e a lista de conexões (clique para abrir, × para remover).
- Salvamento automático **0,5 s** após parar de digitar, com a mesma escrita atômica e a mesma fila por nota.
- **Renomear**: renomeia o arquivo e atualiza as conexões, a cor e a posição do nó.
- **Excluir** (menu do nó, painel ou `Delete` com a nota selecionada no mapa): o arquivo vai para a Lixeira e as conexões dela saem do `mapa.json` (o Desfazer devolve tudo).

**Vindo da 1.0.0**: na 1.0.0 as notas ficavam soltas em `mindmap/` e as conexões eram `[[links]]` dentro do texto. Na primeira abertura da 1.0.1, `repository.migrateLegacy()` copia as notas originais para `.4notes/backups/mindmap-1.0.0-<data>/`, move tudo para o mapa `Principal`, transforma cada `[[link]]` para uma nota existente numa conexão do `mapa.json` e tira a marcação do texto (`Veja [[Godot]]` → `Veja Godot`; linhas que eram só links saem). As posições dos nós são aproveitadas. As regras ficam em `lib/mindmap/migration.ts` (testadas).

---

## 8. Como funcionam as tarefas recorrentes

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
- Interações: zoom com a roda (em direção ao cursor), arrastar o fundo para mover a câmera, arrastar um nó para movê-lo, Shift + arrastar para conectar, clique abre a nota, duplo clique ou botão direito no vazio criam uma nota ali, botão direito no nó abre o menu (renomear, cor, excluir…).
- Ajustes: esconder notas sem conexões e nós em **cards** (padrão, com o nome dentro) ou **círculos** (estilo Obsidian). Nos círculos, os nomes aparecem **só na nota selecionada** (padrão), conforme o zoom ou sempre.
- Os ajustes ficam em `.4notes/mindmap.json` com `settingsVersion`: na primeira abertura da 1.1.0, os ajustes gravados pelas versões anteriores (que sempre salvavam os padrões antigos) passam para os novos padrões — cards e nomes ao selecionar — uma única vez.

---

## 10. Menções a notas (tarefas e notas)

Arquivos: `app/lib/tasks/mentions.ts` (formato e regras), `app/stores/mentions.ts` (ponte entre os módulos), `app/lib/note-events.ts` (avisos de renomeação), `components/tasks/NotePicker.vue` e `MentionChip.vue`.

- Digitar **`@`** na barra de criação rápida, no título ou nos detalhes da tarefa abre a lista de notas (`composables/useMentionTrigger.ts`); o botão **Mencionar nota** do painel abre a mesma lista com busca. Entram as notas das Notas e de **todos os mapas** (as dos mapas fechados são listadas direto da pasta, sem carregá-los).
- A menção é salva **na tarefa**, no `tasks.json`, como uma referência estruturada — onde a nota está + o último título conhecido:
  `{ "kind": "note", "path": "notes/Ideias.md", "title": "Ideias" }` ou `{ "kind": "map", "map": "Principal", "note": "Godot.md", "title": "Godot" }`.
  O texto da tarefa fica limpo (`@ide` vira `Ideias de jogo`); a menção aparece como um chip.
- **Clicar no chip** abre a nota no módulo dela (troca de mapa se precisar). Se a nota não existir mais, aparece um aviso — a tarefa não é alterada.
- **Dentro das Notas**, a menção é um link Markdown no texto (ver "Menções a outras notas" no item 6).
- **Renomear no app** (título de uma nota rápida, nota ou mapa do Mapa Mental) publica um aviso em `note-events.ts`; o store de menções corrige as tarefas afetadas (o `tasks.json` é salvo) e reescreve os links das notas rápidas que citam a nota (`renameMentionLinks`; o texto do link acompanha o novo título). Por isso a referência continua funcionando depois de fechar e reabrir o app. Arquivos renomeados **por fora** do app não têm como ser acompanhados: o chip mostra o último título conhecido e avisa ao clicar.

---

## 11. Como gerar uma nova versão/build

1. Aumente a versão no `package.json` (ex.: `"version": "1.1.1"`).
2. Rode:

   ```bash
   npm run dist:win
   ```

3. O instalador aparece em `release/1.1.1/4notes-Setup-1.1.1.exe`.

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

## 12. Como instalar em outro computador

1. Leve o arquivo `4notes-Setup-<versão>.exe` (pendrive, nuvem…) e execute.
   - O instalador não é **assinado digitalmente** (isso exige um certificado pago). O Windows SmartScreen pode avisar: clique em **Mais informações → Executar assim mesmo**.
   - A instalação é por usuário (não pede administrador), cria atalhos na Área de Trabalho e no Menu Iniciar e permite escolher a pasta de instalação.
2. Na primeira abertura:
   - **Começar do zero**: **Criar workspace** (escolha o local e dê um nome);
   - **Levar seus dados**: copie a pasta do workspace para o outro computador e use **Abrir workspace existente**;
   - **Usar nos dois computadores**: deixe o workspace numa pasta sincronizada (OneDrive, Google Drive…) e abra-o nos dois. Use um computador de cada vez para evitar conflitos de sincronização.

Para gerar o instalador em outra máquina (para desenvolver lá), instale o Node.js 22+, copie o projeto (sem `node_modules`) e rode `npm install` + `npm run dist:win`.

---

## Decisões de arquitetura (resumo)

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Camada desktop | Electron + electron-builder | Tudo em TypeScript; compila no Windows só com Node.js. |
| Nuxt | SPA (`ssr: false`) servida por `app://` | Não há servidor; rotas e caminhos funcionam como num site. |
| Comunicação | IPC com contrato tipado (`shared/ipc.ts`) | Interface isolada do Node.js; erros de contrato pegos pelo TypeScript. |
| Notas | `.md`, nome do arquivo = título da primeira linha | Arquivos que fazem sentido ao abrir a pasta; sem formato proprietário. |
| Notas permanentes | Uma pasta por mapa: `.md` (só texto) + `mapa.json` (conexões e cores) | Texto limpo; conexões explícitas, fáceis de criar arrastando e de remover. |
| Formatação | Markdown + HTML simples (`<u>`, `<span style="color">`), marcações escondidas no editor | Continua texto puro e compatível com o Obsidian, com aparência de editor visual. |
| Workspaces | Workspace = pasta de dados; nome = nome da pasta | Nada de cadastro paralelo de nomes; qualquer pasta abre; backup continua sendo copiar a pasta. |
| Imagens | `attachments/` + caminho relativo + protocolo `workspace://` só para imagens | Imagens junto dos dados, notas compatíveis com outros editores, interface sem acesso livre ao disco. |
| Blocos de código | Detecção própria por padrões + `@codemirror/language-data` | Sem serviço externo; cores para dezenas de linguagens, cada uma carregada só quando usada. |
| Tarefas | Um `tasks.json` | Dados estruturados; gravação atômica de tudo de uma vez; fácil de fazer backup. |
| Menções | Tarefas: referência estruturada no `tasks.json`. Notas: link Markdown relativo para o `.md`. Renomear no app avisa a ponte, que corrige as duas | Abre a nota certa depois de reabrir o app; o texto das notas continua Markdown comum; a ligação entre módulos fica explícita e num lugar só. |
| Menus | Componente próprio (`ContextMenuHost.vue`); o Electron só manda os dados do menu de texto | Visual do 4notes no claro e no escuro, com submenus e teclado; foco continua no editor. |
| Imagens removidas | Lixeira + cópia na memória durante a sessão | O arquivo sai do workspace, mas Desfazer/Ctrl+Z devolvem tudo. |
| Recorrência | Data da próxima ocorrência + regra, calculado ao abrir | Funciona com o app fechado, sem processo em segundo plano. |
| Estado da interface | `.4notes/` | Separado dos dados; pode ser apagado. |
| Editor | CodeMirror 6 | Editor de Markdown "de verdade" (o mesmo motor do Obsidian), com busca, desfazer e prévia ao vivo da formatação, listas, código e imagens. |
| Grafo | Canvas próprio + layout radial próprio | Posições estáveis (o mapa não "flutua") e um "Reorganizar" que evita cruzamentos; sem biblioteca de física. |
| Estado/estilo | `reactive()` do Vue + CSS com variáveis | Sem Pinia/Tailwind: menos dependências; tema claro/escuro por variáveis CSS. |
| Ícones | SVG próprios | Sem biblioteca de ícones. |

Dependências usadas no app: `nuxt`/`vue`, `@codemirror/*` (editor — na 1.1.0 entrou `@codemirror/language-data`, para colorir o código dos blocos), `electron`, `electron-builder` e `esbuild` (build). Para testes: `vitest`. (O `d3-force` da 1.0.0 saiu: o mapa não usa mais física.)

## Testes

- `npm test` — testes unitários das regras puras (datas, recorrência, tarefas, títulos, nomes de arquivo, formatação, marcação de listas/tarefas, níveis e numeração automática das listas, blocos de código e detecção de linguagem, caminhos das imagens, menções em tarefas e notas, nomes de workspace, `mapa.json`, conversão da 1.0.0, grafo, layout sem cruzamentos e compactação).
- `npm run typecheck` — TypeScript estrito na interface e no Electron.
- Durante o desenvolvimento, o app também foi testado de ponta a ponta dirigindo o Electron real (workspaces, notas, abas, formatação, listas, checklists e numeração automática, código e imagens colados e apagados, menus do clique direito, tarefas recorrentes com datas simuladas e app fechado, menções em tarefas e notas depois de reabrir, mapas mentais com conversão da 1.0.0, conexões e notas novas por arraste, cores, vários mapas, layout salvo, fechamento seguro). O instalador do Windows foi testado no Wine (tela "Atalhos", reinstalação e desinstalação).

## Onde mexer para…

| Quero… | Arquivo |
| --- | --- |
| Mudar cores/tema | `app/assets/css/tokens.css` |
| Mudar a regra do título das notas | `app/lib/notes/title.ts` |
| Mudar como a recorrência calcula datas | `app/lib/tasks/recurrence.ts` |
| Mudar a aparência/interações do mapa | `app/lib/mindmap/graph-view.ts` |
| Mudar o "Reorganizar o mapa" | `app/lib/mindmap/layout.ts` |
| Mudar a barra/regras de formatação | `app/components/editor/FormatToolbar.vue`, `app/lib/editor/formatting.ts` |
| Mudar títulos/listas/checklists no editor | `app/lib/editor/markdown-preview.ts` (desenho), `app/lib/editor/line-markers.ts` (leitura da marcação) |
| Ajustar a detecção de código colado | `app/lib/editor/code-detect.ts` (linguagens: `languages.ts`) |
| Mudar o cartão do bloco de código / as cores do código | `app/lib/editor/code-blocks.ts`, `app/lib/editor/theme.ts` (`--code-*` em `tokens.css`) |
| Mudar como as imagens são salvas/mostradas | `electron/files.ts` (`saveImage`), `app/lib/editor/images.ts`, `app/lib/editor/paste.ts` |
| Mudar as menções a notas | `app/lib/tasks/mentions.ts` (tarefas), `app/lib/editor/mentions.ts` + `app/lib/notes/mention-links.ts` (notas), `app/stores/mentions.ts` (ponte) |
| Mudar Tab/Shift+Tab ou a numeração das listas | `app/lib/editor/lists.ts` |
| Mudar os menus do clique direito | `app/components/shell/ContextMenuHost.vue`, `app/composables/useContextMenu.ts` |
| Mudar a criação/abertura de workspaces | `app/stores/app.ts`, `electron/data-dir.ts` |
| Adicionar um novo pedido ao "lado desktop" | `shared/ipc.ts` → `electron/preload.ts` → `electron/ipc.ts` |
| Mudar o instalador | `electron-builder.yml`, `build/installer.nsh` (tela "Atalhos") |
