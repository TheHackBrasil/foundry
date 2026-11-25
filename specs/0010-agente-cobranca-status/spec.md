# Spec 0010: agente de cobrança de status com claim verificável

**Status:** rascunho (aguarda aprovação do time)
**Origem:** entrevista com contato da TOTVS (áudio transcrito de
24/11): o embarcador trabalha com 5 a 15 transportadoras, muitas sem
página de rastreio, e descobre o atraso ligando uma a uma. Integrar
transportadora por transportadora é a barreira declarada do mercado.
Cruzado com o second brain (pendência, claim com origem, caso de
exceção) e com a análise competitiva: a Intelipost já cobre status
multicarrier, torre de controle e auditoria de frete; o espaço que
ela não cobre é a transportadora sem integração e a prova neutra
entre as partes.
**Data:** 2026-11-24

## Problema e resultado esperado

Hoje o sistema é puramente reativo: só sabe o que um documento
trouxe. Se nenhuma fonte publica nada, o pedido apodrece em silêncio
e ninguém percebe. É exatamente o cenário do contato da TOTVS: a
transportadora pequena não emite documento novo, e o embarcador só
descobre o atraso quando o cliente liga.

O resultado esperado é o agente virar o braço que falta:

1. Um verificador periódico marca pedidos **sem atualização há X
   horas** como pendência (o gap "pendência" do second brain).
2. O sistema monta uma **cobrança** de status para a transportadora
   pelo canal que ela já usa (e-mail nesta versão), sempre para um
   contato da agenda do workspace, nunca para endereço arbitrário.
3. A resposta chega pela caixa IMAP que já existe e vira um
   **claim**: evento `status_declarado` com origem, remetente,
   `Message-Id`, hash do `.eml` bruto e resultado da verificação
   **DKIM** do domínio remetente.
4. O claim entra na comparação dos quatro campos vigiados; se
   contradisser a NF-e ou uma declaração anterior da mesma
   transportadora, abre divergência e distribui tarefas como sempre.
5. A âncora Merkle, que já existe, passa a cobrir claims com
   evidência: "a transportadora X declarou dia 25 às 14h12" é prova
   que terceiros verificam sem confiar no operador.

A regra da spec 0007 segue íntegra: a LLM é a recepcionista, o
ledger é o cartório. O agente cobra e registra; quem compara,
propaga e ancora é o motor determinístico.

## O que esta spec NÃO faz (enunciado explícito)

- Não vira produto de rastreio multicarrier: não busca posição,
  não integra API de transportadora, não compete com a torre de
  controle da Intelipost.
- Não promete valor jurídico: a âncora prova que a declaração
  existiu naquele instante e não foi alterada; validade em juízo
  não é afirmada em nenhum lugar do produto ou do pitch.
- Não automatiza spam: cobrança exige contato cadastrado, janela
  mínima e (por padrão) aprovação humana.

## Fora de escopo

- WhatsApp/Nvoip como canal de cobrança: template aprovado pela
  Meta e resposta de volta têm atrito próprio; fica para spec
  futura, citado no pitch como próximo passo.
- OCOREN/EDI (P-009): segue pesquisa, não vira parser nesta spec.
- Identidade de pedido muitos-para-muitos (xPed, CT-e cobrindo
  várias NF-e): gap real do second brain, específico demais para
  esta fatia.
- Claims generalizados para todas as fontes: nesta spec só a
  resposta da transportadora vira claim estruturado.
- Ciclo de vida completo de caso (dono, prazo, reabertura): a
  divergência e as tarefas atuais bastam para a demo.
- Envio iniciado pela transportadora sem cobrança prévia: já é
  coberto pelo ingest IMAP genérico da spec 0007.

## Histórias

### US1: juiz vê o pedido apodrecer e a cobrança sugerida

- **Dado** um pedido cujo último evento tem mais de
  `PENDENCIA_HORAS` **Quando** o verificador roda **Então** a
  projeção marca a pendência e uma `Cobranca` aparece como
  `pendente` na trilha, visível no painel e no SSE.
- **Dado** pendência já com cobrança aberta **Quando** o
  verificador roda de novo **Então** nada duplica.

### US2: operador aprova e o e-mail sai de verdade

- **Dado** cobrança `pendente` para contato da agenda **Quando** a
  sessão dona chama `POST /api/cobrancas/:id/enviar` **Então** o
  servidor envia pelo SMTP configurado, com assunto e corpo de
  template citando a chave da NF-e, grava o `Message-Id` gerado e
  marca a cobrança `enviada`.
- **Dado** `SMTP_*` ausente **Quando** o envio é pedido **Então**
  a cobrança vira `pendente_envio` com o motivo visível, sem erro
  500.
- **Dado** sessão visitante tentando enviar cobrança de pedido
  seed **Então** recebe 403, como no restante da spec 0008.

### US3: a transportadora responde e a palavra dela vira claim

- **Dado** cobrança `enviada` **Quando** a resposta chega pelo
  IMAP com `In-Reply-To` do `Message-Id` ou com a chave de 44
  dígitos no assunto/corpo **Então** nasce o evento
  `status_declarado` na fonte `email_transportadora`, com
  `dados.remetente`, `dados.messageId`, `dados.emlHash` (SHA-256
  do `.eml` bruto) e `dados.dkim` em `pass | fail | ausente`.
- **Dado** resposta com DKIM `pass` e a LLM extraindo a nova
  previsão com confiança acima do limiar **Então** o claim entra
  na comparação dos quatro campos vigiados.

### US4: a declaração contradiz a nota e a prova já está guardada

- **Dado** claim "entrega dia 25" contra NF-e prometendo dia 20
  **Quando** a comparação roda **Então** abre divergência de data
  com as duas fontes citadas, distribui as tarefas por papel e o
  painel mostra o selo "verificado DKIM" no evento da
  transportadora.
- **Dado** segunda resposta da mesma transportadora com data
  diferente da primeira **Quando** a comparação roda **Então**
  abre divergência do tipo `mudanca` ("a transportadora mudou a
  própria versão"), fechando o furo de comparação que ignora a
  mesma fonte.

### US5: resposta forjada ou fraca não vira verdade

- **Dado** resposta sem DKIM ou com DKIM `fail` **Quando** é
  processada **Então** a confiança é limitada a 0.6 e o item vai
  para a fila de revisão, nunca direto para o campo vigiado.
- **Dado** resposta que não cita pedido nem responde cobrança
  **Quando** chega **Então** segue o fluxo IMAP genérico atual,
  sem claim.

## Casos de borda

- Resposta menciona chave de pedido de outro workspace: o matching
  só casa cobrança do mesmo workspace; chave estranha vai para o
  fluxo genérico.
- Duas respostas com datas diferentes: a segunda vira `mudanca`
  contra a primeira (US4), não sobrescrita silenciosa.
- Transportadora nunca responde: a cobrança expira em
  `COBRANCA_EXPIRA_HORAS` (default 72) e a pendência continua
  visível; reenvio é manual, respeitando a janela.
- Bounce/erro SMTP: cobrança `erro_envio` com o motivo registrado,
  sem retry automático.
- E-mail cujo corpo a LLM não consegue ler (anexo só de imagem,
  texto vazio): revisão, como todo caminho de baixa confiança.

## Requisitos funcionais

### Pendência por tempo

- **RF1 (P0)** `verificarPendencias(store, agora)`: todo pedido com
  projeção aberta e último evento mais velho que
  `PENDENCIA_HORAS` (env, default 24) ganha `Cobranca` `pendente`
  para a parte `transportadora`; rodada a cada
  `PENDENCIA_TICK_MS` (env, default 5 min) no processo do servidor
  e idempotente por pedido.
- **RF2 (P0)** `Cobranca` persistida no Postgres por workspace:
  `{id, pedidoId, workspaceId, canal, destinatarioContatoId,
  status, messageId, criadaEm, enviadaEm, expiraEm}`; migração
  `ALTER` no padrão da spec 0004.
- **RF3 (P0)** Projeção do pedido expõe `pendencias` e
  `cobrancas`; SSE emite evento de atualização no workspace dono.

### Cobrança por e-mail

- **RF4 (P0)** `app/server/smtp.ts`: envio por `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (envs novas,
  documentadas no `.env.example` sem valores); destinatário
  resolvido exclusivamente por `contatos.ts` do workspace;
  assunto e corpo gerados por template do servidor que inclui a
  chave de 44 dígitos; `Message-Id` gerado no nosso domínio e
  gravado na cobrança.
- **RF5 (P0)** `POST /api/cobrancas/:id/enviar`: só a sessão dona
  da cobrança envia; seed responde 403. `COBRANCA_AUTO=1` (env,
  default off) faz o verificador disparar o envio sem aprovação;
  default mantém aprova
