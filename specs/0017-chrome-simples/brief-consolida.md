# Brief consolida (fadiga de controles + textos + barra IA), feedback do usuario 26/11 com screenshots

Worktree: ../foundry-wt-consolida, branch wt/consolida.
Arquivos permitidos: app/web/src/components/PainelPedido.tsx,
app/web/src/painel-v2.css, app/web/src/components/torre/TorreVistas.tsx,
app/web/src/vistas.css, este brief. Nada mais (BarraMandatos.tsx NAO
pode ser editada, so desmontada do painel).

Skills: impeccable + ux-heuristics + interaction-design.

Tres entregas, todas com evidencia visual antes/depois nos dois temas:

## 1. Uma unica linha de controles acima da torre
Hoje sao DUAS faixas cheias: a tablist de perspectiva (Visao completa
15, Fornecedor 2, Transportadora 4, CD 3, Fiscal 3, Financeiro 3) e a
faixa de layouts (5 presets + densidade Compacta/Normal/Grande + menu
Layout). O usuario reporta cansaco visual e confusao.

Consolidar em UMA linha: abas de perspectiva a esquerda; a direita um
unico menu "Layout" contendo presets, densidade, vistas salvas, salvar,
restaurar e cards. A densidade pode virar segmento dentro do menu em
vez de radiogroup visivel (ou segmented compacto se couber na linha sem
poluir, decisao sua com criterio). Presets NAO ficam mais visiveis como
chips soltos, exceto o preset ativo como rotulo no gatilho do menu se
houver um ativo. Preservar toda a a11y ja entregue (roving, foco
devolvido, toast com Desfazer).

## 2. Textos pequenos poluentes escondidos atras de "ver detalhes"
No cabecalho do pedido (PainelPedido): a linha NF-e com a chave gigante
"3526 0211 2223 ..." + "6 UN" + itens e poluicao visual (feedback
direto do usuario com screenshot). Esconder essa linha de detalhes
tecnicos atras de um toggle discreto "ver detalhes" (ou disclosure
similar) fechado por padrao. O botao copiar chave continua acessivel
quando aberto. A rota visual e o titulo ficam como estao. Criterio:
a primeira dobra do pedido mostra titulo, rota e status; metadados
tecnicos so sob demanda.

## 3. Remover a BarraMandatos da torre
A barra "simule ou comande sobre esse pedido" sai do PainelPedido, o
comando por IA vai viver na busca da topbar (frente paralela). Desmontar
o componente do painel e remover o espaco; NAO editar BarraMandatos.tsx
nem apagar o arquivo (a pagina da IA usa). Se a remocao deixar props
orfas ou imports mortos no PainelPedido, limpar. Verificar que a pagina
pedido nao quebra sem o PalcoGenUI inline (o focoPendenteTorre e
mecanismo separado, manter).

## Restricoes
- NAO tocar em App.tsx, Cabecalho.tsx, GrafoDomino.tsx, menuwiki.
- Preservar testes 230/230, tsc limpo, build ok.
- A6: disclosure acessivel (button + aria-expanded), foco visivel.
Commit thisux1, sem push.
