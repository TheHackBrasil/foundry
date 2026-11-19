# Tasks 0002: Site público na identidade Foundry

Formato: `- [ ] TNNN [P] [US?] descrição — path — verificação`

## Fase 1: contrato (estrutura e tokens)

- [ ] T001 [P] tokens de design (cores, type scale, espaçamento, motion) — `site/styles.css` `:root` — tokens batem com `PRODUCT.md`
- [ ] T002 [P] fontes woff2 self-hosted + `@font-face` + preload — `site/assets/fonts/` — arquivo existe e carrega sem CDN
- [ ] T003 esqueleto HTML: header, hero, seções da forja, footer, metas OG — `site/index.html` — `html-assets` verde, lang pt-BR

## Fase 2: fundação

- [ ] T004 base CSS: reset, grid, tipografia Space/JetBrains, header fixo — `site/styles.css` — renderiza sem erro de console
- [ ] T005 marca bigorna em SVG + favicon — `site/assets/` — referenciado no header e `<link rel=icon>`

## Fase 3: histórias

- [ ] T006 [US1] hero: marca, tese, status build-in-public — `site/index.html` — acima da dobra em 1440px e 360px
- [ ] T007 [US1] seção MATÉRIA-PRIMA (a dor) + copy — `site/index.html` — texto sem padrão proibido (prose-evals)
- [ ] T008 [US1] dominó do atraso: 5 nós, propagação, 2 modos, rótulo fictício — `site/index.html` + `main.js` + `styles.css` — alterna modos, propaga em stagger, teclado acessível
- [ ] T009 [US1] seção FOGO: FENATRAN, call 16/11, contatos (fotos + evidências datadas) — `site/index.html` — fotos com alt, datas corretas
- [ ] T010 [US1] seção FORMA: decisão de direção, o que ficou fora, blockchain como opção — `site/index.html` — fatos batem com `docs/escopo.md`
- [ ] T011 [US1] seção TÊMPERA: perguntas abertas (Enviagora remarcada, TOTVS, Liz) — `site/index.html` — nada prometido sem fonte
- [ ] T012 [US3] cenas em código para slots visuais (SVG linha-art industrial) — `site/index.html`/`main.js` — sem assets isométricos antigos
- [ ] T013 [US2] seção A FORJA: time (3 + Liz pendente), links repo/docs — `site/index.html` — LinkedIn correto, disclaimer contatos
- [ ] T014 [US1] reveals de scroll + progress bar (IntersectionObserver, transform/opacity) — `site/main.js` — só compositor, sem jank visual
- [ ] T015 [US2] footer: data da última atualização, repo, docs — `site/index.html` — data real do commit

## Fase 4: polimento

- [ ] T016 [P] reduced-motion em camadas + `?reduce=1`/`?t=` debug — `site/styles.css`/`main.js` — Tier-1 some, Tier-3 fica
- [ ] T017 [P] mobile 360px: layout, dominó empilhado, demo usável — `site/styles.css` — screenshot sem quebra
- [ ] T018 OG/Twitter meta + description + theme-color — `site/index.html` — tags presentes
- [ ] T019 DoD completo: guard, prose-evals, node --check, screenshots — saídas coladas no converge — todos exit 0
- [ ] T020 converge: spec → entregue, índice, BACKLOG, DECISIONS — arquivos atualizados no mesmo commit
