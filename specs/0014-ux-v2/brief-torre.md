# Brief frente v2-torre (THE-15, THE-18, THE-19)

Escopo e criterios de aceite na spec `specs/0014-ux-v2/spec.md` e nas issues
THE-15/18/19 do Linear. Paths exclusivos em `speckit/frentes.json`.

## Ordem interna

1. THE-15 (quick win): em `GrafoDomino.tsx`, linhas causais off por default;
   revelar so no hover, clique ou foco de teclado do no de origem. Estado
   por no, nao global.
2. THE-18: refatorar `PainelPedido.tsx` (1320 linhas) em cards de tiling:
   cada secao atual (matriz, grafo, tarefas, sinais, status) vira um card
   expansivel, configuravel e arrastavel com drag fluido via FLIP
   (transform/opacity, nada de layout em animacao). Layout persiste por
   pedido em localStorage.
3. THE-19: templates de view prontos (Operacao, Atrasos, Fiscal, Financeiro,
   Despacho) que pre-configuram quais cards aparecem e como; usuario pode
   salvar template proprio (localStorage).

## Restricoes

- CSS novo em `app/web/src/torre-v2.css`, importado pelo componente de
  entrada. Nao editar `styles.css`.
- Manter os mounts existentes: `PainelPedido` recebe as mesmas props do
  `App.tsx`; `focoInicial` e `aoConsumirFocoInicial` continuam.
- A6: contraste, foco/teclado (drag tambem por teclado: setas movem card),
  reduced-motion (sem FLIP), nome acessivel nos cards e handles.
- Skills a carregar: 60fps-animation, accessible-animation; prosa segue
  `docs/STYLE.md`.
- Teste novo para o estado do tiling (ordem, expansao, template).

## Decisoes da frente
