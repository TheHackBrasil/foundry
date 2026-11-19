# site/

Site público do The Foundry: página única estática, diário de construção
do projeto no HackBrasil 2026.

## Stack

- Astro 7 (SSG) + TypeScript, sem backend
- Ilha React 19 no componente do dominó (`src/components/domino/`)
- GSAP 3 + ScrollTrigger para reveals; Lenis para scroll suave
- Fontes locais via `@fontsource` (sem CDN em runtime)
- Saída estática em `dist/` (ignorada pelo git)

## Comandos

```bash
npm install
npm run dev        # desenvolvimento
npm run build      # gera dist/
npm run preview    # serve dist/ localmente
npx astro check    # typecheck dos .astro
```

## Regras

- Copy segue `../STYLE.md` (formal-direto, sem travessão nem meia-risca).
- Motion: só `transform`/`opacity`; `prefers-reduced-motion` desliga Lenis,
  embers e reveals grandes (teste manual com `?reduce=1`).
- Fatos com data e fonte: nunca apresentar simulação como validação (A7).
  O dominó é simulação fictícia e diz isso na própria peça.
- Spec vigente: `../specs/0002-site-foundry/`.
- Decisões: `../DECISIONS.md`. Processo: `../docs/`.
