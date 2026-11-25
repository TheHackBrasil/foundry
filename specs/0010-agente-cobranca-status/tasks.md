# Tasks: Spec 0010: agente de cobrança de status com claim verificável

Formato: `- [ ] TNNN [P] [USn] descrição: path: verificação`
`[P]` = paralelizável · `[USn]` = história da spec · toda task tem path e
verificação. Numeração T4xx para não colidir com T001-T099 (0004/0006),
T1xx (0007), T2xx (0008) e T3xx (0009). Prioridade entre parênteses `(P0|P1|P2)`.
Frentes a definir pelo time; ver "Frentes" no plan.md.

## Fase 0: Contrato

- [ ] T400 spec + plan + tasks + índice em `specs/README.md`:
  `specs/0010-agente-cobranca-status/`, `specs/README.md`:
  guard exit 0
- [ ] T401 (P0) contrato em `model.ts`: `Cobranca`,
  `StatusCobranca`, tipo `status_declarado` em `TipoEvento`,
  campos de `dados` do claim (`remetente`, `messageId`, `emlHash`,
  `dkim`, `cobrancaId`), divergência tipo `mudanca`:
  `app/shared/model.ts`: `tsc --noEmit` limpo
- [ ] T402 (P0) migração: tabela `cobrancas` com `workspace_id`
  (padrão `ALTER ... IF NOT EXISTS` da spec 0004) + persistência
  do `.eml` bruto por hash (tabela `evidencias` ou coluna):
  `app/server/db.ts`: migração roda no banco existente sem erro

## Fase 1: Pendência e cobrança

- [ ] T410 (P0) [US1] `verificarPendencias(store, agora)` +
  tick no boot: pedido aberto sem evento há `PENDENCIA_HORAS`
  cria `Cobranca` `pendente` idempotente:
  `app/server/pendencia.ts`: teste com relógio falso, 3 rodadas sem
  duplicar
- [ ] T411 (P0) [US1] projeção expõe `pendencias`/`cobrancas` e SSE
  avisa o workspace dono: `app/server/store.ts`,
  `app/server/sse.ts`: teste de isolamento entre workspaces
- [ ] T412 (P0) [US2] `smtp.ts`: envio por `SMTP_*`, `Message-Id`
  gravado, timeout 15 s, sem env -> `pendente_envio`:
  `app/server/smtp.ts`, `app/.env.example`: teste com servidor
  SMTP falso (ethereal ou socket mock)
- [ ] T413 (P0) [US2] `POST /api/cobrancas/:id/enviar`: sessão dona,
  seed 403, janela anti-spam `COBRANCA_INTERVALO_HORAS`,
  `COBRANCA_AUTO` opt-in: `app/server/index.ts`: teste de rota
  (403 seed, janela, envio feliz)
- [ ] T414 (P0) [US2] destinatário só via `contatos.ts` do
  workspace; template de assunto/corpo do servidor com chave de 44
  dígitos: `app/server/cobranca.ts`: teste rejeita destinatário
  injetado no body

## Fase 2: Claim com evidência DKIM

- [ ] T420 (P0) [US3] matching resposta->cobrança por
  `In-Reply-To`/`References` e por chave de 44 dígitos no mesmo
  workspace: `app/server/ingest/eml.ts`: teste com `.eml` de
  resposta encadeada e com chave no assunto
- [ ] T421 (P0) [US3] evento `status_declarado` na fonte
  `email_transportadora` com `dados` completos + `.eml` bruto
  persistido por `emlHash`: `app/server/ingest/eml.ts`,
  `app/server/db.ts`: teste confere hash e campos
- [ ] T422 (P0) [US5] verificação DKIM (`mailauth`): `pass` segue
  normal; `fail`/`ausente` limita confiança a 0.6 -> revisão:
  `app/server/ingest/dkim.ts`: teste com `.eml` assinado, sem
  assinatura e assinatura quebrada
- [ ] T423 (P0) [US3] extração dos campos vigiados do corpo por
  `chatJson`, limiar 0.7 e fila de revisão (padrão `pdf.ts`):
  `app/server/ingest/eml.ts`: teste com LLM mockada
- [ ] T424 (P0) [US4] `email_transportadora` entra nas fontes
  vigiadas da comparação: `app/shared/divergence.ts` ou
  configuração de fontes: teste com claim contradizendo NF-e
- [ ] T425 (P1) [US4] divergência `mudanca`: nova versão da mesma
  fonte divergindo da anterior: `app/shared/divergence.ts`: teste
  com duas respostas da transportadora
- [ ] T426 (P0) [US5] `.eml` bruto fora de resposta pública; só
  `emlHash` circula: `app/server/index.ts`: teste de rota não
  vaza raw

## Fase 3: Superfície e demo

- [ ] T430 (P1) [US4] selo "verificado DKIM" e badge de pendência
  na trilha/matriz, identidade v4, contraste AA:
  `app/web/src/...`: checagem de contraste + teste de render
- [ ] T431 (P1) [US1] `/api/simulate` aceita `pendenciaHoras`:
  `app/server/index.ts`: teste de rota
- [ ] T432 (P0) documentar `SMTP_*`, `COBRANCA_*`, `PENDENCIA_*`
  no `.env.example` sem valores: `app/.env.example`: diff limpo
- [ ] T433 (P0) roteiro de demo E2E local: pedido envelhecido ->
  cobrança -> e-mail real -> resposta -> claim DKIM -> divergência
  -> âncora: evidência no commit

## Fase 4: Gates

- [ ] T440 `tsc --noEmit` limpo, suíte de servidor e web verdes,
  `repo-guard` + `prose-evals` exit 0
- [ ] T441 decisões copiadas para `DECISIONS.md` pela integração;
  spec sai de `rascunho` só com aceite do time
