# 4notes

Aplicativo pessoal de organização, no **computador (Windows)** e no **celular (Android)**: **Notas** rápidas em abas, **Tarefas** com categorias e recorrência, **Mapas Mentais** de notas permanentes conectadas por setas, **Links** salvos em categorias e um **Timer** (cronômetro, temporizador e Pomodoro, com histórico e estatísticas) — tudo salvo em arquivos comuns, em **workspaces** (pastas) que você cria e nomeia.

- 100% local: sem login, sem servidor, sem banco de dados.
- Arquivos legíveis: Markdown (`.md`) para notas e JSON para tarefas, conexões do mapa, links e o Timer.
- Editor que esconde o Markdown: você vê só o texto formatado — títulos, listas e checklists de verdade, negrito, links, blocos de código coloridos, imagens coladas (prints) — e nunca os `**`, `#` ou as cercas dos blocos.
- Formatação ao selecionar texto (negrito, itálico, sublinhado, cor, marca-texto, link, listas…).
- Notas em **categorias** (pastas com cor e um ícone pronto ou uma foto) e agrupadas em pastas pelo título, com **+** para criar a nota direto na pasta. Exporte uma nota como **TXT** ou **PDF**.
- **Links**: cole um endereço e pronto — o título e o ícone do site chegam sozinhos. Categorias com cor, ícone ou foto, busca, ordem pela URL e importação dos favoritos do navegador (inclusive Firefox e Zen).
- **Biblioteca de imagens**: toda imagem enviada ao 4notes fica guardada para usar de novo — numa nota, numa categoria das Notas ou dos Links.
- **Tarefas** com a mesma formatação das notas na descrição (negrito, listas, checklists, código…).
- **Timer**: cronômetro, temporizador e Pomodoro com categorias e atividades; histórico filtrável e estatísticas com gráficos e comparação com o período anterior. A contagem segue pelo relógio — trocar de módulo, minimizar ou fechar o app não atrapalha.
- **Menções** (`@`) entre todos os módulos: notas e tarefas mencionam notas, mapas, tarefas, links salvos e registros do Timer — um clique abre o item no módulo dele. No Timer e nos Links, **Ver menções** mostra onde cada item foi mencionado.
- **Mapa Mental** com seleção de várias notas: `Ctrl + arrastar` seleciona uma área; arraste uma delas para mover todas, ou exclua/pinte o grupo de uma vez.
- Tema claro e escuro, em roxo e amarelo.
- **No celular também**: o app Android abre o mesmo workspace. Com a pasta sincronizada (Google Drive…), notas, tarefas, mapas, links e configurações são os mesmos no computador e no celular. A tela se adapta ao celular, ao dobrável fechado ou aberto e ao tablet, e o toque prolongado faz o papel do botão direito (veja [Celular (Android)](#celular-android)).

> Como tudo funciona por dentro (Nuxt + Electron + Capacitor, arquivos, recorrência, mapa, links, celular): veja **[docs/ARQUITETURA.md](docs/ARQUITETURA.md)**.

---

## Requisitos

- **Node.js 22 LTS** (22.12 ou mais recente) — confira com `node -v`
- Windows 10/11 (também roda em macOS e Linux)
- Para gerar o app Android: **Android Studio** (ele traz o Java e o Android SDK). O app roda no Android 7 ou mais recente.

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
npm run build:windows    # o mesmo que npm run dist:win
```

O instalador fica em `release/<versão>/4notes-Setup-<versão>.exe`. Para uma nova versão, aumente o campo `"version"` do `package.json` antes (ex.: `1.0.1` → `1.1.0`) — ele vale para o Windows e para o Android.

Outros comandos:

| Comando                 | O que faz                                                           |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run dev`           | Desenvolvimento (Nuxt + Electron com recarregamento)                |
| `npm start`             | Compila e abre a versão de produção sem instalar                    |
| `npm run build:windows` | Gera o instalador `.exe` do Windows (o mesmo que `npm run dist:win`) |
| `npm run dist`          | Gera o instalador para o sistema atual                              |
| `npm run build:android` | Gera o app Android: `release/android/4notes-<versão>.apk` (veja abaixo) |
| `npm run android:run`   | Gera e instala no celular ligado no cabo (com a depuração USB ativa) |
| `npm run android:sync`  | Só atualiza o projeto `android/` com a interface                    |
| `npm run android:open`  | Abre o projeto `android/` no Android Studio                         |
| `npm run build:ios`     | iOS: ainda não incluído — explica o que falta                       |
| `npm run build:web`     | Só a interface (`.output/public`), usada pelo Windows e pelo Android |
| `npm test`              | Testes da lógica (datas, recorrência, editor, código, menções, categorias, mapa, links, exportar, biblioteca, favoritos, configurações, celular, Timer)|
| `npm run typecheck`     | Verificação de tipos (TypeScript) da interface e do Electron        |

## Gerando o app Android

O app Android usa a **mesma interface** do Windows (a pasta `app/`); só muda a camada que lê e grava os arquivos (`app/lib/mobile/`). Ele é gerado no seu computador:

1. Instale o **[Android Studio](https://developer.android.com/studio)** e abra-o uma vez: o assistente da primeira abertura baixa o **Android SDK** (o Java já vem junto).
2. No projeto:

   ```bash
   npm install              # na primeira vez (e quando as dependências mudarem)
   npm run build:android
   ```

3. O APK fica em `release/android/4notes-<versão>.apk`. A primeira compilação demora alguns minutos (o Gradle baixa o que precisa); as seguintes são bem mais rápidas.

O que o `build:android` faz (`scripts/android.mjs`): encontra o Java e o SDK do Android Studio (ou usa `JAVA_HOME`/`ANDROID_HOME`), gera a interface (`nuxt generate`), copia para o projeto `android/` (`npx cap sync android`) e compila o APK com o Gradle.

- **Assinatura**: sem configurar nada, o APK é assinado com a chave de testes do Android Studio do seu computador — serve para instalar no seu celular. Gere as próximas versões **no mesmo computador**: um APK assinado com outra chave não atualiza o app instalado (o Android pede para desinstalar antes; o workspace não é apagado). Para ter uma chave própria, crie `android/keystore.properties` com `storeFile`, `storePassword`, `keyAlias` e `keyPassword` (fica fora do Git).
- **Versão**: a mesma do `package.json` (`1.6.1` vira o código 10601). Aumente antes de gerar uma atualização — o Android não instala uma versão menor por cima.
- **iOS**: ainda não. O mesmo código serve (Capacitor), mas o build exige um Mac com o Xcode e o iOS não deixa um app usar uma pasta qualquer como workspace — `npm run build:ios` explica o que falta.

## Instalando em outro computador

1. Copie o `4notes-Setup-<versão>.exe` para o outro computador e execute. Na tela **Atalhos**, escolha se quer um atalho na área de trabalho (o do Menu Iniciar é sempre criado).
2. O instalador não é assinado digitalmente, então o Windows pode mostrar _"O Windows protegeu o computador"_: clique em **Mais informações → Executar assim mesmo**.
3. Na primeira abertura, crie um workspace (ou abra um que você copiou). Para levar seus dados junto, copie a pasta do workspace inteira antes (ou use uma pasta sincronizada, como Google Drive ou OneDrive).

Desinstalar o app **não** apaga os workspaces.

## Celular (Android)

### Instalar

1. Passe o `4notes-<versão>.apk` para o celular (cabo USB, Google Drive, e-mail…) e toque nele. Na primeira vez, o Android pede para permitir que o app que abriu o arquivo (Arquivos, Drive…) **instale apps desconhecidos**: permita e volte. O Play Protect pode avisar que o app não vem da Play Store — confirme a instalação.
2. Para atualizar, instale o APK novo por cima: o app é substituído e os dados continuam no workspace. Desinstalar o app também não apaga o workspace.

### Primeira abertura

- Toque em **Criar workspace** (ou **Abrir workspace existente**). O 4notes explica e abre a tela **Acesso a todos os arquivos** do Android: ative a opção para o 4notes e volte para o app. Ela é necessária porque o workspace fica numa pasta que **você** escolhe (e que um app de sincronização pode ler), e não escondido dentro do app.
- O seletor de pastas do 4notes mostra o **Armazenamento interno**: escolha a pasta (ou crie uma em **Nova pasta**) e, ao criar um workspace, dê o nome dele — como no computador.
- Trocar de workspace: toque no nome dele no topo (ou em **Mais**).

### O mesmo workspace no computador e no celular (Google Drive)

O 4notes não sincroniza nada sozinho: ele lê e grava uma pasta comum, e um app de sincronização mantém a pasta igual nos dois aparelhos.

1. **No computador**: instale o **Google Drive para computador**, abra as Preferências dele (engrenagem › Preferências) e, nas opções de sincronização do Meu Drive, escolha **Espelhar arquivos** — o "Meu Drive" vira uma pasta comum do disco, que funciona também sem internet (no modo "streaming", os arquivos ficam só na nuvem até serem abertos). Coloque o workspace dentro dela (ex.: `Meu Drive\4notes\Pessoal`; para mover um workspace, feche o 4notes, mova a pasta e use **Abrir workspace existente**).
2. **No celular**: o app do Google Drive não sincroniza pastas. Instale um app de sincronização em **duas vias** (two-way), como o **Autosync for Google Drive** ou o **FolderSync**, e ligue uma pasta do celular (ex.: `Armazenamento interno/4notes`) à pasta do Drive (`Meu Drive/4notes`).
3. Depois da primeira sincronização, no 4notes do celular: **Abrir workspace existente** → `4notes/Pessoal`.
4. Confira no Google Drive se a pasta `Pessoal/.4notes/` chegou (é nela que ficam as configurações). Se o app de sincronização ignorar pastas ocultas (as que começam com ponto), ligue a opção de sincronizar arquivos ocultos.

Dicas:

- Use um aparelho de cada vez e deixe a sincronização terminar antes de trocar. Se o mesmo arquivo mudar nos dois aparelhos antes de sincronizar, quem resolve o conflito é o app de sincronização.
- Ao voltar para o 4notes (e a cada minuto com ele aberto), os arquivos são relidos: o que mudou no outro aparelho aparece sozinho.
- **Igual nos dois aparelhos**: notas, tarefas, mapas (com as posições dos nós), links, o histórico do Timer (e a sessão em andamento), imagens, o tema e todas as configurações. **De cada aparelho**: abas abertas, último módulo, mapa aberto e a lista lateral aberta ou fechada.
- Os dois aparelhos precisam da 1.5.0 ou mais recente (as configurações mudaram de lugar na 1.5.0).

### Usando no celular

- **Tamanhos de tela**: no celular (e no dobrável fechado), uma coisa por vez — a lista de notas ou a nota, os módulos na barra de baixo e as listas das Tarefas e dos Links numa gaveta (botão de lista ao lado do título; fecha tocando fora, arrastando para a esquerda ou com o "voltar"). No dobrável aberto, no tablet e na horizontal, lista e conteúdo lado a lado, com o menu lateral. Girar a tela ou abrir e fechar o dobrável só reorganiza a tela — nada se perde.
- **Toque prolongado = botão direito**: abre o mesmo menu (na tela pequena, numa folha que sobe de baixo). O **voltar** do Android fecha o que estiver aberto (menu, painel, gaveta), volta da nota para a lista e, por fim, minimiza o app.
- **Editor**: a barra de formatação fica acima do teclado enquanto você escreve (com **Inserir imagem**; com o cursor num link, **↗** abre o link).
- **Mapa Mental**: um dedo arrasta a nota ou o mapa; pinça aproxima e afasta. Toque numa nota para abrir (na tela pequena, o primeiro toque seleciona e mostra **Abrir**). Para conectar, arraste a **seta** que aparece ao lado da nota selecionada até outra nota — ou até o vazio, para criar uma nota nova conectada. Dois toques no vazio criam uma nota; segurar o dedo abre o menu.
- **O que é diferente**: excluir manda para `.4notes/trash/` do workspace (o Android não tem Lixeira para essas pastas); exportar PDF usa a impressão do Android (**Salvar como PDF**) e o TXT vai para a pasta que você escolher; importar links aceita o **arquivo de favoritos** (HTML exportado pelo navegador). Não existem no celular: Mostrar no Explorador e Iniciar com o computador. Os atalhos de teclado funcionam com um teclado físico.

## Workspaces (onde ficam os dados)

Um **workspace** é uma pasta com todos os dados: notas, tarefas, mapas, links, o Timer e imagens. O nome dele é o nome da pasta e aparece no canto superior esquerdo — clique nele para trocar de workspace.

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
    ├── timer/
    │   └── timer.json       Timer: categorias, histórico das sessões e a sessão em andamento
    ├── attachments/         Biblioteca de imagens: coladas nas notas (imagem-AAAAMMDD-HHMMSS.png), enviadas, fotos das categorias
    └── .4notes/             settings.json (tema e configurações — as mesmas em todos os aparelhos), mindmap.json (posições dos nós), backups/ e, no celular, trash/ (o que foi excluído)
```

A formatação continua sendo Markdown: `# título`, `- lista`, `- [ ] tarefa`, `**negrito**`, `*itálico*`, `~~tachado~~`, `==marca-texto==`, blocos ` ```linguagem ` e imagens `![](../attachments/…)`; sublinhado e cor usam HTML simples (`<u>…</u>`, `<span style="color: red">…</span>`), que o Obsidian também entende. No editor:

- **Marcação sempre escondida**: `**`, `*`, `==`, `~~`, `` ` ``, `<u>`, a cor, o endereço dos links, os `#`, `-`, `1.`, `- [ ]` e `>` do começo da linha e as cercas ` ``` ` dos blocos de código **nunca aparecem** — o texto simplesmente fica formatado. Para tirar uma formatação, selecione o texto e desligue-a na barra (ou no atalho, como `Ctrl+B`); um título ou item de lista sai com `Backspace` no começo da linha. Digitar, colar ou apagar nunca quebra uma marcação pela metade, e `Ctrl+B` sem nada selecionado deixa o que você digitar em seguida em negrito (como no Word). Os atalhos do Markdown continuam valendo: `# `, `- `, `1. `, `- [ ] `, `> ` no começo da linha e ` ``` ` + `Enter` para um bloco de código.
- **Links no texto**: selecione o texto e clique no 🔗 da barra (ou `Ctrl+K`) para colar o endereço; o texto fica sublinhado e `Ctrl+clique` abre. O botão direito sobre o link tem **Abrir**, **Copiar endereço**, **Editar link** e **Remover link**.
- **Listas e checklists**: digite `- `, `1. ` ou `- [ ] ` (ou use a barra de formatação). `Enter` continua a lista, `Enter` num item vazio sai dela, `Tab` / `Shift+Tab` mudam o nível (o item leva os subitens junto) e `Backspace` no começo do item tira o marcador. Clique na caixa para marcar/desmarcar a tarefa (grava `[x]` no arquivo). **Listas numeradas se renumeram sozinhas**: apagou o item 1, o antigo 2 vira 1, e assim por diante.
- **Código colado** vira um bloco com a linguagem identificada (JavaScript, TypeScript, Python, GDScript, C#, SQL, JSON, HTML, CSS, shell…), com botões **Copiar**, **Tela cheia** (ver e editar) e **Remover bloco**; blocos grandes têm altura máxima e rolagem própria. Clique no código para editá-lo ali mesmo, no cartão — ele continua do mesmo tamanho (só a **Tela cheia** mostra o bloco inteiro). Dentro do bloco, o duplo clique seleciona a palavra (com o destaque de sempre), `Ctrl+D` seleciona as próximas ocorrências, `Ctrl+Z` desfaz como no resto da nota e `↑`/`↓` no começo/fim (ou `Esc`) voltam para o texto da nota. A linguagem muda clicando no nome dela. `Ctrl+Shift+V` cola como texto comum.
- **Bloco de texto**: selecione um trecho e clique em **Bloco de texto** na barra de formatação. O trecho vai para um bloco (` ```text ` no arquivo) exatamente como aparece na tela — sem linguagem, sem cores e sem nenhum tratamento — com **Copiar**, **Tela cheia** (o texto usa a largura toda, com a mesma margem do editor) e **Remover**, e altura máxima com rolagem para textos grandes. É sempre manual: colar nunca cria bloco de texto (só código reconhecido vira bloco de código); texto comum, listas e trechos longos entram como texto.
- **Várias ocorrências (`Ctrl+D`)**: com um trecho selecionado, `Ctrl+D` seleciona também a próxima ocorrência dele (sem diferenciar maiúsculas); de novo, a seguinte. Digitar, apagar ou formatar muda todas juntas; `Esc` volta para um cursor só. Sem nada selecionado, o primeiro `Ctrl+D` seleciona a palavra do cursor. Vale também dentro dos blocos de código e de texto — no cartão e na tela cheia —, cada bloco com as próprias ocorrências; as outras ocorrências do texto selecionado ficam só contornadas, para não parecerem selecionadas.
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
- **Versões (anterior e próxima)**: numa nota com número de versão no título (`4notes 1.4.1`, `Aula 3`, `App v2`), botões discretos no fim da barra das abas abrem a versão anterior (**‹ 1.4.0**) e a próxima (**1.4.2 ›**) numa aba — a mais perto da atual, com o mesmo resto do título (`1.3.2` ↔ `1.4.0` ↔ `1.4.1` ↔ `1.4.2`…). Vale entre as notas da mesma categoria (ou entre as sem categoria), as mesmas que ficam juntas na pasta pelo título. Cada botão só aparece se a versão existir.
- **Exibição das pastas pelo título** (Configurações → Módulos → Notas): **Padrão** (como foi digitado) ou **CAIXA ALTA**. Muda só a aparência na lista — o título das notas e os arquivos continuam iguais.
- **Fechar a aba** de uma nota que está numa categoria não pergunta nada: a nota continua salva (para apagá-la, use a lixeira ao lado dela na lista). Notas sem categoria continuam perguntando se você quer guardar ou apagar.

## Links

- **Salvar**: cole o endereço no campo do topo e aperte `Enter` (`nuxt.com/docs` já basta), aperte `Ctrl+V` em qualquer lugar da tela de Links, ou arraste um link do navegador para ela. O título e o ícone do site chegam sozinhos — o ícone fica guardado em `links/icons/`, então aparece mesmo sem internet. Se o link já estiver salvo, o 4notes avisa em vez de repetir.
- **Abrir**: clique no link (abre no navegador padrão). Na lista, `↑`/`↓` escolhem, `Enter` abre, `F2` edita, `Delete` exclui (com **Desfazer**) e `Ctrl+C` copia o endereço. O botão direito tem **Mover para**, **Atualizar título e ícone** e as demais opções.
- **Categorias**: crie no **+** de "Categorias" (nome, cor e um ícone pronto ou uma foto da biblioteca de imagens). Com uma categoria aberta, o link salvo já vai para ela; para mover, arraste o link até a categoria na lista lateral (ou use **Mover para**). Excluir uma categoria não apaga links: eles ficam em "Sem categoria" — que só aparece quando existe algum link sem categoria (ou enquanto você arrasta um link, para soltar ali). A busca procura no título e no endereço, em todas as categorias.
- **Ordem**: Recentes, A–Z (pelo título) ou **URL** (pelo endereço: o domínio, sem o `www.`, e depois o caminho).
- **Menções**: links salvos podem ser mencionados com `@` nas notas (entram como links comuns, com o ícone do site) e nas tarefas. **Ver menções** (botão direito no link ou em **Editar**) lista onde ele foi mencionado e leva até lá. Trocar o endereço de um link salvo atualiza os links das notas que apontavam para o endereço antigo.
- **Importar do navegador**: o 4notes encontra os favoritos do Brave, Opera GX, Opera, Chrome, Edge, Vivaldi, **Firefox** e **Zen** instalados (cada perfil aparece separado). O Zen é feito a partir do Firefox e guarda os favoritos do mesmo jeito (o banco `places.sqlite` do perfil, lido de uma cópia — dá para importar com o navegador aberto; se não der para ler o banco, vale a cópia automática mais recente de `bookmarkbackups/`). Para outros navegadores, exporte os favoritos como arquivo HTML e escolha **Arquivo de favoritos**. Marque o que quer trazer e escolha onde os links ficam: uma categoria para cada pasta do navegador ou tudo numa categoria só. Links que já estão salvos não são repetidos e nada muda no navegador.

## Tarefas: descrição formatada

A descrição de uma tarefa usa **o mesmo editor das notas**: selecione o texto para a barra de formatação (negrito, itálico, sublinhado, cor, marca-texto, título, listas, checklists, código, bloco de texto, link) — num painel estreito, a barra quebra em duas fileiras —, use os mesmos atalhos (`Ctrl+B`, `- `, `1. `, `- [ ] `…) e cole prints e código. No `tasks.json`, a descrição fica em Markdown, como as notas; na lista, a primeira linha aparece sem a marcação. O **`@`** na descrição lista itens de todos os módulos e o escolhido vai para **Menções** (como no título da tarefa). Descrições antigas (texto simples) continuam iguais.

## Timer

- **Sessão**: escolha **Cronômetro**, **Temporizador** (com as durações prontas ou **Outro…** — `40`, `1:30`, `2h`) ou **Pomodoro** e clique em **Iniciar** (ou `Espaço`). Atividade (ex.: "Estudando Godot") e categoria (ex.: Estudo) são opcionais e podem ser preenchidas ou trocadas com a sessão contando; uma atividade já usada puxa a categoria da última vez, e **Recentes** recomeça uma atividade com um clique. **Pausar/Retomar**, **Finalizar** (`Ctrl+Enter`; salva no histórico, com **Desfazer**) e **Cancelar** (fica no histórico como cancelada, sem contar o tempo — com menos de 1 minuto, nem fica). Ao lado, o resumo de **Hoje**.
- **Pomodoro**: **Ajustar ciclos** define foco, pausa curta, pausa longa, quantos focos até a pausa longa e se a próxima etapa começa sozinha. A sessão é uma só, com a atividade, os ciclos e o tempo de foco — as pausas não contam como tempo da atividade. Quando uma etapa termina, um som curto (desligável) avisa, e com o 4notes minimizado aparece também um aviso do Windows.
- **A contagem vem do relógio**, não de um contador na tela: trocar de módulo, minimizar ou fechar o 4notes não atrapalha. Ao abrir de novo, a sessão em andamento continua; um temporizador que acabou com o app fechado é registrado no horário certo; uma etapa do Pomodoro que terminou com o app fechado espera você para começar a próxima. Um ponto amarelo no ícone do Timer (no menu) mostra que há uma sessão contando.
- **Histórico**: as sessões por **data**, **categoria** ou **atividade**, com o período (dia, semana, mês, ano, intervalo ou tudo, com ‹ › e `←`/`→`), busca, categoria, situação (concluídas, interrompidas, canceladas) e ordem. Clique num registro para editar a atividade, a categoria, as observações e o **tempo válido** (o que conta nas estatísticas — dá para dar um tempo válido a uma sessão cancelada); o botão direito também exclui (com **Desfazer**).
- **Estatísticas**: só com as suas sessões. Escolha o período e a categoria em cima: tempo total (e a variação), sessões, duração média, o dia com mais tempo; o tempo por dia (ou hora, ou mês) em colunas — com o período anterior lado a lado e uma **Tabela**; a distribuição por categoria e o tempo por atividade; a **comparação** com o período anterior equivalente (diferença, variação, categorias e atividades que aumentaram ou diminuíram — com o período atual ainda em andamento, compara com o mesmo trecho do anterior). **Detalhado** mostra quando você registra tempo (dias × horas, partes do dia, dias da semana) e a tabela por categoria.
- **Categorias**: crie em **+ Nova**; o botão direito (toque prolongado no celular) edita, muda de lugar ou exclui. Excluir uma categoria **não apaga o histórico**: as sessões dela ficam sem categoria. As categorias do Timer são só dele (as das Tarefas continuam separadas).
- **Interrompida**: o temporizador parado antes do fim ou o Pomodoro finalizado no meio de um foco — o tempo feito conta.
- **Menções**: digite `@` numa nota ou tarefa e escreva a atividade (ou a categoria e a data: `@estudo 12/10`) para mencionar um registro. Clicar na menção abre o **Histórico** já no registro, destacado. **Ver menções** (botão direito no registro ou no diálogo de edição) lista as notas e tarefas que o mencionam. Um registro excluído aparece riscado na menção, sem quebrar nada.

## Biblioteca de imagens

Toda imagem enviada ao 4notes — colada numa nota, enviada pela biblioteca ou escolhida como foto de uma categoria — fica em `attachments/` e aparece na **biblioteca de imagens**. Ela abre sempre que você escolhe uma imagem (**Escolher imagem/foto…** nas categorias das Notas e dos Links, **Inserir imagem…** no botão direito do editor) e também em **Configurações → Geral → Biblioteca de imagens…**.

- **Enviar imagens…** traz imagens do computador (até 40 MB cada); enviar de novo uma imagem que já está lá não cria outra cópia.
- Cada imagem mostra onde é usada ("2 notas", "1 tarefa", "Categoria “Dev” (Notas)"…). Tirar a imagem de uma nota, de uma tarefa ou de uma categoria não a apaga: ela continua na biblioteca.
- **Excluir** (passe o mouse sobre a imagem) só aparece nas imagens que não estão em uso; o arquivo vai para a Lixeira (no celular, para `.4notes/trash/` do workspace).

## Configurações

`Ctrl+,` (ou a **engrenagem** no fim do menu lateral; no celular, em **Mais**). Toda configuração tem um **?** com uma explicação curta.

As configurações — o tema, os módulos ativos e a ordem deles, o menu lateral, os ajustes de cada módulo e a ordem dos links — ficam **no workspace**, em `.4notes/settings.json`: com a pasta sincronizada, valem no computador e no celular, e uma mudança num aparelho aparece no outro quando você volta para o app. Abas abertas, último módulo, mapa aberto e a lista lateral aberta ou fechada são de cada aparelho.

- **Geral**: tema; **Tutoriais e atalhos**; **Iniciar com o computador** (abre o 4notes quando você entra no Windows — no app instalado); workspace e a biblioteca de imagens.
- **Módulos**: primeiro a seção **Geral** — **Módulos ativos** (ligue ou desligue Notas, Tarefas, Mapa Mental, Links e Timer; arraste para mudar a ordem) e **Menu lateral** (**Ícone e nome** ou **Só o ícone**, que deixa o menu mais estreito). Depois, os ajustes de cada módulo ativo. **Notas**: categoria automática pelo título e exibição das pastas pelo título. **Mapa Mental**: notas sem conexões, estilo dos nós (círculos ou cards) e quando mostrar os nomes. **Timer**: som ao terminar, aviso do sistema (computador) e em que dia a semana começa (estatísticas). Tarefas e Links ainda não têm configurações. O que se usa toda hora continua na tela do próprio módulo: ordenar os links, as opções de criação das tarefas, **Reorganizar o mapa** (barra do mapa ou botão direito no fundo do mapa), a duração do temporizador e os ciclos do Pomodoro.

## Módulos e tutoriais

- **Ativar e desativar módulos**: em **Configurações → Módulos** ou com o **botão direito no menu lateral**. Desativar **só tira o módulo do menu**: as notas, tarefas, mapas, links e o histórico do Timer continuam no workspace, e ao ativar de novo ele volta com tudo como estava. Pelo menos um módulo fica ativo. Ao ligar, o módulo se "conecta" ao menu — um fio sai dele até os outros, o ícone encaixa e um sinal corre até cada módulo; ao desligar, o contrário. Um som curto e baixo acompanha o encaixe (ligar) e a saída (desligar); ele segue o volume e o mudo do sistema e nunca se repete nem se acumula. Com as Configurações abertas em **Módulos**, o menu lateral e a barra de cima ficam sem desfoque (só o conteúdo atrás do painel fica embaçado), para você ver as mudanças na hora.
- **Reorganizar os módulos**: **arraste** um módulo no menu lateral (ou na lista de Configurações → Módulos) para mudar a ordem; o botão direito num módulo também tem **Mover para cima/baixo**. A ordem fica no workspace e vale depois de reiniciar; nada muda nos dados nem nas configurações dos módulos, e os atalhos `Ctrl+1…5` continuam presos a cada módulo.
- Um atalho (`Ctrl+2`…) ou uma menção para um módulo desativado avisa e oferece **Ativar**.
- **Tutoriais**: o **?** no fim do menu lateral, logo abaixo do botão de tema (ou **`F1`**), abre um painel ao lado do menu com o tutorial do módulo em que você está — para que serve, o que dá para fazer, o que tem no **botão direito**, dicas que passam despercebidas e os atalhos dele, tudo em frases curtas. As abas no topo mostram os outros módulos (na ordem do menu) e o **Geral**. Fecha com ×, `F1`, o **?**, `Esc` ou clicando fora dele (clicar dentro não fecha). Os atalhos de cada módulo ficam ali (a antiga aba **Atalhos** das Configurações saiu).

**Vindo da 1.0.0?** Na primeira abertura da 1.0.1, as notas do Mapa Mental vão para o mapa `Principal`, os `[[links]]` viram conexões no `mapa.json` e saem do texto. Uma cópia das notas originais fica em `.4notes/backups/mindmap-1.0.0-<data>/`.

**Vindo da 1.0.1?** A pasta de dados que você já usa continua funcionando como workspace (o nome mostrado é o nome dela). Na primeira abertura da 1.1.0, o Mapa Mental passa a mostrar as notas como cards, com o nome dos círculos só ao selecionar (dá para mudar em Configurações → Módulos → Mapa Mental).

**Vindo da 1.4.3?** Na primeira abertura da 1.5.0, as configurações que ficavam em `.4notes/notes.json`, `mindmap.json`, `links.json` e `app.json` — e o tema, que ficava no computador — passam para `.4notes/settings.json`; as abas abertas, o último módulo e o mapa aberto passam a ficar no aparelho, e `.4notes/mindmap.json` fica só com as posições dos nós. Os arquivos antigos vão para `.4notes/backups/1.5.0/` (nada é apagado). Nada muda nas notas, tarefas, mapas e links. Atualize todos os aparelhos que usam o workspace.

Backup = copiar a pasta do workspace. Os arquivos podem ser abertos e editados em qualquer editor (VS Code, Obsidian, Bloco de Notas…); ao voltar para a janela do 4notes, as mudanças aparecem.

Fora do workspace ficam só as preferências do aparelho: no computador, qual workspace abrir, o zoom e o tamanho da janela (`%APPDATA%\4notes\config.json`, com uma cópia do tema para a janela já abrir com a cor certa); no celular, qual workspace abrir (e a mesma cópia do tema). Junto delas, o próprio app guarda o estado da tela de cada workspace (abas abertas, último módulo, mapa aberto).

## Atalhos

| Atalho                        | Ação                                             |
| ----------------------------- | ------------------------------------------------ |
| `Ctrl+1` … `Ctrl+5`           | Notas / Tarefas / Mapa Mental / Links / Timer    |
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
| `Ctrl+arrastar` (mapa)        | Selecionar as notas de uma área (soma à seleção) |
| `Ctrl+clique` (mapa)          | Pôr ou tirar uma nota da seleção                 |
| `Delete` (mapa)               | Excluir as notas ou a conexão selecionadas       |
| `Ctrl+V` (Links)              | Salvar o endereço copiado                        |
| `↑` `↓` `Enter` `F2` `Delete` (Links) | Escolher, abrir, editar e excluir links  |
| `@` (numa nota ou tarefa)     | Mencionar uma nota, mapa, tarefa, link ou registro do Timer |
| `Espaço` (Timer)              | Iniciar, pausar ou retomar a sessão              |
| `Ctrl+Enter` (Timer)          | Finalizar a sessão                               |
| `←` / `→` (Timer)             | Período anterior / próximo (histórico e estatísticas) |
| `Ctrl+,`                      | Configurações                                    |
| `F1`                          | Tutorial do módulo atual (com os atalhos dele)   |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0`| Zoom da interface                                |

Os menus do clique direito (notas, abas, tarefas, mapa, links e o de copiar/colar do editor, com as sugestões do corretor) seguem o tema do 4notes, no claro e no escuro.

Clicar num ícone (botões de ícone, módulos e botões do menu lateral, abas das Configurações e do tutorial, botões das barras e dos blocos) faz o ícone "afundar" e voltar num movimento curto — o mesmo em todo o app, para ações e para o que abre menus, painéis ou módulos. Com "reduzir movimento" ligado no sistema, não há animação.

Nas Tarefas, clicar fora do painel de edição (na lista, nas categorias…) fecha o painel; o clique continua fazendo o que faria (clicar em outra tarefa abre a outra). Um painel de **Nova tarefa** com algo já escrito não fecha assim, para não perder o rascunho.

Na adição rápida de tarefas: `Estudar Godot amanhã #estudos` já define data e categoria (se a categoria Estudos existir). Digite **`@`** (na barra, no título ou na descrição da tarefa) ou use **Mencionar** no painel da tarefa para mencionar uma nota, um mapa, outra tarefa, um link salvo ou um registro do Timer — cada item da lista diz de onde é (módulo, categoria, data). A menção aparece em **Menções** e um clique abre o item no módulo dele. Ela continua funcionando depois de fechar o app e acompanha o item se você o renomear no 4notes (tarefas, links e registros são achados pelo id).

No Mapa Mental: clique numa nota para abri-la (clicar no vazio tira a seleção e fecha o painel); com o mouse sobre uma nota, as setas que saem dela ficam com a cor dela; **arraste** uma nota para movê-la; **Shift + arrastar** de uma nota até outra cria uma conexão — soltando no vazio, o 4notes pede um nome e cria ali uma nota nova já conectada. Selecione uma nota ou conexão e aperte **`Delete`** para excluí-la (com **Desfazer**). **Várias notas**: `Ctrl + arrastar` desenha uma área que seleciona as notas que ela toca (de novo soma mais), `Ctrl + clique` põe ou tira uma; arraste uma das selecionadas para mover todas juntas (as conexões não mudam) e use a barra de baixo — **Cor** e **Excluir** — ou o botão direito numa delas para o grupo todo (excluir em lote tem um **Desfazer** para todas). No toque: segure o dedo no vazio › **Selecionar área**; clique numa conexão e use o **×** para removê-la; o **botão direito** no fundo cria uma nota ali ou **reorganiza o mapa**. **Reorganizar** (também na barra do mapa) deixa as linhas curtas e só as alonga quando é preciso para as notas não se encostarem e as linhas não se cruzarem. As configurações do mapa ficam em Configurações → Módulos → Mapa Mental; a barra do mapa tem só o seletor de mapas, a busca (`Ctrl+K`), **Nova nota** e **Reorganizar**.

## Estrutura do projeto

```
4notes/
├── electron/            Lado desktop (Node.js): janela, arquivos, pasta de dados, IPC
├── android/             Projeto Android (Capacitor): manifesto, permissões, ícones e o plugin nativo do 4notes
├── shared/              Contrato entre a interface e as plataformas (ipc.ts) e regras usadas pelos dois lados
├── app/                 Interface (Nuxt 4 + Vue 3)
│   ├── pages/           Um arquivo por módulo: notes.vue, tasks.vue, mindmap.vue, links.vue, timer.vue
│   ├── components/      Componentes visuais (shell/, notes/, tasks/, mindmap/, links/, timer/, editor/, ui/)
│   ├── stores/          Estado de cada módulo (notes.ts, tasks.ts, mindmap.ts, links.ts, timer.ts, app.ts)
│   ├── lib/             Lógica pura e persistência (sem Vue — testável); lib/mobile/ é a camada do Android
│   ├── composables/     Tema, atalhos, avisos, diálogos…
│   └── assets/css/      Cores (tokens.css) e estilos base
├── scripts/             dev.mjs (modo dev), build-electron.mjs (compila o Electron), android.mjs (app Android), ios.mjs
├── capacitor.config.ts  Configuração do app Android (Capacitor)
├── tests/               Testes unitários (Vitest)
├── build/               Ícones do app/instalador
├── electron-builder.yml Configuração do instalador
└── docs/ARQUITETURA.md  Explicação didática da arquitetura
```

## Problemas comuns

- **`npm install` falha com `EPERM`/`EBUSY` dentro do OneDrive** — o OneDrive pode travar arquivos da pasta `node_modules` enquanto sincroniza. Pause a sincronização durante a instalação (ícone do OneDrive → Pausar) ou mantenha o projeto fora do OneDrive (ex.: `C:\dev\4notes`). Isso vale para o código-fonte; a pasta de **dados** do 4notes pode ficar no OneDrive sem problema.
- **Porta 3141 ocupada no `npm run dev`** — o Nuxt escolhe outra porta automaticamente e o script detecta.
- **Tarefas, links ou o Timer não carregam ("não foi possível ler o arquivo…")** — o `tasks.json` (ou o `links.json`, ou o `timer/timer.json`) foi editado e ficou com JSON inválido. O app não sobrescreve nada: corrija o arquivo ou restaure um backup de `.4notes/backups/`.
- **Um link ficou sem ícone** — o site estava fora do ar ou bloqueou o acesso. Use **Atualizar título e ícone** no botão direito do link; enquanto isso, ele aparece com a inicial do site.
- **`npm run build:android` diz que não encontrou o Java ou o Android SDK** — abra o Android Studio uma vez e deixe o assistente terminar (ele instala o SDK em `%LOCALAPPDATA%\Android\Sdk`). Se o Android Studio estiver num lugar diferente do padrão, configure as variáveis `JAVA_HOME` (a pasta `jbr` do Android Studio) e `ANDROID_HOME` (a pasta do SDK).
- **`Unsupported class file major version 69` (ou 70…) no `build:android`** — o Gradle do projeto Android roda com o Java 17 a 24, e foi usado um Java mais novo (69 = Java 25). O script escolhe sozinho um Java compatível (o do `JAVA_HOME`, o do Android Studio ou um JDK instalado em `Program Files`) e avisa qual usou; se só houver Java 25 ou mais novo, instale o JDK 21 (Temurin, em adoptium.net).
- **A primeira compilação do Android falha baixando arquivos** — o Gradle precisa de internet na primeira vez (baixa o Gradle e as bibliotecas do Android). Confira a conexão (ou o proxy/antivírus) e rode `npm run build:android` de novo.
- **"App não instalado" ao atualizar no celular** — o APK novo foi assinado com outra chave (gerado em outro computador) ou tem uma versão menor que a instalada. Gere no mesmo computador e aumente a versão no `package.json`; se precisar, desinstale o 4notes do celular (o workspace não é apagado) e instale de novo.
- **O celular pede "Permita o acesso aos arquivos"** — o "Acesso a todos os arquivos" foi desligado (nas configurações do Android). Toque em **Permitir acesso**, ative para o 4notes e volte.
- **Uma mudança feita num aparelho não aparece no outro** — confira se o app de sincronização terminou (no celular e no Google Drive para computador) e se ele sincroniza a pasta oculta `.4notes/`. O 4notes relê os arquivos quando você volta para ele.
