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

- `app/server/index.ts`: o teste de boot standalone montava `file:///` +
  caminho, que no Linux vira `file:////` e nunca casava, então `npm run dev` e
  `npm start` saíam sem subir o servidor e sem erro. Corrigido na `main` em
  21/11 com `pathToFileURL`, e o `PORT` do `.env` passou a valer (antes era
  lido antes do `dotenv`). Validado no Linux com Postgres real. Falta o Gui
  confirmar e a correção chegar à `origin/main`.
- O banco agora é Postgres real (D-024), então o dado persiste entre
  processos e o `npm run seed` funciona. Para a URL pública o servidor ainda
  precisa semear na primeira subida.
- `GET /api/pedidos` devolve `{ pedidoId, totalEventos, criadoEm, ultimoEm }`
  sem tipo em `app/shared/model.ts` (a web declara `PedidoResumo` em
  `app/web/src/api.ts` até a infra promover o tipo).
- Textos de `detalhe` das tarefas vêm com data ISO, código de status e sem
  acento (THE-9 corrige em `app/shared/rules.ts`).

## Evidência por critério do gate (21/11)

- `tsc --noEmit` limpo: `npm run typecheck` em `app/web/`, sem saída de erro.
- Testes: `npm test` em `app/web/` passa 8 testes de `src/matriz.test.ts`
  (matriz por fonte, conflito que some quando a fonte corrige o valor,
  filtro por parte e agrupamento de tarefas). Build: `npm run build` ok.
- Screenshot 1440 e 390 sem quebra: `app/web/evidencias/torre-1440.png` e
  `app/web/evidencias/torre-390.png`. A página não rola na horizontal em
  320, 390, 768 e 1440 px (`scrollWidth` igual a `clientWidth`); a tabela de
  campos rola por dentro, o que o reflow permite em tabela de dados.
- XML enviado vira pedido na tela: NF-e, CT-e e planilha de
  `app/web/public/exemplos/` enviados pela própria interface criam o pedido,
  com 1, 14 e 26 eventos, e o resultado de cada envio é listado. O
  `exemplo.eml` (a NF-e dentro de um e-mail) cria o mesmo pedido com 1
  evento, e um `.xlsx` é recusado com a mensagem que pede CSV (D-025).
- Divergência propaga sem recarregar: a tela busca de novo ao receber o
  evento do SSE (uma busca de lista, uma do pedido e uma da auditoria por
  rajada, agrupadas em 300 ms) e anuncia na região viva, por exemplo
  "Pedido 3526…000019: 20 eventos novos. 141 eventos no registro."
- Cinco visões: o seletor "Ver como" filtra as tarefas por parte (D-W1,
  pendente de confirmação).
- A6, item a item, auditoria por subagente com `agent-browser` e
  axe-core 4.14.1 (0 violações a 1440 e a 320 px) em dois passes:
  - contraste: texto do menor par mede 4,88:1 (`--ink-faint` sobre
    `--panel-hi`, só usado em borda) e os demais passam de 5,7:1;
    ícones e bordas de controle passam de 3:1 (`--line-ctl` mede 3,69,
    3,44 e 3,12 sobre `--bg`, `--panel` e `--panel-hi`);
  - foco e teclado: ordem de Tab completa, anel visível em todas as
    paradas (o anel dos links da lista estava cortado pelo `overflow` e
    foi corrigido), grupo "Ver como" por setas, skip link sem trocar o
    pedido aberto;
  - `prefers-reduced-motion`: `.tarefa-nova` só anima sob
    `no-preference` (medido com a mídia emulada);
  - alt text: a tela não tem imagem; os 7 ícones SVG são decorativos
    (`aria-hidden`) e o sentido vem em texto.
- Não verificado: leitor de tela real (NVDA, VoiceOver), queda de rede real
  do stream (simulada por evento `error` na instância do `EventSource`;
  a recuperação foi testada com rede real), `forced-colors`, zoom de 200%
  e 400% do navegador, Firefox e Safari, toque real e tema claro (não
  existe).
