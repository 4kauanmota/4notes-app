# 4notes

Aplicativo desktop pessoal de organização: **Notas** rápidas em abas, **Tarefas** com categorias e recorrência, **Mapas Mentais** de notas permanentes conectadas por setas e **Links** salvos em categorias — tudo salvo em arquivos comuns, em **workspaces** (pastas) que você cria e nomeia.

- 100% local: sem login, sem servidor, sem banco de dados.
- Arquivos legíveis: Markdown (`.md`) para notas e JSON para tarefas, conexões do mapa e links.
- Editor que esconde o Markdown: você vê só o texto formatado — títulos, listas e checklists de verdade, negrito, links, blocos de código coloridos, imagens coladas (prints) — e nunca os `**`, `#` ou as cercas dos blocos.
- Formatação ao selecionar texto (negrito, itálico, sublinhado, cor, marca-texto, link, listas…).
- Notas em **categorias** (pastas com cor e um ícone pronto ou uma foto) e agrupadas em pastas pelo título, com **+** para criar a nota direto na pasta. Exporte uma nota como **TXT** ou **PDF**.
- **Links**: cole um endereço e pronto — o título e o ícone do site chegam sozinhos. Categorias com cor, ícone ou foto, busca, ordem pela URL e importação dos favoritos do navegador (inclusive Firefox e Zen).
- **Biblioteca de imagens**: toda imagem enviada ao 4notes fica guardada para usar de novo — numa nota, numa categoria das Notas ou dos Links.
- Notas mencionam notas, tarefas e links salvos (`@`); tarefas mencionam notas — um clique abre.
- Tema claro e escuro, em roxo e amarelo.

> Como tudo funciona por dentro (Nuxt + Electron, arquivos, recorrência, mapa, links): veja **[docs/ARQUITETURA.md](docs/ARQUITETURA.md)**.

---

## Requisitos

- **Node.js 22 LTS** (22.12 ou mais recente) — confira com `node -v`
- Windows 10/11 (também roda em macOS e Linux)

## Rodando em modo de desenvolvimento

```bash
npm install      # instala as dependências e baixa o Electron (só na primeira vez)
npm run dev      # abre o 4notes com recarregamento automático
```

- Alterou algo em `app/` (interface)? A janela atualiza sozinha.
- Alterou algo em `electron/`? O Electron reinicia sozinho.
- `F12` abre as ferramentas de desenvolvedor (só no modo dev).

## Gerando o instalador do Windows

```bash
npm run dist:win
```

O instalador fica em `release/<versão>/4notes-Setup-<versão>.exe`. Para uma nova versão, aumente o campo `"version"` do `package.json` antes (ex.: `1.0.1` → `1.1.0`).

Outros comandos:

| Comando             | O que faz                                                           |
| ------------------- | ------------------------------------------------------------------- |
| `npm run dev`       | Desenvolvimento (Nuxt + Electron com recarregamento)                |
| `npm start`         | Compila e abre a versão de produção sem instalar                    |
| `npm run dist:win`  | Gera o instalador `.exe` (NSIS)                                     |
| `npm run dist`      | Gera o instalador para o sistema atual                              |
| `npm test`          | Testes da lógica (datas, recorrência, editor, código, menções, categorias, mapa, links, exportar, biblioteca, favoritos)|
| `npm run typecheck` | Verificação de tipos (TypeScript) da interface e do Electron        |

## Instalando em outro computador

1. Copie o `4notes-Setup-<versão>.exe` para o outro computador e execute. Na tela **Atalhos**, escolha se quer um atalho na área de trabalho (o do Menu Iniciar é sempre criado).
2. O instalador não é assinado digitalmente, então o Windows pode mostrar _"O Windows protegeu o computador"_: clique em **Mais informações → Executar assim mesmo**.
3. Na primeira abertura, crie um workspace (ou abra um que você copiou). Para levar seus dados junto, copie a pasta do workspace inteira antes (ou use uma pasta sincronizada, como OneDrive).

Desinstalar o app **não** apaga os workspaces.

## Workspaces (onde ficam os dados)

Um **workspace** é uma pasta com todos os dados: notas, tarefas, mapas, links e imagens. O nome dele é o nome da pasta e aparece no canto superior esquerdo — clique nele para trocar de workspace.

- **Criar workspace**: você escolhe o local (não existe pasta sugerida) e digita o nome; o 4notes cria lá dentro uma pasta com esse nome e guarda tudo nela.
- **Abrir workspace**: escolha qualquer pasta. Se ela já tiver dados do 4notes, eles aparecem; se estiver vazia, vira um workspace novo (dá para copiar os dados do workspace atual para ela).
- As mesmas opções ficam em **Configurações → Geral → Workspace**.

```
<local escolhido>/
└── Pessoal/                 O workspace (pasta com o nome que você deu)
    ├── notes/               Notas rápidas — um .md por nota (o nome do arquivo segue o título)
    │   ├── categorias.json  Ordem, cor, ícone e imagem das categorias
    │   └── Trabalho/        Uma pasta por categoria, com as notas dela e a imagem (Trabalho.png)
    ├── tasks/
    │   └── tasks.json       Tarefas, categorias e menções a notas
    ├── mindmap/             Mapas mentais — uma pasta por mapa
    │   └── Principal/
    │       ├── mapa.json    Conexões (setas) e cores das notas deste mapa
    │       └── Godot.md     Um .md por nó, só com o texto
    ├── links/
    │   ├── links.json       Links salvos e categorias (cor, ícone e foto)
    │   └── icons/           Ícones dos sites (nuxt.com.png…), um por site
    ├── attachments/         Biblioteca de imagens: coladas nas notas (imagem-AAAAMMDD-HHMMSS.png), enviadas, fotos das categorias
    └── .4notes/             Estado da interface (abas abertas, mapa aberto, posições dos nós), configurações dos módulos e backups
```

A formatação continua sendo Markdown: `# título`, `- lista`, `- [ ] tarefa`, `**negrito**`, `*itálico*`, `~~tachado~~`, `==marca-texto==`, blocos ` ```linguagem ` e imagens `![](../attachments/…)`; sublinhado e cor usam HTML simples (`<u>…</u>`, `<span style="color: red">…</span>`), que o Obsidian também entende. No editor:

- **Marcação sempre escondida**: `**`, `*`, `==`, `~~`, `` ` ``, `<u>`, a cor, o endereço dos links, os `#`, `-`, `1.`, `- [ ]` e `>` do começo da linha e as cercas ` ``` ` dos blocos de código **nunca aparecem** — o texto simplesmente fica formatado. Para tirar uma formatação, selecione o texto e desligue-a na barra (ou no atalho, como `Ctrl+B`); um título ou item de lista sai com `Backspace` no começo da linha. Digitar, colar ou apagar nunca quebra uma marcação pela metade, e `Ctrl+B` sem nada selecionado deixa o que você digitar em seguida em negrito (como no Word). Os atalhos do Markdown continuam valendo: `# `, `- `, `1. `, `- [ ] `, `> ` no começo da linha e ` ``` ` + `Enter` para um bloco de código.
- **Links no texto**: selecione o texto e clique no 🔗 da barra (ou `Ctrl+K`) para colar o endereço; o texto fica sublinhado e `Ctrl+clique` abre. O botão direito sobre o link tem **Abrir**, **Copiar endereço**, **Editar link** e **Remover link**.
- **Listas e checklists**: digite `- `, `1. ` ou `- [ ] ` (ou use a barra de formatação). `Enter` continua a lista, `Enter` num item vazio sai dela, `Tab` / `Shift+Tab` mudam o nível (o item leva os subitens junto) e `Backspace` no começo do item tira o marcador. Clique na caixa para marcar/desmarcar a tarefa (grava `[x]` no arquivo). **Listas numeradas se renumeram sozinhas**: apagou o item 1, o antigo 2 vira 1, e assim por diante.
- **Código colado** vira um bloco com a linguagem identificada (JavaScript, TypeScript, Python, GDScript, C#, SQL, JSON, HTML, CSS, shell…), com botões **Copiar**, **Tela cheia** (ver e editar) e **Remover bloco**; blocos grandes têm altura máxima e rolagem própria. Clique no código para editá-lo ali mesmo, no cartão; a linguagem muda clicando no nome dela. `Ctrl+Shift+V` cola como texto comum.
- **Bloco de texto**: selecione um trecho e clique em **Bloco de texto** na barra de formatação. O trecho vai para um bloco (` ```text ` no arquivo) exatamente como aparece na tela — sem linguagem, sem cores e sem nenhum tratamento — com **Copiar**, **Tela cheia** e **Remover**, e altura máxima com rolagem para textos grandes. É sempre manual: colar nunca cria bloco de texto (só código reconhecido vira bloco de código); texto comum, listas e trechos longos entram como texto.
- **Várias ocorrências (`Ctrl+D`)**: com um trecho selecionado, `Ctrl+D` seleciona também a próxima ocorrência dele (sem diferenciar maiúsculas); de novo, a seguinte. Digitar, apagar ou formatar muda todas juntas; `Esc` volta para um cursor só. Sem nada selecionado, o primeiro `Ctrl+D` seleciona a palavra do cursor.
- **Imagens**: cole um print (`Win+Shift+S` e depois `Ctrl+V`), arraste um arquivo de imagem para a nota ou use **botão direito → Inserir imagem…** para escolher uma da biblioteca. A imagem fica em `attachments/` e a nota guarda o caminho relativo, então ela continua lá quando você reabrir (e aparece também no Obsidian/VS Code). O botão **Remover** (passe o mouse sobre a imagem) tira a imagem só da nota — o arquivo continua na biblioteca de imagens — e **Desfazer** (no aviso ou `Ctrl+Z`) devolve.
- **Menções**: digite **`@`** numa nota (das Notas ou do Mapa Mental) e escolha uma nota das Notas, de qualquer mapa, uma **tarefa** ou um **link salvo**. Notas e tarefas aparecem como um chip com o título atual (a tarefa concluída aparece riscada); clique para abrir. No arquivo a menção é um link Markdown comum — `[Ideias](Ideias.md)`, `[Godot](../mindmap/Principal/Godot.md)`, `[Estudar Godot](../tasks/tasks.json#t_k3j9x0)` — que também funciona no Obsidian/VS Code e acompanha a nota (ou o título da tarefa) quando algo muda no 4notes. Um link salvo entra como um link comum (`[Nuxt](https://nuxt.com/)`, texto editável) com o ícone do site na frente.
- **Exportar**: botão direito na nota (na lista ou na aba) → **Exportar → TXT** (só o texto, sem nenhuma formatação nem sintaxe do Markdown; listas ficam com •, 1., ☐/☑) ou **PDF** (com a formatação, como na tela). Você escolhe onde salvar; a nota não muda.
- **Título**: numa nota nova das Notas, a primeira linha já é um título (`# `) — é só digitar. Para tirar, `Backspace` no começo da linha.
- **Marca-texto** em verde, bem diferente da cor da seleção.

## Categorias e pastas das Notas

- **Categorias** ficam fixas no topo da lista lateral, com ícone (ou foto), cor e as notas delas; as notas sem categoria ficam embaixo, com o título "Notas" (que só aparece quando há notas sem categoria). Crie no **+** de "Categorias" (nome, cor e um dos ícones prontos — ou uma imagem da biblioteca); edite com duplo clique ou pelo botão direito.
- Para colocar uma nota numa categoria: **botão direito na aba → Categoria**, ou **arraste a aba** (ou a nota da lista) até a parte de baixo da lista para tirar a categoria. A aba fica marcada com a **cor da categoria**.
- **Categoria automática pelo título** (Configurações → Módulos → Notas, desligada no começo): uma nota nova criada fora das categorias vai sozinha para a categoria que já tem notas com o mesmo começo de título — `4notes 1.2.1` vai para a categoria que tem `4notes 1.1.1`. Ela decide quando o título fica pronto (`Enter` depois dele, ou ao sair da nota) e avisa, com **Desfazer**.
- Cada categoria é uma **pasta** dentro de `notes/` (o nome dela é o nome da pasta) e a foto fica dentro dela com o nome da categoria (`notes/Trabalho/Trabalho.png`, uma cópia da imagem da biblioteca). Mover, renomear ou excluir corrige sozinho os links e imagens das notas e as menções. Excluir uma categoria não apaga notas: elas voltam a ficar sem categoria.
- **Pastas pelo título** (só na lista; os arquivos não mudam): quando duas ou mais notas começam com a mesma palavra, ela vira uma pasta — `4notes 1.1.1` e `4notes 1.2.0` aparecem como **4notes › 1.1.1, 1.2.0**. A segunda palavra também vira pasta quando há mais texto depois (`4notes 1.2.0 bugs` → **4notes › 1.2.0 › bugs**). A nota com o título igual ao da pasta é a própria pasta (clicar abre a nota). Vale dentro de cada categoria.
- O **+** de uma pasta pelo título (passe o mouse sobre ela) cria uma nota que já começa com o título da pasta (`4notes `) — é só completar (`1.3.0`) e ela fica junto das outras.
- **Exibição das pastas pelo título** (Configurações → Módulos → Notas): **Padrão** (como foi digitado) ou **CAIXA ALTA**. Muda só a aparência na lista — o título das notas e os arquivos continuam iguais.
- **Fechar a aba** de uma nota que está numa categoria não pergunta nada: a nota continua salva (para apagá-la, use a lixeira ao lado dela na lista). Notas sem categoria continuam perguntando se você quer guardar ou apagar.

## Links

- **Salvar**: cole o endereço no campo do topo e aperte `Enter` (`nuxt.com/docs` já basta), aperte `Ctrl+V` em qualquer lugar da tela de Links, ou arraste um link do navegador para ela. O título e o ícone do site chegam sozinhos — o ícone fica guardado em `links/icons/`, então aparece mesmo sem internet. Se o link já estiver salvo, o 4notes avisa em vez de repetir.
- **Abrir**: clique no link (abre no navegador padrão). Na lista, `↑`/`↓` escolhem, `Enter` abre, `F2` edita, `Delete` exclui (com **Desfazer**) e `Ctrl+C` copia o endereço. O botão direito tem **Mover para**, **Atualizar título e ícone** e as demais opções.
- **Categorias**: crie no **+** de "Categorias" (nome, cor e um ícone pronto ou uma foto da biblioteca de imagens). Com uma categoria aberta, o link salvo já vai para ela; para mover, arraste o link até a categoria na lista lateral (ou use **Mover para**). Excluir uma categoria não apaga links: eles ficam em "Sem categoria" — que só aparece quando existe algum link sem categoria (ou enquanto você arrasta um link, para soltar ali). A busca procura no título e no endereço, em todas as categorias.
- **Ordem**: Recentes, A–Z (pelo título) ou **URL** (pelo endereço: o domínio, sem o `www.`, e depois o caminho).
- **Importar do navegador**: o 4notes encontra os favoritos do Brave, Opera GX, Opera, Chrome, Edge, Vivaldi, **Firefox** e **Zen** instalados (cada perfil aparece separado). O Zen é feito a partir do Firefox e guarda os favoritos do mesmo jeito (o banco `places.sqlite` do perfil, lido de uma cópia — dá para importar com o navegador aberto; se não der para ler o banco, vale a cópia automática mais recente de `bookmarkbackups/`). Para outros navegadores, exporte os favoritos como arquivo HTML e escolha **Arquivo de favoritos**. Marque o que quer trazer e escolha onde os links ficam: uma categoria para cada pasta do navegador ou tudo numa categoria só. Links que já estão salvos não são repetidos e nada muda no navegador.

## Biblioteca de imagens

Toda imagem enviada ao 4notes — colada numa nota, enviada pela biblioteca ou escolhida como foto de uma categoria — fica em `attachments/` e aparece na **biblioteca de imagens**. Ela abre sempre que você escolhe uma imagem (**Escolher imagem/foto…** nas categorias das Notas e dos Links, **Inserir imagem…** no botão direito do editor) e também em **Configurações → Geral → Biblioteca de imagens…**.

- **Enviar imagens…** traz imagens do computador (até 40 MB cada); enviar de novo uma imagem que já está lá não cria outra cópia.
- Cada imagem mostra onde é usada ("2 notas", "Categoria “Dev” (Notas)"…). Tirar a imagem de uma nota ou de uma categoria não a apaga: ela continua na biblioteca.
- **Excluir** (passe o mouse sobre a imagem) só aparece nas imagens que não estão em uso; o arquivo vai para a Lixeira.

## Configurações

`Ctrl+,` (ou o ícone de ajustes na barra lateral). Toda configuração tem um **?** com uma explicação curta.

- **Geral**: tema; **Tutoriais e atalhos**; **Iniciar com o computador** (abre o 4notes quando você entra no Windows — no app instalado); workspace e a biblioteca de imagens.
- **Módulos**: primeiro a seção **Geral** — **Módulos ativos** (ligue ou desligue Notas, Tarefas, Mapa Mental e Links) e **Menu lateral** (**Ícone e nome** ou **Só o ícone**, que deixa o menu mais estreito). Depois, os ajustes de cada módulo ativo, guardados no workspace (`.4notes/`). **Notas**: categoria automática pelo título e exibição das pastas pelo título. **Mapa Mental**: notas sem conexões, estilo dos nós (círculos ou cards) e quando mostrar os nomes. Tarefas e Links ainda não têm configurações. O que se usa toda hora continua na tela do próprio módulo: ordenar os links, as opções de criação das tarefas, **Reorganizar o mapa** (barra do mapa ou botão direito no fundo do mapa).

## Módulos e tutoriais

- **Ativar e desativar módulos**: em **Configurações → Módulos** ou com o **botão direito no menu lateral**. Desativar **só tira o módulo do menu**: as notas, tarefas, mapas e links dele continuam no workspace, e ao ativar de novo ele volta com tudo como estava. Pelo menos um módulo fica ativo. Ao ligar, o módulo se "conecta" ao menu — um fio sai dele até os outros, o ícone encaixa e um sinal corre até cada módulo; ao desligar, o contrário. Com as Configurações abertas em **Módulos**, o menu lateral fica visível por cima do fundo escurecido, para você ver as mudanças na hora.
- Um atalho (`Ctrl+2`…) ou uma menção para um módulo desativado avisa e oferece **Ativar**.
- **Tutoriais**: o **?** no fim do menu lateral (ou **`F1`**) abre um painel ao lado do menu com o tutorial do módulo em que você está — para que serve, o que dá para fazer, dicas que passam despercebidas e os atalhos dele. Ele fica aberto enquanto você usa o módulo e acompanha a troca de módulo; as abas no topo mostram os outros e o **Geral**. Fecha com ×, `F1`, o **?** ou `Esc`. Os atalhos de cada módulo ficam ali (a antiga aba **Atalhos** das Configurações saiu).

**Vindo da 1.0.0?** Na primeira abertura da 1.0.1, as notas do Mapa Mental vão para o mapa `Principal`, os `[[links]]` viram conexões no `mapa.json` e saem do texto. Uma cópia das notas originais fica em `.4notes/backups/mindmap-1.0.0-<data>/`.

**Vindo da 1.0.1?** A pasta de dados que você já usa continua funcionando como workspace (o nome mostrado é o nome dela). Na primeira abertura da 1.1.0, o Mapa Mental passa a mostrar as notas como cards, com o nome dos círculos só ao selecionar (dá para mudar em Configurações → Módulos → Mapa Mental).

Backup = copiar a pasta do workspace. Os arquivos podem ser abertos e editados em qualquer editor (VS Code, Obsidian, Bloco de Notas…); ao voltar para a janela do 4notes, as mudanças aparecem.

A configuração do app (qual workspace abrir, tema, tamanho da janela) fica separada, em `%APPDATA%\4notes\config.json`.

## Atalhos

| Atalho                        | Ação                                             |
| ----------------------------- | ------------------------------------------------ |
| `Ctrl+1` … `Ctrl+4`           | Notas / Tarefas / Mapa Mental / Links            |
| `Ctrl+N`                      | Nova nota, tarefa, nó ou link (no módulo atual)  |
| `Ctrl+W`                      | Fechar aba de nota (o X da aba de uma nota sem categoria pergunta se quer guardar ou apagar) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Próxima / anterior aba                           |
| `Ctrl+Shift+T`                | Reabrir aba fechada                              |
| `Ctrl+\`                      | Mostrar/ocultar a lista de notas                 |
| `Ctrl+F`                      | Procurar no texto (no mapa e nos Links, a busca deles) |
| `Ctrl+D`                      | Selecionar também a próxima ocorrência do texto selecionado (edita todas juntas; `Esc` volta a um cursor) |
| `Ctrl+K`                      | Link no texto selecionado (no editor) · Buscar no Mapa Mental |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U`| Negrito / itálico / sublinhado (selecione o texto para ver todas as opções) |
| `Ctrl+Shift+X` / `Ctrl+Shift+H` / `Ctrl+E` | Tachado / marca-texto / código      |
| `Ctrl+Shift+V`                | Colar como texto comum (código não vira bloco)   |
| `Ctrl+clique`                 | Abrir um endereço web                            |
| `Shift+arrastar` (mapa)       | Conectar notas (soltar no vazio cria uma nota)   |
| `Delete` (mapa)               | Excluir a nota ou a conexão selecionada          |
| `Ctrl+V` (Links)              | Salvar o endereço copiado                        |
| `↑` `↓` `Enter` `F2` `Delete` (Links) | Escolher, abrir, editar e excluir links  |
| `@` (numa nota)               | Mencionar uma nota, tarefa ou link salvo         |
| `Ctrl+,`                      | Configurações                                    |
| `F1`                          | Tutorial do módulo atual (com os atalhos dele)   |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0`| Zoom da interface                                |

Os menus do clique direito (notas, abas, tarefas, mapa, links e o de copiar/colar do editor, com as sugestões do corretor) seguem o tema do 4notes, no claro e no escuro.

Nas Tarefas, clicar fora do painel de edição (na lista, nas categorias…) fecha o painel; o clique continua fazendo o que faria (clicar em outra tarefa abre a outra). Um painel de **Nova tarefa** com algo já escrito não fecha assim, para não perder o rascunho.

Na adição rápida de tarefas: `Estudar Godot amanhã #estudos` já define data e categoria (se a categoria Estudos existir). Digite **`@`** (na barra, no título ou nos detalhes da tarefa) ou use **Mencionar nota** no painel da tarefa para mencionar uma nota das Notas ou de qualquer mapa: a menção aparece na tarefa e um clique abre a nota. Ela continua funcionando depois de fechar o app e acompanha a nota se você a renomear no 4notes.

No Mapa Mental: clique numa nota para abri-la (clicar no vazio tira a seleção e fecha o painel); com o mouse sobre uma nota, as setas que saem dela ficam com a cor dela; **arraste** uma nota para movê-la; **Shift + arrastar** de uma nota até outra cria uma conexão — soltando no vazio, o 4notes pede um nome e cria ali uma nota nova já conectada. Selecione uma nota ou conexão e aperte **`Delete`** para excluí-la (com **Desfazer**); clique numa conexão e use o **×** para removê-la; o **botão direito** no fundo cria uma nota ali ou **reorganiza o mapa**. **Reorganizar** (também na barra do mapa) deixa as linhas curtas e só as alonga quando é preciso para as notas não se encostarem e as linhas não se cruzarem. O botão de ajustes da barra abre as configurações do mapa (Configurações → Módulos → Mapa Mental).

## Estrutura do projeto

```
4notes/
├── electron/            Lado desktop (Node.js): janela, arquivos, pasta de dados, IPC
├── shared/              Contrato entre o Electron e a interface (ipc.ts) e regras usadas pelos dois lados
├── app/                 Interface (Nuxt 4 + Vue 3)
│   ├── pages/           Um arquivo por módulo: notes.vue, tasks.vue, mindmap.vue, links.vue
│   ├── components/      Componentes visuais (shell/, notes/, tasks/, mindmap/, links/, editor/, ui/)
│   ├── stores/          Estado de cada módulo (notes.ts, tasks.ts, mindmap.ts, links.ts, app.ts)
│   ├── lib/             Lógica pura e persistência (sem Vue — testável)
│   ├── composables/     Tema, atalhos, avisos, diálogos…
│   └── assets/css/      Cores (tokens.css) e estilos base
├── scripts/             dev.mjs (modo dev) e build-electron.mjs (compila o Electron)
├── tests/               Testes unitários (Vitest)
├── build/               Ícones do app/instalador
├── electron-builder.yml Configuração do instalador
└── docs/ARQUITETURA.md  Explicação didática da arquitetura
```

## Problemas comuns

- **`npm install` falha com `EPERM`/`EBUSY` dentro do OneDrive** — o OneDrive pode travar arquivos da pasta `node_modules` enquanto sincroniza. Pause a sincronização durante a instalação (ícone do OneDrive → Pausar) ou mantenha o projeto fora do OneDrive (ex.: `C:\dev\4notes`). Isso vale para o código-fonte; a pasta de **dados** do 4notes pode ficar no OneDrive sem problema.
- **Porta 3141 ocupada no `npm run dev`** — o Nuxt escolhe outra porta automaticamente e o script detecta.
- **Tarefas ou links não carregam ("não foi possível ler o arquivo…")** — o `tasks.json` (ou o `links.json`) foi editado e ficou com JSON inválido. O app não sobrescreve nada: corrija o arquivo ou restaure um backup de `.4notes/backups/`.
- **Um link ficou sem ícone** — o site estava fora do ar ou bloqueou o acesso. Use **Atualizar título e ícone** no botão direito do link; enquanto isso, ele aparece com a inicial do site.
