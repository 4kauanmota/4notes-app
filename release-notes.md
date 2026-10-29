## Novidades
- **Nova seleção de categorias**: em todos os módulos, o campo de categoria abre uma busca. Digite para filtrar (sem se preocupar com acentos), escolha com ↑ ↓ e Enter, ou crie uma categoria pelo nome sem abrir outra janela. As categorias do módulo aparecem primeiro e depois as outras do app. Nos menus do botão direito, "Categoria…" abre a mesma busca.
- **Filtros com várias categorias**: o Histórico e o Painel das Finanças e o Histórico e as Estatísticas do Timer filtram por mais de uma categoria de uma vez.
- **Categoria automática nas Finanças**: o app escolhe, entre as suas categorias, a que combina com o lançamento. "iFood" vai para a sua categoria de alimentação ("Alimentação", "Comida", "Food"…), "Uber" para transporte, "Netflix" para assinaturas. Vale ao registrar, ao importar extrato e ao buscar no banco, aparece marcada como "automática" e dá para trocar antes de salvar. O app nunca cria uma categoria sozinho.
- **Categoria padrão**: em Configurações › Módulos › Finanças, escolha a categoria dos gastos que a categoria automática não reconhecer.
- **Conexão com bancos (Meu Pluggy)**: conecte os seus bancos pelo Open Finance e as transações entram sozinhas nos Lançamentos, sem duplicar e com Desfazer. "Buscar no banco" busca na hora, e o app também busca sozinho uma vez por dia. O 4notes não pede nem guarda a senha do banco. O passo a passo está em Configurações › Módulos › Finanças › Conexões bancárias e em `docs/CONEXAO-BANCARIA.md`.
- **Recolher e expandir código**: setas na margem dos blocos de código recolhem objetos, JSON, funções e blocos aninhados, como num editor de código. Recolher só esconde na tela.
- **Guias de indentação**: linhas verticais discretas mostram os níveis de recuo do código.
- **Formatar código**: ao colar código, o aviso oferece "Formatar" (ou "Escolher linguagem", quando ela não foi reconhecida). O botão ✦ no bloco, o botão "Formatar" na tela cheia e Shift+Alt+F fazem o mesmo. Funciona com JavaScript, TypeScript, JSON, CSS, SCSS, LESS, HTML, Vue, YAML, Markdown e GraphQL, mantendo o estilo do código (recuo, aspas, ponto e vírgula). Código com erro de sintaxe e linguagens sem formatador seguro (Python, GDScript…) ficam como estão. Ctrl+Z desfaz.

## Melhorias
- A fonte dos blocos de código ficou um pouco menor, para caber mais num trecho longo.
- "Ou use uma categoria que já existe" nos diálogos de nova categoria virou uma lista que filtra pelo nome digitado.

## Observações
- A conexão com bancos depende de um serviço externo (a Pluggy): é opcional, fica desligada até você configurar e os dados passam pela Pluggy. Ela não foi testada contra a Pluggy de verdade durante o desenvolvimento; o primeiro uso real é o seu.
- As credenciais da Pluggy ficam só no aparelho (no Windows, criptografadas pelo sistema). Em outro aparelho, informe de novo; os bancos e as contas escolhidas vêm pelo workspace.
- Formatar código usa o Prettier, carregado só quando você formata (nada sai do aparelho).
- Atualize o computador e o celular para a 1.7.2. Uma configuração das Finanças mudada num aparelho ainda na 1.7.1 apaga a categoria padrão e os bancos conectados do workspace.
