## Novidades
- **Contas a pagar**: marque "Me lembre de pagar" ao registrar um gasto e ele fica pendente até você confirmar o pagamento (com o dia em que foi pago). Pendente, pago e vencido aparecem diferentes no histórico e na nova área **Contas**, que reúne as vencidas, as próximas e o histórico dos pagamentos. Com o app aberto, as contas do dia e as vencidas aparecem num aviso (no Windows, também como aviso do sistema) e com um número no ícone das Finanças.
- **Recorrências**: aluguel, assinaturas, salário. Ative "Repetir" ao registrar (diária, semanal, mensal ou anual, até você encerrar ou até uma data). Cada ocorrência tem data e situação próprias e nunca é considerada paga só porque a data chegou. Ao mudar o valor, a frequência ou a data, você escolhe se vale só para a próxima ou também para as futuras; encerrar ou excluir mantém o histórico dos pagamentos. Meses curtos e anos bissextos são tratados (todo dia 31 cai no último dia do mês).
- **Entradas e saldo**: registre salário e outras entradas (uma vez ou recorrentes). O Painel mostra o **saldo realizado** (só o que entrou e o que foi pago de verdade) e o **saldo projetado** (depois das contas pendentes, vencidas e das próximas, e das entradas previstas), além do que ficou comprometido. Informe o saldo da conta num dia para o cálculo partir dele; sem isso, o saldo aparece marcado como estimativa.
- **Importar extrato** (CSV ou OFX): o app descobre as colunas, as datas e os centavos, mostra uma prévia para você revisar e corrigir, sugere categorias pelas descrições parecidas, deixa desmarcados os possíveis duplicados e confirma como paga a conta pendente que aparece no extrato. O arquivo é lido só no aparelho e não é guardado.
- **# para categorias**: em qualquer nota (e na descrição das tarefas), "#" lista as categorias do app e cria uma nova sem sair do texto. A menção fica ligada à categoria de verdade: renomear ou juntar com outra mantém o vínculo, e um clique abre a categoria com os registros dela. Nas Finanças, "#Mercado" na descrição escolhe a categoria do lançamento, e nas observações vira uma menção.
- **Cor do marca-texto**: o marca-texto agora tem paleta de cores, ao lado da cor do texto.

## Melhorias
- **Configurações › Categorias**: a lista de categorias agora fica nas Configurações, compacta e com busca enquanto você digita, pensada para centenas de categorias. Os detalhes, onde cada uma é usada e as menções abrem só quando você pede.
- O tema claro/escuro e as categorias saíram do menu lateral (e do "Mais" no celular): os dois ficam nas Configurações.
- As Tarefas mostram o ícone (ou a foto) de cada categoria, o mesmo de todo o app.
- As observações das Finanças abrem e fecham, com a formatação das notas.
- Nova opção nas Notas: "Selecionar a nota aberta na lista". Desligada, a lista lateral não abre pastas nem muda o destaque ao trocar de aba.
- Ao excluir uma nota, as imagens que só ela usava saem da biblioteca depois que o "Desfazer" some. Imagens usadas em outro lugar continuam.

## Correções
- A cor do texto agora funciona dentro de listas (com marcadores, numeradas e de tarefas) e fica só no trecho selecionado.

## Observações
- As Finanças guardam os novos dados no mesmo `finance/finance.json` (entradas em `incomes`, recorrências em `recurrences`). Um gasto comum continua no formato da 1.7.0.
- Se você usa o mesmo workspace num aparelho com a 1.7.0, atualize os dois: a versão antiga não conhece as entradas nem as recorrências e pode apagá-las ao salvar.
- No celular, os lembretes aparecem com o app aberto (aviso e número no ícone); o Android não recebe aviso do sistema.
