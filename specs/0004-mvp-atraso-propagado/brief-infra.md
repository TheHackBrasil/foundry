# Brief · frente `app-infra`

Escopo: servidor, banco e hospedagem da spec 0004: `app/server/*.ts`
(Fastify, rotas, SSE, store Postgres append-only, carga da seed),
`app/server/db/` (SQL e trigger), `app/api/` (contrato HTTP e SSE com a
web), `app/contracts/` (FoundryAnchor, P1 só na final),
`app/package.json`, lockfile, `app/tsconfig*.json`,
`app/docker-compose.yml`, arquivos de deploy, a decisão de hospedagem
(P-008, até 24/11) e a URL pública (T040).
Paths: `app/server/*.ts`, `app/server/db/**`, `app/api/**`,
`app/contracts/**`, `app/package.json`, `app/package-lock.json`,
`app/tsconfig*.json`, `app/docker-compose.yml`, `app/Procfile`,
`app/app.json`, `app/.env.example`, `app/deploy/**`. Não escrever em
`app/shared/**` nem `app/server/ingest/**` (`app-core`), `app/web/**`
(`app-demo`) nem `app/seed/**`.
Base: `main` com spec 0004 commitada; branch `wt/app-infra`; worktree
`../foundry-wt-infra`.

Contrato com a `app-core`: a infra importa só `ingerir()` de
`app/server/ingest/index.ts`. Recebe `ok`, `rejeitado` ou `revisao`;
grava os eventos com `encadear()` de `app/shared/chain.ts` e responde
`IngestResposta`. Mudança nesse formato é combinada no Linear.
Contrato com a `app-demo`: os tipos de `app/api/contrato.ts` são a
fonte das respostas GET e das mensagens SSE. A demo importa os tipos e
não inventa formato; mudou a rota, mudou o tipo no mesmo commit e avisa
no Linear.
Workspace: a infra sorteia o `workspaceId` (valor aleatório, em cookie
`foundry_ws`) e nunca confia em workspace vindo do cliente. GET e SSE
devolvem só o workspace da sessão e o `WORKSPACE_SEED`, que é
compartilhado e só leitura (RF27, regulamento 6.9).

Invariantes do store, que quem faz pela primeira vez costuma perder:
- Cadeia por pedido. Duas gravações simultâneas no mesmo pedido leem a
  mesma cabeça e bifurcam a cadeia, e a auditoria passa a acusar uma
  história legítima. Use `UNIQUE (workspace_id, pedido_id, seq)` com nova
  tentativa, ou trava por pedido na mesma transação. Teste com dois
  uploads em paralelo.
- Trigger que rejeita UPDATE e DELETE na tabela de eventos. O teste da
  T022 desliga a trigger como dono da tabela para adulterar um evento;
  isso fica documentado no teste e não vira rota.
- Ler a cabeça, encadear e inserir na mesma transação.
- Limite de tamanho e de tipo no upload; resposta de erro explícita,
  nunca 500 solto.

Runtime: `DATABASE_URL` e `PORT` por ambiente; heartbeat de SSE a cada
20 s (o roteador da hospedagem derruba conexão ociosa, 55 s no Heroku);
em produção o Fastify serve o build da web; `npm run dev` sobe servidor
e web, e o boot do Vite é da `app-demo`. Dependência nova: a infra
instala, e a `app-core` pede no Linear.
Hospedagem: decidir até 24/11 (P-008). A URL pública, sem login e no ar
até o fim da avaliação, é P0 (regulamento 7.2 e 7.3).
Proibido: merge em main, push fora da branch, editar imutável (A9),
commitar `.env*` ou chave, escrever fora dos paths, UPDATE ou DELETE na
tabela de eventos fora do teste de adulteração.
Gate: guard e prose-evals exit 0; `tsc --noEmit` limpo; `node --test`
verde; `node --check` em `.js`/`.mjs`; `curl` cria pedido e dois eventos
encadeados; UPDATE manual falha no banco; dois clientes SSE recebem o
evento em menos de 1 s; XML de uma sessão não aparece em outra; teste de
aceite de 10 min numa janela anônima na URL pública (upload de um XML,
propagação, auditoria que acusa a adulteração).
Setup no clone: `git pull`, `git config core.hooksPath scripts/hooks`,
`git fetch && git worktree add ../foundry-wt-infra wt/app-infra`.
Reporte: conclusão + evidência `arquivo:linha` e saídas de comando por
critério; "feito" sem evidência não é feito.
