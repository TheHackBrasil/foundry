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

## Decisões da frente

- Item 41: input type=search acima do listbox, foco nele ao abrir e
  navegacao por setas com foco no campo (padrao paleta de comandos, sem
  role=combobox). normalizarConsulta importado de menuwiki/dados.ts,
  dependencia limpa (modulo puro, sem efeito colateral). O texto de busca
  cobre emitente, codigo curto exibido, id completo e o status textual
  renderizado ("2 conflitos", "Consistente"). indiceAtivo indexa a lista
  filtrada; ao digitar volta a 0 e um efeito trava no ultimo indice
  valido. Opcao ativa faz scrollIntoView nearest para nao sumir da area
  rolada. Filtro reseta no fechar (setConsulta dentro de fechar cobre
  Escape, clique fora, selecao e Tab). Empty state e option desabilitada
  dentro do listbox para o leitor de tela nao encontrar uma lista muda.
- Item 42: hint persistente dentro da propria pilula, "->Nx" ao lado do
  "Nx" atual (forma compacta do "proximo passo"; as palavras completas
  ficam no title e no aria-label, que agora diz para onde o clique leva).
  Subordinacao por tamanho 0.875em, peso 400 e tinta var(--text2), sem
  opacidade, para o numero manter contraste (A6). Calculo identico ao
  ciclo de aoAjustarSpan na grade (span >= spanMax ? 1 : span + 1).
- Foco da busca: o efeito depende de presenca.montado e nao de aberto,
  porque montado vira um commit depois; focar no flip de aberto pegava o
  input ainda desmontado e o foco ficava no gatilho.
- Testes novos destes arquivos existem e passam (12 casos), mas
  speckit/frentes.json nao lista *.test.* para esta frente: o pre-commit
  os recusaria. Ficam fora do commit, untracked no worktree, para a
  integracao incluir ou ampliar os paths da frente.
