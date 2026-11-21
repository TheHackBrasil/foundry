# Brief · frente `app-core`

Escopo: núcleo do MVP da spec 0004: `app/shared/` (modelo, cadeia de
hashes, detecção de divergência, tabela de regras), `app/server/`
(Fastify, Postgres append-only com trigger anti UPDATE/DELETE, SSE,
anchor on-chain), `app/server/ingest/` (parsers NF-e, CT-e,
eventos/CC-e, CSV, IMAP, PDF por LLM), `app/contracts/`
(FoundryAnchor), `app/package.json`, `app/tsconfig.json`,
`app/docker-compose.yml`, `app/server/seed.ts`.
Paths: `app/shared/**`, `app/server/**`, `app/contracts/**`,
`app/package.json`, `app/tsconfig*.json`, `app/docker-compose.yml`.
Não escrever em `app/web/**`; `app/seed/**` é da frente produto (o
server consome o corpus de XMLs, formato combinado entre as frentes).
Base: `main` com spec 0004 commitada; branch `wt/app-core`; worktree
`../foundry-wt-app-core`.
Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*` no repo (chave de testnet e credencial IMAP só local),
escrever fora dos paths, UPDATE/DELETE na tabela de eventos
(invariante append-only).
Gate: `node scripts/repo-guard.mjs` e `node scripts/prose-evals.mjs`
exit 0; `tsc --noEmit` limpo; `node --check` em `.js`/`.mjs`; corpus da
seed parseia com campos corretos; XML inválido rejeita com erro
explícito; evento encadeia hash; UPDATE manual via admin faz audit
falhar nomeando o evento; anchor gera tx visível em
sepolia.basescan.org.
Reporte: conclusão + evidência `arquivo:linha` e saídas de comando por
critério; "feito" sem evidência não é feito.

## Decisões da frente

- **D-C1 (D)**: sem Docker na máquina, o store cai para PGlite
  (Postgres real em WASM, `@electric-sql/pglite`) quando
  `DATABASE_URL` não está definida; com a variável, usa `pg` Pool.
  Mesma interface `Db` nos dois lados (`app/server/db.ts:7`). A
  trigger append-only é testada de verdade, sem mock.
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
  audit reconta a cadeia e, havendo âncora, confere o Merkle root
  atual contra o ancorado (`app/server/index.ts:87`), o que pega
  truncamento de cauda que a cadeia sozinha não vê.
- **D-C6 (D)**: divergência é derivada e gravada como evento, não só
  computada na leitura: cada doc novo compara com a última declaração
  de cada outra fonte e grava `divergencia` + `tarefa` no ledger
  (`app/server/pipeline.ts:52` a `78`), o que propaga via SSE como
  evento normal.
- **D-C7 (D)**: aprovação na fila de revisão reingere o doc guardado
  como se tivesse acabado de chegar, forçando aceite
  (`app/server/pipeline.ts:85`); descarte só marca o status.
- **D-C8 (R)**: IMAP marca `\Seen` só depois do processamento do
  anexo; doc rejeitado por parser vai para a fila de revisão e erro
  de infra deixa a mensagem não lida para o próximo ciclo
  (`app/server/ingest/imap.ts:56` a `78`).
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

## Evidência por critério do gate

- `tsc --noEmit` limpo: `npm run typecheck` sem saída de erro.
- Testes: `npm test` -> `Test Files 5 passed (5)`, `Tests 38 passed (38)`.
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
- Seed idempotente e ordenada por tipo (NF-e primeiro):
  `app/server/seed.ts`; saída `5 doc(s) processados` na mesma chave.
- `node scripts/repo-guard.mjs` exit 0 (11 checks); `prose-evals`
  0 duras, 2 leves pré-existentes.

## Pendências conhecidas (para a integração)

- Deploy real na Base Sepolia exige `ANCHOR_PRIVATE_KEY` +
  `BASE_SEPOLIA_RPC_URL` + `ANCHOR_CONTRACT_ADDRESS` locais;
  `npm run deploy` em `app/contracts/` publica e imprime a URL do
  basescan. Sem chave não há tx visível; o caminho está implementado
  e testado em rede local hardhat.
- Postgres real via `app/docker-compose.yml` não foi validado aqui
  (sem Docker); PGlite cobre os mesmos testes.
- Extração de PDF por LLM implementada (OpenAI-compatible via
  `LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL`); sem provider, todo PDF vai
  para a fila de revisão com motivo `llm_nao_configurada`.
- `dev:all` em `app/package.json` pressupõe `app/web/` da frente
  app-demo; sem ela, `npm run dev` sobe só a API.
