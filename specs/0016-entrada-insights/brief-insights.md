# Brief da frente insights (spec 0016)

Implementacao da spec 0016 (entrada de insights). Dona dos paths
`app/web/` nesta frente; servidor e shared sao da integracao.

## Decisoes da frente

1. Insight de sinais fica fora (inventario da spec): `Sinal` so existe na
   projecao por pedido (`GET /api/pedidos/:id`) e fanout de GETs por pedido
   esta fora de escopo na propria spec. A regra de degradacao ("insight sem
   dado suficiente nao renderiza") cobre a ausencia.
2. "Maioria no setor" sai de `donoPapel` dos casos em aberto, o unico
   recorte por parte que os GETs de lista trazem; a tarefa individual por
   setor nao sai em `PedidoResumo`. Sem caso com dono, o texto cai na
   frase neutra.
3. `atrasoDias` e a distancia entre datas declaradas pelas fontes
   (`index.ts:127-138`), nao atraso contra hoje; o texto diz "distancia
   entre as datas declaradas" para nao prometer o que o numero nao mede.
4. Navegacao manual (setas, segmentos, prev/next) pausa o avanco
   automatico; retomar so pelo botao de play. Em prefers-reduced-motion
   nao ha autoplay nem o botao.
5. Estilos inline do bloco `vazio` viraram classes (`vazio-pedidos` etc.)
   em `insights.css`, com os mesmos tokens e a mesma aparencia. O fallback
   mora dentro de `EntradaInsights`, que decide entre stories, carga e
   estado vazio.
6. Enter segue o CTA so quando o foco nao esta em controle interativo;
   modais abertos por cima (`aria-modal`) desligam o listener de documento.

## Evidencias de entrega

Gates rodados neste worktree, saida real:

- `npm --prefix app/web run typecheck`: exit 0, sem erros.
- `npm --prefix app/web run test`: 15 arquivos, 276 testes, todos verdes
  (12 novos em `insights.test.ts`).
- `npm --prefix app/web run build`: exit 0, bundle 704 kB (208 kB gzip).
- `node scripts/repo-guard.mjs`: 11 checks OK.
- `node scripts/prose-evals.mjs`: 0 duras, 9 leves pre-existentes.
- `python3 app/web/scripts/check_contrast.py`: exit 0, todos os pares
  exigidos passam nos dois temas (`[i]` informativos fora do exigido).
- Verificacao funcional: servidor local (`tsx server/index.ts`) contra o
  postgres da seed (porta 5444) + `comporInsights` executado via tsx sobre
  os GETs reais. Resultado com a seed: 5 insights, na ordem
  divergencias, atraso, tarefas, risco (R$ 24.000, simulacao) e excecao
  (100%), todos com `pedidoId` real e `foco` `AlvoFocoGenUI` correto
  (ex.: `{"tipo":"divergencia","campo":"pesoTotal","fonteA":"nfe","fonteB":"cte"}`).

A6 item a item:

- Contraste: `insights.css` so usa tokens medidos em
  `evidencias/contraste-v4.md` (`--text`, `--text2`, `--primary`,
  `--on-primary`, `--border`, `--surface`); check_contrast verde acima.
- Foco/teclado: setas (4 direcoes), Home/End, Enter e Escape no listener
  de documento com guardas para inputs e modais; botoes reais com
  `aria-label`, `disabled` nos limites e `aria-current` no segmento ativo;
  skip "Pular apresentacao" visivel desde o primeiro instante.
- Reduced-motion: `useMovimentoReduzido` desliga o autoplay (nenhum
  timer e criado) e esconde o botao de pausa; `@media
  (prefers-reduced-motion: reduce)` troca a transicao por fade de 120 ms
  sem deslocamento e a barra ativa fica cheia.
- Alt text: nenhuma imagem nova; icones sao decorativos dentro de botoes
  e links com texto ou `aria-label` proprio.

