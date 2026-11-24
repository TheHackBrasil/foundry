# Tasks: Spec 0009: agente conversacional com tool calling interno

Formato: `- [ ] TNNN [P] [USn] descrição: path: verificação`
`[P]` = paralelizável · `[USn]` = história da spec · toda task tem path e
verificação. Numeração T3xx para não colidir com T001-T099 (0004/0006),
T1xx (0007) e T2xx (0008). Prioridade entre parênteses `(P0|P1|P2)`.
Frente única nesta sessão: integração direta na `main`, sem worktree.

## Fase 0: Contrato (integração, antes das fatias)

- [x] T300 spec + plan + tasks + índice em `specs/README.md`:
  `specs/0009-agente-conversacional-tools/`, `specs/README.md`:
  guard exit 0
- [x] T301 (P0) contrato em `model.ts`: `TurnoConversa`,
  `ToolExecutada`, `StatusExecucaoTool`, `ResultadoAgente`;
  `EventoStreamMandato` com `tool`, `texto_delta`, `fim` e `etapa.id`
  livre: `app/shared/model.ts`: `tsc --noEmit` limpo

## Fase 1: Backend do agente

- [x] T310 (P0) [US4] `llm.ts`: `DefinicaoToolLlm`, `ChamadaToolLlm`,
  `MensagemAgenteLlm`, `chatComTools` (tools OpenAI-compatíveis,
  timeout por env, `ErroLlm` tipado, argumentos parseados com erro
  virando `{}`) e `chatTextoStream` (SSE `data:` parseado,
  `delta.content` por `onDelta`, fallback para resposta JSON comum,
  `[DONE]` limpo): `app/server/llm.ts`: teste com fetch mockado
  (tool call parseada, stream com 2 deltas, fallback não-SSE)
- [x] T311 (P0) [US1] `agente/ferramentas.ts`: registro
  `{nome, descricao, schema, validar, executar}` + `resolverPedido`
  compartilhado (id exato, sufixo de chave, nome parcial de emitente)
  + tools de leitura `listar_pedidos`, `consultar_pedido`,
  `comparar_fontes`, `listar_tarefas_setor`, `consultar_auditoria`:
  `app/server/agente/ferramentas.ts`: teste unitário com PGlite +
  seed (resolve por nome, dados reais da projeção)
- [x] T312 [P] (P0) [US3] `simular_cenario` (mesma normalização de
  `mandatos.ts`, zero escrita, sinaliza `simulador_interativo` +
  `domino_impacto`), `preparar_notificacao` (rascunho por parte +
  contato da agenda, sinaliza `cartoes_despacho`),
  `enviar_notificacao` e `propagar_divergencias` (transação real,
  `seed_somente_leitura` estruturado): `app/server/agente/ferramentas.ts`:
  teste pinando simulação sem evento novo e bloqueio de seed
- [x] T313 (P0) [US1][US2] `agente/motor.ts`: mensagens
  `[system, ...historico saneado, user]`, loop `MAX_ITERACOES = 6`
  com `Promise.all` nas `tool_calls`, erro de tool como `role: tool`
  estruturado, trilha de execução, `pedidoIdResolvido` propagado como
  default dos próximos passos, texto streamado por `texto_delta`,
  composição determinística de blocos ao final e emissão
  `etapa`/`tool`/`texto_delta`/`bloco`/`fim`: `app/server/agente/motor.ts`:
  teste com LLM sequenciada (conversa pura, loop multi-step, teto)
- [x] T314 (P0) [US1] `POST /api/mandatos/stream`: body `{comando |
  texto, pedidoId?, historico?}` validado, guardas idênticas ao
  clássico (limite escrita, `mandatosJanela`, 503 sem LLM), chama o
  motor, fecha com `fim` + `concluido` compat (`RespostaMandato`
  sintetizado) e `erro` mapeado: `app/server/index.ts`: teste de
  integração SSE com socket real (ordem dos eventos, 503 sem LLM)

## Fase 2: Frontend

- [x] T320 [P] (P0) [US1] `apiOps.ts`: `transmitirMandatoStream`
  envia `{comando, pedidoId?, historico?}`, parseia `tool`,
  `texto_delta` e `fim` além dos eventos atuais, devolve
  `{resposta?, agente?}`; historico montado dos últimos turnos da
  tela: `app/web/src/apiOps.ts`: teste web ou typecheck + revisão do
  parser contra o contrato de `model.ts`
- [x] T321 (P0) [US1][US2] `PaginaAssistenteIA.tsx`: turno com
  `textoAgente` acumulado por `texto_delta`, trilha de tools em
  atividade que dissolve na chegada, markdown leve seguro em JSX
  (parágrafos, `**negrito**`, listas, `` `código` ``; sem
  `dangerouslySetInnerHTML`), palco GenUI abaixo do texto,
  `RespostaMandato` legada segue renderizando:
  `app/web/src/components/PaginaAssistenteIA.tsx`: build web +
  teste web existente verde + revisão visual
- [x] T322 [P] (P2) `PalcoGenUI.tsx`: ajustes mínimos se o novo fluxo
  pedir (ex.: etapas do agente já entram pelo prop `etapas`);
  `tokens.css` intocado, contraste 52/52:
  `app/web/src/components/PalcoGenUI.tsx`: `check_contrast.py` 52/52

## Fase 3: DoD

- [x] T330 `agente.test.ts` completo: conversa pura pt-BR, loop
  multi-step com comparação de pedidos, `simular_cenario` sem escrita
  no ledger, multi-turn resolvendo referência do turno anterior,
  recuperação de argumento inválido e de falha de tool, seed
  somente leitura, sequência SSE `etapa`/`tool`/`texto_delta`/`bloco`/
  `fim`, 503 sem LLM: `app/server/agente.test.ts`: vitest verde
- [x] T331 bateria DoD: `node --check scripts/repo-guard.mjs`,
  `node scripts/repo-guard.mjs && node scripts/prose-evals.mjs`,
  `python3 app/web/scripts/check_contrast.py`, `npx tsc --noEmit`,
  `npm --prefix web run build`, `npm --prefix web test`,
  `npx vitest run --maxWorkers=2 shared server`: saída real colada
  no resumo final; sem commit, sem deploy
