# Spec 0003: Redesign do site Foundry

**Status:** entregue
**Origem:** feedback do usuário em 19/11 · decisão D-013
**Data:** 2026-11-19

## Problema e resultado esperado

A versão da 0002 lê como template gerado ("AI slop"). Os sinais: rótulo
mono em todo bloco, palavras gigantes vazadas ao fundo, termômetro
lateral com temperaturas que não medem nada, cards iguais em grade e um
diagrama esquemático genérico no capítulo 3 (FORMA). A bigorna 3D tem
borda serrilhada e uma geometria que não é a da marca. A referência do
Gabriel (`the-foundry/build-in-public`) é mais viva: trilho de datas,
fotos como objeto físico, mapa ASCII animado, stickers isométricos,
retratos em alturas diferentes e barra de leitura.

Quando isto estiver pronto, o site mantém a identidade preta e laranja
(D-008) e os mesmos fatos da 0002, com estrutura editorial e acabamento
de produto: trilho cronológico de datas no capítulo de campo, logo
oficial (F + bigorna, `#EA5808`) no header, no favicon e na bigorna 3D,
que passa a ser extrudada do próprio path do logo e renderizada com
antialiasing real (MSAA no render target do composer). O diagrama do
capítulo 3 dá lugar a stickers isométricos animados (skill
`fun-isometric`: fornecedor, transportadora, CD, financeiro) ligados
pela camada. Um mapa ASCII do Brasil em tons de brasa entra sem números
sem fonte. Saem o termômetro, as palavras vazadas, as cantoneiras HUD e
o grão `feTurbulence`.

## Fora de escopo

- Deploy (GitHub Pages / DNS), item manual do BACKLOG.
- Release do pitch e embed do vídeo no site.
- Capítulo pós-call Enviagora (D-004: bloqueado até a call acontecer).
- Mudança de identidade: paleta e tipografia seguem D-008.

## Requisitos funcionais

- **RF1**: trilho cronológico de datas no capítulo de campo, com as
  datas já existentes na 0002, sem remover nem inventar nenhuma.
- **RF2**: header, favicon e bigorna 3D usam o logo oficial; a malha da
  bigorna vem do path SVG do logo, extrudado.
- **RF3**: o composer do WebGL usa render target com MSAA; a bigorna
  não mostra serrilhado em 1440 nem em 390.
- **RF4**: capítulo 3 com quatro stickers isométricos animados
  (fornecedor, transportadora, CD, financeiro) ligados pela camada
  conectada, no lugar do diagrama esquemático.
- **RF5**: mapa ASCII do Brasil animado, em tons de brasa, sem número
  que não tenha fonte (A7).
- **RF6**: remover termômetro lateral, temperaturas, palavras vazadas,
  cantoneiras HUD e grão `feTurbulence`.
- **RF7**: `<Domino client:visible />` continua como ilha React.

## Requisitos não-funcionais

- **NFR-a11y:** contraste AA; foco visível; navegação por teclado; alt
  text real em toda imagem (A6).
- **NFR-motion:** com `prefers-reduced-motion` ou `?reduce=1`, stickers
  ficam parados e o WebGL não inicializa; o conteúdo segue completo.
- **NFR-sem-JS:** todo o conteúdo legível sem JavaScript.
- **NFR-dados:** nenhum fato novo; nenhum número sem fonte (A5/A7).
- **NFR-idioma:** pt-BR; prosa segue `STYLE.md`.

## Critérios de aceite

- [ ] Sem JS, todo o conteúdo fica legível.
- [ ] `prefers-reduced-motion` e `?reduce=1` mostram stickers parados e
      não criam contexto WebGL.
- [ ] Contraste AA no laranja sobre escuro.
- [ ] Foco visível e uso completo por teclado.
- [ ] Alt text real nas imagens.
- [ ] `<Domino client:visible />` mantido.
- [ ] Nenhum fato novo e nenhuma data removida em relação à 0002.
- [ ] Nenhum número sem fonte (mapa ASCII incluído).
- [ ] `node scripts/repo-guard.mjs` e `node scripts/prose-evals.mjs`
      com exit 0.
- [ ] Capturas em 1440 e 390 revisadas.

## Premissas

- O path SVG do logo oficial está disponível no repo.
- A skill `fun-isometric` gera os quatro stickers com a paleta preta e
  laranja.

## Perguntas abertas

Nenhuma.
