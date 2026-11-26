# Spec 0016: entrada de insights (primeira impressao em segundos)

Status: em especificacao
Data: 2026-11-26
Origem: call de alinhamento do MVP e do pitch (26/11, Alfa/Gabriel/thix),
item 38 do BACKLOG. Decisao central da call: o jurado e leigo em logistica
e decide em segundos; a primeira impressao nao pode ser o dashboard denso.
Recon de codigo com evidencia arquivo:linha na sessao de 26/11.

## Contexto

Hoje a rota `#/` sem pedido selecionado cai no bloco `vazio` de
`App.tsx:444-534`: titulo generico, lista de ate 8 pedidos com selo e
botao de envio. E uma porta de entrada muda: nao diz o que o produto
enxergou, nao prova valor e exige que o visitante saiba o que quer antes
de ter visto nada.

A demo publica sem login ja e o design (P-010, `protecao.ts:1`): sessao
anonima automatica, seed no boot, auto-fork para escrita. A peca que falta
para o jurado ver valor em segundos e exatamente esta tela. O item 38 do
BACKLOG absorve o antigo pedido de "conta de teste sem login" como
criterio de aceite: abrir a URL publica cai em insights reais sem clique.

## Decisoes (26/11)

1. Formato stories: sequencia curta de insights prontos, um por vez, com
   progresso visual e navegacao por teclado, toque e clique. Inspiracao
   de formato: retrospectiva Spotify. Nao e carrossel de marketing: cada
   insight e computado dos dados reais da seed/sessao.
2. Compositor deterministico, sem LLM: frases montadas por funcao pura
   sobre dados que ja saem por GETs existentes. Zero custo, zero latencia
   de modelo, zero dependencia de cota na demo do juri.
3. Todo insight e navegavel: clique leva ao pedido (`#/pedido/:id`, ja
   existe em `useTorre.ts:48-50`) e, quando houver alvo especifico, foca
   a divergencia exata via `AlvoFocoGenUI` (`model.ts:325-330`) com
   `focoPendenteTorre` (`App.tsx:46`), mecanismo ja entregue.
4. Valor monetario agregado carrega rotulo de simulacao (A7), mesmo
   precedente do selo em `PaginaOperacao.tsx:397`.
5. Nenhuma frase depende de entidade inexistente: transportadora nao e
   entidade do pedido hoje (`model.ts:102-110`); insights por
   transportadora ficam fora ate o item 43 do BACKLOG.

## Escopo

### Compositor de insights (`app/web/src/insights.ts`, novo)

Funcao pura `comporInsights(pedidos, casos, metricas): Insight[]` sobre
`PedidoResumo[]` (`buscarPedidos`), `CasoLista[]` (`listarCasos`) e
`Metricas` (`listarMetricas`), espelhando o padrao de
`operacao/dominio.ts`. Reusa `deduplicarPedidos` (`api.ts:47-63`) para
nao contar o pedido da sessao duas vezes.

Inventario minimo de insights (cada um com fonte ja existente):

- Divergencias: "N notas divergem do CT-e" a partir de `divergencias`
  por pedido (`index.ts:413`, shape em `model.ts:121-130`).
- Atraso: "N pedidos com atraso, maior de D dias" a partir de
  `atrasoDias` (`model.ts:478`, calculo em `index.ts:95-106`).
- Tarefas: "M tarefas abertas, maioria no setor S" a partir de
  `tarefas` por pedido (`model.ts:224-229`).
- Risco financeiro: soma de `estimarCusto` por caso aberto
  (`shared/custo.ts:34-46`), com rotulo de simulacao. Agregacao no
  cliente sobre os poucos casos da demo; se faltar dado, o insight
  simplesmente nao entra na sequencia.
- Sinais: "transportadora avisou reagendamento em N pedidos" a partir
  de `Sinal.tipo/resumo` (`model.ts:253-258`).
- Casos: taxa de excecao e casos abertos de `GET /api/metricas`
  (`index.ts:964-969`, shape em `model.ts:213-222`).

Degradacao graciosa obrigatoria: seed tem 2 a 3 pedidos. Insight sem
dado suficiente nao renderiza. Se nenhum insight existir, cai no estado
vazio atual (que permanece como fallback).

### Tela (`app/web/src/components/EntradaInsights.tsx`, novo)

- Substitui o bloco `vazio` em `App.tsx:444-534` apenas na rota `#/`
  sem pedido. O roteador nao muda.
- Um insight por vez, tipografia editorial grande, progresso da
  sequencia visivel, avanco automatico pausavel (respeitando
  prefers-reduced-motion: sem autoplay, navegacao manual).
- CTA por insight: "ver no pedido" navega para `#/pedido/:id` com
  `AlvoFocoGenUI` quando houver alvo; ultimo insight fecha com CTA para
  a lista de pedidos ou para o envio de documento.
- Re-agrega ao receber evento SSE (padrao de `PaginaOperacao.tsx:109-111`).
- Skip visivel desde o primeiro instante: quem ja conhece vai direto.
- Persistencia leve: quem ja viu a sequencia nesta sessao cai na lista
  de pedidos (sessionStorage), primeira visita sempre ve.

### Criterios de aceite

1. Abrir a URL publica sem hash mostra insights computados dos dados
   reais da seed em ate 2s de conteudo util, sem nenhum clique.
2. Cada insight navega para o pedido correto; o insight de divergencia
   foca a divergencia exata no painel.
3. Valor monetario agregado exibe rotulo de simulacao visivel.
4. Teclado completo: setas avancam/voltam, Enter segue o CTA, Escape
   pula a sequencia. Ordem de foco sem armadilha.
5. prefers-reduced-motion: sem autoplay e sem transicao de movimento,
   troca instantanea com fade curto ou nenhum.
6. Contraste AA nos dois temas (A6).
7. Com seed minima (1 pedido sem divergencia) a tela degrada para o
   estado vazio atual sem erro.
8. Evento SSE de ingest re-computa os insights sem reload.
9. Testes do compositor: inventario por fonte, degradacao, dedup de
   pedido de sessao, rotulo de simulacao presente quando ha custo.

### Fora de escopo

- Insights por transportadora (depende do item 43).
- Personalizacao por sessao alem do skip (ordem fixa por prioridade).
- Animacao sofisticada de transicao alem do necessario para o formato.
- Qualquer mudanca no servidor: todos os dados ja saem pelos GETs de
  hoje. Se a agregacao de custo por caso mostrar custo excessivo de
  fanout no cliente, registrar follow-up em vez de inflar esta spec.

## Paths e frente

`App.tsx` e `useTorre.ts` pertencem a frente `app-operacao`
(`speckit/frentes.json`); arquivos novos `EntradaInsights.tsx` e
`insights.ts` + testes. Registrar os paths da frente antes da
implementacao. Spec 0015 proibia tocar `App.tsx` (spec.md:55-56), esta
spec e a primeira que abre esse caminho de proposito.

## Invariantes

- A7: nada de numero inventado; todo insight e computado de dado real
  da seed/sessao e valor financeiro carrega rotulo de simulacao.
- Contratos publicos intocados: rotas, SSE, endpoints.
- A friccao zero e o wedge: nada de login, cadastro ou interstitial
  antes dos insights.
