# Brief · frente `site-forseti`

Escopo: aplicar a identidade do Brandbook v4 na página única de
`site/` (spec 0006), sem rota nova: hero reescrito apresentando o
produto (lockup oficial, proposta na voz da marca, três verbos, bloco
"não somos"), seções existentes re-vestidas (pitch, ticker, problema,
solução, campo, progresso, time, fecho) sem mudar conteúdo factual,
tokens v4 (papel `#F5F2EB`, petróleo `#163C38`, lavanda `#D7C5EA`,
cinza `#52665E`), Manrope + Geist Mono por `@fontsource`, logo oficial
copiado de `forseti-brand/brandbook-v4/forseti-*.svg` (5 arquivos),
favicon derivado do símbolo, `og.png` refeito, gramática
monólitos/cordas/camadas onde couber, motion
Surgir/Conectar/Propagar/Estabilizar com `prefers-reduced-motion`.
Site só claro: não existe alternador hoje (`color-scheme: dark` fixo
em `Base.astro`) e nenhum é criado. Bigorna sai do papel de logo e fica
só como crédito da equipe. Tasks T015 a T017, T020, T021, T024, T090,
T092, T093.

Paths: `site/`, `specs/0006-identidade-forseti-v4/brief-site-forseti.md`.
Não escrever em `app/**`, `specs/` fora do próprio brief,
`DECISIONS.md`/`BACKLOG.md`/`RULES.md`/`docs/` (escopo-produto),
`speckit/`, `scripts/`, `.specify/`.

Base: ponta da `wt/site-entrega1` (versão mais nova do site, ainda não
integrada); branch `wt/site-forseti`; worktree
`../foundry-wt-site-forseti`.

Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*`, escrever fora dos paths, criar rota ou página nova,
afirmação de capacidade sem prova no repo (A7), placeholder ou "em
breve" sem ponteiro (A1), travessão/meia-risca em `.md`, lavanda clara
como texto ou único indicador, redigitar o wordmark "Forseti" ou
alterar os SVGs oficiais (esticar, rotacionar, recolorir blocos,
contorno, sombra), copiar imagem com direitos autorais.

Gate: `node scripts/repo-guard.mjs` + `node scripts/prose-evals.mjs`
exit 0; `npm run build` limpo; pares de RF9 medidos com o colorlib do
R4 e passando; `/` renderiza a página inteira na v4 com as seções
preservadas; `color-scheme`/`theme-color` claros; cordas renderizam
quatro linhas lavanda onde a gramática pede; `?reduce=1` mostra o
estado final; foco e teclado; screenshots 1440 e 390 sem quebra.

Reporte: conclusão + evidência `arquivo:linha`, screenshots, relatório
de contraste e saída de gate por critério.

## Decisões da frente

(registrar aqui como D-S1, D-S2...; a integração copia para
`DECISIONS.md`)
