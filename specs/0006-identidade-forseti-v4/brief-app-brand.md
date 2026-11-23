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

- D-B1: a coluna lateral ganhou tokens próprios (`--rail`, `--on-rail`,
  `--rail-soft`) em vez de reaproveitar `--primary`: o monólito fica
  petróleo nos dois temas como no brandbook, enquanto `--primary` vira
  claro no tema escuro para os controles ativos.
- D-B2: `Marca.tsx` renderiza só o símbolo oficial (petróleo no claro,
  negativo no escuro) ao lado do nome `FORSETI` em texto Geist Mono;
  o lockup completo ficaria redundante a 1,875rem de altura.
- D-B3: favicon gerado como composição do símbolo isolado negativo sobre
  papel; os SVGs oficiais foram copiados sem alteração e servem de fonte.
- D-B4: a corda lavanda `--cord` aparece só como fio gráfico na borda do
  monólito lateral; nunca como texto nem indicador de estado (1,44:1
  sobre papel, medido no relatório de contraste).
- D-B5: divergência na matriz usa três pistas (tinta `--change-bg`, fio
  superior `--change` e o rótulo "Diverge" com ícone), e "antes/depois"
  segue escrito na célula; nenhum estado depende só de cor.
- D-B6: nenhuma transição ou animação foi criada; a interface não tem
  movimento além de foco e estados instantâneos, e o media query global
  de `prefers-reduced-motion` cobre o que existir.
- D-B7: `scripts/check_contrast.py` lê os tokens de `src/tokens.css` e
  sai com código 1 em qualquer reprovação; o relatório gerado fica
  versionado em `evidencias/contraste-v4.md`.
- D-B8: T091 registrada como concluída sem alteração: a copy das telas
  foi relida contra a voz "confiança sem ruído" (frases factuais,
  estados nomeados, dados fictícios sinalizados) e já estava conforme.
- D-B9: os dois `forseti-lockup-*.svg` ficam em `src/assets/` como
  biblioteca oficial da marca, sem referência no código: `Marca.tsx`
  serve símbolo mais wordmark em texto (D-B2), e os lockups completos
  ficam disponíveis para usos futuros a custo zero.

Nota de conhecimento: o fix do stream (`useTorre.ts`) reduz a janela da
corrida de cookie, não a elimina: se a primeira `listarPedidos()` falhar
por rede sem resposta HTTP, o `finally` libera o stream sem cookie e a
tela cai no estado de erro normal.
