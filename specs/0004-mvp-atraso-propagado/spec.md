# Spec 0004: MVP da camada de coordenação (documentos reais + divergência)

**Status:** aprovada
**Origem:** `BACKLOG.md` item 8 · decisões D-015 a D-018 · proposta de
escopo do time (doc de trabalho, 20/11)
**Data:** 2026-11-20

## Problema e resultado esperado

A dor validada na FENATRAN e na call de 16/11: um pedido atravessa
fornecedor, transportadora, CD, fiscal e financeiro, cada um no seu
sistema, e divergências se resolvem por telefone e conferência manual.
Quando isto estiver pronto, `app/` lê o que cada parceiro já produz
(XML de NF-e e CT-e, e-mail, planilha), monta um registro único do
pedido em cadeia de hashes e sinaliza divergências para cada parte com
a tarefa que lhe cabe. A demo roda com documentos fiscais reais de
schema (dados sintéticos rotulados) e uma âncora em blockchain pública
prova a integridade do histórico.

## Fora de escopo

- Integração com ERP, API de SEFAZ, WhatsApp ou banco (pedem
  credencial, certificado A1 ou onboarding pesado).
- Twin de galpão com docas e sensores, app mobile, marketplace,
  roteirização interna (D-002).
- Piloto ou implantação real (sem promessa antes de 30/11, `RULES.md`).
- Blockchain permissionada, nó por empresa, wallet para o usuário,
  escrow on-chain (backlog pós-hackathon, D-017).
- MDF-e, CIOT, NFCom e manifestação do destinatário (citados no pitch
  como fluxo completo, não construídos).
- Capítulo do site sobre o MVP (entra quando a demo existir).

## Histórias

### US1: avaliador da banca quer ver a camada trabalhar sobre dado real

- **Dado** a demo rodando **Quando** o apresentador envia um XML de
  NF-e (upload ou e-mail) **Então** o pedido aparece na torre com as
  partes preenchidas a partir do documento.
- **Dado** o pedido criado **Quando** chega um evento de divergência
  (CC-e de atraso, CT-e com data ou peso divergente) **Então** as
  visões de cada parte acendem com a tarefa que lhes cabe, em tempo
  real.

### US2: avaliador técnico quer prova de integridade

- **Dado** o histórico do pedido **Quando** abre a auditoria **Então**
  vê a cadeia de hashes válida, a raiz ancorada em Base Sepolia e o
  link da transação no explorer.
- **Dado** um evento adulterado à mão (bypass da trigger do banco)
  **Quando** re-roda a verificação **Então** a auditoria falha
  nomeando o evento.

### US3: o time quer um modelo que sobreviva à call Enviagora

- **Dado** o modelo pedido + evento + parte **Quando** a call definir
  outra dor **Então** ela entra como tipo de evento/documento novo,
  sem reescrever a arquitetura.

### US4: juiz ou mentor quer testar sozinho

- **Dado** a URL pública da demo **Quando** sobe o próprio XML ou
  planilha **Então** vê o pedido montado e o selo "dados fictícios".

## Casos de borda

- XML inválido ou fora do schema: parser rejeita com erro explícito,
  nunca 500 solto (A3).
- Evento sem pedido correspondente (chave desconhecida): vai para a
  fila de revisão em vez de falhar.
- Chain pública fora do ar ou sem saldo: âncora falha declarada, a
  demo segue com a cadeia local.
- SSE desconecta: UI reconecta e repõe estado via GET.
- Seed re-executada: idempotente, recria o cenário sintético.

## Requisitos funcionais

Prioridades: **P0** = demo mínima · **P1** = fator wow · **P2** = só
se sobrar. Corte preserva P0 primeiro, depois P1 na ordem inversa.

### Ingestão (o que cada parceiro já produz)

- **RF1 [P0]**: parser de NF-e (XML): chave de 44 dígitos é a
  identidade natural do pedido; extrai emitente, destinatário, itens,
  pesos e datas.
- **RF2 [P0]**: parser de CT-e (XML): liga transportadora e frete à NF
  pela chave.
- **RF3 [P0]**: parser de eventos fiscais (CC-e, cancelamento): é o
  gatilho real do atraso/divergência.
- **RF4 [P0]**: upload manual de arquivo na demo (plano B ao vivo e
  porta para o juiz testar).
- **RF5 [P1]**: caixa de e-mail dedicada via IMAP: documento enviado
  por e-mail entra sozinho na camada.
- **RF6 [P1]**: ingestão de planilha CSV/XLSX fazendo o papel de
  ERP/WMS do CD.
- **RF7 [P1]**: extração de PDF por LLM com fila de revisão humana
  visível na UI (o erro de extração é confessado, não escondido).

### Motor (documento vira alerta)

- **RF8 [P0]**: modelo canônico `Pedido`/`Evento`/`Parte` em
  `app/shared/`; contrato único server x web.
- **RF9 [P0]**: ledger versionado com hash encadeado (SHA-256,
  `prev_hash`); gravação só append; Postgres rejeita UPDATE/DELETE na
  tabela de eventos via trigger.
- **RF10 [P0]**: detecção de divergência entre fontes (data, peso,
  volumes, status); é o produto.
- **RF11 [P0]**: grafo de propagação determinístico transforma
  divergência em tarefa por parte (CD, fiscal, financeiro,
  transportadora); regra em `rules.ts` como dado.
- **RF12 [P1]**: simulação "e se?" reusando o grafo com entrada
  hipotética (é o que justifica chamar de twin).
- **RF13 [P2]**: impacto estimado em reais por divergência, sempre com
  rótulo de simulação (A7).

### Registro verificável

- **RF14 [P1]**: `POST /api/anchor` grava a raiz Merkle dos eventos no
  contrato `FoundryAnchor` na Base Sepolia; audit expõe tx + link do
  explorer. Cobre os eventos que a camada mesma cria (não-fiscais),
  onde a SEFAZ não autentica.
- **RF15 [P0]**: `GET /api/pedidos/:id/audit` verifica a cadeia e
  aponta a primeira adulteração.

### Interface (o fator wow em cima do motor)

- **RF16 [P0]**: painel de alertas por papel: cinco visões
  (fornecedor, transportadora, CD, fiscal, financeiro), propagação ao
  vivo via SSE, selo "dados fictícios".
- **RF17 [P1]**: dominó da propagação movido por evento real (a peça
  que o juiz guarda; site já tem a ilha).
- **RF18 [P1]**: linha do tempo do pedido com as versões lado a lado e
  hashes clicáveis.
- **RF19 [P1]**: tela da fila de revisão (torna o limite da automação
  visível; conta a favor na banca).
- **RF20 [P2]**: twin da cadeia (mapa de nós e cargas, three.js já no
  stack do site); entra só se P1 fechar cedo.

### Dados, entrega e narrativa

- **RF21 [P0]**: conjunto de XMLs sintéticos coerentes (schema real,
  CNPJ fictício, chaves consistentes) em `app/seed/`, rotulados.
- **RF22 [P0]**: testes de parser, cadeia e divergência; demo ao vivo
  não pode quebrar.
- **RF23 [P0]**: critérios oficiais de avaliação do HackBrasil
  levantados (P-005) e registrados em `RULES.md`.
- **RF24 [P1]**: demo pública com URL (juiz testa sozinho).
- **RF25 [P1]**: pitch v11 com gravação da demo.
- **RF26 [P1]**: comparação documentada com a Emiteaí (R-004).

## Requisitos não-funcionais

- **NFR-dados:** dados da demo sintéticos e rotulados; nenhum dado de
  empresa real (A7).
- **NFR-autorização/publicação:** `app/` público por definição;
  nenhum segredo versionado; chave de testnet e credencial IMAP só em
  `.env` local (A2).
- **NFR-privacidade:** nenhuma pessoa nova citada (A5 n/a).
- **NFR-demo:** simulação e extração probabilística rotuladas na UI
  (A7).
- **NFR-a11y:** contraste AA laranja/escuro, foco visível, teclado,
  `prefers-reduced-motion` (A6).
- **NFR-idioma:** UI e docs em pt-BR; identificadores em inglês (A6).
- **NFR-domínio:** regras puras em `app/shared/`; efeitos falham na
  borda (A3).

## Entidades e invariantes

- `app/shared/model.ts`: `Parte`, `TipoEvento`, `Evento`, `Pedido`,
  `VersaoPedido`.
- `app/shared/chain.ts`: `hashEvento`, `verificarCadeia` (puros,
  testados).
- `app/shared/rules.ts`: mapa divergência → tarefas por parte.
- `app/server/ingest/`: parsers (nfe.ts, cte.ts, eventos.ts, csv.ts,
  imap.ts, pdf.ts); efeitos isolados aqui.
- Postgres: tabela `events` append-only com trigger anti
  UPDATE/DELETE.
- `app/contracts/FoundryAnchor.sol` (P1); escrow é backlog pós-30/11.

## Critérios de sucesso observáveis

- [ ] Enviar XML de NF-e (upload ou e-mail) cria pedido com partes
      preenchidas.
- [ ] CC-e/CT-e divergente acende a tarefa certa em cada visão via SSE.
- [ ] UPDATE via admin no banco falha (trigger); bypass dele é pego
      pelo audit nomeando o evento.
- [ ] Anchor gera tx visível em sepolia.basescan.org.
- [ ] `tsc --noEmit` limpo; `node --check` em `.js`/`.mjs`; guard e
      prose-evals exit 0.
- [ ] Demo de 3 min ensaiada ponta a ponta sem intervenção.
- [ ] (P1) URL pública acessível; (P2) twin renderiza a cadeia.

## Premissas

- Node >= 22.23.4; Docker (ou Neon) para Postgres; Base Sepolia com
  faucet; schemas públicos de NF-e/CT-e (layout fixo).
- Deadline 30/11; call Enviagora semana de 23/11 valida, não decide
  (US3).
- 3 pessoas em frentes `wt/`; ~10 dias de calendário.

## Perguntas abertas

Nenhuma. Recorte consolidado em 20/11 a partir da proposta do time +
análise da sessão (D-018).
