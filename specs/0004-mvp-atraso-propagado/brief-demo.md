# Brief · frente `app-demo`

Escopo: interface da demo da spec 0004: `app/web/` (Vite + React +
TS): painel de alertas por papel (fornecedor, transportadora, CD,
fiscal, financeiro), upload de XML/planilha, divergência propagando
via SSE sem reload, linha do tempo do pedido com hashes clicáveis e
versões lado a lado, tela da fila de revisão, dominó da propagação
movido por evento real, selo "demonstração com dados fictícios",
página de auditoria com link do explorer. P2: twin da cadeia (mapa de
nós, three.js) só se o P1 fechar cedo.
Paths: `app/web/**`. Não escrever em `app/shared/**` (consome tipos),
`app/server/**`, `app/api/**` (consome o contrato HTTP e SSE de
`app/api/contrato.ts`, da `app-infra`), `app/contracts/**`, `app/seed/**`.
Base: `main` com spec 0004 commitada; branch `wt/app-demo`; worktree
`../foundry-wt-demo`.
Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*`, escrever fora dos paths, dados reais de empresa
(corpus fictício já existe), métrica como medida (A7).
Gate: guard + prose-evals exit 0; `tsc --noEmit` limpo; screenshot
1440 e 390 sem quebra; XML enviado vira pedido na tela; divergência
acende tarefa nas 5 visões via SSE; a11y item a item (contraste AA
laranja/escuro, foco visível, teclado, reduced-motion); conteúdo
legível com estado vazio.
Reporte: conclusão + evidência `arquivo:linha`, screenshots e saída de
gate por critério.

## Decisões da frente

- **D-W1 (pendente de Thiago)**: tela única com o seletor "Ver como"
  (Todas, Fornecedor, Transportadora, CD, Fiscal, Financeiro) em vez de
  cinco telas. As cinco visões são o mesmo painel filtrado por parte, então
  a escolha serve às duas respostas do P-006. Falta Thiago confirmar.
- **D-W2**: a web chama só `/api/*` no mesmo domínio, por proxy do Vite em
  dev e pelo Fastify em produção. Não depende do CORS aberto que a THE-7
  vai fechar.
- **D-W3**: tipos vêm de `app/shared/model.ts` só por `import type`, mais as
  constantes `PARTES` e `CAMPOS_VIGIADOS`. A tela não recalcula divergência
  nem tarefa: usa o que `ProjecaoPedido` devolve. A matriz mostra a última
  versão de cada fonte e só marca conflito enquanto as duas fontes ainda
  declaram os valores que a divergência registrou (`app/web/src/matriz.ts`,
  com teste para o caso em que a fonte corrige o valor depois).
- **D-W4**: o servidor gera uma tarefa por par de fontes em conflito, então
  um pedido com três fontes chegou a 30 tarefas com a mesma ação repetida.
  A tela agrupa por parte e título e lista as origens (15 grupos).
- **D-W5**: identidade The Foundry (`PRODUCT.md`), não a do Instituto
  Realiza.vc, por ser produto do time no hackathon. Texto auxiliar usa
  `#858c94` do site, porque o `#71717A` de `PRODUCT.md` fica perto de 4:1
  sobre `#0A0C0E` e falha para texto pequeno (medição final na auditoria).

## Pendências para a integração

- `app/server/index.ts:187`: o teste de boot standalone monta
  `file:///` + caminho. No Linux isso vira `file:////` e nunca casa com
  `import.meta.url`, então `npm run dev` e `npm start` saem sem subir o
  servidor e sem erro (os testes passam porque chamam `buildServer()`). No
  Heroku, que é Linux, o deploy não responderia. Correção sugerida:
  comparar com `pathToFileURL(process.argv[1]).href`.
- O seed roda em outro processo e o banco PGlite é em memória: o servidor
  sobe vazio. Para a URL pública ele precisa semear no boot.
- `GET /api/pedidos` devolve `{ pedidoId, totalEventos, criadoEm, ultimoEm }`
  sem tipo em `app/shared/model.ts` (a web declara `PedidoResumo` em
  `app/web/src/api.ts` até a infra promover o tipo).
- Textos de `detalhe` das tarefas vêm com data ISO, código de status e sem
  acento (THE-9 corrige em `app/shared/rules.ts`).
