# Spec 0014: UX v2 (torre em tiling, painel de evidencia, menu wiki, grafo limpo)

Status: implementada
Data: 2026-11-24
Issues: THE-15 a THE-20 (projeto Linear "Forseti v2")
Precede o video do produto (THE-8, prazo 30/11): a UI precisa estar pronta primeiro.

## Contexto

Feedback direto do usuario sobre a onda 2:

1. GrafoDomino: linhas causais poluem; queridas off por default, reveladas so
   no hover, clique ou foco de teclado (THE-15).
2. Painel direito (#/ia): fraco e acoplado; quer integracao menos dependente
   dos dados da torre, micro-blocos GenUI e mini-descricoes geradas por LLM
   em tempo real quando o usuario clica num campo, divergencia ou setor
   (THE-16, THE-17).
3. Torre operacional: "ficou para tras"; quer tiling automatico, cards
   expansiveis, configuraveis, arrastaveis, fluidos, e templates de view
   para filtrar por caso de uso (THE-18, THE-19).
4. Menu lateral: quer um indice visual estilo "mini-Wikipedia" para
   pedidos, parceiros, documentos e regras ja mapeados (THE-20).

## Decisoes de arquitetura (D-050)

- Tres frentes em worktrees, arquivos disjuntos (speckit/frentes.json).
  `App.tsx`, `styles.css`, `tokens.css`, `genui/` e `shaders/` ficam com a
  integracao; cada frente cria seu proprio arquivo `.css` e importa do seu
  componente de entrada. Fiacao nova em `App.tsx` e pedida no brief e feita
  pela integracao.
- Reuso antes de criar: paleta e tipografia do brandbook v4 (tokens.css),
  blocos `genui/` existentes, `usePresencaAnimada`, `useIndicadorDeslizante`.
- THE-17 (mini-descricao via LLM) nao escreve em `app/server/` (territorio
  da frente app-operacao): a frente v2-painel reusa o endpoint SSE do
  agente (`/api/mandatos/stream`) com um mandato de leitura; se o contrato
  nao servir, o front fica pronto atras de flag e a necessidade de endpoint
  e registrada para a integracao.
- Movimento: transform/opacity only (60fps), `prefers-reduced-motion`
  respeitado (A6). Drag and drop usa FLIP; nada de animar width/height/top.
- Acessibilidade A6 e criterio de aceite em todas as frentes: contraste,
  foco e teclado, reduced-motion, nome acessivel.

## Invariantes

- Nada quebra o contrato publico: rotas `#/` e `#/ia` continuam,
  `data-rota` continua no `main`, hooks de foco inicial continuam.
- Sem dado inventado: mini-descricoes citam a evidencia real do pedido.
- Seed/read-only: nenhuma frente toca em seed ou em escrita.
- Testes web continuam verdes; cada frente adiciona teste do que criou.
