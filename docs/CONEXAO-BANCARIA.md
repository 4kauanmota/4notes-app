# Conexão com bancos (Meu Pluggy)

A partir da 1.7.2, as Finanças podem buscar as transações dos seus bancos e lançar tudo sozinhas, com a categoria automática e sem duplicar. Este guia explica o que é preciso para ligar isso, quanto custa e o que acontece com os seus dados.

## Por que o Meu Pluggy

| Alternativa | Situação |
| --- | --- |
| Open Finance direto com o banco | Só instituições autorizadas pelo Banco Central podem usar as APIs. Um app pessoal não consegue. |
| Agregadores comerciais (Pluggy, Belvo, Tecnospeed…) | Planos para empresas, de cerca de R$ 540 a R$ 6.000 por mês (valores citados por desenvolvedores em maio de 2026). |
| **Meu Pluggy** (escolhido) | Gratuito para uso pessoal. Você conecta os bancos pelo Open Finance oficial e o 4notes lê as transações pela API da Pluggy. É o mesmo caminho que o Actual Budget usa. |
| Ler as notificações do banco no celular | Só no Android, depende do texto de cada banco (que muda sem aviso) e só pega o que gera notificação. |

O 4notes **não pede nem guarda a senha do banco**. A autorização acontece no app ou no site do próprio banco, no fluxo do Open Finance.

## O que você precisa

1. **Conta no Meu Pluggy** (gratuita): https://meu.pluggy.ai. Lá você conecta cada banco. O banco abre a tela de consentimento do Open Finance e você autoriza.
2. **Conta no painel da Pluggy** (para desenvolvedores): https://dashboard.pluggy.ai. Crie um time e uma **aplicação**. A aplicação mostra o **Client ID** e o **Client Secret**.
3. Na aplicação, adicione o conector **MeuPluggy** à lista de conectores, abra a **Demo** e autorize a sua conta do Meu Pluggy (uma vez por banco conectado, não por conta).
4. Na Demo, no menu de três pontos, use **Copiar Item ID** para cada banco. É esse id que o 4notes usa.

## Custos

- Meu Pluggy: gratuito.
- Painel da Pluggy: tem um período de teste (15 dias). A documentação da Pluggy e a do Actual Budget dizem que, depois do teste, a conexão continua funcionando, mas a lista de conectores da aplicação deixa de ser editável. Por isso, adicione o conector MeuPluggy **durante o teste**. A Pluggy pode mudar essas condições: confira no painel.
- O 4notes não cobra nada e não tem servidor próprio.

## Ligar no 4notes

1. **Configurações › Módulos › Finanças › Conexões bancárias**.
2. Cole o **Client ID** e o **Client Secret** e clique em **Conectar à Pluggy**. O 4notes testa na Pluggy antes de guardar: se ela recusar, nada é guardado.
3. Cole o **Item ID** de um banco, escolha **Buscar a partir de** (o padrão é 30 dias atrás) e clique em **Adicionar banco**. As contas aparecem (conta corrente, poupança, cartão), todas marcadas. Desmarque as que não quiser.
4. **Buscar agora** (ou **Buscar no banco**, na tela de Lançamentos). Com **Buscar ao abrir o app** ligado, o 4notes busca sozinho uma vez por dia.

## O que acontece numa busca

- As transações entram direto nos Lançamentos, com a **categoria automática** (o que você já fez, um dicionário de estabelecimentos e a categoria padrão). O aviso tem **Desfazer**, que tira só o que veio daquela busca.
- Cada transação guarda o id dela (`externalId: "pluggy:<id>"`). Uma transação que já entrou nunca entra de novo, mesmo buscando nos dois aparelhos.
- DEBIT vira gasto e CREDIT vira entrada, com o valor em centavos e sem sinal.
- Transações ainda **pendentes** no banco ficam para a próxima busca (podem mudar até serem lançadas).
- Com o **cartão** do mesmo banco conectado, o **pagamento da fatura** na conta corrente não entra (as compras do cartão já entram uma a uma; seria gasto em dobro). No cartão, o "pagamento recebido" também não vira entrada.
- Um lançamento seu igual (mesmo valor, até 3 dias de diferença): uma **conta pendente** é confirmada como paga; um lançamento **já pago** (feito à mão ou de um extrato) é ligado à transação, sem duplicar.
- Cada busca volta 7 dias antes da última (o banco às vezes lança com data de dias antes).

## Onde ficam os dados

| O quê | Onde |
| --- | --- |
| Client ID e Client Secret | **Só no aparelho**. Windows: `%APPDATA%\4notes\bank.json`, com o segredo criptografado pelo sistema (proteção de dados do usuário). Android: no armazenamento do próprio app (outros apps não leem; não há um cofre do sistema sem um plugin a mais). |
| Bancos, contas escolhidas, "buscar a partir de", última busca | No workspace: `.4notes/settings.json` › `finance` › `bank`. Valem nos dois aparelhos. Nenhuma credencial fica aqui. |
| As transações | Viram lançamentos no `finance/finance.json`, como os outros. |

O que vai para a internet: o Client ID e o Client Secret (para a Pluggy dar uma chave de acesso de 2 horas), os Item IDs e os ids das contas. Só leitura: o 4notes nunca move dinheiro nem altera nada no banco ou na Pluggy. No computador, os pedidos saem do processo principal do Electron (a interface continua sem acesso à rede).

Desconectar (**Desconectar** nas Configurações) apaga o Client ID e o Client Secret do aparelho. Remover um banco para de buscar nele; os lançamentos que vieram dele continuam.

## Mensagens comuns

| Mensagem | O que fazer |
| --- | --- |
| "A Pluggy recusou o Client ID/Client Secret" | Copie de novo os dois no painel da Pluggy (o Client Secret pode ter sido trocado). |
| "Não encontrado na Pluggy. Confira o Item ID" | O Item ID muda se a conexão for refeita no Meu Pluggy. Copie de novo na Demo. |
| "O banco pede uma nova autorização" | O consentimento do Open Finance venceu ou foi revogado. Refaça a conexão no Meu Pluggy. |
| "Muitos pedidos à Pluggy" | Espere alguns minutos. |
| "Sem conexão com a Pluggy" | Confira a internet. |

## Limitações

- **Não testado contra a Pluggy de verdade** durante o desenvolvimento: os testes usam um servidor que imita a API documentada (autenticação, item, contas e transações com cursor). O primeiro uso real vai mostrar se algum banco descreve as transações de um jeito diferente.
- A Pluggy atualiza os dados do Meu Pluggy cerca de uma vez por dia: uma compra de agora pode demorar para aparecer.
- Os lembretes e a busca automática acontecem com o app aberto (o 4notes não roda em segundo plano).
- Transações em outra moeda entram com o valor informado pela Pluggy, sem conversão.

## Para quem mexe no código

- `shared/pluggy.ts`: o cliente da API (sem Electron e sem Android), com os tipos e as mensagens.
- `electron/bank.ts`: credenciais (safeStorage) e pedidos (`net.fetch`) no computador. `FOURNOTES_PLUGGY_URL` (com `FOURNOTES_TEST=1`) aponta para um servidor de teste.
- `app/lib/mobile/bank.ts`: o mesmo no Android (`CapacitorHttp`). Nos testes no navegador, `localStorage["4notes:test-pluggy-url"]`.
- `app/lib/finance/bank.ts`: o que fica no workspace e o plano da importação (`planBankImport`).
- `app/stores/bank.ts`: conectar, bancos, contas, buscar (direto, com Desfazer) e a busca automática.
- `app/components/finance/BankSettings.vue`: a tela nas Configurações.
- Testes: `tests/bank.test.ts` (com `tests/helpers/fake-pluggy.ts`).
