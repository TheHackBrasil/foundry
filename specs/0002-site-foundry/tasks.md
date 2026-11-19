# Tasks 0002: Site público na identidade Foundry

Formato: `- [ ] TNNN [P] [US?] descrição · path · verificação`

## Fase 1: contrato (frente wt/site)

- [ ] T001 [P] scaffold Astro + TS + React + deps (gsap, lenis, fontsource) · `site/` · `npm run build` passa
- [ ] T002 [P] tokens + tipografia + base layout (Base.astro, global.css) · `site/src/` · renderiza sem erro
- [ ] T003 marca bigorna SVG + favicon + metas OG · `site/public/assets/` + `Base.astro` · tags presentes

## Fase 2: fundação

- [ ] T004 header fixo + progress + footer · `site/src/layouts/Base.astro` · 1440px/360px ok
- [ ] T005 motion: GSAP reveals + ScrollTrigger + Lenis gated · `site/src/scripts/motion.ts` · reduced-motion sem Tier-1

## Fase 3: histórias

- [ ] T006 [US1] hero + status bar · `index.astro` · acima da dobra
- [ ] T007 [US1] CAP.01 MATÉRIA-PRIMA + copy · `index.astro`/`components/` · prose-evals nos docs novos
- [ ] T008 [US1] dominó do atraso (FRENTE wt/domino, subagent) · `src/components/domino/` · alterna modos, stagger, teclado, rótulo fictício
- [ ] T009 [US1] CAP.02 FOGO: evidências datadas + fotos + contatos · `index.astro` · alt real, datas certas
- [ ] T010 [US1] CAP.03 FORMA: decisão + esquema da camada · `index.astro` · fatos = `docs/escopo.md`
- [ ] T011 [US1] CAP.04 TÊMPERA: perguntas abertas · `index.astro` · nada prometido sem fonte
- [ ] T012 [US3] CAP.05 A FORJA: time 3 + Liz pendente + links repo · `index.astro` · LinkedIn + disclaimer
- [ ] T013 [US1] embers canvas + cena da camada em SVG · `components/` · zero asset isométrico antigo

## Fase 4: polimento

- [ ] T014 [P] reduced-motion fim a fim + debug `?reduce=1` · `motion.ts`/`global.css` · Tier-1 some, Tier-3 fica
- [ ] T015 [P] mobile 360px revisão completa · `global.css` · screenshot sem quebra
- [ ] T016 DoD: guard, prose-evals, astro check, build, screenshots · converge · tudo exit 0
- [ ] T017 converge: spec → entregue, índice, BACKLOG, DECISIONS · mesmo commit
