# Tasks: Spec 0011: modelo de exceção completo

Formato: `- [ ] TNNN [P] [USn] descrição: path: verificação`
Numeração T5xx. Prioridade entre parênteses. Frente: `app-operacao`
(worktree `foundry-wt-operacao`, branch `wt/app-operacao`).

## Fase 0: Contrato e schema

- [x] T500 (P0) `model.ts`: `Caso`, `StatusCaso`, `CicloCaso`,
  eventos `caso_atribuido|caso_resolvido|caso_contestado|
  caso_reaberto|caso_resposta_parceiro|pendencia_aberta`,
  divergência `mudanca`, `Claim`, `pedido.documentos`:
  `app/shared/model.ts`: `tsc --noEmit` limpo
- [x] T501 (P0) schema: `casos`? (não: caso é projeção; só
  `pedido_documentos` + índice; revisar se claims precisam de
  coluna ou ficam em `dados`): `app/server/db.ts`: migração limpa
  no banco existente

## Fase 1: Motor

- [x] T510 (P0) [US1] `mudanca`: versão N vs N-1 por fonte em
  `compararFontes`: `app/shared/divergence.ts`: teste planilha
  20->25 abre `mudanca` + propagação igual a divergência
- [x] T511 (P0) [US2] projeção de `Caso`: abre com divergência ou
  pendência, aplica transições, acumula `ciclos`:
  `app/shared/projection.ts` (ou `caso.ts` novo): teste do ciclo
  completo incluindo reabertura
- [x] T512 (P0) [US3] `claims` nos `dados` dos eventos que declaram
  campo vigiado, por ingest: `app/server/ingest/*.ts`: teste com
  evento NF-e conferindo `dados.claims`
- [x] T513 (P0) [US3] `pedido_documentos` + resolução de
  identidade (xPed, CNPJ+série+número, conflito->revisão):
  `app/server/pipeline.ts`, `app/server/db.ts`: teste CT-e+NFe
  mesmo pedido e conflito para revisão
- [x] T514 (P1) [US4] `estimarCusto` rotulado em
  `app/shared/custo.ts` + inclusão na tarefa do financeiro:
  teste dos coeficientes e do rótulo
- [x] T515 (P0) [US4] métricas por projeção:
  `app/shared/metricas.ts`: teste com trilha fixture contando
  tempos e taxa

## Fase 2: Servidor

- [x] T520 (P0) [US2] rotas de caso: listar, detalhar, assumir,
  resolver, reabrir (sessão dona; seed 403):
  `app/server/index.ts`: testes de rota incluindo isolamento
- [x] T521 (P0) [US2] `POST /api/casos/:id/resposta` por token:
  `app/server/index.ts`: teste confirmar/contestar vira evento
- [x] T522 (P0) `GET /api/metricas` por workspace:
  `app/server/index.ts`: teste shape
- [x] T523 (P0) tick de pendência por documento esperado (CT-e sem
  NF-e, entrega sem confirmação): `app/server/pendencia.ts`:
  teste com relógio falso
- [x] T524 (P0) emissão do token do parceiro na abertura do caso +
  entrega manual ao operador (link visível na sessão dona):
  `app/server/casos.ts`: teste token por caso, hasheado

## Fase 3: Web `#/operacao`

- [x] T530 (P0) [US2] fila de casos + detalhe + ações + resposta
  do parceiro: `app/web/src/operacao/`: teste de render + AA
- [x] T531 (P0) [US4] painel de métricas na operação:
  `app/web/src/operacao/`: teste shape -> render
- [x] T532 (P1) [US4] bloco comprovante âncora no caso:
  `app/web/src/operacao/`: render com link basescan
- [x] T533 (P0) rota `#/operacao` no shell sem tocar LP nem `#/ia`:
  `app/web/src/App.tsx` (ou router real): navegação manual ok

## Fase 4: Gates

- [x] T540 `tsc`, suítes server+web verdes, guard + prose-evals 0
- [x] T541 demo E2E local do fluxo de caso completo, evidência no
  commit; decisões no brief da frente
