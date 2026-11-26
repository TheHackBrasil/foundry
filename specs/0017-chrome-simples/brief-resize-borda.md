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
