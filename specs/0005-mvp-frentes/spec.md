# Spec 0005: frentes paralelas do MVP (worktrees, dono por pasta, hook)

**Status:** implementada
**Origem:** decisões D-019 e D-021 · divisão em frentes da
[spec 0004](../0004-mvp-atraso-propagado/spec.md) (fechada na call de 20/11)
**Data:** 2026-11-20 · revisada em 2026-11-21 (frente `app-infra`)

## Problema e resultado esperado

O MVP sai em dez dias, feito por três pessoas, cada uma com agentes em
paralelo. O protocolo de frentes (`speckit/frentes.md`) existia só no
papel: nenhum hook ativo, nenhuma proteção da `main` e uma contradição
(frentes não dividem arquivo, mas todas escreviam em `DECISIONS.md`). Em
20/11, duas sessões de agente escreveram direto na cópia principal.

Quando isto estiver pronto, cada frente trabalha no próprio worktree e na
própria branch e só consegue commitar nos paths que são dela. A `main` só
recebe commit de integração.

Esta spec não define produto nem prioridade: isso é da spec 0004. Aqui
fica só o mecanismo que impede as frentes da 0004 de pisar umas nas
outras.

## Frentes

Quatro. As três da spec 0004 e a `app-infra`, criada em 21/11 (D-021)
quando a `app-core` foi dividida em domínio e ingest de um lado, servidor
e hospedagem do outro.

| Frente | Branch | Worktree | Dona de | Brief |
|---|---|---|---|---|
| `app-core` | `wt/app-core` | `../foundry-wt-app-core` | `app/shared/`, `app/server/ingest/` | [brief-core.md](../0004-mvp-atraso-propagado/brief-core.md) |
| `app-infra` | `wt/app-infra` | `../foundry-wt-infra` | `app/server/*.ts`, `app/server/db/`, `app/contracts/`, `app/package.json`, `app/package-lock.json`, `app/tsconfig*.json`, `app/docker-compose.yml`, arquivos de deploy | [brief-infra.md](../0004-mvp-atraso-propagado/brief-infra.md) |
| `app-demo` | `wt/app-demo` | `../foundry-wt-demo` | `app/web/` (com `package.json` e lockfile próprios) | [brief-demo.md](../0004-mvp-atraso-propagado/brief-demo.md) |
| `escopo-produto` | `wt/escopo-produto` | `../foundry-wt-escopo` | `app/seed/`, `app/README.md`, `docs/`, `DECISIONS.md`, `BACKLOG.md`, `RULES.md`, `README.md`, roteiros | [brief-produto.md](../0004-mvp-atraso-propagado/brief-produto.md) |

Integração, só na `main`: todo o resto, em especial `AGENTS.md`,
`PRODUCT.md`, `speckit/`, `scripts/`, `.specify/`, `site/`, `slides/`,
`specs/` fora dos briefs e `specs/README.md`. Quem integra: P-007.

Cada frente também pode escrever o próprio brief, que é onde registra
decisões e o reporte.

## Requisitos

- **RF1**: `speckit/frentes.json` mapeia cada frente para os seus paths e
  é a fonte única do hook.
- **RF2**: `scripts/frente-check.mjs` recusa, em `wt/<nome>`, commit com
  arquivo fora dos paths da frente; recusa commit na `main` sem
  `FOUNDRY_INTEGRA=1`; recusa branch `wt/` sem entrada no mapa. Um `*`
  vale dentro de um nome de arquivo e não atravessa a barra: `app/server/*.ts`
  casa `app/server/index.ts` e não `app/server/ingest/nfe.ts`.
- **RF3**: `scripts/hooks/pre-commit` roda `frente-check`, `repo-guard` e
  `prose-evals`; ativado por clone com
  `git config core.hooksPath scripts/hooks`.
- **RF4**: nenhum arquivo de dependência é disputado. O `package.json`,
  o lockfile, o `tsconfig*.json`, o `docker-compose.yml` e os scripts
  (`dev`, `start`, `build`) da raiz de `app/` são da `app-infra`. As
  dependências que a `app-core` usa já estão no `package.json` da
  primeira versão do código (D-022), e ela pede dependência nova à
  `app-infra` no Linear. A `app-demo` cria `app/web/package.json` e
  lockfile próprios, e a `app-infra` orquestra os dois no script `dev`.
- **RF5**: `AGENTS.md` e `speckit/frentes.md` registram a regra de
  decisões (fim do brief da frente; `escopo-produto` ou a integração
  copiam para `DECISIONS.md`), a integração diária e o uso em várias
  máquinas (branch por frente, uma pessoa integra).
- **RF6**: as fronteiras entre frentes têm contrato escrito, porque o
  hook impede o arquivo alheio mas não impede o formato alheio.
  `app-core` para `app-infra`: `detectarTipo` e os parsers de
  `app/server/ingest/`, que lançam `ErroParser` para entrada ruim;
  `app/server/pipeline.ts` os chama e grava. `app-infra` para
  `app-demo`: os tipos de resposta de `app/shared/model.ts`
  (`ResultadoIngest`, `ProjecaoPedido`, `RespostaAuditoria`,
  `RespostaSimulacao`), que a demo importa em vez de inventar formato.
  O `workspaceId` é sorteado pela infra, em cookie (RF27 da spec 0004).

## Critérios de aceite

- **CA1**: na `main`, commit sem `FOUNDRY_INTEGRA=1` é recusado.
- **CA2**: em `wt/app-demo`, arquivo staged em `app/server/` é recusado e
  o hook nomeia o arquivo.
- **CA3**: em `wt/app-core`, `app/server/ingest/x.ts` passa pelo
  `frente-check` e `app/server/index.ts` é recusado.
- **CA4**: `repo-guard` verde e `prose-evals` sem falha dura.
- **CA5**: `git worktree list` mostra `main`, `wt/app-core`,
  `wt/app-infra`, `wt/app-demo` e `wt/escopo-produto`.
- **CA6**: em `wt/app-infra`, `app/server/index.ts` e `app/package.json`
  passam e `app/server/ingest/x.ts` é recusado (prova que o `*` não
  atravessa a barra). Em `wt/app-core`, `app/package.json` é recusado.

## Fora de escopo

- Proteção de branch no GitHub: D-005 proíbe hoje; decisão em P-007.
- Hospedagem e scaffolding das apps: primeiras tarefas das frentes
  `app-infra` e `app-demo` (P-008).
- Requisitos e prioridades de produto: spec 0004 e P-006.

## Limites conhecidos

- O hook é local: cada pessoa ativa no próprio clone, e
  `git commit --no-verify` pula o hook. A integração lê o diff antes de
  mergear (`speckit/frentes.md`).
- O `frente-check` olha o que está staged, não o conteúdo. Arquivo gerado
  fora da pasta da frente (lockfile em outro lugar, por exemplo) é
  recusado e precisa ir para a pasta certa.
- O brief original da `app-core` pedia o boot do Vite em `app/web/` e
  proibia escrever lá. Vale a regra desta spec: o boot do Vite é da
  `app-demo` e o script `dev` que sobe os dois é da `app-infra`.
- Arquivo novo em `app/shared/` ou `app/server/ingest/` entra na
  `app-core` sem mexer no mapa. Arquivo novo na raiz de `app/` ou em
  `app/server/` fora de `*.ts` precisa de entrada no mapa, feita pela
  integração.

## Evidência (21/11)

Testes no estado `da3eb69`, com `scripts/hooks/pre-commit` rodando sobre
arquivo temporário staged em cada worktree (removido depois, sem commit de
teste). Quatorze casos, todos com o resultado esperado.

- **CA1**: na `main`, arquivo staged sem `FOUNDRY_INTEGRA=1` foi
  recusado ("commit direto na main é só para integração"); com a variável
  passou.
- **CA2**: em `wt/app-demo`, `app/server/tmp-no.ts` foi recusado e o hook
  listou os paths da frente; `app/web/` passou.
- **CA3**: em `wt/app-core`, `app/server/ingest/` e `app/shared/` passaram;
  `app/server/tmp-no.ts` foi recusado.
- **CA4**: `repo-guard` verde (11 checks); `prose-evals` com 0 duras.
- **CA5**: `git worktree list` com `main`, `wt/app-core`, `wt/app-infra`,
  `wt/app-demo` e `wt/escopo-produto`, todas em `da3eb69`.
- **CA6**: em `wt/app-infra`, `app/server/tmp-ok.ts`, `app/api/` e
  `app/package.json` passaram e `app/server/ingest/tmp-no.ts` foi
  recusado, o que prova que o `*` de `app/server/*.ts` não atravessa a
  barra. Em `wt/app-core`, `app/package.json` foi recusado.
- Extra: em `wt/escopo-produto`, `app/seed/` passou e
  `app/server/ingest/` foi recusado.
