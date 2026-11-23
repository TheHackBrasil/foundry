# Tasks: Spec 0008: blindagem da demo pública (achados de auditoria)

Formato: `- [ ] TNNN [P] [USn] descrição: path: verificação`
`[P]` = paralelizável · `[USn]` = história da spec · toda task tem path e
verificação. Numeração T2xx para não colidir com T001-T099 das specs
0004 e 0006. Prioridade entre parênteses `(P0|P1|P2)`: corte preserva
P0, depois P1 na ordem inversa. Frente única: `[hardening]` =
`wt/hardening` (worktree `../foundry-wt-hardening`, já criada sobre a
`main` de 23/11). Integra antes das frentes da spec 0007.

## Fase 0: Contrato (integração, antes do worktree)

- [x] T200 spec + plan + tasks + brief + `frentes.json` com `hardening` (paths: `app/server/`, `app/shared/`, `app/web/`, `app/contracts/`, `app/package*.json`, `app/tsconfig.json`, `app/vitest.config.ts`, e os paths de `site/` do RF14 se aprovados): `specs/0008-blindagem-publica/`, `speckit/frentes.json`: guard exit 0
- [x] T201 decisões registradas em `DECISIONS.md` pela integração (sugeridas D-039 em diante, numeração real da integração): blindagem antes da camada AI; mecanismo escolhido para a cota de sessões (RF2); comportamento da planilha solitária (RF5); dono dos paths de `site/` do RF14: `DECISIONS.md`: entradas datadas na tabela

## Fase 1: Corretude P0

- [x] T210 (P0) [US1] [hardening] advisory lock `pg_advisory_xact_lock(hashtext(workspace || ':' || pedido))` no início da transação de `processarDoc`, antes do `eventoExiste`: `app/server/pipeline.ts`: teste de dois uploads idênticos em paralelo grava um documento só, `seq` sem buraco
- [x] T211 (P0) [US2] [hardening] rotação de cookie não zera a cota: teto de sessões novas por IP por janela e/ou cap global de workspaces com escrita, com envs em `config.ts` e mensagem em `protecao.ts`: `app/server/index.ts`, `app/server/protecao.ts`, `app/server/config.ts`, `app/server/store.ts`: teste prova N envios sem cookie do mesmo IP param de escrever após o teto; resposta 429 em pt-BR
- [x] T212 (P0) [US1] [hardening] `ROTULO_STATUS` e demais lookups indexados por valor externo via `Map` ou objeto sem protótipo: `app/web/src/format.ts`: teste `formatarValor('status', 'constructor' | 'hasOwnProperty' | 'toString' | '__proto__')` devolve o texto cru; CSV com esses status não trava a tela
- [x] T213 (P0) [US2] [hardening] IMAP: `client.on('error')` registrado; classificação documento ruim x infra por `instanceof ErroParser` (regex da linha 73 sai); erro de `simpleParser` vira `ErroParser`; comentário de `detect.ts` sobre o texto da regex removido: `app/server/ingest/imap.ts`, `app/server/ingest/detect.ts`: teste prova erro emitido pelo cliente não derruba o processo e `ErroParser` vai para a revisão
- [x] T214 (P0) [US1] [hardening] planilha como primeiro documento pinada por teste na opção aprovada (pedido mínimo na projeção ou fila de revisão): `app/shared/projection.ts` ou `app/server/pipeline.ts` conforme a decisão: teste pinando o comportamento + decisão registrada no brief
- [x] T215 (P0) [US2] [hardening] `GET /api/revisao` serializa `ItemRevisao` sem `workspace_id`; acesso interno ao campo por consulta separada do contrato; `aprovarRevisao` com teste (aprovação grava no workspace do item, segunda aprovação falha, item da seed não é aprovável): `app/server/store.ts`, `app/server/index.ts`, `app/server/pipeline.ts`, `app/shared/model.ts`: resposta sem `workspace_id` + testes novos verdes

## Fase 2: Robustez P1

- [x] T220 (P1) [US3] [hardening] `npm test` executa a suíte da web junto (`vitest run shared server` + `npm --prefix web test`, ou vitest com projeto único): `app/package.json`: `npm test` roda `matriz.test.ts` e falha se a web quebrar
- [x] T221 (P1) [US1] [hardening] `eml.test.ts` reescrito com um `buildServer` só e duas sessões por cookie: `app/server/ingest/eml.test.ts`: 10 execuções seguidas sem falha
- [x] T222 (P1) [US2] [hardening] cobertura de `parsePdf` com LLM mockada: sem texto, sem `LLM_API_URL`, confiança baixa, HTTP erro, campo com tipo inválido: `app/server/ingest/pdf.ts` + teste novo: casos cobertos, nenhum chamando rede real
- [x] T223 [P] (P1) [hardening] guardas de `protecao.ts` testadas nos limites (`JanelaFixa` no máximo e na poda; `GuardaEspaco` com medição falhando e acima do teto): `app/server/protecao.ts` + teste: limites pinados
- [x] T224 [P] (P1) [hardening] trigger `TRUNCATE` em `events` com teste (UPDATE/DELETE já têm): `app/server/api.test.ts` ou `endurecimento.test.ts`: TRUNCATE rejeitado pelo banco
- [x] T225 [P] (P1) [hardening] `chaveTarefa` inclui `fonteA`/`fonteB`: `app/web/src/matriz.ts`, `app/web/src/matriz.test.ts`: teste com duas divergências de mesmo campo e valor mas fontes distintas gera duas chaves
- [x] T226 (P1) [US1] [hardening] 413 consistente em upload grande (causa do 422 do smoke de 23/11 achada e corrigida na raiz): `app/server/index.ts`, `app/deploy/smoke.mjs` se preciso: smoke público refeito com o item verde (fecha P-008/item 13 do BACKLOG)
- [x] T227 [P] (P1) [hardening] cap de expansão no PDF (teto de páginas/texto extraído declarado; estouro vira revisão ou 422) + timeout de LLM com `AbortSignal.timeout` (env `LLM_TIMEOUT_MS`, padrão 15 s): `app/server/ingest/pdf.ts`, `app/server/config.ts`: teste de estouro e de timeout sem pendurar
- [x] T228 [P] (P1) [hardening] `/api/anchor` 503 sem RPC URL nem segredo no corpo (detalhe só no log) + nomes de anexo sanitizados no log IMAP e no log do boot (basename, sem controle, truncado): `app/server/anchor.ts`, `app/server/index.ts`, `app/server/ingest/imap.ts`: teste prova corpo limpo; inspeção de log

## Fase 3: Polimento P2

- [x] T230 (P2) [US3] [hardening] helper compartilhado documento->divergências->tarefas usado por `processarDoc` e `aprovarRevisao`: `app/server/pipeline.ts`: duplicação removida, testes atuais verdes
- [x] T231 [P] (P2) [hardening] tipos com fonte única: `ResultadoIngest` (contrato x resumo interno renomeado), `ResultadoAncora` (um só), `TIPOS_DOCUMENTO` (uma lista, `model.ts`, reusada por `store.ts` e `projection.ts`): `app/shared/model.ts`, `app/server/pipeline.ts`, `app/server/anchor.ts`, `app/server/store.ts`, `app/shared/projection.ts`: `tsc --noEmit` limpo, nenhuma definição duplicada
- [x] T232 [P] (P2) [hardening] higiene: mensagens da API em pt-BR consistente (`pedido nao encontrado` e irmãs); `decodeURIComponent` com try em `useTorre.ts:19`; `noUnusedLocals`/`noUnusedParameters` no `tsconfig` com código ajustado; `compararFontes` sem uso sai de `pipeline.ts:4`, `rotuloTipo` morto sai de `format.ts:41`: `app/server/index.ts`, `app/web/src/`, `app/tsconfig.json`: `tsc --noEmit` limpo com as flags novas
- [x] T233 [P] (P2) [US4] [hardening] marca v4: `synced` do dominó em cor de coordenação, metadados violeta em cinza mineral, paletas antigas dos stickers fora (Forseti vira default), assets mortos da marca antiga fora do material publicado após conferir referências: `site/src/components/domino/`, `site/src/components/stickers/`, `site/public/assets/`: contraste medido mantido, build do site limpo, nenhum asset morto no deploy

## Gates locais

- [x] T299 `node scripts/repo-guard.mjs` + `node scripts/prose-evals.mjs` exit 0; `tsc --noEmit` limpo em `app/` e `app/web/` com `noUnusedLocals`; `npm test` verde com `shared`, `server` e `web`; smoke público com 413 verde; `eml.test.ts` 10x sem flake; critérios da spec item a item com evidência no commit/PR
