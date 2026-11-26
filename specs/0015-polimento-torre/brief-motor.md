# Brief polish-motor: motor do grid da Torre

Frente: polish-motor (worktree wt/polish-motor, branch wt/polish-motor)
Spec: specs/0015-polimento-torre/spec.md

## Paths que voce pode escrever (o hook bloqueia qualquer outro)

- app/web/src/components/torre/TorreGrid.tsx
- app/web/src/components/torre/TorreCard.tsx
- app/web/src/torre-v2.css
- specs/0015-polimento-torre/brief-motor.md

Proibido: App.tsx, styles.css, tokens.css, servidor, qualquer outro arquivo.
Skills obrigatorias antes de implementar: 60fps-animation e
accessible-animation. Declare no relatorio final quais usou.

## Contexto

A Torre e um grid masonry de 7 cards. Posicionamento absoluto calculado em
JS (packing skyline com backfill), transicoes CSS de transform/width/height
fazem o reflow. Auditoria de motion com video a 60fps encontrou falhas
graves no gesto central. Decisoes do usuario: movimento fluido sempre
(continuidade visual e obrigatoria, nunca snap/teleporte), arestas do grafo
domino com opacity de repouso por volta de 0,2.

## Escopo (itens em ordem de prioridade)

### M1. O drop precisa assentar de verdade (critico)

Hoje `encerrarDrag` limpa o transform inline da peca na hora (medido: salto
de ate 779px em um frame) e a keyframe `torre-card-entra` reinicia, ou seja
o card teleporta e finge ser um card novo entrando. Reescrever:

- Ao soltar, a peca parte da posicao visual atual (computed transform) e
  assenta no slot com transicao visivel de 180 a 260ms ou spring equivalente.
- O retorno deve ser interrompivel: reagarrar a peca no meio do settle
  continua do ponto onde ela esta (cancelar animacao em voo).
- `torre-card-entra` deve ser mount-only, nunca reiniciar por mudanca de
  estado de drag. Tecnica livre: controle por classe aplicada so na montagem,
  ou animacao via WAAPI no mount.
- O slot tracejado permanece visivel durante o settle, nao so durante o voo.
- Levar em conta a velocidade de release pelo menos no eixo principal, se
  viavel sem complexidade excessiva.

### M2. Estabilidade do arraste: ordem nao muda com pointer parado (critico)

Medido em video: arrastando rapido entre colunas, a ordem comuta uma segunda
 vez sem input novo e a peca desliza lateralmente por conta propria (313px)
quando a base do packing muda sob ela. Reescrever o modelo:

- Posicao visual da peca sempre absoluta em relacao ao pointer, independente
  do slot/base. Manter grabOffset e recomputar o transform inline
  imediatamente quando a ordem/base mudar, preservando a posicao visual.
- Destino com histerese espacial real (margem de entrada e saida), e impedir
  reordenacoes em cadeia enquanto o retarget anterior nao estabilizou, ou
  calcular destino contra uma geometria de referencia fixa do gesto.
- Ordem commitada so muda quando o destino esta estavel.
- Teste de aceite manual obrigatorio: cruzar duas colunas e voltar rapido;
  entrar e sair de slot full-width; a ordem nunca muda com pointer parado e
  a peca nunca desliza sozinha.

### M3. Safety net do arraste (critico)

Hoje o fim do drag depende exclusivamente de pointerup no grip de 30px, com
setPointerCapture em try/catch silencioso. Auditor reproduziu card travado
flutuante com slot fantasma permanente. Corrigir:

- Listeners de pointerup/pointercancel/lostpointercapture no window durante
  o arraste, removidos ao encerrar.
- Escape global enquanto houver arraste ativo (nao apenas no keydown do
  grip), cancelando e restaurando a ordem anterior.
- Blur da janela tambem encerra o arraste de forma segura.

### M4. Ciclo vicioso de ResizeObserver (alto)

Medido: troca de densidade produz 21 a 86 eventos de RO, state updates no
meio da transicao, retarget de animacoes em voo, longtasks de ate 416ms.
O usuario decidiu manter width/height animados (fluido sempre), entao a
continuidade visual se preserva, mas o ciclo precisa ser quebrado:

- ResizeObserver alimenta heights em lote (um rAF), nunca a cada frame
  intermediario.
- Enquanto uma transicao de retile estiver em curso, medidas intermediarias
  de largura animada nao disparam repacking; commit da geometria uma vez,
  no alvo. Tecnicas possiveis: ignorar medidas durante transicao com flag
  temporal, ou so recalcular packing em transitionend, ou congelar heights
  durante o retile. Implementador escolhe e justifica nas decisoes da frente.
- Tiers de container query nao podem pipocar durante o movimento: congelar
  a apresentacao interna durante a transicao geometrica e comutar o tier
  apenas no estado final (classe de transicao no grid ou tecnica equivalente).
- Remover a transicao de height do proprio .torre-grid (custo sem valor).
- Sombra levantada apenas no pseudo-elemento com opacity; tirar transicao
  de box-shadow real das superficies grandes.

### M5. Resize vertical nao pode disparar repack completo (alto)

O max-height do corpo depende de 100vh; mudar a altura da janela repacka
tudo. Corrigir: teto baseado em valor fixo por densidade ou conteudo, nao
em viewport height; ou ao menos atualizacao contida sem retile animado.

### M6. Arraste sem teleporte geometrico: setas espaciais 2-D (alto, a11y)

Hoje ArrowDown e ArrowRight fazem a mesma coisa (passo +1 na lista 1-D), e
medido: ArrowDown move o card para a direita. Reescrever usando o posMap:

- Setas movem o card para a posicao do vizinho mais proximo naquela direcao
  (o posMap tem x/y/span de todos).
- Anuncio na live region com direcao e vizinho ("movido para baixo, abaixo
  de Tarefas abertas").
- Documentar o comportamento no aria-label/aria-keyshortcuts do grip.

### M7. Ordem DOM igual a ordem visual (alto, a11y WCAG 2.4.3 e 1.3.2)

O backfill posiciona cards fora da ordem da lista 1-D; o foco de teclado faz
ping-pong vertical. Corrigir: renderizar os cards ordenados por (y arredondado
, x) do posMap em vez de seguir ordemVisivel crua. Keys estaveis ja existem,
React nao remonta. Verificar que os anuncios de posicao continuam coerentes.

### M8. Controle de largura como window splitter APG (alto, a11y 4.1.2)

A pill de largura virou button puro no refactor. Implementar o padrao:

- role="separator", aria-orientation="horizontal", aria-valuenow=span,
  aria-valuemin=span minimo do card, aria-valuemax=cols, aria-valuetext
  ("2 de 3 colunas").
- Setas do teclado clampam nos limites (nunca wrap). O clique com mouse pode
  continuar ciclando com wrap se desejado, mas as setas nao.
- Anunciar no limite ("ja esta na largura maxima").

### M9. Packing sem coluna morta em viewport largo (alto)

Verificado pela integracao: em viewport de 1600px ou mais (cols=4), sinais
span-1 cai na coluna 3 e todo o resto e span 3-4, que nao cabe em buraco de
uma coluna; resultam cerca de 2200px vazios a direita. Corrigir com uma das
tecnicas, a escolha justificada nas decisoes da frente:

- Span elastico: ultimo card de uma faixa alarga para fechar a linha.
- Rebalancear spans padrao e/ou ordem de packing para cobertura completa.
- Preenchimento de buraco ciente da coluna mais a direita.
- Bonus: garantir que compacta difere de normal em largura comum de desktop
  (hoje em 1280px ambas produzem o mesmo numero de colunas; retunar
  ALVO_COLUNA ou a formula de cols).

### M10. Auto-scroll durante o arraste (alto)

Grid medido tem 3,2x a altura da viewport e nao existe scroll por
proximidade. Implementar edge auto-scroll: zona de ativacao no topo/fundo,
velocidade proporcional a proximidade, compensacao da posicao visual da peca
quando o documento rola, integrado ao loop de rAF existente.

### M11. Collapse como transacao visual unica (medio)

Hoje no collapse o conteudo some instantaneamente (display:none) antes da
casca fechar; no expand, animacoes internas de medidores reiniciam por mais
de 680ms. Corrigir:

- Collapse: fade/clip rapido do conteudo junto com a reducao da casca.
- Expand: reveal sem reexecutar animacoes internas de montagem; animacoes
  tipo draw-in devem ser mount-only.

### M12. Opacity de repouso do grafo domino (decisao do usuario)

`.domino-aresta-oculta` passa de opacity 0 para aproximadamente 0,2 (o
implementador afina entre 0,15 e 0,25 pelo contraste real nos dois temas).
Hover, foco e clique continuam escalando para 1. Verificar tema escuro.

### M13. Reduced motion com fade curto (medio)

Hoje reduced-motion e kill switch total; cards teleportam sem orientacao.
Manter a remocao de deslocamento espacial, mas adicionar fade de opacity
curto (100 a 140ms) em trocas de posicao/estado para preservar causa e
efeito, conforme a skill accessible-animation.

### M14. Contrato tolerante com polish-vistas (obrigatorio)

A frente polish-vistas vai implementar segmented control de densidade no
TorreVistas. TorreGrid precisa passar uma nova prop opcional:

```
aoDefinirDensidade?: (d: 0 | 1 | 2) => void
```

Semantica: define a densidade explicitamente (nao cicla). Implementar em
TorreGrid e passar ao TorreVistas junto das props existentes, mantendo o
callback de ciclo atual para compatibilidade. Nao editar TorreVistas.tsx
(territorio da outra frente).

## Criterios de aceite

1. Drop assenta visualmente do ponto de release, sem teleporte e sem
   reinicio da animacao de entrada; regrab no meio funciona.
2. Arraste rapido cruzando colunas e voltando: ordem estavel com pointer
   parado, peca nunca desliza sozinha.
3. Simular perda de pointer capture (ou drop fora do grip): arraste encerra
   limpo; Escape global cancela.
4. Troca de densidade: zero repacking intermediario por RO; tiers so mudam
   no estado final; getAnimations() zera apos o fim real das transicoes.
5. Resize vertical da janela nao altera posicoes dos cards.
6. ArrowDown move o card visualmente para baixo (vizinho espacial).
7. Ordem de tabulacao segue a ordem visual apos retile com backfill.
8. role="separator" com valores aria corretos no controle de largura; setas
   clampam.
9. Em viewport 1600px nao existe coluna vazia maior que um card de altura.
10. Compacta e normal produzem layouts visivelmente diferentes em 1280px.
11. Grafo domino mostra estrutura quieta em repouso nos dois temas.
12. tsc limpo, vitest passando, build ok. Testes novos para logica pura que
    surgir (histerese, packing anti-coluna-morta, ordenacao visual).
13. prefers-reduced-motion: sem deslocamento espacial, com fade curto.

## Decisoes da frente

(preencher aqui conforme decisoes tomadas; a integracao copia para
DECISIONS.md)

- Logica pura extraida para packing.ts (novo): empacotar (skyline +
  backfill), ordenarVisual, vizinhoDirecional, destinoArraste, spanEscalonado.
  Coberta por packing.test.ts (20 testes). TorreGrid fica so com o motor de
  interacao.
- Span elastico implementado como pos-passo sobre a ocupacao final, nao
  dentro do loop de packing. Um card so estica sobre void de verdade:
  colunas livres na faixa vertical dele ate a borda direita. As extensoes
  processam em ordem de packing, entao a parte esticada de um card bloqueia
  a do proximo na mesma faixa. Escolhido em vez de rebalancear spans padrao:
  resolve a coluna morta em qualquer combinacao de spans, sem depender de
  tuning por densidade.
- ALVO_COLUNA retunado para que compacta produza 4 colunas e normal 3 em
  1280px (a diferenca passa a ser visivel em desktop comum, bonus do M9).
- Modelo de arraste novo: a peca fica presa ao grab point por transform
  inline reescrito a cada rAF como `pointer - grabOffset - rect da section
  renderizada`. Como a medida e feita sobre a geometria real do frame, a
  peca nunca desliza quando a base muda sob ela (retile, transicao da
  propria section, scroll). Em voo nao ha transicao de transform (a classe
  data-lifted exclui transform das transitions; o lift e aplicado
  manualmente no primeiro move >5px para nao disputar o primeiro frame
  com o React).
- Destino do arraste com dois freios (destinoArraste): histerese de 26px de
  deslocamento do pointer desde a ancora do ultimo commit, e teste de
  decisividade (pointer dentro da caixa do alvo com margem de 12% ou
  claramente mais perto do alvo que do proprio slot, razao 0.62). O commit
  so sai se a ordem resultante difere da atual. Com o pointer parado a
  ordem nunca muda: verificado segurando a peca 850ms e 48 frames sem
  nenhum commit espontaneo.
- Settle por WAAPI: no pointerup mede-se o rect atual da peca (o ponto de
  release real), limpa-se o transform e anima-se de la ate o slot.
  Duracao 180-280ms escalada pela distancia; um keyframe de fling usa a
  velocidade do release com cap de 22px. A animacao e cancelavel: reagarrar
  no meio do voo mede o rect no ponto onde a peca esta, cancela o WAAPI e
  continua do mesmo lugar (verificado: salto de 8px, igual ao deslocamento
  residual do proprio voo).
- Entrada mount-only: classe .torre-entra sai no animationend (ou assim que
  arrastando vira true) e nunca volta; nenhuma mudanca de estado reinicia
  a keyframe de entrada.
- Safety net no window com capture durante o arraste: pointerup faz drop,
  pointercancel e Escape revertem a ordem, lostpointercapture marca flag,
  blur encerra como drop, e o primeiro pointermove com botao zerado
  encerra (rede para up perdido fora da janela). Listeners saem no
  encerrar. Escape reverte a ordem commitada durante o gesto (verificado).
- ResizeObserver em lote: medidas acumulam num mapa e fazem flush uma vez
  por frame. Durante o retile um flag temporal (RETILE_MS) congela o RO e
  a largura de cada .torre-card-medida e fixada no alvo, entao o tier de
  container query nao pipoca no meio da transicao; o flush final mede na
  geometria definitiva. Escolhido o flag temporal em vez de transitionend:
  nao depende de animacao existir e cobre mudancas de coluna tambem.
- Custo de pintura: transicao de height do .torre-grid removida; sombra de
  levantado so via opacity de ::after pre-renderizada; crescimento da peca
  via propriedade scale separada (compoe com o transform do pointer sem
  disputar a mesma propriedade).
- Collapse como transacao unica: grid-template-rows 1fr para 0fr com fade
  do inner junto; no expand nao ha reexecucao de animacao de montagem.
- Arestas ocultas do grafo domino em opacity 0.2 nos dois temas (dentro da
  faixa 0.15-0.25 autorizada; verificado em dark e light).
- Reduced motion: deslocamento espacial morto em CSS e, no lugar do
  teleporte, fade WAAPI de ~130ms em cada card que mudou de posicao/
  tamanho e no drop (Tier 2 da skill accessible-animation: causa e efeito
  sem deslocamento). Verificado via emulacao: so animacoes de opacity
  aparecem.
- Setas do teclado: vizinhoDirecional escolhe o centro mais proximo na
  direcao com penalidade perpendicular de 1.7 e exigencia de trajetoria
  (mesma faixa para esq/dir ou dominio claro no eixo principal). O commit
  insere na ordem da lista; em masonry a posicao final e derivada pelo
  packing, entao um movimento em ordem pode nao mudar a posicao visual
  quando a packing preenche o mesmo espaco. Aceito: o anuncio descreve o
  movimento realizado e a seta seguinte opera sobre a nova ordem.
- M14: aoDefinirDensidade(d) define densidade absoluta; aoAlternarDensidade
  (ciclo) mantido para o botao existente. As duas passam ao TorreVistas por
  spread das props, sem editar o arquivo da outra frente.
