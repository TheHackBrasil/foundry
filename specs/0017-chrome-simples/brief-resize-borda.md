# Brief resize-borda (splitter por arraste de borda), pedido do usuario 26/11

Worktree: ../foundry-wt-resize-borda, branch wt/resize-borda.
Arquivos permitidos: app/web/src/components/torre/TorreGrid.tsx,
app/web/src/components/torre/TorreCard.tsx, app/web/src/torre-v2.css,
app/web/src/components/torre/packing.ts (so se indispensavel), este brief.

Skills: interaction-design + animation-performance + impeccable.

O usuario quer resize de janela de verdade: apertar na bordinha direita
do card e arrastar horizontalmente, com o grid definido snapando para as
colunas validas (1..spanMax). Substituir (ou conviver de forma subordinada)
com o ciclo de clique Nx implementado ontem.

Requisitos:
- Alvo de arraste: borda direita do card (zona de uns 10-14px, cursor
  col-resize no hover, indicador visual sutil quando hover/active).
- Durante o arraste: preview ao vivo. Idealmente o span alvo destacado
  (ghost/outline) enquanto arrasta, commit no pointerup com a animacao
  fisica existente do motor (a torre ja anima retile com duracao
  proporcional). NAO implementar largura livre em px: sempre snap para
  o span inteiro mais proximo dentro de 1..spanMax.
- O hint textual de proximo passo implementado ontem pode sair ou virar
  algo subordinado, o gesto principal passa a ser a borda.
- A11y obrigatoria: o role separator APG atual (setas ajustam span) nao
  pode morrer, manter o controle de teclado funcionando, agora como
  affordance acessivel do mesmo mecanismo.
- Nao quebrar o arraste de reordenar (grip) nem o drag existente: a zona
  de resize nao pode colidir com o grip nem com o collapse.
- Feedback visual durante o resize: cursor, a borda acesa, e a largura
  ou o ghost acompanhando, sem lag (transform/opacity, compositor).

Cuidados do motor (leia TorreGrid.tsx antes): o packing tem passo
elastico que nao infla span explicito (fix recente). O resize por borda
define span explicito via o mesmo caminho aoAjustarSpan. Retile ao vivo
durante o arraste: avalie custo, provavelmente melhor feedback e ghost
sem repack ate o pointerup, porque repack a cada frame em width causa
o churn documentado. Justifique a escolha no brief em "Decisoes da frente".

Gates: tsc, vitest 230/230, build. Verificacao manual com arraste real
ou sintetico (pointer events com buttons:1) medindo: snap correto em
1..spanMax, sem churn de transicao, sem conflito com drag de reordenar.
Commit thisux1, sem push.

## Decisoes da frente

1. Ghost sem repack ate o pointerup. Durante o gesto nada do layout muda:
   um div .torre-resize-ghost absoluto no grid mostra a largura alvo ja
   snapada no span inteiro mais proximo (largura n*cardW+(n-1)*GAP, inverso
   por round e clamp em 1..cols). Repack a cada move foi descartado: cada
   commit repacka e reanima todos os vizinhos (o churn documentado), e
   esticar a section real por estilo inline faria o conteudo refluir a cada
   frame (matriz com tabela, domino com SVG). O ghost e um no vazio: mover
   transform/width nele custa um layout trivial e so quando o span alvo
   cruza fronteira. Medido: 0 transitionstart em cards durante o gesto; o
   commit unico via aoAjustarSpan dispara o retile fisico normal.
2. Handle e filho da section, nao da peca. A peca tem overflow hidden e
   voa no arraste de reordenar; a zona de 14px centrada na aresta (7px
   dentro, 7px no gap de 20px) precisa de metade fora do card e nao pode
   seguir a peca. Fica 7px dentro da borda: nao toca o toggle nem o
   separator (terminam a >=16px da aresta) nem o grip (header a esquerda);
   no gap nao colide com o vizinho. Escondida durante data-arrastando.
3. Handle aria-hidden, sem role proprio. O controle de teclado e o mesmo
   mecanismo ja existente: o separator APG (.torre-span) continua com
   setas/Home/End e o clique ciclando. Um segundo controle nativo seria
   duplicacao tabulada; o gesto de ponteiro e a via primaria e o teclado
   fica coberto pelo separator, como pede o brief.
4. Commit e cancelamento espelham o drag de reordenar: listeners no
   window (move/up/cancel/Escape/blur), pointer capture no handle, up
   perdido fora da janela commita no primeiro move sem botao, blur
   commita o alvo corrente, Escape reverte sem commit e anuncia. Clique
   sem mover e no-op (span alvo igual ao atual nem chama aoAjustarSpan,
   evitando anuncio espurio de "ja esta no maximo").
5. Feedback de gesto por data attrs: data-resizing na section acende a
   faixa da aresta (cor --change, a cor de "mudou") e data-torre-resize
   no html trava cursor: col-resize global, porque com capture o ponteiro
   sai da zona de 14px e o cursor dos elementos sob ele venceria. Label
   "N de M" dentro do ghost da o destino numerico durante o gesto.
