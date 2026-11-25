# Brief frente v2-menu (THE-20)

Escopo na spec `specs/0014-ux-v2/spec.md` e na issue THE-20 do Linear.

## Escopo

Transformar o rail esquerdo num indice visual estilo mini-Wikipedia:
secoes para pedidos, parceiros (agenda), documentos e regras ja mapeados;
cada item com titulo, resumo curto de uma linha e estado (selo de
divergencia, pendencia, aguardando). Referencia: a gaveta de temas do
ChatGPT. Busca/filtro local no topo.

## Restricoes

- O mount existente e `<PedidoLista>` dentro do rail em `App.tsx`. Manter o
  contrato de props (`pedidos`, `selecionado`, `rota`, `aoTentarDeNovo`,
  `aoSelecionarMobile`); dados extras que faltarem (agenda, contagens)
  podem ser buscados pelo componente via `api.ts` ou pedidos na integracao:
  anotar no brief o que `App.tsx` precisaria passar.
- CSS novo em `app/web/src/menuwiki.css`. Nao editar `styles.css`.
- Icones novos vao em `icones.tsx` (path da frente); nomenclatura segue o
  arquivo.
- A6: lista navegavel por teclado, contraste, reduced-motion.
- Skills: accessible-animation; prosa segue `docs/STYLE.md`.
- Teste novo: filtro local e selecao mantem comportamento atual.

## Decisoes da frente

- D-M1: a busca local substitui a pilula Todos/Conflitos. O texto do selo
  entra no indice pesquisado ("desvios", "cancelada"), entao o recorte de
  conflitos continua alcancavel pelo filtro unico.
- D-M2: icones novos (lupa, chevron) moram em `app/web/src/icones.tsx`,
  path da frente em `speckit/frentes.json`. O arquivo que o app usa hoje e
  `app/web/src/components/icones.tsx`, fora do alcance da frente; a
  integracao pode fundir os dois.
- D-M3: a secao Regras lista so itens da fila de revisao que carregam
  proposta de mapeamento (RF11); item sem proposta e triagem de ingest,
  nao regra. Selos reutilizam Pendente/Aprovado/Descartado do
  DrawerRevisao.
- D-M4: Documentos vem de `GET /api/pedidos/:id`, uma versao por documento
  recebido (RF18), buscado pelo proprio MenuWiki para os 8 primeiros
  pedidos da lista e limitado a 20 itens; clicar navega para o pedido com
  o mesmo href da lista (rota torre ou ia).
- D-M5: dados extras nao exigem mudanca em `App.tsx`. As props opcionais
  `aoAbrirAgenda` e `aoAbrirRevisao` transformam Parceiros e Regras em
  botoes para os drawers existentes quando a integracao as passar; sem
  elas, os itens dessas secoes sao informativos (sem link).
- D-M6: o colapso por secao persiste em localStorage na chave versionada
  `forseti:menuwiki:v1`; durante a busca todas as secoes abrem para
  mostrar os resultados.
- D-M7: `aria-current` so marca itens da secao Pedidos. Documento aponta
  para o mesmo pedido, mas a pagina corrente e o pedido, nao o documento.
