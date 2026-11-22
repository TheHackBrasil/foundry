# Brief · frente `app-core`

Escopo: núcleo de domínio e ingest da spec 0004: `app/shared/` (modelo,
cadeia de hashes, divergência, regras, projeção, Merkle) e
`app/server/ingest/` (parsers de NF-e, CT-e, eventos fiscais, CSV/XLSX,
IMAP, PDF por LLM e, se o P-009 for aceito, OCOREN). A primeira versão
foi escrita por Gui na `wt/app-core` em 21/11 e é a base do código
(D-022).
Paths: `app/shared/**`, `app/server/ingest/**`. Não escrever em
`app/server/*.ts` (rotas, store, SSE e pipeline são da `app-infra`),
`app/package.json`, lockfile e `app/tsconfig*.json` (`app-infra`),
`app/web/**` nem `app/seed/**`.
Dependência nova: peça à `app-infra` no Linear.
Contratos: com a `app-infra`, os parsers de `app/server/ingest/`
(`detectarTipo` e um parser por tipo, que lançam `ErroParser` para
entrada ruim); `app/server/pipeline.ts` os chama e grava. Com a
`app-demo`, os tipos de resposta de `app/shared/model.ts`
(`ResultadoIngest`, `ProjecaoPedido`, `RespostaAuditoria`,
`RespostaSimulacao`). Parser não grava e não loga cabeçalho de `.eml`
(traz endereço de pessoa, RF27).
Base: `main` com spec 0004 commitada; branch `wt/app-core`; worktree
`../foundry-wt-app-core`.
Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*` no repo, escrever fora dos paths, dado real de empresa ou
de pessoa nos testes.
Gate: `node scripts/repo-guard.mjs` e `node scripts/prose-evals.mjs`
exit 0; `npm run typecheck` limpo; `npm test` verde; corpus da seed
parseia com campos corretos; XML inválido rejeita com erro explícito;
CC-e nunca vira atraso (R-006); `.eml` com a NF-e em anexo gera os
mesmos eventos que o upload do XML; a verificação da cadeia nomeia o
evento adulterado.
Reporte: conclusão + evidência `arquivo:linha` e saídas de comando por
critério; "feito" sem evidência não é feito.

## Decisões da frente

- **D-C1 (D)**: o produto roda só em Postgres real: sem
  `DATABASE_URL`, `createDb` falha com erro acionável; não há
  fallback silencioso (`app/server/db.ts:96`). PGlite (Postgres real
  em WASM) existe apenas como infra de teste via `createLiteDb`,
  injetado em `buildServer` (`app/server/index.ts:27`): memória,
  zero Docker, mesma interface `Db` e triggers reais, sem mock.
- **D-C2 (D)**: seq por pedido serializada com
  `pg_advisory_xact_lock(hashtext(pedido_id))` dentro da tx
  (`app/server/store.ts:99`). `FOR UPDATE` não bastaria: a tx
  concorrente não enxerga a linha nova e calcularia o mesmo seq.
- **D-C3 (D)**: doc + divergências + tarefas gravados numa única tx
  (`app/server/pipeline.ts:52`). Falha no meio não deixa doc sem
  tarefa nem divergência duplicada por corrida.
- **D-C4 (D)**: reingestão idêntica é no-op por igualdade `jsonb`
  (`app/server/store.ts:146`), não por texto serializado, que
  dependeria de ordem de chaves e espaçamento.
- **D-C5 (D)**: `events` tem triggers anti UPDATE/DELETE por linha e
  anti TRUNCATE por statement (`app/server/store.ts:38` a `48`). O
  audit reconta a cadeia e, havendo âncora, recomputa o Merkle root
  sobre os eventos que a âncora cobriu (`app/server/index.ts:87` a
  `100`): `rootConfere` verde significa histórico ancorado intacto.
- **D-C6 (D)**: divergência é derivada e gravada como evento, não só
  computada na leitura: cada doc novo compara com a última declaração
  de cada outra fonte e grava `divergencia` + `tarefa` no ledger
  (`app/server/pipeline.ts:52` a `78`), o que propaga via SSE como
  evento normal.
- **D-C7 (D)**: aprovação na fila de revisão reingere o doc guardado
  como se tivesse acabado de chegar, forçando aceite
  (`app/server/pipeline.ts:85`); descarte só marca o status.
- **D-C8 (R)**: IMAP marca `\Seen` só quando a mensagem tinha anexo
  elegível processado; doc rejeitado por parser vai para a fila de
  revisão e erro de infra deixa a mensagem não lida para o próximo
  ciclo. Só mensagens de hoje em diante (`IMAP_DESDE` configurável):
  caixa pessoal tem histórico grande e mail antigo não é canal
  (`app/server/ingest/imap.ts:30` a `35`, `60` a `86`).
- **D-C9 (R)**: âncora grava evento `ancora` só com receipt
  `status === 1`; sem RPC/chave/contrato ou tx revertida, devolve
  `ok:false` com motivo e o ledger local segue
  (`app/server/anchor.ts:62` a `67`).
- **D-C10 (P)**: `app/vitest.config.ts` não está nos paths da frente;
  a exclusão de `contracts/` dos testes ficou no filtro posicional do
  script (`app/package.json`, `vitest run shared server`). Pedido à
  integração: incluir um config central se a demo quiser vitest na raiz.
- **D-C11 (P)**: CORS aberto e rotas de escrita sem auth são escopo
  de demo local; endurecer (token ou bind localhost) fica para a
  integração se a demo for exposta.
- **D-C12 (D)**: o root da âncora é comparado contra o root
  recomputado dos eventos com `seq < seq` da última âncora, não o de
  todos os eventos. O evento `ancora` entra no próprio ledger após a
  tx, então comparar contra o total tornaria `rootConfere` falso para
  sempre. Eventos legítimos pós-âncora não invalidam a conferência;
  reescrita de cadeia (payload + hash recomputados) é pega por ela
  (`api.test.ts`, "rescrever cadeia inteira").

## Evidência por critério do gate

- `tsc --noEmit` limpo: `npm run typecheck` sem saída de erro.
- Testes: `npm test` -> `Test Files 5 passed (5)`, `Tests 40 passed (40)`.
- Contrato: `npx hardhat test` em `app/contracts/` -> 4/4 passando
  (emit, get, root repetido não sobrescreve).
- Cadeia válida, adulteração nomeia o 1o evento afetado e cadeia
  vazia é válida: `app/shared/chain.test.ts`, `verificarCadeia` em
  `app/shared/chain.ts:51`.
- NF-e seed parseia chave 44, emitente, destinatário, itens, peso e
  data: `app/server/ingest/nfe.ts` + `server/fixtures/nfe-ok.xml`;
  teste `parsers` em `app/server/api.test.ts`.
- XML inválido -> 422 `{erro, tipo:"parser"}` explícito, não 500:
  `app/server/index.ts:52` a `56`; teste "XML invalido responde 422".
- CT-e vincula ao pedido pela chave NF-e em `infDoc/infNFe`:
  `app/server/ingest/cte.ts`.
- CC-e (110110) vira previsaoEntrega/status; cancelamento (110111)
  vira status `cancelada`: `app/server/ingest/eventos.ts`.
- UPDATE/DELETE manual rejeitado por trigger e bypass via
  `DISABLE TRIGGER ALL` é pego pelo audit nomeando `seq`: testes
  "trigger do banco rejeita" e "bypass da trigger" em
  `app/server/api.test.ts`; triggers em `app/server/store.ts:38` a `48`.
- Dois clientes SSE recebem evento em <1s: `app/server/sse.test.ts`;
  hub em `app/server/sse.ts`.
- `POST /api/simulate` devolve tarefas sem gravar (RF12):
  `app/server/index.ts:99`; `REGRAS_PROPAGACAO` em
  `app/shared/rules.ts:13`.
- Doc sem pedido vai para `review_queue`, não 500; aprovação
  reingere: `app/server/pipeline.ts:26` a `35` e `85`.
- `POST /api/anchor` sem credenciais -> 503 com `motivo` declarado e
  `root` computado: `app/server/anchor.ts`; teste "anchor sem config".
- Deploy e âncora reais na Base Sepolia (feitos nesta sessão):
  contrato `FoundryAnchor` em `0x5CA2F67E27257D2f67E703fe7bF81865d481FF03`
  (sepolia.basescan.org/address/0x5CA2F67E27257D2f67E703fe7bF81865d481FF03);
  âncora do pedido do seed na tx `0x5b15133be63d726a2974b2149e2cbecf83e23f78666391053606468e1e704be3`;
  audit ao vivo respondeu `rootConfere:true` com
  `eventosAncorados:73`. Carteira descartável só de testnet, chave em
  `app/.env` local (gitignored, nunca commitada).
- Seed idempotente e ordenada por tipo (NF-e primeiro):
  `app/server/seed.ts`; saída `5 doc(s) processados` na mesma chave.
- `node scripts/repo-guard.mjs` exit 0 (11 checks); `prose-evals`
  0 duras, 2 leves pré-existentes.

## Pendências conhecidas (para a integração)

- Deploy real na Base Sepolia já foi feito (evidência acima). Para
  repetir em outra máquina: `ANCHOR_PRIVATE_KEY` +
  `BASE_SEPOLIA_RPC_URL` + `ANCHOR_CONTRACT_ADDRESS` no `.env` local e
  `npm run deploy` em `app/contracts/` se for contrato novo.
- Postgres real via `app/docker-compose.yml` validado nesta sessão
  (Docker Desktop + WSL2, imagem `postgres:17-alpine`):
  `docker compose up -d` + `DATABASE_URL` faz o server usar `pg`;
  73 eventos do seed persistiram, triggers rejeitaram UPDATE, DELETE
  e TRUNCATE via psql no container, âncora gravou a tx
  `0xd5691de312cb1d486304df92dee78043cef0f1eb236f957e0bb075717f683f84`
  e reiniciar o server manteve dados + `rootConfere:true`.
- Extração de PDF por LLM implementada (OpenAI-compatible via
  `LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL`); sem provider, todo PDF vai
  para a fila de revisão com motivo `llm_nao_configurada`.
- `dev:all` em `app/package.json` pressupõe `app/web/` da frente
  app-demo; sem ela, `npm run dev` sobe só a API.
- T029 `.eml` implementado (`app/server/ingest/eml.ts`): anexos
  elegíveis desembrulham no mesmo pipeline; cabeçalho não é registrado
  (RF27). Validado ao vivo: `email-nfe.eml` retornou o mesmo pedido do
  XML solto, idempotente.
- Correção T023: CC-e passou a evento de correção sem campo vigiado
  (R-006); `cce-atraso.xml` virou `cce-correcao.xml` e o atraso da
  suíte passou a vir da `planilha.csv`. 41 testes passando.
