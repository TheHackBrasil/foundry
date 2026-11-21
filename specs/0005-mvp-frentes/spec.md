# Spec 0005: frentes paralelas do MVP (worktrees, dono por pasta, hook)

**Status:** implementada
**Origem:** decisão D-019 · divisão em frentes da
[spec 0004](../0004-mvp-atraso-propagado/spec.md) (fechada na call de 20/11)
**Data:** 2026-11-20

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

As três da spec 0004, com os nomes dos briefs dela.

| Frente | Branch | Worktree | Dona de | Brief |
|---|---|---|---|---|
| `app-core` | `wt/app-core` | `../foundry-wt-app-core` | `app/shared/`, `app/server/`, `app/contracts/`, `app/package.json`, `app/package-lock.json`, `app/tsconfig*.json`, `app/docker-compose.yml` | [brief-core.md](../0004-mvp-atraso-propagado/brief-core.md) |
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
  `FOUNDRY_INTEGRA=1`; recusa branch `wt/` sem entrada no mapa.
- **RF3**: `scripts/hooks/pre-commit` roda `frente-check`, `repo-guard` e
  `prose-evals`; ativado por clone com
  `git config core.hooksPath scripts/hooks`.
- **RF4**: nenhum arquivo de dependência é disputado: o `package.json`, o
  lockfile, o `tsconfig` e o `docker-compose.yml` da raiz de `app/` são
  da `app-core`; a `app-demo` cria `app/web/package.json` e lockfile
  próprios, e a `app-core` só orquestra os dois no script `dev`. Tipos
  compartilhados vêm de `app/shared/` por caminho relativo.
- **RF5**: `AGENTS.md` e `speckit/frentes.md` registram a regra de
  decisões (fim do brief da frente; `escopo-produto` ou a integração
  copiam para `DECISIONS.md`), a integração diária e o uso em várias
  máquinas (branch por frente, uma pessoa integra).

## Critérios de aceite

- **CA1**: na `main`, commit sem `FOUNDRY_INTEGRA=1` é recusado.
- **CA2**: em `wt/app-demo`, arquivo staged em `app/server/` é recusado e
  o hook nomeia o arquivo.
- **CA3**: em `wt/app-core`, arquivo em `app/server/` e `app/tsconfig.json`
  passam pelo `frente-check`.
- **CA4**: `repo-guard` verde e `prose-evals` sem falha dura.
- **CA5**: `git worktree list` mostra `main`, `wt/app-core`, `wt/app-demo`
  e `wt/escopo-produto`.

## Fora de escopo

- Proteção de branch no GitHub: D-005 proíbe hoje; decisão em P-007.
- Hospedagem e scaffolding das apps: primeiras tarefas das frentes
  `app-core` e `app-demo` (P-008).
- Requisitos e prioridades de produto: spec 0004 e P-006.

## Limites conhecidos

- O hook é local: cada pessoa ativa no próprio clone, e
  `git commit --no-verify` pula o hook. A integração lê o diff antes de
  mergear (`speckit/frentes.md`).
- O `frente-check` olha o que está staged, não o conteúdo. Arquivo gerado
  fora da pasta da frente (lockfile em outro lugar, por exemplo) é
  recusado e precisa ir para a pasta certa.
- O brief da `app-core` na spec 0004 pede o boot do Vite em `app/web/`, e
  o mesmo brief proíbe escrever lá. Vale a regra desta spec: o boot do
  Vite é da `app-demo`.

## Evidência

Preenchida depois dos testes no passo de integração (20/11).
