# Brief topo (busca universal + header), call 26/11 [46:53] e [50:19]

Worktree: ../foundry-wt-topo, branch wt/topo.
Arquivos permitidos: app/web/src/components/Cabecalho.tsx,
app/web/src/components/BuscaUniversal.tsx (novo),
app/web/src/busca.css (novo), app/web/src/App.tsx (APENAS a linha de
montagem do Cabecalho e props necessarias, cirurgico), este brief.

Skills: impeccable + interaction-design + ux-accessibility-audit.

Duas entregas:

## 1. Busca universal na topbar (item 35 do BACKLOG, recorte da call)
Gabriel 46:53-47:21: uma busca pequena na topbar, "entre agenda e modo
claro escuro". E 50:19: "resultados da pesquisa sem precisar dar enter"
(live, enquanto digita).

- Input compacto no Cabecalho entre os botoes existentes, com IconeLupa,
  placeholder curto ("Buscar"), expansao focada elegante se couber.
- Resultados AO VIVO conforme digita (debounce ~150ms), dropdown com
  os pedidos/parceiros/documentos existentes no cliente (os dados ja
  carregados na pagina/menuwiki, investigue o que App.tsx ja tem em
  mao: listaPedidos etc; NAO crie endpoint novo nesta wave).
- Highlight do trecho casado em negrito no resultado.
- Enter/seta+Enter navega para o pedido (#/pedido/:id); Escape fecha;
  setas navegam os resultados; aria em padrao listbox com
  aria-activedescendant (mesmo padrao do SeletorPedidoPopover).
- Click no resultado navega e fecha.
- Preview rico completo do item 35 fica FORA desta wave (registrar no
  brief como decisao): o recorte da call e busca rapida de navegacao.

## 2. Header de-slop
O badge/botao Revisao no header esta com cara de AI slop (feedback do
usuario). Leia Cabecalho.tsx e o CSS correspondente e redesenhe os
botoes da topbar para o padrao da casa: discretos, altura uniforme de
28px, sem pill colorida gratuita; badge de contagem so quando houver
pendencia, tinta neutra, nunca roxo. Consolidar: se houver botoes
demais acumulados, agrupar os configuracionais, mas NAO mover o toggle
de tema nesta wave (depende de superficie de configuracoes inexistente).

Verificacao: tsc, vitest (230 baseline), build. Screenshots da topbar
com busca aberta/digitando nos dois temas. Commit thisux1, sem push.
