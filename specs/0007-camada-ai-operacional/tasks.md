# Tasks: Spec 0007: camada AI operacional

Formato: `- [ ] TNNN [P] [USn] descrição: path: verificação`
`[P]` = paralelizável · `[USn]` = história da spec · toda task tem path e
verificação. Numeração T1xx para não colidir com T001-T099 das specs
0004/0006 e com a T2xx da spec 0008. Prioridade entre parênteses
`(P0|P1|P2)`. Frentes: `[ingest]` = `wt/ai-ingest`, `[mandatos]` =
`wt/ai-mandatos`, `[web]` = `wt/ai-web` (reservada, sem código nesta
spec). Sequência dura: spec 0008 (`hardening`) integra inteira antes;
as tarefas de fundação T110-T112 integram antes do fio de sinais da
`ai-ingest` (T131-T133).

## Fase 0: Contrato (integração, antes dos worktrees)

- [x] T100 spec + plan + tasks + briefs + `frentes.json` com `ai-ingest`, `ai-mandatos` e `ai-web` (reservada): `specs/0007-camada-ai-operacional/`, `speckit/frentes.json`: guard exit 0
- [x] T101 decisões registradas em `DECISIONS.md` pela integração (sugeridas D-043 em diante): arquitetura da camada AI (LLM = acesso, nunca verdade; três empregos fechados); xlsx pelo caminho de D-028; mandatos com ação tipada e evento auditável; contatos por workspace + Nvoip desligada por padrão; contrato `view-spec` com front reservado: `DECISIONS.md`: entradas datadas na tabela
- [x] T102 spec 0008 integrada na `main` (blindagem primeiro): merge da `wt/hardening` com gates verdes: `main`: diff lido e guard rodado pela integração

## Fase 1: Fundação (ai-mandatos, integra primeiro)

- [x] T110 (P0) [mandatos] tipos novos em `model.ts`: `TipoEvento` + `mandato`/`sinal`/`notificacao`; `Sinal`, `Contato`, `CanalContato`, `MandatoParseado`, `AcaoMandato`, `ViewSpec`; `ProjecaoPedido` com `sinais` e `notificacoes`: `app/shared/model.ts`: `tsc --noEmit` limpo
- [x] T111 (P0) [mandatos] `llm.ts`: cliente de chat JSON (OpenAI-compatível, `response_format: json_object`), timeout por env, erro tipado para `indisponivel`/`invalido`: `app/server/llm.ts`: teste com fetch mockado (timeout, HTTP erro, JSON inválido)
- [x] T112 (P0) [mandatos] `sinal.ts`: `extrairSinais(texto, fonte)` via `llm.ts` devolvendo `Sinal[]` tipados com limiar de confiança; sem LLM devolve vazio, nunca lança: `app/server/sinal.ts`: teste com LLM mockada (sinal extraído, confiança baixa descartada, sem LLM vazio)
- [x] T113 [P] (P0) [mandatos] `diverge` exportada e `/api/simulate` reusando `compararFontes`/`diverge` com tolerância de peso; `fonteA` = fonte real do valor atual, `fonteB` = `manual`: `app/shared/divergence.ts`, `app/server/index.ts`: teste pinando peso dentro da tolerância sem divergência e `fonteA` real

## Fase 2: Ingest universal (ai-ingest, em paralelo com Fase 3)

- [x] T120 (P0) [US2] [ingest] parser `.xlsx` em `worker_threads`: checagem estrutural do zip (diretório central, razão de expansão, nº de arquivos, tamanho declarado) antes de inflar; `resourceLimits` + timeout; `exceljs` pinned (>7 dias); worker lê a primeira planilha (ou a de cabeçalho esperado) e emite texto CSV com valores formatados (data serial sai `AAAA-MM-DD`); o texto entra no `parseCsv` sem mudança; falha estrutural (fórmula sem cache, mesclada ambígua, cabeçalho irreconhecível) sinaliza o caminho de revisão de T124: `app/server/ingest/xlsx.ts`, `app/server/ingest/xlsx.worker.ts`, `app/server/ingest/csv.ts`: fixture legítima gera os mesmos eventos do CSV
- [x] T121 (P0) [US2] [ingest] `detectarTipo` reconhece `xlsx`/`xls` (422 sai); `pipeline.ts` chama o parser; `.eml` e IMAP seguem o mesmo caminho (o filtro já aceita); `seed.ts` com `.xlsx` na ordem: `app/server/ingest/detect.ts`, `app/server/pipeline.ts`, `app/server/seed.ts`: upload, `.eml` e seed com xlsx funcionam; zip malformado e expansão absurda 422 sem travar
- [x] T122 [P] (P0) [US4] [ingest] validação de tipo dos campos da extração LLM do PDF antes do modelo canônico: normalização explícita ou descarte registrado; essencial inválido => revisão; nunca `NaN` nem string crua em `CamposObservados`: `app/server/ingest/pdf.ts`: teste `peso_kg:"12kg"` não gera `NaN`; data fora de `AAAA-MM-DD` não entra
- [x] T123 [P] (P0) [ingest] fixtures novas: `planilha.xlsx` (equivalente à `planilha.csv`), `.eml` com corpo de texto, CC-e cujo `xCorrecao` fala de reagendamento, `.xlsx` com layout fora do schema (para T124): `app/server/fixtures/`: fixtures usadas nos testes de T120-T140
- [x] T124 [P] (P2) [ingest] fio do layout desconhecido (RF11): planilha que o `parseCsv` não mapeia vai para a revisão com a proposta de mapeamento de `mapeamento.ts` anexa (ou sem proposta se a LLM estiver fora); aprovação executa o ingest com o mapeamento e grava o template por `(workspace, remetente)`; arquivo seguinte do mesmo remetente aplica o template direto, sem LLM e sem revisão: `app/server/pipeline.ts`, `app/server/ingest/xlsx.ts`, `app/server/ingest/csv.ts`: teste pinando revisão com proposta, ingest aprovado com mapeamento e template reaplicado sem LLM

## Fase 3: Mandatos e serviços (ai-mandatos)

- [x] T130 (P0) [US1] [mandatos] `mandatos.ts`: prompt + validação à mão do JSON tipado `{acao, filtros, alvo}` no conjunto fechado; resolução de alvos por filtro (pedidoId, fornecedor por nome/CNPJ nos `dados` da NF-e, parte) com teto de alvos; execução por `propagar`/`simular`/`resumir`/`notificar` via motor existente: `app/server/mandatos.ts`: teste com LLM mockada por ação; 422 `parse_falhou`/`acao_ambigua`/`sem_alvo`/`filtro_largo`
- [x] T131 (P0) [US1] [mandatos] `POST /api/mandatos` na rota com cotas (limite de escrita + `JanelaFixa` por IP, env `RATE_LIMIT_MANDATOS_PER_10MIN`); gravação do evento `mandato` por pedido alvo na mesma transação da execução; 503 declarativo sem `LLM_API_URL`: `app/server/index.ts`, `app/server/config.ts`, `app/server/protecao.ts`: evento `mandato` com `audit` válido; 503 sem LLM; resposta 200 com `acao`/`alvos`/`resultado`
- [x] T132 [P] (P1) [US3] [mandatos] `contatos.ts` + tabela `contatos` (DDL idempotente em `store.ts`) + `GET`/`PUT /api/contatos` por workspace + 4 contatos fictícios da seed (constante em `contatos.ts`, inserção idempotente via `store.init`): `app/server/contatos.ts`, `app/server/store.ts`, `app/server/index.ts`: GET devolve seed + sessão; PUT upsert por `(workspace, parte)`; isolamento entre sessões
- [x] T133 [P] (P1) [US3] [mandatos] `nvoip.ts`: envio pela API Nvoip por canal; texto por LLM com template determinístico de fallback; evento `notificacao` por pedido com `entregue`/`nao_entregue` + motivo; desligada por padrão; nunca quebra o fluxo; o mandato `notificar` despacha por ela: `app/server/nvoip.ts`, `app/server/config.ts`, `app/server/mandatos.ts`: teste com fetch mockado (`entregue`), sem credencial (`nao_entregue`/`desligado`), sem contato (`nao_entregue`/`sem_contato`)
- [x] T134 [P] (P2) [mandatos] `viewspec.ts` + `GET /api/pedidos/:id/view-spec?papel=<parte>`: geração por LLM, validação server-side contra `ViewSpec` e enums, default determinístico como fallback: `app/server/viewspec.ts`, `app/server/index.ts`: resposta sempre `ViewSpec` válido; LLM fora ou inválida => default
- [x] T135 (P0) [US4] [mandatos] projeção expõe `sinais` e `notificacoes` por pedido: `app/shared/projection.ts`: teste de projeção com os eventos novos sem afetar divergências/tarefas
- [x] T136 [P] (P2) [mandatos] `mapeamento.ts`: proposta de mapeamento coluna a campo canônico por LLM (JSON validado à mão, sem zod) + tabela `templates` por `(workspace, remetente)` no DDL idempotente de `store.ts` + tipo do item de revisão com proposta: `app/server/mapeamento.ts`, `app/server/store.ts`, `app/shared/model.ts`: teste com LLM mockada (proposta válida, JSON inválido sem proposta); template isolado por workspace e por remetente

## Fase 4: Fios no pipeline (ai-ingest, depois de T112 e T133 na `main`; T124 depois de T136)

- [x] T140 (P1) [US4] [ingest] `eml.ts` devolve `{anexos, corpo}`; pipeline extrai sinais do corpo e da `xCorrecao`/`descEvento` da CC-e via `sinal.ts` e emite evento `sinal` na cadeia do pedido (só com pedido existente; corpo nunca vai para ledger nem log): `app/server/ingest/eml.ts`, `app/server/ingest/eventos.ts`, `app/server/pipeline.ts`: `.eml`/CC-e com texto de reagendamento geram `sinal`; teste R-006 segue verde; sem LLM nada muda
- [x] T141 (P1) [US3] [ingest] fio de notificação da tarefa propagada por env global `NVOIP_NOTIFY_ON_TASK` (decidido, desligada por padrão): pipeline chama `nvoip.ts` ao criar tarefa cuja parte tem contato com canal compatível: `app/server/pipeline.ts`: teste com mock: tarefa propagada com contato gera `notificacao`; sem env, nada acontece
- [x] T142 [P] (P1) [US3] [ingest] bootstrap de contatos por `fone` fiscal: parsers nfe/cte extraem `fone` de `enderEmit`/`enderDest` para `dados.emitente.fone`/`dados.transportadora.fone`; pipeline chama `bootstrapContatos` após doc fiscal gravado, idempotente e sem sobrescrever `manual`: `app/server/ingest/nfe.ts`, `app/server/ingest/cte.ts`, `app/server/pipeline.ts`: NF-e com fone => `GET /api/contatos` mostra o fornecedor bootstrapado

## Fase 5: Reservada (ai-web)

- [ ] T150 (P2) [web] nenhuma task de código: a renderização do `view-spec` é do usuário com outro agente. A frente existe só para registrar a reserva em `frentes.json` e o contrato de `brief-ai-web.md`: `specs/0007-camada-ai-operacional/brief-ai-web.md`: contrato revisado pelo usuário

## Gates locais

- [x] T199 `node scripts/repo-guard.mjs` + `node scripts/prose-evals.mjs` exit 0; `tsc --noEmit` limpo; `npm test` verde; critérios da spec item a item com evidência no commit/PR; demo de ponta a ponta ensaiada: xlsx -> divergência -> mandato em pt-BR -> notificação registrada
