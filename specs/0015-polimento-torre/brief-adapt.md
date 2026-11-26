# Brief adapt-generica: camada de adaptacao estrutural

Frente: adapt-generica (worktree wt/adapt-generica, branch wt/adapt-generica)
Spec: specs/0015-polimento-torre/spec.md

## Paths que voce pode escrever (o hook bloqueia qualquer outro)

- app/web/src/styles.css
- app/web/src/adaptacao.css (novo)
- app/web/src/components/GrafoDomino.tsx
- app/web/src/main.tsx (somente o import do css)
- specs/0015-polimento-torre/brief-adapt.md

## Pedido do usuario

Adaptacao por formato, quantidade de celulas e contexto. Regras dinamicas,
nao hardcoded: um componente novo criado no futuro nao deve precisar de
regra especifica para caber num card da torre.

## O que foi implementado

`adaptacao.css`: camada de adaptacao estrutural. O conteudo declara o que
ele e por tokens em `data-adapt` e a camada decide como ele cede ou recebe
espaco conforme a largura real do card (container queries `tcard`, os
mesmos tiers do torre-v2: 700, 430 e 340px).

## Gramatica do contrato

`data-adapt` e uma lista de tokens separada por espaco (seletor `~=`).
Um elemento pode carregar formato e papel ao mesmo tempo, como em
`data-adapt="trilho aux"`.

### Formatos de container

| Token | Estrutura | Comportamento |
|---|---|---|
| `trilho` | zonas proporcionais lado a lado | vira `display: flex`; cada filho reparte por `--adapt-share` (padrao 1), sempre `flex-basis 0` e `min-width 0`, entao o conjunto nunca estoura o card |
| `grade` | celulas de grade em quantidade livre | `auto-fit` com piso legivel por celula (`--adapt-col-min`, padrao 9.5rem); quando nem uma celula minima cabe, colapsa para coluna unica em vez de estourar |
| `tabela` | linhas com colunas paralelas | abaixo de 700px vira scroll horizontal com scrollbar fina; linhas usam `--adapt-min` (padrao 100%) como piso legivel |
| `lista` | sequencia vertical | filhos encolhem ate 0; papeis governam a dispensa |

### Papeis de item

| Token | Significado | Efeito |
|---|---|---|
| `essencial` | carrega o sentido do card | a camada nunca o remove; marca a intencao no markup |
| `corredor` | zona de ligacao dentro de um `trilho` (caminho, nao conteudo) | `--adapt-share` 0.55, depois 0.4 no estreito e 0.3 no micro: encolhe antes das zonas essenciais e nunca some |
| `ponte` | elemento dentro de `trilho` que nao reparte largura (conector, separador) | `flex: none`; ocupa so o proprio conteudo |
| `meta` | informacao secundaria | `display: none` no tier estreito (card <= 430px) |
| `aux` | estrutura dispensavel (cabecalho de colunas, medidor decorativo) | `display: none` no tier micro (card <= 340px) e em viewport <= 760px |

### Variaveis de ajuste

- `--adapt-share`: proporcao de um filho de `trilho` (padrao 1).
- `--adapt-gap`: gap do `trilho` (padrao 0).
- `--adapt-col-min`: piso legivel por celula da `grade` (padrao 9.5rem).
- `--adapt-min`: piso de largura por linha da `tabela` (padrao 100%).

### Ordem de dispensa

Quando o card estreita, o conteudo sai nesta ordem: `meta` no estreito,
`aux` no micro. `corredor` nunca sai, so encolhe. `essencial` nunca sai.
O que fica na tela e sempre o que carrega o sentido do card.

## Como um card futuro adota a camada

Resposta curta: nada alem de declarar formato. O componente novo marca
o container com o formato (`data-adapt="tabela"`, `"trilho"`, `"grade"`
ou `"lista"`) e, se quiser afinar, os itens com os papeis e as variaveis
`--adapt-*`. Nenhuma regra em torre-v2.css, nenhum piso de largura fixo.
A unica obrigacao herdada: dentro de card da torre nenhum componente pode
impor largura minima total maior que o proprio card; a camada ja garante
`min-width: 0` na raiz do conteudo e em todos os filhos dos formatos.

Adocao incremental nos componentes atuais (nao e desta frente): a matriz
marcaria `data-adapt="tabela"` com `--adapt-min` por linha, e os blocos
`.selo-meta`/`.selo-cadeia-info` marcariam `data-adapt="meta"`, o que
torna as regras hardcoded de torre-v2.css redundantes.

## GrafoDomino: primeiro cidadao da convencao

O palco de 3 colunas era o caso hardcoded (minimos de 624px em styles.css,
corrigidos por override em torre-v2.css). Agora:

- `.domino-palco` e `data-adapt="trilho"`: as colunas repartem por share
  e encolhem ate 0 em qualquer contexto (card, painel, Assistente IA).
- `.domino-centro` e `data-adapt="corredor"`: o corredor SVG encolhe
  primeiro (share 0.55/0.4/0.3 por tier) e permanece sempre.
- `.domino-col-titulos` e `data-adapt="trilho aux"`: trilho alinhado ao
  palco (span central com `corredor`, mesmo share) que some no micro.
- `.domino-fluxo-mobile` e `data-adapt="ponte"`: o conector alternativo
  nao reparte largura quando o palco empilha em viewport estreita.
- `.domino-comparacao`, `.domino-tags-origem`, `.domino-inativos` sao
  `data-adapt="meta"`: somem no estreito (o texto segue no aria-label).
- As duas `.domino-col` sao `data-adapt="lista essencial"`.

Em styles.css, `.domino-palco` e `.domino-col-titulos` perderam os
minimos duros: restaram templates fluidos `minmax(0, ...)` como fallback
para contexto sem a camada. O override de colunas do `.ia-turno-resposta`
saiu (o trilho cobre a coluna estreita); ficou so o ajuste tipografico.
No media query de 760px o palco empilha por `flex-direction: column`
(com `grid-template-columns` preservado para o fallback grid).

## Criterios de aceite e evidencias ao vivo

Verificado no vite do worktree (porta 5197, agent-browser sessao adapt),
pedido `35260123456789000123550010000000011000000019`:

1. Domino em card span 1: colunas legiveis, sem overflow horizontal, com
   meta/aux dispensados na ordem correta por tier.
   - span 1 a 470px (tier compacto): colunas 169+93+169, `scrollWidth`
     igual a `clientWidth`, titulos flex, meta visivel, zero nos com
     overflow. Screenshot: /tmp/adapt-domino-span1.png.
   - span 1 a 307px (tier micro, densidade compacta): colunas 121+36+121,
     `domino-col-titulos` em display none (aux dispensado), itens meta em
     display none, corredor a 36px ainda desenhando arestas, zero
     overflow. Screenshot: /tmp/adapt-domino-micro.png e
     /tmp/adapt-domino-micro2.png.
   - span 2 a 960px: colunas 361+198+361 (share 1/0.55/1 exato), conteudo
     completo. Screenshot: /tmp/adapt-domino-wide.png.
2. Clicar num no de setor revela as arestas (fix parteReveladora da main):
   clique em "Fornecedor" moveu 10 das 15 `.domino-aresta` de opacity 0.2
   para 0.72 (computed). Fix verificado correto, sem bug encontrado.
3. GrafoDomino no Assistente IA (`.ia-turno-resposta`) nao quebra:
   medido por clone do wrap renderizado numa coluna ia de 480px (o LLM
   local esta indisponivel, entao o turno real nao gera o embed):
   palco flex 188+104+188 com zero overflow, meta e aux visiveis porque
   os tiers so disparam dentro de `tcard`. Antes, o grid da folha
   forseti-ops exigia ~496px e teria estourado a coluna.
4. Viewport <= 760px: palco empilha (flex-direction column), corredor
   some, conector "↓" aparece entre as colunas, zero overflow-x.
   Screenshot: /tmp/adapt-domino-mobile.png.
5. Gates: `tsc --noEmit -p web` limpo, `vitest run` 207/207 verde,
   `vite build` ok, `repo-guard` 11 checks verdes, `prose-evals` 0 dura.

## Decisoes da frente

- Gramatica em um unico atributo: `data-adapt` como lista de tokens
  (`~=`), com familias ortogonais (formato de container + papel de item).
  Um so atributo compoe `trilho aux` sem colisao; alternativa de dois
  atributos (formato + papel) foi descartada por duplicar superficie sem
  ganho.
- Papel `corredor` separado de `aux`: dentro de um trilho, o corredor de
  ligacao nunca some (o mapa causal perde o sentido sem ele), so encolhe.
  `aux` ficou com um so significado: dispensa no micro. Uma regra, uma
  excecao por formato, documentada na tabela.
- Seletores de atributo dobrados `[data-adapt~='x'][data-adapt]` (0,2,0):
  a folha forseti-ops que GrafoDomino injeta no head em runtime chega por
  ultimo e empataria com 0,1,0; a dobra faz a camada vencer independente
  de ordem de cascata, inclusive sobre `.ia-turno-resposta` e `.tc-domino`.
- Trilho com 4+ zonas e sem ponte quebra linha no estreito
  (`:has(> :nth-child(4)):not(:has(> [data-adapt~='ponte']))`): o domino
  tem 3 zonas + 1 ponte e nunca dispara; a regra serve formatos futuros.
- Papeis `meta`/`aux` so disparam dentro de container `tcard` ou viewport
  estreita: fora de card (Assistente IA, drawers) o conteudo fica inteiro.
- Arestas do domino: o fix de `parteReveladora` da main esta correto
  (clique no setor revela arestas das divergencias impactadas);
  verificacao ao vivo registrada nas evidencias.
