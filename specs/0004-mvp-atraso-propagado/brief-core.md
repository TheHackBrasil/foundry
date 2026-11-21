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
