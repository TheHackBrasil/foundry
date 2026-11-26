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

## Decisoes da frente

- D-T1 (escopo): preview rico do item 35 fica FORA desta wave. O recorte
  da call e busca rapida de navegacao; preview entra quando houver
  superficie propria para ele.
- D-T2 (dados): a busca cobre so o que ja esta carregado no cliente,
  zero GET novo: pedidos e contatos via props do App (listaPedidos e
  torre.contatos) e documentos via projecaoCacheada() de rede.ts, que so
  devolve projecao ja buscada e validada por totalEventos. Resultado: a
  secao Documentos aparece quando o pedido foi aberto ou pre-buscado
  pelo MenuWiki na sessao, nunca com fetch disparado pela busca.
- D-T3 (navegacao): resultado de pedido/documento usa o href route-aware
  de dados.ts (#/pedido/:id na torre, #/ia/:id na rota ia), mesmo
  criterio do SeletorPedidoPopover e do indice lateral. Resultado de
  parceiro abre a Agenda (mesma acao que o MenuWiki liga a parceiros).
- D-T4 (aria): listbox com aria-activedescendant no padrao do
  SeletorPedidoPopover, com uma correcao de fiacao: como o input e o
  proprio gatilho (combobox), o activedescendant mora nele e nao no
  container, forma que o APG recomenda para autocomplete. Grupos por
  secao usam role=group com rotulo.
- D-T5 (comportamento): resultados ao vivo com debounce de 150ms;
  consulta vazia mostra o inventario capado como modo browse; Escape
  fecha o popup e, ja fechado, limpa o campo; "/" foca a busca de
  qualquer ponto fora de campo editavel (helper elementoEditavel
  reutilizado); selecao limpa o campo e fecha.
- D-T6 (de-slop): botoes da topbar na regua compacta --ctl-sm (28px) com
  fs-meta e icone de 14px, iguais ao passo do toggle de tema; em toque
  voltam a 44px como os demais controles. Pill roxa da Revisao removida:
  a pendencia vira chip de contagem em tinta neutra (--text2 sobre
  --tint-soft), sem dot nem fundo colorido. Sem agrupamento extra de
  botoes: a barra tem poucos controles e o toggle de tema fica onde
  esta, conforme o recorte.
- D-T7 (css): busca.css carrega antes de styles.css na cascata (ordem do
  grafo de modulos, nao de main.tsx), entao as regras de de-slop levam
  pai .topo para vencer por especificidade, e .topo ganha
  overflow:visible para o dropdown escapar da barra.
