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

- D-S1: tokens v4 mapeados por papel, não por nome antigo. `--ink` é
  petróleo `#163C38` (texto, estrutura, ação), `--ink-dim` cinza mineral
  `#52665E` (secundário), `--ink-faint` `#5D7068` (metadados, 4.7:1 no
  papel), `--cord` lavanda `#D7C5EA` só gráfica, `--violet` `#654199` como
  sinal de coordenação (divergências, selos, passos, foco), `--stone`
  `#0E1F1D` para ilhas escuras (ticker, fecho, hack-card, repo-shot) com
  `--stone-dim` `#A8B5AF` e `--on-stone`. `--ok` `#31693F` para o estado
  sincronizado do dominó. O mapa de calor laranja virou corda
  lavanda-para-violeta (`global.css`).
- D-S2: lavanda nunca é texto nem único sinal. Nos lugares onde ela marca
  algo (ponto base das perguntas, borda do retrato, selo FENATRAN) o texto
  ao lado é petróleo e o estado real usa violeta ou verde. O foco global é
  violeta (6.8:1 no papel) e vira lavanda dentro das ilhas escuras
  (`--focus: var(--cord)` em `.closing` e `.ticker`).
- D-S3: a bigorna saiu do logo e da tela. Header usa
  `forseti-lockup-petroleo.svg` oficial; footer repete a bigorna pequena
  só como crédito da equipe The Foundry. `forge.ts` (WebGL da bigorna) e
  a dependência `three` foram removidos; o hero ganhou a cena da
  gramática v4: três monólitos de petróleo atravessados por quatro
  cordas lavanda com um sinal violeta (`.hero-scene` + `.cords` em
  `index.astro`).
- D-S4: hero reescrito na voz v4. Título "Diferentes versões da operação.
  Uma resolução compartilhada." (palavra-chave sublinhada pela corda,
  via `em`), sub com "camada de reconciliação e coordenação", três
  verbos como lista `lê / compara / mostra` (o antigo "Sugere" virou
  "Mostra" na seção solução também) e o bloco "Não somos": transportadora,
  TMS, ERP, rastreador nem chatbot, repetido em `index.astro` no texto da
  solução. `hero-verbs` é `<ol>` (axe vetava `aria-label` em `<p>`).
- D-S5: motion segue os quatro verbos da marca. Surgir = entrada do hero
  e monólitos; Conectar = as quatro cordas desenhadas por
  `stroke-dashoffset` no scroll; Propagar = ponto violeta percorrendo a
  segunda corda via `MotionPathPlugin`; Estabilizar = repouso. Sem JS ou
  com `.reduce`/`prefers-reduced-motion`/`?reduce=1` as cordas ficam
  sempre desenhadas e o ponto some: nada é dito só pela animação.
- D-S6: ilhas preservadas com pele nova. O `.gh` mantém a aparência do
  GitHub (é uma janela do repositório, não da marca) com brilho violeta
  no lugar do laranja; o dominó usa violeta para divergência e `--ok`
  para sincronizado; os stickers ganharam a paleta `FORSETI` (corpos
  petróleo, preenchimentos lavanda, contorno `#0E1F1D`) e posters PNG
  regenerados a 800px; o mapa ASCII usa Geist Mono e tons lavanda sobre
  petróleo; o `.layer-bar` virou `.layer-cords` (as quatro linhas).
- D-S7: tipografia v4 aplicada. Manrope Variable 200-800 como família de
  comunicação (títulos 720-750, corpo 420-430, `font-weight` variável) e
  Geist Mono Variable para metadados, datas, verbos e códigos. Títulos
  saem do maiúsculo para caixa de sentença, como nos exemplos do
  brandbook; maiúsculo fica só em selos, carimbos e metadados mono.
  Space Grotesk e JetBrains Mono foram removidas de pacote, imports,
  `ascii-map.ts` e `public/assets/fonts/`.
- D-S8: a11y corrigido aproveitando a frente. `nav` com `role=tablist`
  virou `div` e o link Releases saiu do tablist (axe
  aria-required-children); skip link agora aponta para `#hero`; o
  `<a>` externo mantém ícone de saída. Resta pendente honesto: o vídeo
  do pitch tem faixa de áudio e o axe aponta `video-caption`: falta um
  `.vtt` com a transcrição do pitch-v10, fora do escopo desta frente.
  Os 91 nós "incomplete" de contraste do axe são leituras sobre
  `backdrop-filter`/gradientes, não violações.
- D-S9: og.png 1200x630 refeito em papel com lockup oficial, três
  monólitos, quatro cordas e sinal violeta (render via `rsvg-convert`,
  texto em Manrope/Geist Mono). `favicon.svg` deriva do símbolo oficial
  sobre quadrado arredondado de papel; `favicon.ico` regenerado. Os cinco
  SVGs oficiais foram copiados sem alteração (`forseti-*.svg`).
- D-S10: sem rota nova. Nada de `/diario` ou `/forseti`; as âncoras
  existentes (`#pitch`, `#materia`, `#forma`, `#fogo`, `#tempera`,
  `#progresso`, `#forja`, `#fecho`) foram preservadas e os ids herdados
  da identidade anterior (`materia`, `forma`, `fogo`, `forja`,
  `tempera`) ficaram para não quebrar links internos nem histórico.

## Verificação (22 nov 2026)

- `npm run build`: limpo, 1 página (`/index.html`).
- `node scripts/repo-guard.mjs`: 10 OK, 1 falha ambiental esperada em
  `specs`: o diretório 0006 neste worktree tem só o brief (spec/plan/
  tasks chegam pela integração) e `specs/README.md` pertence a outra
  frente. Falha não-corrigível dentro dos paths da frente.
- `node scripts/prose-evals.mjs`: OK, 0 duras, 1 leve pré-existente.
- axe-core 4.12.1 (`?reduce=1`): 0 violações, 53 passes; 2 incompletos
  (contraste sobre translucidez, pares medidos abaixo; e
  video-caption, ver D-S8).
- Contraste medido (colorlib R4): petróleo/papel 10.81; mineral/papel
  5.49; violeta/papel 6.78; violeta/violet-bg 6.23; petróleo/violet-bg
  9.92; petróleo/lavanda 7.52; papel/petróleo-fundo 15.24; verde
  `#31693F`/papel 5.83; `#5D7068`/papel 4.72. Lavanda sobre papel ~2
  confirmada como só-gráfica.
- Teclado: skip → marca → 6 links de nav → conteúdo, com foco visível
  (anel violeta; lavanda sobre petróleo-fundo).
- `?reduce=1` e `prefers-reduced-motion` emulado: `.reduce` aplicado,
  cordas desenhadas, sinal oculto, reveals instantâneos.
- Screenshots: `site-rev-topo-1440.png`, `site-rev-codigo-1440.png`
  (1440px) e mobile 390px capturados; página inteira renderizada sem
  quebra em ambos.
