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
`app/server/**`, `app/contracts/**`, `app/seed/**`.
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
