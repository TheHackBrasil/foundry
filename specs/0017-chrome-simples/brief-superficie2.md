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

## Decisoes da frente

### D1. De-conteneirizacao via painel-v2.css, nao via torre-v2.css
O interior dos cards da torre e achatado com overrides escopados em
`.torre-card .torre-card-corpo` (especificidade 0,3,0, que vence
torre-v2.css em 0,2,0 mesmo carregando antes no bundle). torre-v2.css
pertence a outra frente e nao foi tocado. Hairline interna nova:
`--tc-hair: color-mix(in srgb, var(--text) 12%, transparent)` definido
em `.torre-card`, adapta sozinho aos dois temas.

O que achatou: `.tarefas-grupo` (laje com borda vira regiao separada por
hairline; o anel volta so em `.tarefas-grupo-focado`), `.mx`/`.mx-h`/
`.mx-b` (moldura da matriz some, separadores internos vao a --tc-hair),
`.domino-no` (anel some, vira bloco tonal --tint-soft; estados
hover/pressed mantem a cor de acordo como affordance), `.painel-card` e
`.aviso-msg` em sinais (achata para o proprio card; mensagem citada vira
bloco tonal), `.versoes` (hairlines translucidas), `.sim-vivo-campo`
(bloco tonal), `.sim-tabela` (ring --tc-hair), `.botao-sutil`/`.selo-btn`
dentro do card (anel --control-border semi-transparente, sem bevel nem
fundo de superficie).

O que ficou e por que: `--control-border` nos controles (ja e color-mix
semi-transparente da casa e e a affordance real do botao), anel de
`.mx-simulacao` e de `.tarefas-grupo-focado`/`cel-focada` (estado
funcional, nao moldura), `.domino-no::after` (indicador de pressionado),
timeline `.versoes li::before` (e o conteudo, nao moldura).

### D2. Glitch do disclosure: WAAPI removido, grid-rows 0fr/1fr
Causa raiz medida: fechar animava altura via WAAPI e o `onfinish`
chamava `setCorpoMontado(false)`. Num re-toggle a ~90 ms o handler stale
desmontava o corpo depois do re-open; o open seguinte animava um
elemento display:none e o estado final ficava aria-expanded=true com
corpo hidden e h=0 permanente (screenshot /tmp/sup2/glitch-quebrado.png).

Correcao: toda a maquina de estados WAAPI sai (corpoMontado, corpoRef,
abertoAntesRef, useLayoutEffect). O corpo fica sempre montado;
`.tarefas-corpo` anima `grid-template-rows: 0fr/1fr` via data-aberto e
`.tarefas-corpo-in` faz `visibility` sair com atraso de 200 ms (fora do
foco/AT fechado, sem desmontar). Transicao declarativa reverte suave no
meio do curso; prefers-reduced-motion zera a transicao. Verificado ao
vivo: re-toggle a 90 ms assenta aberto (h=244, visivel); fechar simples
assenta hidden.

### D3. Textos persistentes: escondidos so visualmente (so-leitor)
"Sua sessao" (.pilula-sutil no titulo da pagina), "Simulacao · nada
gravado no ledger" (.pilula-warn no cab do simulador) e "Pedido de
exemplo (somente leitura)" (.meta no rodape do simulador) viram
ruido dentro do card/pagina da torre. Foram escondidos com o padrao
so-leitor em CSS (visivel-hidden), nao removidos do DOM: seguem na
arvore acessivel e a honestidade do modo demo permanece no feedback da
acao (pilula ok/erro do aplicar). PainelPedido.tsx e SimuladorVivo.tsx
sao de outras frentes, entao a remocao e CSS-only.

Mantidos por criterio: a dica de uso do simulador (unico texto
instrucional, discreto), "Sem contato cadastrado" (explica o botao
Configurar ao lado), selos de menuwiki/dados.ts (Cancelada, +Nd,
desvios, Confere sao estado honesto e o modo compacto ja e o padrao,
expostos via title/aria sob demanda), o pilula-ok/erro de feedback
(acao, nao decoracao). PaginaOperacao.tsx fica fora de escopo.
