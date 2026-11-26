# Brief superficie2 (de-conteneirizacao + textos uteis + glitch dropdown), feedback do usuario 26/11

Worktree: ../foundry-wt-superficie2, branch wt/superficie2.
Arquivos permitidos: app/web/src/painel-v2.css,
app/web/src/components/torre/CardCadeia.tsx, CardDomino.tsx,
CardMatriz.tsx, CardSimulador.tsx, CardSinais.tsx, CardTarefas.tsx,
CardVersoes.tsx, app/web/src/components/TarefasPorParte.tsx,
app/web/src/components/menuwiki/dados.ts (so os selos de texto),
este brief. NADA de torre-v2.css, TorreGrid.tsx, TorreCard.tsx,
PainelPedido.tsx, styles.css (outras frentes).

Skills: impeccable + interaction-design + refactoring-ui se existir.

Tres entregas:

## 1. De-conteneirizacao (direcao visual)
O usuario: "muitas bordas, meio conteinerizado demais, card dentro de
card". Direcao: hierarquia por espacamento e fundo em vez de molduras
aninhadas. Concreto:
- Elementos DENTRO de cards da torre perdem borda propria sempre que
  possivel: separacao por hairline fina semi-transparente ou so
  espacamento+fundo sutil.
- Bordas que ficam: semi-transparentes (color-mix com a tinta do tema,
  alpha baixo) em vez de solidas opacas.
- Gradiente sutil de borda so onde tiver funcao estrutural (topo de
  card, por exemplo), nunca decorativo.
- Medir antes/depois: contar quantas caixas aninhadas com borda existem
  dentro do card de tarefas e do card cadeia e reduzir ao minimo.

## 2. Glitch do dropdown de fornecedor/transportadora (card Tarefas)
Reproduzir primeiro: abrir o card Tarefas abertas, clicar no dropdown/
disclosure de um setor (fornecedor/transportadora) abrindo e fechando
rapido, observar o glitch visual reportado pelo usuario (provavelmente
altura animada com conteudo que pula, ou reflow da lista, ou dupla
renderizacao). Diagnosticar a causa no codigo de TarefasPorParte.tsx e
corrigir na raiz. Se a animacao de altura for o problema, considerar
grid-template-rows 0fr/1fr ou medicao, com reduced-motion respeitado.

## 3. Textos inuteis fora
O usuario: "muito texto inutil tipo pedido de exemplo, somente leitura,
blablabla". Inventariar os selos/pills de texto explicativo nos cards e
no menu (Exemplo, Sua sessao, somente leitura, simulacao etc) e aplicar
criterio: informacao que muda comportamento (ex.: seed somente leitura
que bloqueia escrita) vira affordance sob demanda (title/aria ou um
unico indicador discreto), nao texto persistente; texto decorativo/
repetitivo some. Manter a honestidade funcional: onde a demo realmente
e read-only, a pessoa precisa descobrir isso ao tentar escrever, com
mensagem clara no momento da acao, nao uma faixa permanente.

Gates: tsc, vitest 230/230, build. Screenshots antes/depois dos cards
nos dois temas, e video/gif ou sequencia de frames do dropdown
abrindo/fechando sem glitch. Commit thisux1, sem push.
