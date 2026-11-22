# Brief · frente `app-brand`

Escopo: aplicar a identidade do Brandbook v4 em `app/web/` (spec 0006)
sobre a versão integrada: remapear `src/tokens.css` por papel (papel
`--bg`, petróleo `--text`/`--primary`/`--focus`, cinza mineral
`--text2`/`--border-strong`, coordenação `--change #654199` sobre
`--change-bg #EDE5FE`, corda `--cord #D7C5EA`), tema escuro adaptado
medido (fundo `#0E1F1D`, texto `#E8F0EE`, coordenação `#C9B2F0` sobre
`#35294A`) com light como padrão e o alternador preservado, fontes
Manrope + Geist Mono por `@fontsource`, logo oficial copiado de
`forseti-brand/brandbook-v4/forseti-*.svg` servido por `Marca.tsx`,
favicon v4, materialidade mineral nas superfícies e movimento
produtivo conferido. Sem mudança funcional: componentes só mudam onde
a identidade manda. Tasks T010 a T014, T022, T023, T025, T091.

Paths: `app/web/`, `specs/0006-identidade-forseti-v4/brief-app-brand.md`.
Não escrever em `app/shared/**`, `app/server/**`, `app/contracts/**`,
`app/seed/**`, `app/package.json` (app-infra; pedir dependência nova à
dona), `site/**`, `DECISIONS.md`/`docs/` (escopo-produto).

Base: ponta da `integra/mvp-final` (única com `app/web/` na versão
nova; idealmente após o merge dela na `main`); branch `wt/app-brand`;
worktree `../foundry-wt-app-brand`.

Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*`, escrever fora dos paths, reescrever componente por
estética, lavanda `#D7C5EA` como texto ou único indicador de estado,
ouro/prata como identidade, alterar os SVGs oficiais do logo,
fonte fora do `@fontsource` (OFL confirmada no pacote),
travessão/meia-risca em `.md`.

Gate: `node scripts/repo-guard.mjs` + `node scripts/prose-evals.mjs`
exit 0; `tsc --noEmit` limpo; `vitest run` verde; relatório colorlib
com todos os pares de RF9 passando nos dois temas (script em
`app/web/scripts/` ou adaptado do build do moodboard); light padrão e
alternador funcionando; divergência na matriz legível sem cor única;
`prefers-reduced-motion` respeitado; screenshot 1440 e 390 sem quebra.

Reporte: conclusão + evidência `arquivo:linha`, relatório de contraste,
screenshots e saída de gate por critério.

## Decisões da frente

(registrar aqui como D-B1, D-B2...; a integração copia para
`DECISIONS.md`)
