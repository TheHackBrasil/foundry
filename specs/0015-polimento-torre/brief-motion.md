# Brief motion-fisica: fisica do retile (wave C)

Frente: motion-fisica (worktree foundry-wt-motion-fisica, branch wt/motion-fisica)
Spec: specs/0015-polimento-torre/spec.md (adendo wave C, sessao 12)

## Paths

- app/web/src/components/torre/TorreGrid.tsx
- app/web/src/components/torre/TorreCard.tsx (lido; nao modificado: a prop
  estilo ja encaminha custom properties no spread)
- app/web/src/components/torre/packing.ts
- app/web/src/components/torre/packing.test.ts
- app/web/src/torre-v2.css
- specs/0015-polimento-torre/brief-motion.md

Skills carregadas: animation-principles, ui-animation,
animation-performance, interaction-design.

## Escopo (adendo wave C)

Tres pedidos: duracao proporcional a distancia, curva sem velocidade
inicial nos retargets (anti-flicker do arraste) e stretch de span mais
lento. Sintoma relatado: a animacao de stretch de span era rapida demais
e o arraste causava flicker nos cards vizinhos.

## Diagnostico (causa raiz do flicker)

O flicker nao era so easing. Quando a ordem visual do grid muda (span ou
destinoArraste), o React movia os <section> entre irmaos no mesmo commit
do retarget. O browser trata no re-inserido como elemento novo para o
before-change style: a transicao CSS e suprimida e o card teleporta para
o valor final. O defeito era assimetrico (span 2->1 vs 1->2 moviam
siblings diferentes) porque dependia de quais nos o insertBefore
deslocava. Medicao no browser: o indice DOM do card mudava no mesmo
frame em que a posicao saltava, sem frames intermediarios.

## Decisoes da frente

- **ordemDom (a correcao do flicker)**: a ordem DOM deixa de seguir a
  ordem visual no mesmo commit. Um estado ordemDom atrasa a reordenacao
  de nos vivos ate a torre assentar: timer de RETILE_MS + 80ms e, na
  hora de aplicar, checagem via getAnimations() procurando transicao de
  transform/width/height em curso; havendo, re-tenta a cada 120ms.
  Remocoes e entradas aplicam na hora (no removido nao tem transicao a
  preservar; no novo nasce sem). Efeito medido: a ordem DOM ficou
  estavel durante todo o gesto e as transicoes, e reordenou cerca de
  900ms apos o ultimo commit, com a torre ja parada.
- **duracaoRetile (packing.ts)**: duracao por card, pura e testada.
  Formula: 340ms de base + 0.35ms por px do deslocamento euclidiano;
  o resize (delta de w/h) soma na distancia efetiva com peso 0.45; teto
  de 680ms; piso de 420ms quando ha resize >= 1px. O "antes" e o alvo
  do retile anterior (o mapa commitado), nao a posicao interpolada:
  deterministico e suficiente. Cards novos recebem a base.
- **durMap derivado de ref, nao de memo**: a duracao mede o
  deslocamento contra prevPosRef, que so avanca dentro de effect.
  Medir dentro de useMemo contra o posMap em construcao zerava a
  distancia no segundo invoke do StrictMode (dev), produzindo duracao
  base em todo card.
- **curva material-standard**: --ease-retile cubic-bezier(0.4, 0,
  0.2, 1) substitui --ease-out (0.22, 1, 0.36) nas transicoes
  geometricas. A curva antiga entrega velocidade inicial alta: cada
  retarget de transicao durante o arraste entrava como solavanco. A
  nova arranca do repouso (v0 = 0), acelera e desacelera como corpo
  com massa; retargets em sequencia viram mudanca de direcao, nao
  tranco.
- **RETILE_MS 400 -> 800**: a janela que congela o ResizeObserver de
  medidas precisa cobrir o teto da transicao (680ms) mais folga; com
  400ms uma medida intermediaria repackava no meio do retile.
- **data-arraste-ativo + piso de 380ms nos siblings**: durante o gesto
  (voandoIds.size > 0) os cards nao arrastados recebem
  max(var(--retile-dur), 380ms). Retiles curtos de vizinho cedendo
  lugar nao viram tremida seca quando o pointer atravessa o grid. O
  slot do arrastado fica fora do piso: o tracejado desliza atras do
  gesto sem inercia extra.
- **--retile-dur por card**: viaja na prop estilo como custom property;
  a transicao usa var(--retile-dur, 420ms). TorreCard nao precisou de
  mudanca: o spread de estilo ja encaminha custom properties.
- **Reduced motion**: o seletor do arraste tem especificidade maior
  que .torre-grid > .torre-card e foi repetido dentro do bloco
  prefers-reduced-motion, para o fade de 130ms vencer tambem no drag.
  Sem reduced-motion nada de fade extra: deslocamento sempre.

## A6 (o que aplica a esta mudanca)

- Contraste: inalterado (so motion).
- Foco/teclado: a ordem de tab segue ordemDom, que atrasa cerca de
  880ms em relacao a ordem visual commitada. A janela e curta e so
  existe durante retile; o tradeoff e anotado como risco residual.
- Reduced-motion: retiles geometricos viram fade de 130ms, inclusive
  durante o arraste (seletor repetido no bloco reduce).
- Alt text: inalterado.

## Verificacao (browser, vite :5198, sessao agent-browser motion)

- --retile-dur medido por card em retiles reais: 340, 359, 420 e 680ms
  conforme o deslocamento.
- Span 1->2 e 2->1: largura interpola em cerca de 690ms com perfil
  acelera/desacelera; indice DOM constante durante a transicao.
- Drag sintetico (pointerdown/move/up no grip): zero saltos no eixo x
  dos siblings em 66 amostras de 35ms; data-arraste-ativo liga no
  inicio do gesto e sai apos o settle; drop commita a ordem final.
- Ordem DOM: estavel durante todo o gesto e as transicoes; reordena
  para o estado final ~900ms apos o ultimo commit.
- Screenshots em /tmp/motion-*.png (antes, durante e apos gestos).

## Gates

- npx tsc --noEmit -p web: limpo.
- npx vitest run: 212/212 (5 novos em describe('duracaoRetile')).
- npx vite build: ok.
- node scripts/repo-guard.mjs: 11 checks ok.

## Riscos residuais

- Atraso de ~880ms da ordem DOM: a ordem de tab fica stale durante o
  retile. Aterrissa antes do proximo Tab na maioria dos casos; se a
  integracao quiser, um atraso menor para commits fora de gesto e
  trivial (o timer ja e parametrizado).
- Cancelamento de transicao por re-grab dentro da janela deferida foi
  coberto por drag sintetico, nao por gesto humano longo em sessao
  real.
