# BACKLOG: fila local

Fila versionada de trabalho. Ordem = prioridade. Item não-trivial entra
em execução só via spec (`speckit/specify.md`). Status: `todo` /
`spec` (→ NNNN) / `doing` / `done` / `blocked`.

## Em execução

- #8 Build do MVP (atraso propagado): três frentes da `specs/0004`
  (core, demo, produto), meta de demo funcional em 23/11.
  Reconciliação com `docs/plano-mvp.pdf` em P-006.

## Fila

| # | Item | Status | Nota |
|---|---|---|---|
| 4 | Publicar `slides/` do deck de descoberta Enviagora | todo | arquivos já portados; subir no mesmo deploy |
| 6 | Capítulo pós-call Enviagora no diário | blocked | call remarcada sem data: escrever só com resultado real |
| 10 | Capítulo "MVP no ar" no site | blocked | escrever quando a demo da spec 0004 existir |

## Feito

| # | Item | Data |
|---|---|---|
| 7 | Escopo do MVP fechado: atraso propagado (`specs/0004`, D-015 a D-018) | 2026-11-20 |
| 11 | Frentes do MVP: worktrees por frente, dono por pasta, hook de pre-commit | 2026-11-20 → `specs/0005` |
| · | Publicação dos docs de pesquisa | 2026-11-19 → `specs/0001` |
| · | Pipeline SDD local (constitution, speckit, guard, DECISIONS, RULES) | 2026-11-19 |
| 9 | `site/assets/` + `slides/` portados e commitados | 2026-11-19 |
| 2 | Release `pitch-v10` com `pitch-v10-share.mp4` + vídeo no site (D-014) | 2026-11-19 |
| 1 | Site público na identidade Foundry (specs 0002 + 0003) | 2026-11-19 |
| 3 | README definitivo com SVG animado + OG/Twitter | 2026-11-19 |
| 5 | Site no ar e verificado em the-foundry-alpha.vercel.app | 2026-11-19 |

## Regras da fila

- Um item `doing` por vez; `blocked` sempre com o desbloqueio nomeado.
- Reordenação é edição livre; remoção de item pede motivo no commit.
- Nada aqui vira trabalho sem spec quando a mudança for não-trivial.
