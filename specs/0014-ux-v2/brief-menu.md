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
