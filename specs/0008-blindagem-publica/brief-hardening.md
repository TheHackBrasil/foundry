# Brief · frente `hardening`

Escopo: corrigir os achados confirmados das cinco auditorias de 23/11
(SOLID, segurança, TypeScript, testes, brandbook) sobre a `main`, na
ordem P0, P1, P2 da spec 0008. São eles: corrida de idempotência entre
`eventoExiste` e o lock (lock passa a abrir a transação de
`processarDoc`); bypass de cota por rotação de cookie (teto por IP e/ou
cap global, com envs e mensagem pt-BR); `ROTULO_STATUS` do web
resolvendo via `Object.prototype` (Map ou objeto sem protótipo em
todos os lookups por valor externo); IMAP sem listener `error` e com
classificação por regex (listener + `instanceof ErroParser` + log
sanitizado); planilha solitária que gera `pedido: null` (opção
aprovada pinada por teste); `aprovarRevisao` sem cobertura e fila
vazando `workspace_id` (contrato `ItemRevisao` na API); `npm test` sem
a suíte da web; flake do `.eml` (um servidor, duas sessões);
cobertura de `parsePdf`, guardas de `protecao.ts`, `TRUNCATE` e
`chaveTarefa` com `fonteA`/`fonteB`; 413 consistente no smoke público;
cap de expansão do PDF e timeout de LLM; `/api/anchor` sem RPC URL no
503; helper compartilhado doc->divergências->tarefas; tipos
`ResultadoIngest`/`ResultadoAncora`/`TIPOS_DOCUMENTO` com fonte única;
mensagens pt-BR consistentes; `decodeURIComponent` com try;
`noUnusedLocals`; código morto (`compararFontes` importado,
`rotuloTipo`); e os pontos de marca: `synced` do dominó em cor de
coordenação, metadados violeta em cinza mineral, paletas antigas dos
stickers fora (Forseti default), assets mortos da marca antiga fora do
deploy. Tasks T210 a T233, T299.

Paths: `app/server/`, `app/shared/`, `app/web/`, `app/contracts/`,
`app/package.json`, `app/package-lock.json`, `app/tsconfig.json`,
`app/vitest.config.ts`, `specs/0008-blindagem-publica/brief-hardening.md`.
Se a integração aprovar: `site/src/components/domino/`,
`site/src/components/stickers/`, `site/public/assets/`. Não escrever em
`site/` fora desses três paths, nem em `app/seed/`, `docs/`,
`DECISIONS.md`, `BACKLOG.md`, `RULES.md`, `README.md` (escopo-produto),
`lp/`, `.env*`, `specs/` fora desta pasta.

Base: `main` de 23/11 (`58a8454`); branch `wt/hardening`; worktree
`../foundry-wt-hardening` (já criado). Integra antes de qualquer frente
da spec 0007: elas nascem sobre a `main` com esta blindagem.

Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*`, escrever fora dos paths, criar rotas ou capacidades
novas (isso é da spec 0007), mudar `TipoEvento` ou campos vigiados,
afrouxar limite, trigger ou isolamento de workspace, apagar teste sem
substituto, travessão/meia-risca em `.md`.

Gate: `node scripts/repo-guard.mjs` + `node scripts/prose-evals.mjs`
exit 0; `tsc --noEmit` limpo em `app/` e `app/web/` com
`noUnusedLocals` ligado; `npm test` verde executando `shared`,
`server` e `web`; testes novos por achado (cada RF tem a verificação
na linha da task); `eml.test.ts` 10 execuções sem falha; smoke
público `node app/deploy/smoke.mjs` com o item do 413 verde; build do
site limpo se `site/` for tocado.

Reporte: conclusão + evidência `arquivo:linha` por critério, saída de
gate e do smoke, e a decisão tomada nas perguntas abertas (cota de
sessões, planilha solitária, paths de `site/`) na seção abaixo.

## Decisões da frente

(preencher na primeira decisão)
