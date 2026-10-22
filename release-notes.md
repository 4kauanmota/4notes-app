## Novidades
- **Finanças**: um módulo novo para registrar gastos. Digite o valor e a descrição e aperte Enter (a data já vem como hoje); categoria e observações são opcionais. O histórico mostra os gastos por dia, com período, categoria, busca e ordem por data ou valor, e o total do que está na tela. O **Painel** traz a evolução por dia, semana ou mês, os gastos por categoria, os dias com mais gastos, os maiores gastos e a comparação com o período anterior, tudo calculado só com os seus gastos.
- **Categorias compartilhadas**: as categorias agora valem para o app inteiro. Uma categoria criada nas Notas pode ser usada nas Tarefas, nos Links, no Timer e nas Finanças, sem criar outra igual. Em **Ver categorias** (a etiqueta no menu lateral; no celular, em "Mais") você vê onde cada uma é usada, abre os registros dela, muda nome, cor, ícone ou foto em todos os módulos de uma vez, junta duas categorias e exclui uma escolhendo para onde vão os registros.
- **Abas temporárias nas Notas**: um clique numa nota da lista abre uma aba temporária (título em itálico), que o próximo clique reaproveita para outra nota. Clique duplo, "Abrir em aba fixa" no menu ou começar a editar deixam a aba fixa, e ela não é mais trocada.
- **Gastos nas menções**: com @, notas e tarefas podem citar um gasto. A menção mostra a descrição e o valor atuais e leva até o gasto nas Finanças.

## Melhorias
- **Limpar formatação** só aparece na barra quando o trecho selecionado tem alguma formatação para tirar, e tira apenas dentro da seleção (Ctrl+Z desfaz).
- Excluir uma categoria que tem registros pergunta antes o que fazer com eles: passar para outra categoria ou deixar sem categoria. Nada é apagado.
- Janelas mais largas que a tela (como a biblioteca de imagens) agora encolhem para caber em vez de passar da borda.

## Observações
- Na primeira abertura da 1.7.0, as categorias de mesmo nome em módulos diferentes viram uma só (a cor, o ícone e a foto vêm da categoria das Notas, se houver). Antes disso, uma cópia dos arquivos fica em `.4notes/backups/1.7.0/`.
- Os gastos ficam em `finance/finance.json` e as categorias compartilhadas em `categories/categories.json`, dentro do seu workspace.
- Se você usa o mesmo workspace num aparelho com uma versão antiga, atualize os dois: a versão antiga continua lendo os arquivos, mas só a 1.7.0 conhece as Finanças e as categorias compartilhadas.
- Suas notas, tarefas, links e sessões do Timer não se perdem com a atualização.
