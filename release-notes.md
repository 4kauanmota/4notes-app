## Novidades
- **Documentos**: um módulo novo para guardar documentos pessoais. Importe (botão, Ctrl+O ou arrastando os arquivos para a tela) PDFs, imagens e textos: uma cópia fica em `documents/arquivos/` do workspace. Organize por categoria (as mesmas do app), marque vários para mudar a categoria de todos de uma vez, busque pelo nome e leia sem sair do app. Outros formatos ficam guardados e abrem no programa do sistema.
- **Anotações nos PDFs**: caneta, marca-texto, caixas de texto e borracha por cima do PDF, como nos leitores dos navegadores. Selecione um texto do PDF e use "Marcar" para destacar o trecho. Tem desfazer e refazer, e tudo é salvo sozinho num arquivo à parte (`documents/anotacoes/`): o PDF original não muda.
- **Tabelas nas notas**: botão direito › "Inserir tabela…" (no celular, o botão de tabela na barra). Escolha colunas e linhas, edite as células direto na nota, marque uma coluna como Número e ela soma na linha Total, que se atualiza a cada mudança. Células vazias ou com texto ficam fora da soma, sem erro. No arquivo fica uma tabela Markdown comum, com a linha Total.

## Melhorias
- **Um botão só para blocos**: na barra de formatação fica só "Bloco de texto". Se o trecho for código (JavaScript, JSON, GDScript…), ele já vira bloco de código na linguagem certa. Para trocar texto por código, clique no nome do bloco.
- **Código na linha só com o texto**: aplicar "Código" (Ctrl+E) num trecho com negrito, cor ou link agora deixa só o texto, como já acontecia com negrito e itálico. Antes, os caracteres escondidos da formatação apareciam dentro do código.

## Removido
- **Conexão com bancos (Meu Pluggy)**: saiu do app. Ao abrir a 1.7.3, as credenciais guardadas no aparelho são apagadas e os bancos conectados saem do workspace. Os lançamentos que já tinham vindo do banco continuam. Importar extrato (CSV e OFX) continua igual.

## Observações
- Atualize o computador e o celular para a 1.7.3: as versões anteriores não têm o módulo Documentos (os arquivos ficam guardados, só não aparecem) e mostram as tabelas como texto.
- O leitor de PDF usa o pdf.js (o motor do leitor do Firefox), carregado só quando você abre um PDF. Nada sai do aparelho.
- PDFs com senha não abrem no app: use o programa do sistema.
