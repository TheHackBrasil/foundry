# Brief polish-fluxo: performance e estrutura de conteudo

Frente: polish-fluxo (worktree wt/polish-fluxo, branch wt/polish-fluxo)
Spec: specs/0015-polimento-torre/spec.md

## Paths que voce pode escrever (o hook bloqueia qualquer outro)

- app/web/src/components/PainelPedido.tsx
- app/web/src/useTorre.ts
- app/web/src/useStream.ts
- app/web/src/components/menuwiki/
- app/web/src/format.ts
- app/web/src/components/GrafoDomino.tsx
- app/web/src/components/StatusCadeia.tsx
- app/web/src/components/TarefasPorParte.tsx
- app/web/src/components/MatrizFontes.tsx
- app/web/src/components/torre/Card*.tsx (os 7 wrappers Card*.tsx)
- specs/0015-polimento-torre/brief-fluxo.md

Proibido: TorreGrid.tsx, TorreCard.tsx, layout.ts, TorreVistas.tsx,
torre-v2.css, App.tsx, styles.css, servidor (app/server e territorio da
frente app-operacao; toda otimizacao de rede e client-side). Skills
obrigatorias antes de implementar: react-component-performance e
60fps-animation. Declare no relatorio final quais usou.

## Contexto

Auditoria de performance com medicoes reais encontrou: memoizacao inerte
(funcao recriada a cada render invalida o mega useMemo dos 7 cards; zero
React.memo no projeto), fanout de rede (32 GETs /api num reload; ate 15
requests por rajada SSE), ResizeObserver em ciclo, formatters Intl recriados
por celula, pulsos espelhados em state. Decisao do usuario: movimento fluido
sempre; nao cortar animacao de width/height. O ganho de performance vem
desta frente.

## Escopo (ordem de prioridade)

### F1. Memoizacao real (critico)

- `aplicarHipotesePapel` em PainelPedido.tsx:609-624 e recriada a cada
  render e esta nas deps do mega useMemo de cardsTorre (linha 861),
  invalidando tudo sempre. Envolver em useCallback com deps explicitas.
- Dividir o mega useMemo de cardsTorre em um useMemo por card, para que um
  pulso do domino nao recrie tarefas, versoes ou simulador.
- `titulosCard` (objeto inline) memoizado.
- Avaliar React.memo nos wrappers Card*.tsx e nos componentes de conteudo
  pesados (TarefasPorParte, MatrizFontes, GrafoDomino) com props estaveis.
- Verificar com React Profiler ou contagem de renders antes e depois;
  incluir numeros no relatorio.

### F2. Fanout de rede (critico)

Medido: 32 GETs /api num reload dev; rajada SSE pode disparar ate 15
requests. Sem tocar o servidor:

- Dono unico de contatos/revisao: useTorre busca; MenuWiki consome por props
  ou contexto em vez de refazer fetch (MenuWiki.tsx:95-114). Se a fiacao
  exigir mudanca em quem monta MenuWiki e isso estiver fora dos paths,
  implementar com cache compartilhado em modulo (dedupe in-flight por
  endpoint) e registrar a fiacao ideal nas decisoes da frente.
- Documentos: MenuWiki.tsx:118-141 faz Promise.all de ate 8 obterPedido
  para montar a secao. Tornar lazy (carregar quando a secao abrir ou
  entrar na viewport) e dedupe in-flight por pedidoId.
- Pular setState quando os dados nao mudaram (comparacao barata por
  revisao/tamanho/hash simples) em recarregarLista e carregarPedido.
- useStream: diferenciar hello de primeira conexao de reconexao; so
  reidratar na reconexao.

### F3. Pulsos sem espelhamento em state (alto)

PainelPedido.tsx:247-253 copia pulso para state gerando renders extras;
StatusCadeia.tsx:52-54 chama setUltimoOk durante render e :64-69 espelha
pulso. Passar chaves de pulso diretamente aos consumidores visuais; estado
derivado no render, nao em effect.

### F4. GrafoDomino: setGeom com comparacao (alto)

GrafoDomino.tsx:296-336 observa centro e botoes e chama setGeom com objeto
novo sem comparar. Comparar antes de setar (ou bail out por igualdade
shallow dos valores numericos).

### F5. Formatters Intl cacheados (medio, quick win)

format.ts:147-158, :135, :182 recriam Intl por celula. Cachear
Intl.DateTimeFormat e Intl.NumberFormat em modulo. Manter saida identica.
Rodar testes existentes.

### F6. Tarefas agrupadas por setor, telefone sem truncamento (alto)

Medido: card Tarefas tem 3106px de conteudo espremido em janela de 880px,
usuario ve 28%, telefone truncado em "WhatsApp +55 11 9...". Reestruturar
TarefasPorParte:

- Agrupar tarefas por setor/parte com disclosure (fechado ou aberto por
  default conforme o volume; justificar). Manter densidade de informacao.
- Telefone nunca trunca: quebra de linha ou valor completo com acao de
  copiar; nada de ellipsis em dado de contato.
- Preservar os botoes de origem e a semantica existente.

### F7. Roving tabindex nas grades densas (alto, a11y)

Medido: 118 tab stops dentro da torre (matriz com cerca de 25, tarefas 47,
simulador 21). Implementar:

- MatrizFontes: celulas navegaveis por setas com roving tabindex (padrao
  grid APG dentro do possivel; role="table" atual pode permanecer se a
  mudanca de role for arriscada, implementador decide e justifica).
- TarefasPorParte: botoes de origem com roving tabindex por grupo.
- Resultado medido: numero de tab stops antes e depois no relatorio.

### F8. Timestamp compacto da matriz (medio)

Medido: timestamps quebram em 3 linhas ("v1 / 25/11 / 16:44") inflando cada
linha para 130px e contribuindo para o clip horizontal de 43px. Formato
compacto em uma linha ("25/11 16:44" com versao em superscript ou variante
tipografica menor). Sem perda de informacao; title/tooltip com o completo.

## Criterios de aceite

1. Profiler ou instrumentacao mostra reducao clara de renders em interacao
   de densidade/span; numeros no relatorio.
2. Reload com log de rede: menos de 15 GETs /api (baseline medido: 32);
   rajada SSE simulada nao dispara mais de um fetch por endpoint.
3. Zero setState durante render; zero pulsos copiados para state.
4. Card Tarefas: telefone completo visivel, agrupamento por setor, altura
   total reduzida no estado default.
5. Tab stops dentro da torre reduzidos significativamente (meta: menos de
   40) sem perda de operacao por teclado.
6. Matriz: timestamp em uma linha, sem quebra.
7. tsc limpo, vitest passando, build ok. Testes novos para dedupe/cache e
   comparadores de igualdade.

## Decisoes da frente

(preencher aqui; a integracao copia para DECISIONS.md)
