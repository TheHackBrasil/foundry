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

- D-T1 (THE-15): a aresta causal so existe visualmente quando o no de
  origem (a divergencia) e ativado por hover, clique/isolamento, foco de
  teclado ou foco externo vindo da matriz/KPI. Setor nao revela aresta;
  os circulos de origem no grafo acompanham o mesmo conjunto revelado.
  Onda inicial removida; em reduced-motion as arestas aparecem sem
  transicao. Rotulo do botao de limpeza virou "Limpar isolamento".
- D-T2 (THE-18): ficam fora do tiling o cabecalho do pedido, a faixa KPI,
  a BarraMandatos, as abas de perspectiva, a faixa de resumo da lente e o
  PalcoGenUI. StatusCadeia sai do header e vira o card "cadeia"; o
  simulador vira card permanente (nao existia como secao propria) e segue
  alimentando modoSimulacao do grafo e da matriz. Versoes, antes um
  details slab solto, vira card; dentro do card o details fica plano, sem
  segunda superficie.
- D-T3: ids dos titulos viram `torre-titulo-<card>`; foco/scroll antes
  feito por ref (matrizCabRef, bloco-tarefas) agora usa getElementById,
  com fallback para a primeira aba quando o card esta oculto. Cards
  ocultos desmontam e ficam sempre ao fim da ordem persistida, assim
  reexibicao e previsivel; recolhido mantem o conteudo montado.
- D-T4: drag por pointer na alca do card (mouse, toque e caneta via
  Pointer Capture; threshold de 5px antes de virar arrasto). Vizinhos
  deslizam por FLIP com WAAPI, so transform; o card arrastado segue o
  ponteiro por transform inline. Teclado na alca: setas/Home/End
  reordenam; Esc ou pointercancel reverte para a ordem de antes do
  arrasto. Em reduced-motion nao ha FLIP nem deslize, so o commit.
- D-T5 (THE-19): presets Operacao, Atrasos, Fiscal, Financeiro e Despacho
  ordenam os cards visiveis e mandam o resto para ocultos. Vista salva
  pela pessoa vai para uma chave global de templates (nao por pedido) e o
  chip ativo e detectado por assinatura de ordem+ocultos, entao mexer na
  ordem depois de aplicar desmarca o preset. Toggles card a card ficam no
  details "Cards" da barra de vistas.
- D-T6 (integracao): nenhuma edicao necessaria em App.tsx, styles.css ou
  tokens.css. `torre-v2.css` e importado pelo proprio PainelPedido;
  classes removidas do JSX (cols, col-matriz, sec-domino) ficam orfas em
  styles.css, o que e da frente de integracao se quiser limpar.
