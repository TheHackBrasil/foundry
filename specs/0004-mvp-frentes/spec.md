# Spec 0004: MVP em frentes paralelas

**Status:** implementada
**Origem:** decisão D-015 · escopo de referência
[`docs/plano-mvp.pdf`](../../docs/plano-mvp.pdf) (aprovação do time
pendente, P-006)
**Data:** 2026-11-20

## Problema e resultado esperado

O MVP precisa sair em dez dias, feito por três pessoas, cada uma com
agentes em paralelo. O protocolo de frentes (`speckit/frentes.md`)
existia só no papel: nenhum hook ativo, nenhuma proteção da `main` e uma
contradição (frentes não dividem arquivo, mas todas escreviam em
`DECISIONS.md`). Em 20/11, duas sessões de agente escreveram direto na
cópia principal.

Quando isto estiver pronto, cada frente trabalha no próprio worktree e na
própria branch e só consegue commitar nos paths que são dela. A `main` só
recebe commit de integração. Decisões de frente ficam no brief, e quem
integra consolida em `DECISIONS.md` e `BACKLOG.md`.

## Frentes

| Frente | Branch | Worktree | Dona de | Brief |
|---|---|---|---|---|
| `core` | `wt/core` | `../foundry-wt-core` | `apps/core/`, `packages/shared/`, `infra/` | [brief-core.md](brief-core.md) |
| `demo` | `wt/demo` | `../foundry-wt-demo` | `apps/web/` | [brief-demo.md](brief-demo.md) |
| `produto` | `wt/produto` | `../foundry-wt-produto` | `corpus/`, `docs/`, `site/`, `README.md` | [brief-produto.md](brief-produto.md) |

Integração, só na `main`: todo o resto, em especial `DECISIONS.md`,
`BACKLOG.md`, `RULES.md`, `AGENTS.md`, `PRODUCT.md`, `speckit/`,
`scripts/`, `.specify/` e `specs/README.md`. Quem integra: P-007.

## Requisitos

- **RF1**: `speckit/frentes.json` mapeia cada frente para os seus paths e
  é a fonte única do hook.
- **RF2**: `scripts/frente-check.mjs` recusa, em `wt/<nome>`, commit com
  arquivo fora dos paths da frente; recusa commit na `main` sem
  `FOUNDRY_INTEGRA=1`; recusa branch `wt/` sem entrada no mapa.
- **RF3**: `scripts/hooks/pre-commit` roda `frente-check`, `repo-guard` e
  `prose-evals`; ativado por clone com
  `git config core.hooksPath scripts/hooks`.
- **RF4**: esqueleto com README de dona em `apps/core`, `apps/web`,
  `packages/shared` e `corpus`.
- **RF5**: cada app tem `package.json` e lockfile na própria pasta; a raiz
  não tem `package.json`; tipos compartilhados vêm de `packages/shared`
  por caminho relativo. Nenhum arquivo de dependência fica disputado.
- **RF6**: `AGENTS.md` e `speckit/frentes.md` registram a regra de
  decisões (brief da frente, depois integração), a integração diária e o
  uso em várias máquinas (branch por frente, uma pessoa integra).

## Critérios de aceite

- **CA1**: na `main`, commit sem `FOUNDRY_INTEGRA=1` é recusado.
- **CA2**: em `wt/demo`, arquivo staged em `apps/core/` é recusado e o
  hook nomeia o arquivo.
- **CA3**: em `wt/core`, arquivo em `apps/core/` passa pelo
  `frente-check`.
- **CA4**: `repo-guard` verde e `prose-evals` sem falha dura.
- **CA5**: `git worktree list` mostra `main`, `wt/core`, `wt/demo` e
  `wt/produto`.

## Fora de escopo

- Proteção de branch no GitHub: D-005 proíbe hoje; decisão em P-007.
- Hospedagem e scaffolding das apps: primeiras tarefas das frentes `core`
  e `demo`.
- Requisitos de produto: estão no plano (P-006) e nos briefs.

## Limites conhecidos

- O hook é local: cada pessoa ativa no próprio clone, e
  `git commit --no-verify` pula o hook. A integração lê o diff antes de
  mergear (`speckit/frentes.md`).
- O `frente-check` olha o que está staged, não o conteúdo. Arquivo gerado
  fora da pasta da frente (lockfile na raiz, por exemplo) é recusado e
  precisa ir para a pasta certa.
