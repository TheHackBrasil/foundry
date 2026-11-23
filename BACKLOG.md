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
| 19 | "Cadeia viva" como fator wow: dominó da propagação movido por evento real (RF17, spec 0004) mais botão "simular" batendo no `POST /api/simulate` sobre o estado real da cadeia; portar o modelo do `Domino.tsx` do `site/` para `app/web`; cenário da demo = os dois pedidos da call TOTVS (eletrônicos atrasa, embalagem segura); twin 3D de galpão segue fora (plano-mvp) | todo | ideia aprovada em 23/11 para a fase final (12/12); exige spec própria antes de implementar |
| 12 | Vídeo do produto (até 3 min) para a entrega de 30/11 | todo | regulamento 7.3; o `pitch-v10` existe mas é anterior ao produto funcionando |
| 13 | Responder 413 (não 422) em upload acima do limite | feito | spec 0008 (T226); smoke público 11/11 em 23/11 após o redeploy |
| 14 | Faixa `.vtt` de legendas no vídeo `pitch-v10` do site | todo | axe `video-caption` |
| 20 | `og:url`/`og:image` em `site/src/layouts/Base.astro` apontam o domínio antigo da marca (resíduo no `<head>` do site da equipe) | todo | achado do reviewer da `hardening`, 23/11; path é da `escopo-produto` |
| 21 | Nota de deploy do `CLIENT_IP_HEADER`: ausente atrás de proxy vira bucket global (demo congela para visitante novo); presente sem proxy que sobrescreva é spoofável | todo | documentar no README/`deploy/`; achado do reviewer da `hardening`, 23/11 |
| 22 | `MAX_WRITING_WORKSPACES=0` recusa toda primeira escrita: documentar como kill-switch ou exigir mínimo 1 em `config.ts` | todo | achado do reviewer da `hardening`, 23/11 |
| 23 | Menores da revisão da `hardening`: `parser.destroy()` no `finally` pode mascarar `ErroParser` em `pdf.ts`; `confianca > 1` aceito; `e.message` do mailparser entra no payload de revisão visível a outras sessões; `JanelaFixa` poda só acima de 10 mil chaves expiradas | todo | achados do reviewer da `hardening`, 23/11 |
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
