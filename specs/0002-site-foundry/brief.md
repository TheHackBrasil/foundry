# Brief · frente `site`

Escopo: construir `site/` completo conforme `specs/0002` (página única
dark industrial, narrativa "A Forja", dominó do atraso interativo).
Paths: `site/index.html`, `site/styles.css`, `site/main.js`,
`site/assets/fonts/`, `site/assets/foundry-mark.svg`, demais arquivos
novos dentro de `site/`. Não editar `site/assets/*.webp` portados.
Base: `main` em `74edd27`+ (spec 0002 commitada).
Proibido: merge em main, push fora da branch `wt/site`, editar imutável
(A9), tocar `.env*`, escrever fora dos paths, assets isométricos
antigos (`centro-logistico*`, `operation-sticker*` ficam fora da página).
Gate: `node scripts/repo-guard.mjs` exit 0, `node scripts/prose-evals.mjs`
exit 0, `node --check site/main.js`, screenshots 1440px + 360px sem
quebra, critérios da spec 0002 item a item.
Reporte: conclusão + evidência `arquivo:linha` por critério.
