# Brief frente v2-painel (THE-16, THE-17)

Escopo na spec `specs/0014-ux-v2/spec.md` e nas issues THE-16/17 do Linear.

## Ordem interna

1. THE-16: reconstruir `EvidenciaLateralIA.tsx` como painel contextual
   autonomo: funciona tanto com projecao da torre quanto com o que o agente
   respondeu; incorpora micro-blocos GenUI (reusar `genui/` existente, sem
   editar a pasta; se faltar bloco, criar dentro de `components/evidencia/`).
   Menos dependente: o painel decide o que mostra a partir do contexto
   (pedido selecionado, ultima resposta, foco clicado), nao de props
   rigidamente casadas.
2. THE-17: clique em campo, divergencia ou setor abre mini-descricao
   detalhada gerada em tempo real via SSE reutilizando
   `/api/mandatos/stream` com mandato de leitura (ex.: "explica o campo X
   do pedido Y citando a evidencia"). Cache por (pedido, alvo) em
   `lenteCache`-like local ao painel. Se o contrato do endpoint nao servir,
   registrar no brief e deixar a UI atras de flag.

## Restricoes

- CSS novo em `app/web/src/painel-v2.css`. Nao editar `styles.css`.
- `PaginaAssistenteIA.tsx` pode ser ajustada para a nova fiacao do painel;
  contrato de props com `App.tsx` nao muda.
- A6 completo; streaming textual respeita reduced-motion (sem typewriter).
- Skills: accessible-animation; prosa segue `docs/STYLE.md`; textos de UI
  curtos, sem hype.
- Teste novo: render do painel com contexto minimo e resposta de stream
  mockada.

## Decisoes da frente

- D-P1: o painel deriva as secoes em `components/evidencia/contexto.ts`
  (`derivarSecoesEvidencia`), puro e testavel. O contexto e pedido
  selecionado, projecao da torre, foco clicado e ultima resposta do agente
  (`ContextoAgente`). A pagina so entrega os insumos; quem decide o que
  mostra e o painel.
- D-P2: a ultima resposta do agente entra na secao "Da ultima resposta" so
  quando o pedido bate (sem pedido selecionado, ela e o unico contexto).
  Turno em voo nao entra. Com blocos estruturados, eles sao a resposta em
  formato micro; sem eles, entra o texto. Blocos que entram na coluna:
  `resumo_citado` e `matriz_focada` sem projecao; `comparador_conflito`,
  `linha_tempo_causal` e `checklist_papel` com projecao. `domino_impacto`,
  `simulador_interativo` e `cartoes_despacho` nunca entram (largos, pedem
  simulacao ou acao de escrita).
- D-P3 (THE-17): o endpoint SSE serviu como esta; nenhuma flag precisou.
  O alvo de leitura e `AlvoDescricao` = `AlvoFocoGenUI` + `{ tipo: 'campo' }`
  (o campo sozinho explica sem apontar fonte). O mandato montado em
  `descricao.ts` e sempre de leitura ("Somente leitura, sem executar acoes")
  e injeta os valores da projecao local para o agente citar a evidencia.
  O texto volta por `texto_delta` com fallbacks `fim.textoFinal` ->
  `agente.textoFinal` -> `resumo` do `concluido` (compat).
- D-P4: cache LRU (`criarCacheLente`, 24 entradas) por
  `pedidoId|totalEventos|alvo`. `totalEventos` na chave invalida a leitura
  quando o ledger anda. O limite do servidor (10 mandatos/10 min por IP)
  torna o cache funcional, nao so perf: revisitar o mesmo alvo nao gasta
  chamada.
- D-P5: cliques internos (celula, campo, divergencia, setor, sinal,
  citacao de bloco) pedem a leitura sozinhos; foco vindo de fora (palco,
  torre) mostra a evidencia e so gera texto por acao explicita ("Gerar
  leitura detalhada"). Razao: custo e latencia de um mandato nao devem ser
  disparados por foco passivo.
- D-P6: a evidencia concreta vem antes do texto (`evidenciasDoAlvo`): o que
  cada fonte declarou, com versao e momento reais do ledger. Estados
  honestos: vazio e erro sao visiveis; nada e inventado quando o agente
  nao responde.
- D-P7: o projeto nao tem jsdom nem testing-library. O teste novo usa
  vitest puro: `renderToStaticMarkup` cobre o render com contexto minimo e
  o stream e mockado via `executar` injetavel em `pedirDescricaoAlvo`.
- D-P8: CSS so em `painel-v2.css`, prefixo `ev2-`; classes existentes
  (`ia-mini-*`, `ia-parte-*`, `estado-*`, `ia-foco-*`) reutilizadas. A6:
  alvos clicaveis sao `<button>` com `aria-pressed`, foco visivel global
  mantido, reduced-motion herda o degrau do palco (forja vira fade de
  120 ms) e zera transicoes novas, forced-colors ganha bordas explicitas.
