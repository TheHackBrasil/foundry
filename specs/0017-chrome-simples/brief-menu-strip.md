# Brief menu-strip (correcao da call 26/11 [1:04:13])

Worktree: ../foundry-wt-menu-strip, branch wt/menu-strip.
Arquivos permitidos: app/web/src/components/menuwiki/, app/web/src/menuwiki.css, este brief.

Skills: impeccable + interaction-design.

A decisao exata da call (Gabriel, 1:04:13 a 1:05:11): no menu lateral
so precisa ter O NOME DO PEDIDO e e isso. Sem "+5d", sem "N desvios",
sem selo de status, sem destinatario. "Esquece o cinco dias. Nao precisa
ter para qual o gol ta indo. Acho que so precisa ter o nome do pedido
ali e e isso. E muita informacao no cantinho que nao precisa ter. Aqui
tem que ser tipo um menu rapido."

Implementar:
- No modo compacto (padrao), itens de Pedidos mostram SOMENTE o nome
  (emitente). Nada de selo visual, nada de linha de resumo. O selo e o
  resumo continuam no aria-label/title (a11y nao perde informacao).
- Excecao do brief anterior se mantem: erro de carregamento da secao
  Pedidos continua visivel (retry a vista).
- Itens visualmente menores ainda se couber no craft: "os cards seriam
  bem menores" (1:06:21), padding/altura compacta sem perder alvo de
  toque minimo.
- Secoes nascem minimizadas por padrao exceto Pedidos (1:06:07: "por
  padrao ele ta minimizado"). Pedidos nunca nasce fechada.
- Modo expandido (toggle) continua mostrando tudo como antes: o strip
  e so do compacto.
- Parceiros/Documentos/Regras: aplicar o mesmo espirito no compacto
  (nome apenas), respeitando os selos semanticos so no expandido.

Verificacao: tsc, vitest (230 baseline), build. Screenshot do menu
compacto nos dois temas. Commit thisux1, sem push.
