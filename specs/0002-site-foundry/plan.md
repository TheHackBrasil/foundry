# Plan 0002: Site público na identidade Foundry

## Resumo

Página única em `site/` como projeto **Astro + TypeScript** (SSG, zero
JS por padrão). Ilha **React** só no dominó do atraso (componente
state-driven). **GSAP + ScrollTrigger** nas cenas e **Lenis** no scroll
(gated por prefers-reduced-motion). Fontes via `@fontsource`. Assets
reais em `site/public/assets/`. Build estático em `site/dist/`
(gitignored; publicação Pages é item separado do BACKLOG).

## Constitution Check

| Artigo | Veredito | Evidência |
|---|---|---|
| A1 fatia completa | passa | Página inteira funcional; Enviagora mostra status real "remarcada" |
| A2 dados na fronteira | n/a | Sem backend/dados de usuário; 100% público |
| A3 escritas previsíveis | passa | SSG: HTML completo sem JS funciona; ilhas falham isoladas |
| A4 superfície pública | passa | `site/` = superfície explícita, indexada em README e spec |
| A5 dados pessoais | passa | Pessoas citadas em `docs/fontes-e-contatos.md`; contatos com disclaimer |
| A6 idioma/a11y | passa | pt-BR; AA laranja/escuro; foco; reduced-motion em camadas (gsap.matchMedia); alt real |
| A7 demo honesta | passa | Dominó rotulado "simulação fictícia" |
| A8 gate local | passa | DoD: guard + prose-evals + astro check + build + screenshots |
| A9 imutável | passa | Fontes primárias não tocadas; spec 0001 congelada |
| A10 intenção | passa | Esta spec + DECISIONS |

## Caminhos reais

```
site/
  astro.config.mjs, package.json, tsconfig.json
  src/pages/index.astro        página única
  src/layouts/Base.astro       head + header + footer
  src/components/*.astro       seções estáticas
  src/components/domino/**     ilha React (frente wt/domino)
  src/styles/global.css        tokens + motion
  src/scripts/motion.ts        GSAP + Lenis + reveals
  public/assets/               fotos webp, svg mark
```

Frentes: `wt/site` (orquestrador: scaffold, seções, motion) +
`wt/domino` (subagent: ilha React). Integração: domino → site → main.
Repo antigo = referência de conteúdo/assets (D-008).

## Dados e migrations

n/a: estático.

## Matriz de autorização

n/a: sem dados de usuário; tudo publicado é público.

## Plano de testes

- `node scripts/repo-guard.mjs`, `node scripts/prose-evals.mjs`.
- `cd site && npm run astro check` (types) e `npm run build` limpo.
- `npm run dev`/preview local; screenshots 1440px + 360px em vários
  scroll points; dominó nos dois modos.
- `prefers-reduced-motion`: sem Tier-1 (Lenis nem instancia).
- Console limpo; fontes sem CDN; imagens lazy.

## Rollout manual

Fora de escopo. Entrega = `site/dist/` gerável com `npm run build`;
publicação Pages é item próprio do BACKLOG.

## Desvios de complexidade

- Framework em vez de vanilla: pedido explícito do usuário ("usa
  frameworks modernos"). Custo: node_modules local + build.
- React apenas onde o estado é rico (dominó); o resto fica `.astro`
  estático: menos JS no cliente, não mais.
