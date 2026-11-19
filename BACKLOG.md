# BACKLOG — fila local

Fila versionada de trabalho. Ordem = prioridade. Item não-trivial entra
em execução só via spec (`speckit/specify.md`). Status: `todo` /
`spec` (→ NNNN) / `doing` / `done` / `blocked`.

## Em execução

_(nenhum)_

## Fila

| # | Item | Status | Nota |
|---|---|---|---|
| 1 | Site build-in-public na identidade Foundry (dark + laranja, timeline portada, call remarcada) | todo | spec antes de começar; ref: repo `TheHackBrasil/the-foundry` (read-only) |
| 2 | Release `pitch-v9` com `pitch-v9-share.mp4` + seção/embed no site | todo | asset fora do repo: `/home/thiago/hackbrasil/projects/pitch-inicial/out/` |
| 3 | README definitivo: SVG animado da marca, OG/Twitter, LICENSE, links | todo | depende do #1 para o visual |
| 4 | Publicar `slides/` do deck de descoberta Enviagora | todo | arquivos já portados, aguardam Pages |
| 5 | GitHub Pages ativo + verificação do site live | todo | destrava #1–#4 publicamente |
| 6 | Capítulo pós-call Enviagora no diário | blocked | call remarcada sem data — escrever só com resultado real |
| 7 | Definir fluxo único do MVP | blocked | depende de #6 + resposta TOTVS (`docs/escopo.md`) |
| 8 | Integrar Liz (4ª integrante) no site/docs quando confirmada | blocked | confirmação pendente |

## Feito

| # | Item | Data |
|---|---|---|
| — | Publicação dos docs de pesquisa | 2026-11-19 → `specs/0001` |
| — | Pipeline SDD local (constitution, speckit, guard, DECISIONS, RULES) | 2026-11-19 |
| 9 | `site/assets/` + `slides/` portados e commitados | 2026-11-19 |

## Regras da fila

- Um item `doing` por vez; `blocked` sempre com o desbloqueio nomeado.
- Reordenação é edição livre; remoção de item pede motivo no commit.
- Nada aqui vira trabalho sem spec quando a mudança for não-trivial.
