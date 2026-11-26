# Brief chrome-controles (itens 41 + 42)

Worktree: ../foundry-wt-chrome-controles, branch wt/chrome-controles.
Arquivos permitidos: app/web/src/components/assistente/SeletorPedidoPopover.tsx,
app/web/src/assistente.css, app/web/src/components/torre/TorreCard.tsx,
app/web/src/torre-v2.css, e testes novos desses arquivos. Nada mais.

Carregue as skills interaction-design e impeccable antes de escrever
codigo e diga no commit que usou.

## Item 41: filtro no seletor de pedido

SeletorPedidoPopover.tsx hoje renderiza pedidos.map sem filtro nem teto
(:183-231). Adicionar input de busca ACIMA do listbox (nunca dentro do
role=listbox, invalida o padrao). Filtra por emitente + codigo + status
textual usando normalizarConsulta de menuwiki/dados.ts (:206-212) se o
import for limpo; se houver qualquer atrito de dependencia, duplique a
funcao localmente com nome claro. Detalhes obrigatorios:

- indiceAtivo passa a indexar a lista FILTRADA (hoje indexa pedidos
  cru em :64 e :111-120); setas/Home/End/Enter/Escape continuam.
- Filtro reseta ao fechar o popover.
- Lista filtrada vazia mostra empty state curto ("Nenhum pedido
  corresponde").
- Foco: ao abrir, foco vai para o input de busca; ao fechar, devolve ao
  gatilho (padrao ja existente em fechar(restaurarFoco) :53-60).
- Filtrar tambem por status textual ("conflito", "consistente").

## Item 42: affordance do resize de largura

O splitter Nx (TorreCard.tsx:100-134) tem title de hover mas nenhuma
affordance visivel do efeito. Implementar hint persistente e discreto do
proximo estado do ciclo: ao lado do Nx, texto pequeno do proximo passo
(ex.: com spanMax 3 e span 2: "proximo: 3 colunas"; com span == spanMax:
"proximo: volta a 1"). Deve ser legivel mas subordinado (texto de apoio,
nao competir com o titulo do card). Alternativa aceita se mais simples:
transformar o clique em menu com as opcoes 1..spanMax explicitas.
Manter o APG separator com aria-valuetext e as setas funcionando.

Verificacao obrigatoria: tsc, vitest, build como no brief-toolbar.
Screenshots do popover filtrando e do hint do splitter. Commit thisux1.
Sem push.
