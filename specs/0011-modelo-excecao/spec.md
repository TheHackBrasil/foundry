# Spec 0011: modelo de exceção completo (second brain -> código)

**Status:** rascunho (implementação em andamento na frente `app-operacao`)
**Origem:** comparação entre a tese refinada no
the-foundry-second-brain e o código da spec 0004. O second brain
modela exceção de fronteira como: afirmação com origem, contradição,
mudança de versão, pendência e caso com dono, prazo e resolução. O
código implementa só a contradição entre fontes. Esta spec fecha os
gaps restantes, sem tocar na spec 0010 (cobrança por e-mail, que
reusa tudo que esta spec cria).
**Data:** 2026-11-24

## Problema e resultado esperado

O motor de hoje compara campos vigiados entre fontes e abre
divergência com tarefa por papel. O que falta para o produto ser o
que a pesquisa descreve:

1. **Mudança**: a mesma fonte muda de ideia (planilha manda dia 20,
   depois dia 25) e nada acende, porque a comparação ignora a
   própria fonte.
2. **Caso de exceção**: divergência vira um caso com dono, prazo,
   status e fechamento registrado, hoje a tarefa não tem dono,
   prazo, status nem evidência de resolução.
3. **Identidade do pedido**: um pedido pode ter várias NF-e e um
   CT-e pode cobrir várias NF-e; hoje `pedidoId` é só a chave de 44
   dígitos da NF-e.
4. **Pendência**: "deveria ter acontecido e não aconteceu", versão
   mínima vem da spec 0010 (tick por tempo); esta spec completa com
   pendência por documento esperado (CT-e sem NF-e, entrega sem
   confirmação).
5. **Métricas**: tempo até perceber, até ter dono, até resolver;
   taxa de exceção por pedido, hoje nada é medido.
6. **Custo da exceção**: estimativa em reais, rotulada como
   simulação, alimentando a tarefa do financeiro.
7. **Parceiro participa**: confirmar ou contestar um caso pelo
   canal que já usa, link de resposta que vira evento.
8. **Tela de operação**: a superfície que mostra casos, claims,
   pendências e métricas, a "torre" do operador, separada da LP e
   da página de IA.

O resultado esperado: qualquer afirmação no sistema carrega quem
disse, quando, de onde e com que confiança; toda contradição vira
caso com dono e relógio; e a tela de operação mostra a fila de
casos, não só a trilha de eventos.

## Fora de escopo

- Canal de cobrança (SMTP, matching IMAP, DKIM): spec 0010.
- Agente proativo externo (WhatsApp, ligação): fase posterior,
  citada no pitch.
- OCOREN/EDI: segue pesquisa.
- Multi-tenant real, autenticação de parceiros externos com conta:
  o link do parceiro é por token opaco, sem login.
- Recálculo retroativo de eventos já gravados: novas regras valem
  para eventos novos; a trilha antiga permanece como está (A9).

## Decisões de modelo (o contrato)

### Claim: afirmação com origem

Todo evento que declara um campo vigiado carrega
`dados.claims[]`: `{campo, valor, afirmadoEm, origem}`. Origem =
fonte do evento + referência extraível (chave, remetente,
messageId). O motor não muda o que compara; passa a registrar por
que compara aquilo.

### Mudança: mesma fonte, versão nova

`compararFontes` ganha passo anterior: para cada fonte com mais de
uma versão de campos, compara versão N com N-1; divergência vira
tipo `mudanca` com `fonte` única e `detalhes.de/para`. Regras de
propagação tratam `mudanca` como divergência comum.

### Caso de exceção

`Caso` = agregado por divergência (ou pendência) aberta:
`{id, pedidoId, workspaceId, divergenciaId, status, donoPapel,
prazo, abertoEm, assumidoEm, resolvidoEm, resolucao}`.
Ciclo: `aberto -> atribuido -> em_resolucao -> resolvido |
contestado`, e `reaberto` volta para `atribuido`. Cada transição é
evento no ledger (`caso_atribuido`, `caso_resolvido`,
`caso_contestado`, `caso_reaberto`), o caso é projeção, nunca
estado solto fora da cadeia.

### Identidade do pedido

`Pedido` ganha `documentos[]`: cada documento que declara
`xPed`, `nPed` ou referência CT-e->NF-e se liga ao mesmo pedido.
Chave de 44 dígitos segue identificador primário; as ligações são
por tabela `pedido_documentos {pedidoId, tipoDoc, referencia}`,
a mesma chave lógica pode agregar NF-e complementar, CT-e e carta
de correção sem criar pedido paralelo. Resolução de match: xPed
igual -> mesmo pedido; CNPJ emitente + série + número iguais ->
mesmo pedido; conflito -> revisão, nunca merge silencioso.

### Métricas

Transições de caso já são eventos, então as medidas saem da
projeção: `tempoAtePerceber` (fato -> divergência aberta),
`tempoAteDono` (aberta -> atribuída), `tempoAteResolver` (aberta ->
resolvida), `taxaExcecao` (pedidos com caso / pedidos).
`GET /api/metricas` expõe por workspace (sessão + seed).

### Custo da exceção

`estimarCusto(caso, pedido)` rotulado: horas de doca ociosa, frete
extra e multa estimados por tabela de coeficientes em
`shared/custo.ts`, com `metodo: 'simulacao'` explícito no retorno.
Aparece na tarefa do financeiro e na tela do caso. Nunca apresentado
como medida real (A7).

### Parceiro participa

`POST /api/casos/:id/resposta` com `token` opaco por caso:
`{acao: confirmar | contestar, texto?}` vira evento
`caso_resposta_parceiro` com `dados.token` hasheado. O token é
emitido na criação do caso e entregue pela cobrança da spec 0010
(ou mostrado ao operador para repasse manual). Sem login, sem
cookie, quem tem o link responde; resposta sempre visível na
trilha.

### Tela de operação

`#/operacao`: fila de casos por status e prazo, painel do caso
(trilha de claims, divergência, tarefas, custo simulado, comprovante
âncora), métricas do workspace. Identidade v4, AA, sem tocar em
LP, `#/ia` ou componentes do agente.

## Histórias

### US1: a mesma fonte se contradiz e vira caso

- **Dado** planilha do fornecedor com previsão dia 20 já ingerida
  **Quando** nova planilha da mesma fonte traz dia 25 **Então**
  abre divergência tipo `mudanca` e um `Caso` com a tarefa de
  justificar a nova versão para o papel dono.

### US2: operador trabalha a fila de casos

- **Dado** 3 casos abertos **Quando** abre `#/operacao` **Então**
  vê a fila ordenada por prazo, assume um caso, marca em resolução
  e resolve com texto; cada passo vira evento na trilha e o tempo
  de cada etapa aparece nas métricas.
- **Dado** caso contestado pelo parceiro **Quando** a resposta
  chega pelo link **Então** o caso fica `contestado`, o operador é
  notificado por SSE e a resposta do parceiro está na trilha.

### US3: documentos de um mesmo pedido se agregam

- **Dado** NF-e com `xPed=4821` e CT-e referenciando-a **Quando**
  ambos são ingeridos **Então** os eventos caem no mesmo pedido e
  `pedido.documentos` lista as referências; CT-e cobrindo duas
  NF-e do mesmo `xPed` agrega as duas.
- **Dado** CT-e referenciando chave de outro `xPed` **Quando**
  ingerido **Então** vai para revisão (conflito de identidade),
  nunca merge silencioso.

### US4: pitch mostra número

- **Dado** a demo roteirizada **Quando** o avaliador abre
  `#/operacao` **Então** vê tempo até perceber (segundos na demo),
  até ter dono, até resolver, taxa de exceção e custo simulado
  rotulado.

## Casos de borda

- Evento sem campos vigiados na versão nova da mesma fonte: sem
  `mudanca` (só compara o que ambas declaram).
- Caso reaberto: métrica usa `abertoEm` original e acumula ciclo
  novo separadamente (`ciclos` na projeção).
- Parceiro responde duas vezes: cada resposta é evento; a última
  define `contestado | confirmado` no caso.
- Pedido seed: casos seed são read-only para visitantes (spec
  0008); visitante vê a fila seed mas 403 em qualquer transição.
- Identidade ambígua (xPed igual, CNPJ diferente): revisão com os
  dois candidatos listados.

## Requisitos funcionais

### Motor (shared/)

- **RF1 (P0)** `mudanca` em `divergence.ts`: comparação N vs N-1 por
  fonte, tipo `mudanca`, propagação igual a divergência comum.
- **RF2 (P0)** `Caso` + transições em `model.ts` e projeção em
  `projection.ts` (ou equivalente): caso derivado de divergência e
  de pendência, com `ciclos` para reabertura.
- **RF3 (P0)** `claims` em `dados` dos eventos que declaram campo
  vigiado, preenchido por cada ingest sem mudar contrato de API.
- **RF4 (P0)** `pedido_documentos` + resolução de identidade
  (xPed -> CNPJ+série+número -> conflito para revisão) em
  `pipeline.ts`.
- **RF5 (P1)** `estimarCusto` em `shared/custo.ts`: coeficientes
  declarados, retorno `{valor, metodo: 'simulacao', itens[]}`.
- **RF6 (P0)** métricas por projeção: tempos por ciclo de caso e
  taxa de exceção.

### Servidor

- **RF7 (P0)** Schema: `casos` e `pedido_documentos` por workspace
  (padrão ALTER da spec 0004); transições como eventos tipados.
- **RF8 (P0)** Rotas: `GET /api/casos`, `GET /api/casos/:id`,
  `POST /api/casos/:id/assumir|resolver|reabrir`,
  `POST /api/casos/:id/resposta` (token), `GET /api/metricas`.
  Sessão escreve só na própria; seed 403 em transições.
- **RF9 (P0)** Pendência por documento esperado: CT-e sem NF-e por
  `PENDENCIA_HORAS`, entrega passada sem confirmação, gera caso de
  pendência (reusa tick da spec 0010; se 0010 ainda não
  implementada, esta spec entrega o tick mínimo).

### Web

- **RF10 (P0)** `#/operacao`: fila de casos (status, prazo, pedido),
  detalhe do caso, ações assumir/resolver/reabrir, resposta do
  parceiro visível.
- **RF11 (P0)** Painel de métricas do workspace na operação.
- **RF12 (P1)** Comprovante: bloco "ancorada em tx" com link
  basescan no detalhe do caso (prepara a superfície pública da
  spec 0010).

## Requisitos não-funcionais

- **RNF1** Nenhuma transição de caso fora do ledger: estado vem de
  projeção, nunca de coluna mutável sem evento correspondente.
- **RNF2** Custo sempre rotulado `simulacao` (A7).
- **RNF3** Token do parceiro opaco, por caso, hasheado em `dados`;
  revogável pelo dono (nova transição `caso_token_revogado` é P2).
- **RNF4** Migrações só `ALTER ADD`; eventos antigos sem `claims`
  projetam claims vazios, sem backfill destrutivo.

## Entidades e invariantes

- `Caso`: projeção de eventos `caso_*`; `donoPapel` é papel do
  mapa de regras (fornecedor/transportadora/CD/fiscal/financeiro),
  não usuário, a demo não tem contas humanas por papel.
- `pedido_documentos`: invariante "um documento pertence a um
  pedido por workspace"; conflito sempre revisão.
- Métricas derivam só de eventos: reimportar a trilha reproduz os
  números.

## Critérios de sucesso observáveis

- Duas planilhas do mesmo fornecedor com datas diferentes ->
  `mudanca` + caso aberto.
- Fluxo completo num pedido: divergência -> caso -> assumir ->
  resolver -> métricas contam os tempos.
- CT-e sem NF-e após `PENDENCIA_HORAS` -> caso de pendência.
- Link do parceiro contesta -> `contestado` + evento na trilha.
- Visitante em outra sessão não vê nem altera casos da sessão A;
  vê seed read-only.

## Premissas

- Spec 0010 aprovada em paralelo; onde há overlap (tick de
  pendência), a que chegar primeiro implementa e a outra reusa.
- `xPed` presente nos XMLs de teste; fixtures novos se necessário.
- Sem pressa de prazo: escopo definido por valor, não por data.
