# Brief topo (busca universal + header), call 26/11 [46:53] e [50:19]

## REFINAMENTO DO USUARIO (prioridade sobre o resto deste brief)

A busca e no estilo do site/docs do Supabase: command palette tipo
Cmd+K, NAO dropdown colado no input.

- Gatilho compacto na topbar, mas ao focar/clicar abre uma PALETA
  centralizada (overlay modal no centro superior da tela).
- Atalho global Ctrl+K ou Cmd+K abre de qualquer lugar; Escape fecha e
  devolve o foco.
- Input grande no topo da paleta; resultados ao vivo; grupos por tipo
  com rotulo (Pedidos, Parceiros, Documentos) quando houver mais de um.
- Highlight do trecho casado; cada resultado com icone do tipo + nome +
  contexto curto. Visual de palette premium.
- aria: input da paleta e o dono do foco com aria-activedescendant
  (padrao combobox APG).
- Sem preview rico ainda, mas estruture a paleta pensando nele: largura
  generosa, espaco para painel lateral futuro.

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
- D-T8 (apresentacao, refinamento): a busca virou command palette no
  estilo Cmd+K do Supabase, overlay modal centralizado no alto da tela
  (veu fixed + createPortal no body, role=dialog aria-modal), nao
  dropdown colado. O campo da topbar virou gatilho-botao com cara de
  campo (lupa + "Buscar" + keycaps Ctrl+K) e aria-haspopup=dialog: o
  input de verdade mora na paleta e recebe o foco ao abrir. Decisao de
  craft: manter a silhueta de campo honra o recorte da call ("busca
  pequena entre agenda e tema") sem mentir que ali se digita; um clique
  e a paleta assume. Revoga o "dropdown" de D-T5; o overflow:visible de
  D-T7 ficou sem objeto (portal ignora o overflow:hidden de .topo).
- D-T9 (atalhos): Ctrl+K/Cmd+K alternam a paleta de qualquer ponto do
  app (preventDefault contra a barra de busca do navegador); "/" abre
  fora de campo editavel; Escape fecha e devolve o foco a quem chamou
  (focoAnteriorRef, preventScroll). Dentro da paleta o input e o unico
  focavel: Tab fica segurado nele e a navegacao dos resultados e por
  aria-activedescendant, como manda o combobox APG (role=combobox +
  aria-haspopup=listbox + listbox com role=group por secao).
- D-T10 (IA): grupo fixo "Comandos" no fim da lista, fora do filtro e
  sempre presente; quando nada casa vira rota de escape. O item
  "Perguntar à IA sobre X" chama abrirAssistente(comando) com a consulta
  crua (nao a debounced: o titulo promete exatamente o que Enter envia);
  a PaginaAssistenteIA executa o comandoInicial sozinha. Sem consulta,
  abre o assistente vazio.
- D-T11 (estrutura): .paleta tem 42rem de largura e .paleta-corpo ja e
  uma grid de colunas, entao o painel de preview rico de D-T1 entra como
  segunda coluna sem refazer o painel. Rodape com dicas de tecla e
  contagem de resultados fecha a assinatura de command palette.
