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
