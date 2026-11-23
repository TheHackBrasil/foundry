# Brief · frente `ai-web`

Status: implementada na branch `wt/ai-web`, pronta para revisão e
integração. Dona dos paths `app/web/` e deste brief.

Objetivo: expor na tela a camada AI já em produção (mandato em linguagem
natural, lente `view-spec` por papel, sinais consultivos e avisos) com os
componentes, tokens e padrões de acessibilidade de `app/web/`. Voz do
produto: torre de pedidos, confiança sem ruído, zero hype de IA.

## O que já existe (não reinventar)

- `useTorre`: estado da tela, SSE com pausa (WCAG 2.2.2), região viva
  `anunciar`, seleção por hash.
- `PainelPedido` -> `Conteudo`: `filtro` de parte alimenta
  `TarefasPorParte` (abas acessíveis com navegação por teclado).
- `matriz.ts`: `montarMatriz(versoes, divergencias)` -> `Matriz`;
  `FILTRO_TODAS`; `tarefasDaParte`; `agruparTarefas`.
- `api.ts`: `pedirJson`, `ErroApi`, `enviarArquivo`.
- `format.ts`: lookups seguros em `Map` (pt-BR), `chaveCurta`, `variacao`.
- `app/shared/model.ts`: `RespostaMandato`, `ViewSpec`, `Sinal`,
  `Notificacao`, `ProjecaoPedido` (já inclui `sinais` e `notificacoes`).
- Servidor (`index.ts`, `mandatos.ts`, `viewspec.ts`, `protecao.ts`):
  - `POST /api/mandatos`: atua nos pedidos da sessão do visitante (seed é
    somente leitura). Erros 422 (`sem_alvo`, `filtro_largo`,
    `acao_ambigua`, `parse_falhou`) e 503 (`indisponivel`) trazem
    `corpo.mensagem` em pt-BR; erros 400, 403, 429 e 507 vêm de
    `ErroRequisicao` e trazem a frase pt-BR em `corpo.erro`.
  - `GET /api/pedidos/:id/view-spec?papel=<parte>`: devolve `ViewSpec`
    validado com fallback determinístico (`viewSpecPadrao`) e cota própria
    por IP (`20 / 10 min` quando a LLM está ativa).

## Escopo

### T-W1 Barra de mandato e voz (`BarraMandatos.tsx`, `useVoz.ts`, `mandato.ts`, `api.ts`)

- `enviarMandato(texto)` em `api.ts` com `ErroMandatoApi` (`status`,
  `motivo`, `message` em pt-BR). Resolução de erro: lê `corpo.mensagem`
  quando presente; se ausente, lê `corpo.erro` quando não for código cru
  (`invalido`/`indisponivel`); cai em fallback pt-BR por status (503 =
  serviço de IA indisponível).
- Seção operacional entre `painel-cab` e `cols`, deixando explícito que o
  comando atua nos pedidos da sessão atual. Atalho `/` foca o campo fora
  de entradas editáveis; `Esc` cancela a gravação ou fecha o cartão de
  resultado.
- Chips de sugestão como `<button type="button">` que preenchem e focam o
  campo (sem disparo automático de escrita): "Resuma o estado", "Propague
  o atraso", "Simule a entrega para 28/01/2026" (data explícita, porque o
  prompt do servidor não injeta a data atual) e "Avise a transportadora".
- Recuperação de sessão vazia / pedido de exemplo: quando o mandato falha
  com `sem_alvo` ou `403`, exibir ação de um clique "Carregar exemplo na
  minha sessão" que envia `/exemplos/nfe-ok.xml`, `cte-ok.xml` e
  `planilha.csv` reais via `enviarArquivo` (sem mock, sem endpoint novo).
- Estados: ociosa, enviando ("Traduzindo…", desabilita entrada e botão,
  fio `Propagar` de `2px` em `--change` na borda superior da caixa),
  resultado e erro (`role="alert"` com `id` direto na mensagem). O anúncio
  de resultado usa a região viva única de `useTorre` com atraso de 420 ms
  para não colidir com o lote SSE de 300 ms, sem duplicar anúncios de
  erro.
- Camada de voz (`useVoz.ts`, `VisualizadorVoz.tsx`, backlog 26): botão
  microfone com `SpeechRecognition`/`webkitSpeechRecognition`
  (`lang='pt-BR'`, resultados provisórios no input, `aria-pressed`). Some
  quando o browser não suporta. Enquanto escuta, abre cápsula única
  (`36px` no desktop, `>= 44px` em toque) com visualizador `<canvas>`
  Retina de 20 barras simétricas (traços arredondados sem `roundRect`,
  espectro vocal `fftSize=256` + RMS temporal e janela de Hann), timer
  `00:00` em `Geist Mono tabular-nums` e botão `Parar` (WCAG 2.2.2).
  `AudioContext`/`AnalyserNode` via `getUserMedia` roda com DSP desligado
  e encerramento garantido de tracks e contexto em qualquer saída; se
  indisponível ou em conflito no aparelho, reage aos eventos
  `onsoundstart`/`onspeechstart`/`onresult`. Em
  `prefers-reduced-motion: reduce`, desenha snapshot estático sem
  `requestAnimationFrame`. Finalizar a fala mantém o texto editável no
  campo sem disparo automático; `Esc` cancela e restaura o texto anterior.
- Cartão tipado por ação (`mandato.ts` parseia `resultado.porPedido` sem
  `any`), sempre com rótulo da ação em pt-BR, links clicáveis `#/pedido/`
  para os alvos e botão `Fechar`:
  - `simular`: selo A7 "Simulação: nenhum campo foi gravado", mini-tabela
    de divergências previstas (campo, origem x hipótese, variação) e
    contagem de tarefas previstas por parte.
  - `propagar`: contadores `tabular-nums` de divergências, tarefas e novos
    eventos, explicitando idempotência quando 0 novos eventos foram
    gravados.
  - `resumir`: texto do resumo em largura de leitura + rótulo honesto de
    origem (`llm` vs `deterministico`).
  - `notificar`: recibo por pedido com parte, canal, status com ícone e
    texto, os 6 motivos possíveis de `nao_entregue` traduzidos em pt-BR e
    prévia da mensagem quando houver.

### T-W2 Lente `view-spec` (`matriz.ts`, `lenteCache.ts`, `MatrizFontes.tsx`, `PainelPedido.tsx`, `api.ts`)

- `obterViewSpec(pedidoId, papel, signal)` em `api.ts`.
- `aplicarViewSpec(matriz, spec)` pura e testada em `matriz.ts`: dedup e
  filtro de `fontesVisiveis` (ignorando fontes ausentes na matriz) e
  `colunas` (`CampoVigiado`). Se a interseção de fontes ou colunas ficar
  vazia, devolve a matriz completa (nunca exibe estado falso de "sem
  documentos"). Informa `ajustada`, `fontesOcultas`, `camposOcultos` e
  `destacarDivergencias`.
- Ativação sem ruído: abrir o pedido mantém a visão completa até a pessoa
  escolher uma parte nas abas (ou clicar em "Ajustar visão para {parte}"
  para a aba já aberta), evitando layout shift e consumo imediato da cota
  de `20 / 10 min`. Voltar para "Todas" restaura a matriz completa.
- Cache fora do ciclo de vida do `PainelPedido` (`lenteCache.ts`), com
  chave `${pedidoId}|${papel}|${totalEventos}` (sobrevive à troca de
  pedido e invalida quando o SSE traz novos eventos), teto de entradas,
  guard de corrida por sequência e `AbortController`. Falha na rede ou 429
  mantém a visão completa em silêncio.
- Estabilidade de layout: `data-fontes` em `.cols` segue a contagem da
  matriz completa para as abas de `TarefasPorParte` não saltarem durante o
  clique.
- Coreografia Brandbook v4 (`MatrizFontes.tsx`, `TarefasPorParte.tsx`):
  enquanto `/view-spec` carrega, um fio de `2px` em `--change` percorre o
  topo da matriz e a gaveta informa "Ajustando visão para {parte}…" sem
  apagar os dados atuais; ao aplicar, o hook `useFlipMatriz` (WAAPI sobre
  chaves DOM estáveis) desliza nós persistentes (`260 ms`) e revela novos
  nós com atraso escalonado (`240 ms`), sem rodar no carregamento inicial
  nem sob `prefers-reduced-motion: reduce`.
- Faixa de transparência da lente (exibida só quando `ajustada` é
  verdadeiro, respeitando A7 no fallback determinístico): indica "Visão
  ajustada para {parte}", lista fontes/campos ocultos, anuncia a troca na
  região viva estável e oferece botão independente "Ver matriz completa"
  com retorno seguro de foco e `inert` na gaveta fechada.
- Prop `destacar` em `MatrizFontes` (default `true`): quando `false`,
  suprime `.cel-dv` (tinta e fio lavanda) e usa estado neutro `--text2` no
  cabeçalho da linha, preservando o rótulo factual "Diverge" e a variação.

### T-W3 Sinais, avisos e upload `.xlsx` (`SinaisEAvisos.tsx`, `PainelPedido.tsx`, `format.ts`, `EnvioArquivos.tsx`)

- `proj.sinais` e `proj.notificacoes` renderizados entre `.cols` e
  `Versoes` (grade de 2 colunas quando ambos existem, 1 coluna quando só
  um existe), só quando há itens.
- Sinais consultivos: subtítulo reforçando R-006 ("Leitura consultiva: não
  altera campos vigiados"), etiqueta de `TipoSinal` traduzida, resumo,
  fonte e medidor geométrico reto (`32px x 4px`) com confiança `%` em
  `Geist Mono tabular-nums`.
- Avisos (`notificacoes`): ícone + status (`Entregue` / `Não entregue`),
  parte, canal traduzido, motivo traduzido quando não entregue e prévia da
  mensagem enviada quando existir.
- Novos sinais/avisos recebidos via SSE recebem o destaque temporário de
  `3px` em `--change` (mesmo padrão de `.tarefa-nova`).
- `EnvioArquivos.tsx`: aceitar `.xlsx` no `input[type="file"]` e atualizar
  o texto de ajuda para incluir planilhas `.xlsx` (RF1 da 0007).

## Direção visual e restrições (Brandbook v4)

- Paleta restrita aos tokens medidos de `tokens.css` (papel `#F5F2EB`,
  petróleo `#163C38`, cinza `#52665E`, lavanda profunda `#654199` /
  `#C9B2F0` só para coordenação, divergência e sinal de ação). Nenhuma cor
  nova em `tokens.css`, nenhum gradiente neon, brilho ou emoji.
- Hierarquia por espaço, superfícies tonais, fios sutis e raios
  concêntricos (`12px` superfície externa, `8px` controles, `6px` chips e
  pílulas), eliminando caixas aninhadas e bordas duras em repouso.
- Movimento produtivo com `cubic-bezier(0.22, 1, 0.36, 1)` e
  `transform`/`opacity`/`filter`: troca contextual de ícones
  (`scale 0.25 -> 1`, `blur 4px -> 0`), gavetas suaves por grid
  (`0fr -> 1fr`), abas em linha única com indicador deslizante, stagger na
  materialização da lente e supressão de transições na troca de tema.
  Respeito em camadas a `prefers-reduced-motion` e `forced-colors`.
- Zero dependência nova em `app/web/package.json`.

## Fora de escopo

- GenUI nível 3 (componente inventado pela LLM): nunca.
- Telas novas de agenda de contatos (`/api/contatos`) e fila de revisão
  (`ItemRevisao.proposta`): ficam para fatia própria.
- Auth, passkeys, endpoint novo no servidor: escopo estrito em `app/web/`.

## Critérios de aceite

- [x] `cd app && npx tsc --noEmit` limpo (shared/server).
- [x] `cd app && npm --prefix web run build` limpo (`app/web` `tsc --noEmit` + Vite).
- [x] `cd app && npm --prefix web test` verde (53 testes), com casos para
      `aplicarViewSpec` (fonte ausente, coluna ausente, spec parcial,
      dedup, interseção vazia, `destacarDivergencias: false`, fallback
      sem ajuste), `extrairMensagemErroMandato`,
      `interpretarResultadoMandato`, `montarTranscricao` (Safari e
      deduplicação Android com fronteira de palavra), `calcularRmsTemporal`,
      `calcularAlvosBarras`, `suavizarBarras`, `chaveCacheLente`,
      `deduplicarPedidos` e novos rótulos/formatadores de `format.ts`.
- [x] Mandato "Resuma o estado" exibe cartão de resumo; `simular` exibe
      mini-tabela com selo A7; erros 503, 422 e 429 exibem mensagem pt-BR
      legível, nunca código cru; `sem_alvo` oferece carga de exemplo em um
      clique.
- [x] Escolher parte nas abas aplica o `view-spec` à matriz, exibe faixa
      da lente só quando houve filtragem real e permite voltar para a
      visão completa; falha no fetch preserva a matriz inteira em silêncio.
- [x] A11y: rótulo real no campo de mandato, chips como `button`, mic com
      `aria-pressed` e controle `Parar`, `role="status"`/`role="alert"`,
      teclado preservado, `prefers-reduced-motion` e `forced-colors`.
- [x] Marca v4: lavanda só para sinal/coordenação; sem cor nova nem emoji;
      `python3 app/web/scripts/check_contrast.py` verde.
- [x] `node scripts/repo-guard.mjs && node scripts/prose-evals.mjs` exit 0.

## Proibido

Push, merge, deploy. Escrever fora de `app/web/` e deste brief. Inventar
endpoint. Apresentar mock como medido (A7). Travessão, meia-risca, aspa
curva ou emoji em `.md`.

## Skills carregadas

`typescript-clean-code`, `typescript-unit-testing`, `react-dev`,
`better-interface`, `better-accessibility`, `better-layout`, `better-ui`,
`better-typography`, `better-colors`, `ui-animation`,
`accessible-animation`, `micro-interaction`, `antislop-ui`, `taste`,
`humanizer`.

Base: `main` pós-0007 (`ViewSpec`, `sinais`, `notificacoes`,
`RespostaMandato` em `app/shared/model.ts`).

## Decisões da frente

- D-W1: `extrairMensagemErroMandato` (`api.ts`) prioriza `corpo.mensagem`
  e cai para `corpo.erro` quando não for código cru (`invalido`,
  `indisponivel`), porque o servidor devolve 400, 403, 429 e 507 via
  `ErroRequisicao` em `corpo.erro` e 422/503 em `corpo.mensagem`.
- D-W2: `BarraMandatos` declara escopo de sessão, usa data explícita no
  chip de simulação ("Simule a entrega para 28/01/2026", já que o prompt
  do servidor não injeta a data de hoje) e oferece carga real de 1 clique
  dos arquivos em `/exemplos/` quando o mandato retorna `sem_alvo` ou 403.
- D-W3: o anúncio do mandato em `useTorre.anunciar` aguarda 420 ms após a
  resposta para não ser sobrescrito pelo lote SSE de 300 ms disparado pelo
  próprio evento `mandato`; o cartão mantém `role="status"`/`role="alert"`
  próprio.
- D-W4: `useVoz` inicia `SpeechRecognition` primeiro e liga `AnalyserNode`
  (`getUserMedia`) de forma não-bloqueante em desktop fora de
  `prefers-reduced-motion`; em toque ou sem permissão, as 5 barras retas
  de `2px` reagem apenas aos eventos reais de fala/resultado e voltam ao
  piso no silêncio.
- D-W5: `aplicarViewSpec` preserva a ordem das fontes e campos da matriz,
  cai na matriz completa se a interseção de fontes ou colunas zerar, só
  marca `ajustada: true` quando houve omissão real ou supressão de
  destaque (respeitando A7 no `viewSpecPadrao`) e mantém `referencia` e
  `divergente` fiéis ao ledger. Quando uma fonte conflitante fica oculta,
  `Resumo` informa "diverge em fonte oculta pela lente".
- D-W6: a lente `view-spec` não dispara na montagem inicial (evita salto
  visual e consumo automático da cota `20 / 10 min`), guarda cache fora do
  `PainelPedido` em `lenteCache.ts` com chave `${pedidoId}|${papel}|${totalEventos}`
  (invalida ao chegar evento SSE), mantém `data-fontes` amarrado à matriz
  completa para não deslocar as abas durante o clique e oferece o botão
  independente "Ver matriz completa".
- D-W7: `SinaisEAvisos` sobe para entre `.cols` e `Versoes`, aparece só
  quando há itens, reforça R-006 no subtítulo e aplica destaque temporário
  de 3 px em `--change` a itens novos chegados por SSE.
- D-W8: `EnvioArquivos.tsx` passa a aceitar `.xlsx` no `input` e no texto
  de ajuda, alinhado ao RF1 da spec 0007. Nenhuma cor nova foi criada em
  `tokens.css`; os 52 pares de `check_contrast.py` seguem verdes.
- D-W9: `useVoz` abre e retoma o `AudioContext` sincronamente dentro do
  gesto de clique (evitando `AnalyserNode` suspenso), usa `continuous: true`
  com pausa pós-fala de 2,6 s, libera o `MediaStream` e retenta sozinho se
  houver disputa de microfone (`audio-capture`), e informa claramente
  falha de `network` (Brave/Chromium sem chave Google). O visualizador
  passa a rodar em `<canvas>` 20 barras simétricas a 60 fps via refs, sem
  re-renderizar o React (`VisualizadorVoz.tsx`).
- D-W10: `listarPedidos` (`api.ts`) deduplica `pedidoId` priorizando a
  entrada da sessão do visitante sobre a seed; `aplicarTema` (`tema.ts`)
  suprime transições por 1 quadro na troca de tema e sincroniza
  `meta[name="theme-color"]`; `BarraMandatos` e `TarefasPorParte` adotam
  superfície única acoplada, abas em linha única com indicador GPU
  (`translate3d` + `scaleX`) e elevação sutil sem caixas aninhadas.
- D-W11: `useVoz` adota máquina de estados de 4 fases (`ocioso`,
  `iniciando`, `ouvindo`, `finalizando`) com guarda `recRef.current !== rec`
  em todos os callbacks, watchdog de 1,2 s para `onend`, 3 temporizadores
  de silêncio + guarda de 12 s para ruído sem transcrição, `montarTranscricao`
  com fronteira de palavra no Android, `getUserMedia` com DSP desligado e
  encerramento garantido de `AudioContext`/`MediaStream` em qualquer rota
  de erro ou cancelamento. `VisualizadorVoz` usa traços `lineCap: 'round'`
  (sem `roundRect`), cache de tokens via `MutationObserver`, RMS temporal +
  bandas vocais `1..16` (`fftSize=256`) e suavização exponencial por `dt`.
- D-W12: `MatrizFontes` troca a reconstrução de DOM por continuidade FLIP
  via WAAPI (`useFlipMatriz`, descontando deslocamento da linha pai nas
  células e inativo no mount inicial e em `prefers-reduced-motion`). As
  gavetas de mandato e lente retêm snapshot de 200 ms para fechamento
  pareado com `inert`, sem animar propriedades de layout e sem duplicar
  animações em contêiner e filhos.
- D-W13: auditorias independentes fecharam contraste WCAG 2.2 AA em pares
  compostos (`--control-border`, `.tema` ativo com `--primary`/`--on-primary`,
  `.voz-ativo-parar`, `.btn-copiar`, `.envio-exemplos a`), foco interno em
  contêineres roláveis (`outline-offset: -2px`), ordem DOM `<main>` antes
  de `<aside>` com `grid-template-areas` (WCAG 2.4.3), hierarquia única de
  `<h1>` por tela, alvos de toque `>= 44 px`, reflow limpo em `320 px`
  (WCAG 1.4.10), `forced-colors` e redução de movimento em 3 camadas.


