# Tasks: Spec 0006: identidade Brandbook v4 no site e nas telas

Formato: `- [ ] TNNN [P] [USn] descrição: path: verificação`
`[P]` = paralelizável · `[USn]` = história da spec · toda task tem path e
verificação. Frentes: `[site]` = `wt/site-forseti`, `[app]` =
`wt/app-brand`. Onda 0 é sequencial (integração); as frentes rodam em
paralelo depois, `speckit/frentes.md`.

## Fase 0: Contrato (integração, antes dos worktrees)

- [ ] T001 spec + plan + tasks + briefs + `frentes.json` com `site-forseti` e `app-brand`, `app-demo` encerrada: `specs/0006-identidade-forseti-v4/`, `speckit/frentes.json`: guard exit 0
- [ ] T002 decisões D-030 a D-035 registradas em `DECISIONS.md` pela integração, na forma decidida em 22/11 (v4 substitui Rota 3 e a marca Refinada; site único re-vestido, sem landing separada nem `/diario`; logo oficial extraído do brandbook; app em light padrão com alternador e dark adaptado medido; lavanda clara proibida como texto): `DECISIONS.md`: entradas datadas na tabela

## Fase 1: Fundação (cada frente na sua base)

- [ ] T010 [P] [app] remapear `tokens.css` para a paleta v4 por papel: papel `--bg #F5F2EB`, petróleo `--text/--primary/--focus #163C38`, cinza `--text2/--border-strong #52665E`, coordenação `--change #654199` e `--change-bg #EDE5FE`, corda `--cord #D7C5EA`; `--gold*`/`--silver*` removidos; estados intactos: `app/web/src/tokens.css`: relatório colorlib com todos os pares de RF9 passando
- [ ] T011 [P] [app] tema escuro adaptado à v4 (fundo `#0E1F1D`, texto `#E8F0EE`, coordenação `#C9B2F0`/`#35294A`); light segue padrão e o alternador é preservado: `app/web/src/tokens.css`, `app/web/src/tema.ts`: pares do tema escuro passando na mesma medição e toggle funcionando
- [ ] T012 [P] [app] script de medição dos pares exigidos de RF9 reaproveitando `colorlib.py` (padrão `moodboard/scripts/build.py`, exit 1 se reprova): `app/web/scripts/`: relatório commitado com zero reprovações
- [ ] T013 [P] [app] fontes: `@fontsource` de Manrope e Geist Mono no `package.json` e imports no `main.tsx`; Source* removidos; `--font-ui` Manrope, `--font-mono` Geist Mono: `app/web/package.json`, `app/web/src/main.tsx`, `app/web/src/tokens.css`: `tsc --noEmit` limpo, nenhuma fonte antiga no bundle
- [ ] T014 [P] [app] logo oficial: copiar os SVGs de `forseti-brand/brandbook-v4/` para os assets do app; `Marca.tsx` serve o símbolo oficial; favicon v4 gerado dos SVGs: `app/web/src/components/Marca.tsx`, `app/web/index.html`, assets: screenshot sem ouro/prata, lockup correto por fundo
- [ ] T015 [P] [site] logo oficial: copiar os 5 SVGs de `forseti-brand/brandbook-v4/` para `site/public/assets/`, favicon derivado do símbolo, `og.png` refeito na v4 (composição 2D): `site/public/assets/forseti-*.svg`, `site/public/favicon.svg`, `site/public/assets/og.png`: assets resolvem no build
- [ ] T016 [P] [site] tokens v4 do site: papel/petróleo/lavanda/cinza por papel, corda como token gráfico; `Base.astro` com `color-scheme`/`theme-color` claros e fontes novas: `site/src/styles/global.css`, `site/src/layouts/Base.astro`, `site/package.json`: pares de RF9 medidos passando, Manrope e Geist Mono via `@fontsource`
- [ ] T017 [P] [site] remover Space Grotesk e JetBrains Mono das superfícies da marca (imports, fallbacks, `public/assets/fonts/` se ficarem sem uso): `site/src/`, `site/package.json`, `site/public/assets/fonts/`: build sem fonte antiga carregada

## Fase 2: Histórias

- [ ] T020 [US1] [site] hero reescrito: lockup oficial, proposta na voz da marca ("diferentes versões da operação, uma resolução compartilhada"), camada em três verbos (lê, compara, mostra), bloco "não somos" (transportadora, TMS, ERP, rastreador, chatbot): `site/src/pages/index.astro`: screenshot 1440/390, copy real sem placeholder
- [ ] T021 [US1] [site] seções existentes re-vestidas na v4 (pitch, ticker, problema, solução, campo, progresso, time, fecho), sem mudar conteúdo factual; componentes com estilo próprio recoloridos; bigorna sai do papel de logo e fica só como crédito da equipe: `site/src/pages/index.astro`, `site/src/components/`, `site/src/styles/global.css`: página inteira na v4, âncoras e links resolvem
- [ ] T022 [US2] [app] divergência e coordenação na matriz e nas tarefas usam a lavanda profunda medida; nenhuma lavanda clara como texto ou estado: `app/web/src/styles.css`, componentes tocados: inspeção visual + pares medidos
- [ ] T023 [US2] [app] materialidade v4 nas telas: pedra polida/papel nas superfícies, vidro lavanda só em evidência contextual, metal acetinado só em componente técnico, sem brilho genérico: `app/web/src/styles.css`: screenshot lado a lado com o site coerente
- [ ] T024 [US3] [site] gramática e motion v4: monólitos/cordas/camadas onde couber (hero e divisões), Surgir/Conectar/Propagar/Estabilizar no scroll; `prefers-reduced-motion` entrega o estado final; nenhuma informação só por animação: `site/src/`: teste `?reduce=1` renderiza cordas desenhadas
- [ ] T025 [US3] [app] movimento produtivo conferido: transições até ~240 ms, anel de mudança some e o "antes/depois" fica escrito, pausa ao vivo mantida (D-W7): `app/web/src/`: inspeção + `prefers-reduced-motion` no navegador

## Fase 3: Polimento

- [ ] T090 [P] [site] `site/README.md` e `README.md` raiz atualizados: página única na identidade v4, sem rota nova (A4): `site/README.md`, `README.md`: guard exit 0
- [ ] T091 [P] [app] revisão de copy das telas sob a voz "confiança sem ruído" (clara, precisa, resolutiva, imparcial), sem string nova sem uso: `app/web/src/`: releitura + `prose-evals` onde aplicável
- [ ] T092 [P] [site] a11y: foco visível, teclado pelos links e hero, alt/aria do logo e das cordas decorativas, contraste medido: `site/src/`: checklist A6 item a item com evidência
- [ ] T093 [P] [site] copy final revisada contra `STYLE.md` e a voz da marca; nenhuma afirmação sem prova no repo (A7): `site/src/pages/index.astro`: releitura + `prose-evals` limpo

## Gates locais

- [ ] T099 `node scripts/repo-guard.mjs` + `node scripts/prose-evals.mjs` exit 0; `tsc --noEmit` limpo em `app/web/`; `astro build` limpo; relatório colorlib anexado; critérios da spec item a item com evidência no commit/PR
