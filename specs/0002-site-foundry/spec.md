# Spec 0002: Site público na identidade Foundry

**Status:** entregue
**Origem:** `BACKLOG.md` itens 1-4 · decisões D-008, D-010, D-011
**Data:** 2026-11-19

## Problema e resultado esperado

O entregável "site" ainda não existe na identidade do time: o diário do
repo antigo é editorial claro e traz fatos desatualizados (call marcada
como agendada, sem a decisão de direção de 16/11). Quando isto estiver
pronto, `site/` é uma página única, dark industrial + laranja, que conta
o processo real desde o Serena até a hipótese atual, com interações que
uma banca lembra, e serve como a URL pública do time via GitHub Pages.

## Fora de escopo

- GitHub Pages / DNS / deploy (item separado do BACKLOG, manual).
- GitHub Release do `pitch-v9-share.mp4` e embed no site (depende da release).
- Capítulo pós-call Enviagora (D-004: bloqueado até a call acontecer).
- Qualquer CMS, framework ou backend: estático vanilla.
- Slides Enviagora (`slides/` já portado, não é o site público).

## Histórias

### US1: avaliador da banca quer entender quem é o time e o que investiga

- **Dado** a URL pública **Quando** abre a página **Então** vê marca,
  tese e uma narrativa em capítulos que prova processo real (datas,
  lugares, pessoas nomeadas), sem precisar ler o repo.
- **Dado** a narrativa **Quando** chega ao capítulo da hipótese
  **Então** pode interagir com a demonstração fictícia e entender a dor
  da fragmentação em menos de um minuto.

### US2: visitante técnico quer conferir o processo

- **Dado** o diário **Quando** rola até o fim **Então** encontra links
  para o repo, os docs de pesquisa e os perfis reais das pessoas citadas.

### US3: visitante com preferência de movimento reduzido

- **Dado** `prefers-reduced-motion` **Quando** navega **Então** todo o
  conteúdo funciona sem animações de deslocamento; fades curtos e
  estados finais continuam corretos.

## Casos de borda

- Mobile 360px: capítulos e a demo interativa legíveis e usáveis.
- Sem JS: conteúdo integral legível (progressive enhancement; demo
  mostra estado estático com rótulo).
- Fonte self-hosted falha: fallback system sem quebrar layout.
- Fotos pesadas: lazy-load; hero com `fetchpriority`.
- Link externo morto: todos com `rel="noopener noreferrer"`.

## Requisitos funcionais

- **RF1**: página única em `site/` como projeto Astro + TypeScript,
  ilha React no dominó, GSAP ScrollTrigger + Lenis via npm; build
  estático, sem backend e sem CDN em runtime.
- **RF2**: narrativa com estrutura nova (não cronológica): a metáfora da
  forja organiza a página (matéria-prima: a dor → fogo: a investigação
  em campo → forma: a decisão de direção → têmpera: o que ainda está
  aberto → a forja: o time e o repo). Cobre os mesmos fatos: Serena,
  time, HackBrasil/FIAP, trilha, FENATRAN, contatos, call 16/11, call
  Enviagora remarcada, hipótese atual.
- **RF3**: fatos corretos e datados: call Enviagora = "remarcada, sem
  nova data" (não "agendada 18/11"); nada promete validação que não
  houve (A7).
- **RF4**: interação central "dominó do atraso": um fornecedor atrasa e
  a propagação pelos parceiros (transporte, CD, fiscal, financeiro) é
  visível; modo alternativo mostra a mesma cascata absorvida pela
  camada conectada. transform/opacity, 60fps, sem libs.
- **RF5**: identidade `PRODUCT.md`: fundo escuro, laranja de acento,
  Space Grotesk + JetBrains Mono self-hosted, marca Foundry.
- **RF6**: fotos reais portadas do repo antigo com tratamento dark;
  assets isométricos substituídos por cenas desenhadas em código
  (SVG/canvas) na identidade nova; retratos de contatos com disclaimer.
- **RF7**: meta OG/Twitter + description + favicon; `lang="pt-BR"`.
- **RF8**: README do site ou seção no repo com link para docs e specs.

## Requisitos não-funcionais

- **NFR-dados:** nenhum asset de pessoa fora do inventário A5; fontes
  primárias não são copiadas nem alteradas (A9).
- **NFR-autorização/publicação:** tudo em `site/` é público por
  definição (A2 não se aplica ainda: sem dados de usuário).
- **NFR-privacidade:** pessoas citadas constam em
  `docs/fontes-e-contatos.md`; contatos externos com disclaimer "não
  endossam" como no site antigo (A5).
- **NFR-demo:** demo interativa rotulada "simulação fictícia"; nenhuma
  métrica apresentada como medida (A7).
- **NFR-a11y:** contraste AA no laranja sobre escuro; foco visível;
  navegação por teclado na demo; `prefers-reduced-motion` respeitado
  com degradação em camadas (A6); alt text real em toda imagem.
- **NFR-idioma:** pt-BR na página; identificadores técnicos em inglês.
- **NFR-perf:** animações só em transform/opacity; sem libs de
  animação; LCP razoável em conexão móvel.

## Entidades e invariantes

- `site/` é a única pasta de produto público; `site/assets/` contém só
  arquivos referenciados.
- Nenhum link relativo quebra (check `md-links`/`html-assets`).
- Todo `.md` do repo continua sem travessão/meia-risca (prose-evals).
- Capítulos novos datam o que aconteceu: diário nunca reescreve o
  passado, só adiciona (espírito A9 no conteúdo).

## Critérios de sucesso observáveis

- [ ] `node scripts/repo-guard.mjs` exit 0 (inclui html-assets).
- [ ] `node scripts/prose-evals.mjs` exit 0.
- [ ] `node --check` em todo `.js` do site.
- [ ] Página servida localmente renderiza hero + 8+ capítulos sem erro
      de console; demo alterna estados.
- [ ] Screenshot mobile 360px e desktop 1440px sem quebra.
- [ ] Call Enviagora consta como remarcada sem data.
- [ ] `?reduce` ou prefers-reduced-motion: sem deslocamentos grandes.

## Premissas

- Assets do repo antigo (`site/assets/` já portados) estão completos e
  podem ser reutilizados livremente.
- Fontes Space Grotesk e JetBrains Mono podem ser baixadas (woff2) e
  servidas localmente.
- O time continua com 3 pessoas confirmadas (Liz pendente: P-003).

## Perguntas abertas

Nenhuma. Resolvidas em 19/11: interação = dominó do atraso (nova, sem
repaginar a demo antiga); narrativa = estrutura nova na metáfora da
forja; isométricos substituídos por cenas em código; ritmo = iteração
com review visual ao longo da semana.
