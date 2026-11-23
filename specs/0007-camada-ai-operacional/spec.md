# Spec 0007: camada AI operacional: ingest universal, mandatos e notificação

**Status:** rascunho (aguarda aprovação do usuário)
**Origem:** decisão do usuário de 23/11 sobre a arquitetura da camada
AI (LLM como camada de acesso e universalidade, nunca de verdade; três
empregos fechados: traduzir intenção para ação tipada, extrair campos
de documento sem parser, escrever texto para humanos) · caminho de
volta do xlsx citado em D-028 · padrão existente de
`app/server/ingest/pdf.ts` (LLM extrai, confiança baixa vai para a
fila de revisão)
**Data:** 2026-11-23

## Problema e resultado esperado

O núcleo do Forseti já prova a tese: documentos viram eventos
imutáveis, campos vigiados são comparados entre fontes e a divergência
vira tarefa por parte. O que falta para a banca de 12/12 é a camada
que torna isso operável por quem não fala JSON: a planilha no formato
que o fornecedor tem (xlsx, que saiu em D-028 por vulnerabilidade da
única lib instalável), um comando em português que vira ação tipada e
auditável ("propague o atraso pros pedidos do fornecedor X", "avise o
CD"), uma agenda de contatos por sessão, a notificação que sai de
verdade pela Nvoip, os sinais consultivos lidos do corpo da CC-e e do
e-mail, e o contrato de interface generativa para o front renderizar
com os componentes que já existem. A regra que vale para tudo aqui:
a LLM é a recepcionista, o ledger é o cartório. Ela nunca escreve no
cartório: o que a IA toca ou vira evento com ator, timestamp e
intenção, ou cai na fila de revisão quando a confiança não basta. O
núcleo determinístico (`app/shared/`, comparação de campos,
`REGRAS_PROPAGACAO`, hash chain, isolamento por workspace) segue como
única fonte de verdade.

## Fora de escopo

- Implementação do front da interface generativa (GenUI nível 2):
  esta spec entrega só o contrato `view-spec` validado no servidor e
  o endpoint. A renderização é do usuário, pessoalmente, com outro
  agente, em trabalho próprio fora desta spec.
- Firecrawl ou ingest de página web: fase futura; quando entrar,
  entra com fixture própria e spec própria.
- Templates de WhatsApp aprovados pela Meta, remetente real e conta
  de produção na Nvoip: a demo usa destinos fictícios e conta de
  teste do time.
- Twin 3D, dominó por evento real e a "cadeia viva" (item 19 do
  `BACKLOG.md`, fator wow da final): outra fatia, com spec própria.
- Ação de mandato fora do conjunto fechado, LLM escrevendo campo
  vigiado direto no ledger, e qualquer execução de texto livre
  gerado pela LLM como código.
- Integração com ERP, SEFAZ, EDI OCOREN (P-009) e qualquer canal que
  peça credencial de cliente.
- Mudança no modelo de isolamento por workspace nem nos campos
  vigiados (RF10 da spec 0004).

## Histórias

### US1: juiz fala com a demo em português

- **Dado** a demo rodando com pedidos da sessão dele **Quando** envia
  `POST /api/mandatos` com `{"texto": "simule o embarque sexta-feira"}`
  **Então** a LLM traduz para a ação tipada, o motor determinístico
  executa a simulação e a resposta traz as divergências e tarefas
  previstas, com um evento `mandato` gravado na cadeia do pedido.
- **Dado** o mesmo endpoint **Quando** o texto é ambíguo ou pede ação
  fora do conjunto ("apague o pedido") **Então** a resposta é 422 com
  o motivo, e nada muda no ledger além de não ter mudado nada: nenhum
  efeito colateral.
- **Dado** a demo sem `LLM_API_URL` **Quando** o mesmo envio chega
  **Então** a resposta é 503 declarativa e a demo inteira segue
  funcionando sem a camada de linguagem.

### US2: fornecedor manda a planilha no formato que ele tem

- **Dado** um `.xlsx` legítimo com as mesmas colunas do CSV **Quando**
  entra pelo upload ou por anexo de `.eml` **Então** a planilha é lida
  num `worker_threads` com limite de recursos, depois de checagem
  estrutural do zip, o worker converte a primeira planilha em texto
  CSV com valores formatados (data em `AAAA-MM-DD`, nunca serial
  Excel) e o texto cai no `parseCsv` sem mudança: cada linha vira
  documento `planilha` com os mesmos campos.
- **Dado** um `.xlsx` malformado, zip corrompido ou com expansão
  absurda **Quando** sobe **Então** a resposta é 422 com motivo e o
  processo segue em pé, sem inflar o arquivo na memória.
- **Dado** um `.xlsx` legítimo cujo layout o `parseCsv` não reconhece
  **Quando** sobe **Então** não falha solto nem some linha: a LLM
  propõe o mapeamento coluna a campo canônico e o documento vai para
  a fila de revisão com a proposta anexa; aprovado, o mapeamento vale
  para o documento e fica guardado como template daquele remetente.

### US3: juiz vê o efeito físico e a trilha

- **Dado** uma divergência propagada e um contato cadastrado para a
  parte afetada **Quando** a notificação está ligada **Então** a API
  Nvoip recebe o texto gerado a partir da divergência e do papel, e o
  ledger grava o evento `notificacao` com canal, destino e status.
- **Dado** a Nvoip desligada ou sem contato para a parte **Quando**
  o mandato "avise o CD" chega **Então** o evento `notificacao`
  registra `nao_entregue` com o motivo e o fluxo segue intacto.

### US4: avaliador técnico confere que a IA nunca escreve verdade

- **Dado** uma CC-e cujo texto diz "reagendamos para sexta" **Quando**
  ela entra **Então** o evento `sinal` registra o aviso consultivo
  com confiança e fonte, e nenhum campo vigiado muda (R-006): o atraso
  continua entrando só por fonte que o declara.
- **Dado** um PDF cuja extração traz `peso_kg: "12kg"` **Quando** a
  validação de tipo roda antes do modelo canônico **Então** o campo
  inválido não entra silencioso: ou é normalizado com regra explícita
  ou a extração vai para a revisão.

## Casos de borda

- `worker_threads` estourando limite de memória ou tempo: o worker é
  encerrado, a resposta é 422 e o event loop principal nunca bloqueia.
- Mandato cujo filtro resolve pedidos demais: resposta 422 pedindo
  filtro mais específico, com teto de alvos declarado.
- Mandato que resolve zero pedidos: 422 `sem_alvo`, sem efeito.
- Nvoip sem credencial (`NVOIP_API_URL`/`NVOIP_API_KEY` ausentes):
  nada sai para a rede; mandato `notificar` grava `notificacao` com
  status `nao_entregue` e motivo `desligado`. A propagação normal não
  gera evento de notificação quando está desligada.
- Contato sem canal compatível com a Nvoip configurada, ou sem
  contato para a parte: `nao_entregue` com motivo, nunca exceção.
- LLM que responde JSON inválido, ação fora do enum ou campos que
  falham na validação de schema: 422 com motivo; o texto bruto não
  vaza para o ledger.
- `sinal` de confiança abaixo do limiar: descartado, sem evento e sem
  fila de revisão (sinal é informativo; o custo de revisão é para
  documento, não para palpite).
- `.eml` sem corpo de texto ou CC-e sem `xCorrecao`: nada a extrair,
  nenhum sinal, o documento segue normal.
- `.xlsx` com fórmula sem valor cacheado (arquivo que nunca passou
  pelo Excel), célula mesclada sobre linhas de dados, ou cabeçalho
  fora do schema: nada de linha sumida nem `NaN`; o arquivo vai para
  a fila de revisão com o motivo, e o caminho de RF11 propõe o
  mapeamento.
- Template de mapeamento de um remetente não se aplica a outro: a
  chave é `(workspace, remetente)` e o template só entra depois de
  aprovado uma vez.
- `contatos` repetidos: `PUT /api/contatos` faz upsert por
  `(workspace, parte)`; o bootstrap por documento nunca sobrescreve
  um contato cadastrado à mão.
- `view-spec` emitido fora do schema ou com componente inexistente:
  o servidor descarta e devolve a visão padrão determinística, nunca
  erro solto.

## Requisitos funcionais

Prioridades: **P0** = sem isso a tese não se mostra; **P1** = fator
wow operacional; **P2** = contrato para a próxima fatia.

### Ingest universal

- **RF1 [P0]**: `.xlsx` volta ao upload e ao `.eml`, revertendo D-028
  pelo caminho que ela mesma declara: "ler a planilha num
  `worker_threads` com limite de recursos e checar o zip antes de
  inflar". Obrigatório: leitura em `worker_threads` com
  `resourceLimits` (memória) e timeout; checagem estrutural do zip
  antes de inflar (tamanho declarado, razão de expansão, número de
  arquivos no diretório central); sem a lib `xlsx` (CVE-2024-22363 e
  prototype pollution, D-028). Implementação: `exceljs` em versão
  pinned com mais de 7 dias de publicação (decidido: `exceljs`,
  porque datas do Excel são seriais e a conversão precisa de
  valores formatados). Saída = o mesmo `DocData[]` do `parseCsv`,
  fonte `planilha`. `detectarTipo` passa a reconhecer `xlsx` (hoje
  rejeita em `detect.ts:16`); `.eml` e IMAP já aceitam o anexo.
  Conversão: o worker lê a primeira planilha (ou a que tiver o
  cabeçalho esperado) e emite texto CSV com valores formatados
  (data serial do Excel sai como `AAAA-MM-DD`, nunca como número);
  o `parseCsv` existente continua sendo o único parser tabular,
  sem mudança de mapeamento. Falha estrutural (fórmula sem valor
  cacheado, mesclada ambígua, cabeçalho irreconhecível) não falha
  solto: segue o caminho de RF11. Aceite: fixture `.xlsx`
  equivalente à `planilha.csv` gera os mesmos eventos; zip
  malformado ou com razão de expansão absurda responde 422 sem
  travar.
- **RF2 [P0]**: validação de tipo dos campos extraídos por LLM antes
  do modelo canônico (`pdf.ts:87-90` hoje copia direto). Campo com
  tipo inválido (`peso_kg` como `"12kg"` string, data fora de
  `AAAA-MM-DD`) é normalizado por regra explícita ou descartado com
  registro na extração; `pedidoId` inválido ou campo essencial
  inválido manda para a revisão como hoje. Nunca `NaN` nem string
  crua em `CamposObservados`.
- **RF3 [P1]**: sinal semântico. O corpo de texto do `.eml` e o
  `xCorrecao`/`descEvento` da CC-e passam por extração LLM que
  devolve sinais consultivos tipados (`Sinal`: `tipo` em
  `atraso_avisado | reagendamento | instrucao | outro`, `resumo`,
  `confianca`, `fonte`). Cada sinal com confiança no limiar vira
  evento `sinal` na cadeia do pedido do documento, só depois do
  pedido existir (documento órfão segue para a revisão como hoje, sem
  sinal). O sinal nunca declara campo vigiado nem vira divergência:
  é trilha informativa auditável (R-006 respeitado). Sem
  `LLM_API_URL`, nenhum sinal é extraído e o documento entra igual.

### Mapeamento de layout por IA

- **RF11 [P2]**: planilha cujo cabeçalho/layout o `parseCsv` não
  reconhece não morre em 422 nem perde linha: a LLM lê a amostra e
  propõe o mapeamento coluna a campo canônico (`{coluna -> campo}`,
  confiança, motivo). O documento vai para a fila de revisão com a
  proposta anexa; a aprovação executa o ingest com o mapeamento
  aprovado e guarda o template por `(workspace, remetente)` em
  tabela `templates` no padrão DDL idempotente de `store.ts`.
  O próximo arquivo do mesmo remetente aplica o template direto,
  sem LLM e sem revisão: a planilha do fornecedor entra uma vez
  com revisão, da segunda em diante o formato já é conhecido.
  Sem `LLM_API_URL`, o documento vai para a revisão sem proposta.
  A LLM propõe mapeamento, nunca dado: os valores continuam saindo
  do parser determinístico rodando com o mapeamento aprovado
  (mesma regra dos empregos fechados). Template é dados de sessão,
  não vaza entre workspaces e nunca se aplica a outro remetente.

### Mandatos

- **RF4 [P0]**: `POST /api/mandatos` recebe `{"texto": "<pt-BR livre>"}`
  e responde a ação tipada executada. A LLM traduz para JSON validado
  por schema de conjunto fechado:
  `{acao: "propagar" | "simular" | "resumir" | "notificar", filtros: {fornecedor?, parte?, pedidoId?, campo?, valor?}, alvo?}`.
  A execução usa só o motor determinístico existente: `propagar`
  reprocessa divergências -> tarefas sobre os pedidos do filtro
  (`camposPorFonte` + `divergenciasDaNovaFonte` + `propagarTodas`,
  idempotente); `simular` executa a mesma função do `/api/simulate`
  (RF10) sem gravar nada além do evento `mandato`; `resumir` devolve
  o estado do(s) pedido(s) com texto redigido pela LLM para o papel
  pedido, com resumo determinístico como fallback; `notificar`
  despacha RF7. Respostas: 200 com `acao`, `alvos` e `resultado`;
  422 `parse_falhou` | `acao_ambigua` | `sem_alvo` | `filtro_largo`;
  503 sem `LLM_API_URL` (mensagem pt-BR, nada quebra). Cota por IP
  como a do PDF (`JanelaFixa`, env própria) e conta no limite de
  escrita por minuto.
- **RF5 [P0]**: todo mandato aceito grava evento `mandato` na cadeia
  de cada pedido alvo, com `prevHash`/`hash` normais: payload
  `{ator: "workspace", texto, acao, filtros, resultado resumido}`.
  Comando agentic auditável é a tese aplicada a si mesma. O evento é
  derivado (não entra em `TIPOS_DOCUMENTO` nem conta como documento
  no uso da sessão). A execução e a gravação rolam na mesma
  transação por pedido.
- **RF6 [P0]**: novos tipos de evento `mandato`, `sinal` e
  `notificacao` em `TipoEvento` (`app/shared/model.ts`), fora de
  `TIPOS_DOCUMENTO`/`FONTES_DOC` (são derivados, como `divergencia` e
  `tarefa`). A projeção os expõe em campos próprios para o front
  consumir depois (sinais por pedido, notificações por pedido), sem
  mudar o cálculo de divergências.

### Contatos e entrega

- **RF7 [P1]**: agenda de contatos por workspace:
  `parte -> {nome, canal, destino}` com `canal` em
  `whatsapp | sms | ligacao | email`. Tabela `contatos` por
  `(workspace_id, parte)` no padrão DDL idempotente de `store.ts`.
  Bootstrap: o parse da NF-e passa a ler `fone` de `enderEmit`/
  `enderDest` quando presente, e o ingest faz upsert do fornecedor
  (emit da NF-e) e da transportadora (emit do CT-e) marcados
  `fonte: "documento"`, sem sobrescrever contato `manual`.
  `GET /api/contatos` devolve a agenda da sessão mais a da seed;
  `PUT /api/contatos` faz upsert na sessão do chamador (seed só
  leitura, como todo escrita). A seed recebe 4 contatos fictícios
  rotulados (fornecedor, transportadora, cd, financeiro).
- **RF8 [P1]**: entrega Nvoip. Config por env (`NVOIP_API_URL`,
  `NVOIP_API_KEY`, `NVOIP_CANAL_PADRAO`), desligada por padrão.
  Gatilhos: o mandato `notificar` (RF4) e, quando ligada por env,
  a tarefa propagada cuja parte tem contato com canal compatível.
  O texto é gerado pela LLM a partir da divergência e do papel
  (emprego c da arquitetura); sem LLM, um template determinístico
  com campo, valores e parte. Resultado: evento `notificacao` por
  pedido com `{parte, canal, destino, mensagem, status, motivo?}`,
  `status` em `entregue | nao_entregue`. Falha de rede, ausência de
  credencial ou de contato: `nao_entregue` registrado, o fluxo nunca
  quebra. Telefone e destino ficam na sessão do dono (RF27 da 0004);
  nada sai para a rede quando desligada.

### Contrato de interface generativa

- **RF9 [P2]**: schema `view-spec` (`ViewSpec` em `model.ts`):
  `{versao: 1, fontesVisiveis: FonteDocumento[], colunas: CampoVigiado[], lente: Parte, destacarDivergencias: boolean}`.
  `GET /api/pedidos/:id/view-spec?papel=<parte>` pede à LLM a visão
  para aquele papel, valida server-side contra o schema e os enums
  conhecidos e devolve o spec; inválido ou sem LLM, devolve a visão
  padrão determinística (todas as fontes, todas as colunas, lente do
  papel pedido). O front renderiza só com componentes existentes: a
  implementação da renderização é explicitamente reservada ao usuário
  com outro agente e não faz parte desta spec.

### Correções no mesmo código

- **RF10 [P0]**: `/api/simulate` passa a comparar com a função
  `diverge`/`compararFontes` de `app/shared/divergence.ts` (hoje
  replica a comparação em `index.ts:283-294` sem a tolerância de peso
  e com `fonteA`/`fonteB` fixos). `fonteA` passa a ser a fonte real
  do valor atual (a última que declarou o campo) e `fonteB` é
  `manual`, a hipótese. Comportamento pinado por teste.

## Requisitos não-funcionais

- **NFR-verdade:** a LLM nunca escreve verdade: campo vigiado só vem
  de parser determinístico ou de campo validado por tipo; ação só
  sai do conjunto fechado executado pelo motor; texto para humanos
  só sai como mensagem, nunca como regra. Toda saída dela ou vira
  evento auditável ou cai na fila de revisão (padrão de `pdf.ts`).
- **NFR-degradação:** sem `LLM_API_URL`/`LLM_API_KEY` a demo inteira
  funciona: mandatos 503 declarativo, sinais ausentes, PDF na
  revisão, notificação por template, `view-spec` padrão.
- **NFR-dados:** eventos novos seguem append-only com hash chain;
  `contatos` é tabela nova no DDL idempotente de `store.ts`, sem
  migration numerada. Nenhum arquivo imutável tocado (A9).
- **NFR-autorização/publicação:** credenciais Nvoip, LLM e IMAP só
  em `.env` (A2); `.env.example` documenta as novas envs sem valor.
- **NFR-privacidade:** corpo de e-mail passa pela LLM na mesma regra
  do texto de PDF (regulamento 6.9: só documento sintético); o corpo
  não vai para o ledger nem para log, só o sinal extraído (RF27 da
  0004). Contatos de sessão ficam na sessão.
- **NFR-demo:** custo de LLM sob cota por IP (mesmo padrão do PDF);
  chamadas com timeout; nada de simulação apresentada como medida
  (A7): o evento `mandato` registra que foi comando, a notificação
  registra o que saiu de verdade ou não.
- **NFR-a11y:** n/a no servidor; o front do view-spec é reservado e
  herda A6 inteiro quando existir.
- **NFR-idioma:** pt-BR nas mensagens e na prosa; identificadores em
  inglês (A6).
- **NFR-dependência:** nenhuma lib de planilha vulnerável; qualquer
  dependência nova entra pinned e com dias de publicação
  verificados, ou vira parser próprio.

## Entidades e invariantes

- `app/shared/model.ts`: `TipoEvento` ganha `mandato`, `sinal`,
  `notificacao`; tipos novos `Sinal`, `Contato`, `CanalContato`,
  `MandatoParseado`, `AcaoMandato`, `ViewSpec`; `ProjecaoPedido`
  expõe `sinais` e `notificacoes`.
- `app/server/llm.ts` (novo): cliente único de chat JSON com
  timeout e extração de `choices[0].message.content`; usado por
  `sinal.ts`, `mandatos.ts`, `viewspec.ts`, `nvoip.ts` (texto) e
  candidato a absorver o fetch de `pdf.ts` quando couber.
- `app/server/mandatos.ts` (novo): prompt, validação do JSON
  tipado (à mão, sem zod, no padrão do server), resolução de alvos
  e execução pelo motor.
- `app/server/contatos.ts` (novo): agenda por workspace, bootstrap
  por documento, 4 contatos fictícios da seed.
- `app/server/nvoip.ts` (novo): envio pela API Nvoip, texto por
  LLM com template de fallback, evento `notificacao`.
- `app/server/sinal.ts` (novo): extração de sinais consultivos por
  LLM com limiar de confiança.
- `app/server/viewspec.ts` (novo): geração e validação de
  `ViewSpec` com default determinístico.
- `app/server/ingest/xlsx.ts` + worker (novos): parser da planilha
  com checagem de zip e limites; `detect.ts` reconhece `xlsx`;
  `seed.ts` passa a considerar `.xlsx` na ordem.
- `app/server/ingest/pdf.ts`: validação de tipo dos campos (RF2),
  timeout e cap de expansão (a parte de expansão já é da spec 0008;
  aqui entra o que faltar).
- `app/server/ingest/eml.ts`: devolve corpo de texto além dos
  anexos (para RF3); `eventos.ts` expõe o texto da correção para o
  extrator de sinais.
- `app/server/pipeline.ts`: emite eventos `sinal` depois do doc, no
  mesmo fluxo de divergência, quando o documento traz sinais; e, se o
  gatilho por env for aprovado, chama `nvoip.ts` ao criar tarefa
  propagada cuja parte tem contato com canal compatível.
- `app/server/store.ts`: tabela `contatos` e CRUD por workspace,
  no padrão DDL idempotente.
- `app/server/index.ts`: rotas `POST /api/mandatos`,
  `GET/PUT /api/contatos`, `GET /api/pedidos/:id/view-spec`;
  `/api/simulate` reusando a comparação de `divergence.ts`.
- `app/shared/divergence.ts`: `diverge` exportada para o simulate.
- Invariantes que não mudam: ledger append-only por pedido com hash
  chain; campos vigiados vêm só de parser validado; divergência e
  tarefa só saem do motor determinístico; seed só leitura pela API;
  isolamento por workspace.

## Critérios de sucesso observáveis

- [ ] `POST /api/ingest` com `.xlsx` legítimo gera os mesmos eventos
      que o CSV equivalente; `.eml` com `.xlsx` anexo segue o mesmo
      caminho; zip malformado e razão de expansão absurda respondem
      422 sem travar nem inflar.
- [ ] `POST /api/mandatos` `{"texto":"propague o atraso pros pedidos do fornecedor X"}`
      executa `propagar` pelo motor e grava `mandato` com hash chain;
      texto ambíguo responde 422 sem efeito; sem `LLM_API_URL`
      responde 503.
- [ ] `GET /api/contatos` devolve os 4 contatos fictícios da seed;
      `PUT` cria/atualiza na sessão; contato manual sobrevive ao
      bootstrap por documento.
- [ ] Mandato `notificar` com Nvoip desligada grava `notificacao`
      `nao_entregue` com motivo; com credencial de teste e contato
      cadastrado, sai entrega real com `entregue` registrado.
- [ ] `.eml` e CC-e com texto de reagendamento geram evento `sinal`
      com `resumo` e `confianca`, e nenhum campo vigiado muda
      (teste de R-006 segue verde).
- [ ] `GET /api/pedidos/:id/view-spec?papel=cd` devolve `ViewSpec`
      válido; LLM fora ou JSON inválido devolve o default, nunca 500.
- [ ] Extração PDF com `peso_kg:"12kg"` não grava `NaN` nem string
      crua em `pesoTotal`: normalizada ou revisão, pinado por teste.
- [ ] `/api/simulate` usa `diverge`/`compararFontes`: peso dentro da
      tolerância não diverge, e `fonteA` reflete a fonte real do
      valor atual.
- [ ] `tsc --noEmit` limpo; `npm test` verde; guard e prose-evals
      exit 0.

## Premissas

- A spec 0008 (blindagem) integra antes desta: as frentes daqui
  nascem sobre a `main` já com lock de idempotência, cota de sessões,
  IMAP corrigido e `ItemRevisao` no contrato.
- `LLM_API_URL`/`LLM_API_KEY` seguem o padrão OpenAI-compatível já
  documentado em `app/.env.example` (D-026); o mesmo cliente serve
  mandatos, sinais, view-spec e texto de notificação.
- Nvoip é a provedora de notificação decidida pelo usuário; conta e
  credencial de teste são do time e ficam fora do repo.
- A renderização do `view-spec` é do usuário: esta spec entrega só o
  contrato e o endpoint.
- O parser `.xlsx` usa `exceljs` em versão pinned com mais de 7
  dias de publicação (decidido); nenhuma outra dependência nova é
  obrigatória.

## Perguntas decididas

- `.xlsx`: `exceljs` em versão pinned (>7 dias de publicação), porque
  datas do Excel são seriais e a conversão precisa de valores
  formatados (`cell.text`/`cell.value` resolvido); um parser mínimo
  próprio teria que interpretar `numFmt`. O worker ainda checa o zip
  antes de inflar e roda com `resourceLimits` + timeout (D-028).
- Conversão `.xlsx` em texto CSV no worker e `parseCsv` sem mudança:
  o parser tabular existente segue único (decisão do usuário, 23/11).
- Layout desconhecido resolve por IA: mapeamento coluna a campo
  proposto por LLM, aprovado na revisão, persistido como template
  por remetente (RF11; decisão do usuário, 23/11).
- Evento `mandato` por pedido alvo: o ledger é por pedido e a trilha
  fica onde o comando agiu.
- `propagar` é repropagação idempotente das divergências já
  registradas; escrever documento novo pelo mandato fica fora.
- Gatilho de notificação na propagação: env global
  `NVOIP_NOTIFY_ON_TASK`, desligada por padrão.
- Bootstrap de contatos: só fornecedor e transportadora, quando o
  documento traz `fone`; destinatário da NF-e não alimenta papel
  automaticamente (CD, fiscal e financeiro ficam manuais/seed).
- Números de decisão sugeridos D-043 em diante (a integração numera
  de verdade).
