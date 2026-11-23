# Spec 0006: identidade Brandbook v4 no site e nas telas do produto

**Status:** aprovada (decisões do usuário de 22/11)
**Origem:** Brandbook v4 do Gabriel (`forseti-brand/brandbook-v4/`,
recebido em 22/11) · decisões D-W6 a D-W8 da frente `app-demo`
(identidade anterior "Rota 3 Salão") a substituir
**Data:** 2026-11-22

## Problema e resultado esperado

As telas do produto (`app/web/`, versão integrada em `integra/mvp-final`)
e o moodboard foram desenhados antes do Brandbook v4 chegar: paleta
neutra com ciano de mudança, Source Serif/Sans/Code Pro e a marca
"Refinada" em ouro e prata. O site (`site/`, deployado em
the-foundry-alpha.vercel.app) ainda fala a língua da equipe: escuro,
laranja, Space Grotesk, bigorna. O Brandbook v4 manda outra coisa:
Manrope e Geist Mono, petróleo `#163C38`, lavanda `#D7C5EA`, papel
mineral `#F5F2EB`, cinza mineral `#52665E`, gramática de monólitos,
cordas e camadas, e voz "confiança sem ruído". Quando isto estiver
pronto, o site inteiro e as telas do produto falam a língua da marca:
mesma paleta medida, mesmas fontes, mesmo logo oficial, mesmo
movimento, sem afirmar nada que a demo não prova.

## Fora de escopo

- Biblioteca 3D (6 GLB do brandbook): os meshes são protótipos sem
  textura final; importá-los não cabe até 30/11. Fica como fase 2. Onde
  uma seção pediria cena 3D, usa-se a gramática vetorial (monólitos e
  cordas em SVG/CSS).
- Iconografia editorial isométrica autoral (armazém, transporte,
  documento, reconciliação, conexão, resolução): o brandbook entrega
  PNGs conceituais, não vetores. Vetorização autoral é fase 2.
- Rotas ou páginas novas no site: o sitemap atual se mantém; a página
  única é re-vestida, não substituída por outra arquitetura.
- Alternador de tema no site: o site não tem toggle hoje
  (`color-scheme: dark` fixo em `Base.astro`) e fica só claro na v4.
- Pesquisa de anterioridade no INPI, domínio final do produto, versões
  de acessibilidade completas do brandbook (pendências declaradas na
  página de governança do próprio brandbook).
- Re-shoot do pitch em vídeo, slides e qualquer peça fora de `site/` e
  `app/web/`.
- Mudança funcional nas telas e no site: esta spec troca identidade e
  copy de apresentação, não comportamento. Matriz, tarefas, envio,
  cadeia, dominó e seções seguem como estão.

## Histórias

### US1: visitante da banca quer entender o produto em segundos

- **Dado** a URL pública do site **Quando** abre a página **Então** vê
  o logo oficial Forseti, a proposta em uma frase na voz da marca e o
  que o produto não é, na identidade v4, sem precisar rolar.
- **Dado** a mesma página **Quando** rola **Então** encontra as seções
  de hoje (pitch, problema, solução, campo, progresso, time)
  apresentadas na identidade v4, com links para demo e vídeo quando
  existirem.

### US2: operador da demo quer reconhecer o produto do site na tela

- **Dado** o site visto **Quando** abre a demo **Então** reconhece a
  mesma marca, paleta e tipografia, sem transição brusca.
- **Dado** a matriz de fontes **Quando** um campo diverge **Então** a
  divergência usa a cor de coordenação da marca em forma legível, nunca
  a lavanda clara como texto.

### US3: avaliador técnico quer prova, não promessa

- **Dado** qualquer texto das duas superfícies **Quando** lê **Então**
  não encontra afirmação de capacidade sem evidência no repo nem "em
  breve" sem ponteiro (A1, A7).
- **Dado** o leitor de contraste ou o daltonismo **Quando** usa as duas
  superfícies **Então** todos os pares exigidos passam na medição e
  nenhum estado depende só de cor (A6).

## Casos de borda

- Lavanda `#D7C5EA` como texto ou indicador: reprova contraste (1,44:1
  sobre papel, medido com o colorlib do R4). Regra dura: lavanda clara
  só como corda, vidro ou preenchimento; texto sobre ela é sempre
  petróleo.
- Tema escuro do app: o brandbook não define escuro. O tema existente é
  adaptado, não inventado: fundo petróleo profundo, texto claro,
  lavanda clareada para o papel de coordenação. O padrão do app é
  light, o alternador segue existindo. O site não tem alternador: fica
  só claro, e `color-scheme`/`theme-color` do `Base.astro` passam a
  refletir isso.
- `prefers-reduced-motion`: cordas aparecem desenhadas, monólitos em
  repouso; nenhuma informação só por animação.
- `DEMO_URL` e `VIDEO_URL` vazios em `site/src/config.ts`: a página
  diz "Em preparação" e não renderiza link (mecanismo já existe na
  `wt/site-entrega1`).
- Logo sobre fundo escuro, sobre papel e isolado: usar a variante
  oficial correspondente (`forseti-lockup-*` e `forseti-simbolo-*`),
  com área de respiro, sem contorno, sombra, rotação ou recoloração
  arbitrária dos blocos (regras da página 8 do brandbook).
- Seção que pedia asset inexistente (3D, isométrico): compõe com
  monólitos/cordas vetoriais ou cai fora; nunca entra placeholder (A1).

## Requisitos funcionais

- **RF1 [P0]**: paleta v4 aplicada por papel nos dois sistemas de
  tokens: `site/src/styles/global.css` e `app/web/src/tokens.css`.
  Mapeamento mínimo: papel mineral funde com `--bg`, petróleo com
  `--text`/`--primary`/`--focus`, cinza mineral com `--text2` e
  `--border-strong`, lavanda só em cordas, vidro e preenchimentos.
- **RF2 [P0]**: sinal de coordenação/divergência em lavanda profunda
  medida (proposta `#654199` sobre `#EDE5FE`, da família medida no R4);
  `--change` e `--change-bg` do app passam a esses valores. Lavanda
  `#D7C5EA` nunca como texto, ícone de estado ou único indicador.
- **RF3 [P0]**: Manrope para comunicação e Geist Mono para
  identificadores (chaves, hashes, horários, códigos), servidas por
  `@fontsource` nas duas superfícies. Source Serif/Sans/Code Pro e
  Space Grotesk/JetBrains Mono saem das superfícies da marca.
- **RF4 [P0]**: logo oficial v4 usado das duas superfícies, copiado de
  `forseti-brand/brandbook-v4/`: `forseti-lockup-petroleo.svg` e
  `forseti-lockup-negativo.svg` (símbolo + wordmark),
  `forseti-simbolo-petroleo.svg`, `forseti-simbolo-negativo.svg` e
  `forseti-simbolo-isolado.svg` (variante da página 7). Lockup no
  cabeçalho do app e no topo do site; símbolo isolado no favicon e
  onde o lockup não couber. A marca "Refinada" (águas ouro/prata) e a
  bigorna como logo do produto são aposentadas; a bigorna só pode
  aparecer como crédito da equipe The Foundry. Wordmark nunca
  redigitado. Favicon raster ou tamanho extra, se preciso, é gerado a
  partir desses SVGs.
- **RF5 [P0]**: site único adaptado inteiro à v4, sem rota nova. O hero
  passa a apresentar o produto: logo oficial, proposta na voz da marca
  (camada de reconciliação e coordenação; "diferentes versões da
  operação, uma resolução compartilhada" é o exemplo do próprio
  brandbook), o que a camada faz e o bloco "não somos" (transportadora,
  TMS, ERP, rastreador, chatbot). As seções existentes (pitch, ticker,
  problema, solução, campo, progresso, time, fecho) são mantidas e
  re-vestidas: paleta, tipografia, tokens, gramática e voz v4.
- **RF6 [P0]**: copy do site reescrita sob a voz "confiança sem ruído"
  (clara, precisa, resolutiva, imparcial), real e final: o que mudou e
  por que importa, evidência concreta, próxima ação sem dramatizar,
  lados da divergência descritos com justiça. `STYLE.md` continua
  valendo.
- **RF7 [P0]**: gramática formal v4 onde aparece: monólitos como
  participantes independentes, cordas como quatro linhas lavanda tipo
  partitura, camadas para versões/evidências. Proibido uso decorativo
  fora desse significado (regra de composição do brandbook).
- **RF8 [P0]**: movimento v4 nomeado e obedecido: Surgir (elementos
  entram sem ruído), Conectar (cordas se desenham), Propagar (sinal
  percorre as cordas), Estabilizar (repouso claro). Nas telas do app,
  só movimento produtivo (até ~240 ms, R4/Carbon); o expressivo fica no
  site. `prefers-reduced-motion` em ambas.
- **RF9 [P0]**: medição de contraste obrigatória com o colorlib do R4
  (`forseti-brand/research/R4-assets/scripts/colorlib.py`), no padrão
  de `moodboard/scripts/build.py`: sai exit 1 se algum par exigido
  reprovar. Pares exigidos por tema, no mínimo: texto/fundo,
  texto/superfície, texto2/fundo, texto2/superfície2, on-primary/primary,
  border-strong/superfície (3,0), foco/superfície (3,0),
  mudança/mudança-bg, mudança/fundo, mudança/superfície, texto/mudança-bg,
  rail-soft/primary, ok/ok-bg, warn/warn-bg, error/error-bg, petróleo
  sobre lavanda e lavanda sobre petróleo (cordas, informativo), e os
  mesmos no tema escuro adaptado do app.
- **RF10 [P0]**: tema do app: light é o padrão e o alternador segue
  existindo; o dark usa a adaptação medida (proposta: fundo petróleo
  profundo `#0E1F1D`, texto `#E8F0EE`, lavanda de coordenação
  `#C9B2F0` sobre `#35294A`). O site fica só claro: não existe
  alternador hoje e nenhum é criado.
- **RF11 [P0]**: credenciais honestas: o site credita The Foundry como
  equipe (HackBrasil 2026) sem que a bigorna vire logo do produto.
  Nenhuma superfície apresenta a marca Refinada nem a paleta antiga.
- **RF12 [P1]**: `site/README.md`, `specs/README.md` e o `README.md`
  raiz refletem o site na identidade v4 (A4).

## Requisitos não-funcionais

- **NFR-dados:** nenhum dado novo; tokens e assets de marca são artefatos
  novos, nenhum arquivo imutável tocado (A9).
- **NFR-autorização/publicação:** site e telas públicas por definição;
  nenhum segredo; os SVGs oficiais copiados são artefatos públicos
  versionados (A2).
- **NFR-privacidade:** nenhuma pessoa nova citada; retratos e contatos
  já inventariados seguem no site (A5).
- **NFR-demo:** o site nunca mostra número ou afirmação que a demo não
  prova; estado da entrega vem do `config.ts`, sem promessa solta (A7).
- **NFR-a11y:** todos os pares de RF9 medidos e passando; foco visível;
  teclado; `prefers-reduced-motion`; alt text no logo onde for
  conteúdo; estado nunca só por cor (A6, WCAG 2.2).
- **NFR-idioma:** pt-BR nas duas superfícies; tokens e identificadores em
  inglês conforme a convenção vigente em cada pasta (A6).
- **NFR-licença:** Manrope e Geist Mono em licença aberta (OFL) via
  `@fontsource`, mesma via das fontes atuais; nenhuma fonte de CDN ou de
  licença restrita.

## Entidades e invariantes

- `app/web/src/tokens.css`: sistema por papel (`--bg`, `--surface`,
  `--text`, `--text2`, `--primary`, `--on-primary`, `--focus`,
  `--change`, `--change-bg`, `--ok*`, `--warn*`, `--error*`,
  `--rail-soft`, `--font-*`, `--radius`). `--gold*`/`--silver*` saem com
  a marca Refinada. Nomes de papel não mudam: os componentes não são
  reescritos.
- `site/src/`: `pages/index.astro` (hero reescrito na v4, seções
  re-vestidas), `layouts/Base.astro` (fontes, favicon, meta
  `color-scheme`/`theme-color` claros), `styles/global.css` (tokens v4),
  `components/` existentes recoloridos onde o estilo é próprio.
- `site/public/`: `favicon.svg` a partir do símbolo oficial,
  `assets/forseti-*.svg` (cópias dos oficiais), `assets/og.png` refeito
  na v4.
- `app/web/src/components/Marca.tsx`: passa a servir o símbolo oficial
  v4 (cópia do SVG, sem ouro/prata); o componente segue decorativo com
  o nome em texto.
- `app/web/index.html`: favicon v4.
- `speckit/frentes.json`: frente `site-forseti` dona de `site/`; frente
  `app-brand` assume `app/web/`; `app-demo` encerrada (entregue e
  integrada em `integra/mvp-final`).
- Link relativo e âncora interna nunca quebram (A1); o sitemap atual se
  mantém.

## Critérios de sucesso observáveis

- [ ] `npm run build` limpo em `site/` e `tsc --noEmit` limpo em
      `app/web/`; `node scripts/repo-guard.mjs` e
      `node scripts/prose-evals.mjs` exit 0.
- [ ] Relatório de contraste colorlib com todos os pares exigidos de
      RF9 passando nos dois temas do app e no site.
- [ ] Nenhuma ocorrência de Source Serif/Sans, Source Code Pro, Space
      Grotesk nem JetBrains Mono nas superfícies da marca; Manrope e
      Geist Mono servidas localmente via `@fontsource`.
- [ ] Logo oficial v4 presente no favicon, no cabeçalho do app e no
      topo do site, na variante correta por fundo; nenhuma ocorrência
      da marca Refinada, de ouro/prata como identidade nem da bigorna
      como logo do produto.
- [ ] `/` renderiza a página inteira na v4 com as seções preservadas e
      copy real; `color-scheme` claro; nenhuma rota nova.
- [ ] Cordas renderizam quatro linhas lavanda onde a gramática pede;
      redução de movimento mostra o estado final sem animação
      (`?reduce=1` no site, `prefers-reduced-motion` no app).
- [ ] Screenshot 1440 e 390 das duas superfícies sem quebra; a11y item
      a item (contraste, foco, teclado, reduced-motion, alt text).

## Premissas

- `integra/mvp-final` é a versão mais nova de `app/web/` e é base da
  frente de marca; `wt/site-entrega1` é a versão mais nova de `site/`.
- O prazo de 30/11 vale; as fases 2 (3D, iconografia, motion avançado)
  ficam fora por decisão de recorte, não por esquecimento.
- Os estados ok/warn/error neutros já medidos não mudam: não concorrem
  com a marca e já passam.
- A licença OFL de Manrope e Geist Mono confirma-se na checagem do
  pacote `@fontsource` na implementação; se falhar, a frente reporta
  antes de trocar.
- Os SVGs oficiais extraídos do brandbook são a fonte de verdade do
  logo; qualquer diferença de geometria descoberta na implementação é
  reportada, não corrigida à mão.

## Perguntas abertas

Nenhuma. As três questões de 22/11 foram decididas pelo usuário: site
único adaptado inteiro à v4 (rejeitadas: landing separada em `/` com
diário em `/diario`, e landing em `/forseti`; motivo: o site é um só e
recebe a marca inteira), logo oficial extraído do próprio brandbook
(sem redesenho), app em light padrão com alternador preservado e site
só claro.

## Errata 22/11 (mesma data)

A frente `site-forseti` cobre DUAS superfícies: o `the-foundry`
re-vestido (entregue, mantido como bônus) e a LP nova do produto em
`lp/`: site do zero com estrutura de empresa real, deploy Vercel
próprio (D-036). RF: hero com proposta, para quem, como funciona
(lê/compara/mostra), bloco "não somos", evidências reais do MVP
(matriz de divergências, fontes fiscais, cadeia, âncora) e CTA para a
demo na Railway. Conteúdo verossímil sem fabricar clientes nem
capacidades não provadas (A7).
