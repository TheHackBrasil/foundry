# BACKLOG: fila local

Fila versionada de trabalho. Ordem = prioridade. Item não-trivial entra
em execução só via spec (`speckit/specify.md`). Status: `todo` /
`spec` (→ NNNN) / `doing` / `done` / `blocked`.

## Em execução

- Entrega da fase online (30/11, 23h59): repositório, demo pública e
  vídeo do produto de até 3 minutos. Demo já no ar (D-038); o vídeo do
  produto segue na fila.

## Fila

| # | Item | Status | Nota |
|---|---|---|---|
| 12 | Vídeo do produto (até 3 min) para a entrega de 30/11 | todo | regulamento 7.3; o `pitch-v10` existe mas é anterior ao produto funcionando |
| 13 | Responder 413 (não 422) em upload acima do limite | todo | falha do smoke público de 23/11 (P-008) |
| 14 | Faixa `.vtt` de legendas no vídeo `pitch-v10` do site | todo | axe `video-caption` |
| 4 | Publicar `slides/` do deck de descoberta Enviagora | todo | arquivos já portados; subir no mesmo deploy |
| 6 | Capítulo pós-call Enviagora no diário | blocked | call remarcada sem data: escrever só com resultado real |
| 10 | Capítulo "MVP no ar" no site | todo | demo pública no ar desde 23/11 (D-038) |

## Feito

| # | Item | Data |
|---|---|---|
| 8 | Build do MVP (atraso propagado): demo funcional em 23/11 (`specs/0004`) | 2026-11-23 |
| 15 | Identidade Brandbook v4 nas telas do app e no site (`specs/0006`, D-030 a D-035) | 2026-11-23 |
| 16 | LP do produto em `lp/` no ar: forseti-br.vercel.app (D-036, D-038) | 2026-11-23 |
| 17 | Demo pública no ar: app + Postgres na Railway (D-037, smoke 10/11, soak SSE ok) | 2026-11-23 |
| 18 | Integração das frentes v4 e deploy na `main` (sessão 14 do `DECISIONS.md`) | 2026-11-23 |
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
