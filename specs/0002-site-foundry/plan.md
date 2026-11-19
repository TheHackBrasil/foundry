# Plan 0002: Site público na identidade Foundry

## Resumo

Página única estática em `site/` (HTML + CSS + JS vanilla, zero deps,
sem build). Estrutura narrativa na metáfora da forja; peça central =
demo "dominó do atraso" (SVG/DOM + WAAPI, transform/opacity). Fotos
reais com tratamento dark; cenas novas desenhadas em código; fontes
Space Grotesk + JetBrains Mono self-hosted em woff2.

## Constitution Check

| Artigo | Veredito | Evidência |
|---|---|---|
| A1 fatia completa | passa | Página inteira funcional sem placeholder; capítulo Enviagora mostra status real "remarcada" em vez de teaser vazio |
| A2 dados na fronteira | n/a | Sem backend/dados de usuário; página é 100% pública |
| A3 escritas previsíveis | passa | JS sem backend: falha de asset não derruba a página; JS opcional (progressive enhancement) |
| A4 superfície pública | passa | `site/` nova = superfície pública explícita, indexada em README e spec |
| A5 dados pessoais | passa | Pessoas citadas já estão em `docs/fontes-e-contatos.md`; contatos externos com disclaimer de não-endosso |
| A6 idioma/a11y | passa | pt-BR; contraste AA laranja/escuro; foco visível; reduced-motion em camadas; alt text real |
| A7 demo honesta | passa | Dominó rotulado "simulação fictícia"; nada apresentado como validado |
| A8 gate local | passa | DoD: guard + prose-evals + node --check + screenshots |
| A9 imutável | passa | Fontes primárias não tocadas; spec 0001 congelada |
| A10 intenção | passa | Esta spec + DECISIONS D-012 |

## Caminhos reais

```
site/index.html      página única
site/styles.css      tokens + layout + motion
site/main.js         dominó + reveals + progress
site/assets/         fotos webp (portadas), fonts/woff2 (novas), svg
```

Repo antigo `the-foundry/build-in-public/` = referência de conteúdo e
assets somente (D-008).

## Dados e migrations

n/a: estático, sem banco.

## Matriz de autorização

n/a: sem dados de usuário. Tudo publicado é público por definição.

## Plano de testes

- `node scripts/repo-guard.mjs` (html-assets cobre src/href relativos).
- `node scripts/prose-evals.mjs` (docs novos; copy do site revisada com
  skill `antislop-copywriting`).
- `node --check site/main.js`.
- Servir `site/` localmente; screenshots desktop 1440px e mobile 360px
  em vários pontos de scroll; demo nos dois modos.
- `prefers-reduced-motion`: checar ausência de deslocamentos Tier-1.
- Console limpo; Lighthouse mental: fontes preload, imagens lazy.

## Rollout manual

Fora de escopo (Pages é item separado do BACKLOG). Entrega = pasta
`site/` servível por qualquer servidor estático.

## Desvios de complexidade

- JS monolítico em `main.js` (sem módulos/build): justificado por zero
  deps e Pages direto; mantido em seções comentadas.
- Cenas em SVG/canvas em vez de vídeo/asset gerado: zero peso de
  mídia, identidade 100% code-made.
