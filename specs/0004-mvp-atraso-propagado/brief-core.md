# Brief · frente `app-core`

Escopo: núcleo de domínio e ingest da spec 0004: `app/shared/` (modelo,
cadeia de hashes, detecção de divergência, tabela de regras, projeção) e
`app/server/ingest/` (parsers de NF-e, CT-e, eventos fiscais, CSV, `.eml`,
PDF por LLM e, se o P-009 for aceito, OCOREN), com o ponto de entrada
`ingerir()` em `app/server/ingest/index.ts`.
Paths: `app/shared/**`, `app/server/ingest/**`. Não escrever em
`app/server/*.ts` (rotas, store e SSE são da `app-infra`), `app/api/**`,
`app/package.json`, lockfile e `app/tsconfig*.json` (`app-infra`),
`app/web/**` nem `app/seed/**` (o ingest consome o corpus, formato
combinado entre as frentes).
Dependência nova: peça à `app-infra` no Linear. As do ingest
(`fast-xml-parser`, `csv-parse`, `mailparser`) já estão instaladas.
Contrato com a `app-infra`: `ingerir({ nome, mime, bytes, workspaceId })`
devolve `ok` com os eventos, `rejeitado` com erro explícito ou `revisao`.
Não grava, não lança por entrada ruim e não loga cabeçalho de `.eml`
(traz endereço de pessoa, RF27). A infra nunca importa um parser avulso.
Base: `main` com spec 0004 commitada; branch `wt/app-core`; worktree
`../foundry-wt-app-core`.
Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*` no repo, escrever fora dos paths, dado real de empresa ou de
pessoa nos testes.
Gate: `node scripts/repo-guard.mjs` e `node scripts/prose-evals.mjs`
exit 0; `tsc --noEmit` limpo; `node --test` verde; `node --check` em
`.js`/`.mjs`; corpus da seed parseia com campos corretos; XML inválido
rejeita com erro explícito; `.eml` com a NF-e em anexo gera os mesmos
eventos que o upload do XML; evento encadeia hash e a verificação
nomeia o evento adulterado.
Reporte: conclusão + evidência `arquivo:linha` e saídas de comando por
critério; "feito" sem evidência não é feito.
