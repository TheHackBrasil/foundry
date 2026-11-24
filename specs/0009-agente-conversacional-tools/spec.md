# Spec 0009: agente conversacional com tool calling interno

**Status:** rascunho (aguarda aprovação do usuário)
**Origem:** decisão do usuário de 24/11 de evoluir a camada AI do
classificador fechado de 4 ações (spec 0007, `POST /api/mandatos`)
para um agente conversacional real: histórico multi-turn, tool
calling interno sobre o motor determinístico, resposta em pt-BR
natural com streaming SSE e blocos GenUI acoplados quando fizerem
sentido.
**Data:** 2026-11-24

## Problema e resultado esperado

O endpoint `POST /api/mandatos` classifica o texto livre num JSON
fechado `{acao: propagar | simular | resumir | notificar}`. Funciona
para ordens diretas, mas a conversa real da banca não cabe nele:
perguntas abertas ("quais pedidos têm conflito?"), comparações
("compare Krona e PackSul"), acompanhamento ("e se atrasar mais 3
dias?"), pedidos de texto ("o que eu digo pro motorista?") e a fala
social ("oi", "como você ajuda?") caem em `422 acao_ambigua` ou em
resposta de template engessada.

O resultado esperado é um agente que conversa em pt-BR natural sobre
a operação, chama ferramentas internas tipadas para ler fatos reais
do ledger antes de afirmar qualquer número, executa as ações de
escrita que já existem quando o usuário pede explicitamente, e
acompanha a resposta com os blocos GenUI que o contexto pedir (grafo
dominó, simulador, comparador, cartões de despacho). A regra da spec
0007 segue íntegra: a LLM é a recepcionista, o ledger é o cartório.
Toda tool lê ou escreve exclusivamente pelo motor determinístico
(`app/shared/` + `LedgerStore`); a LLM nunca inventa data, chave,
valor ou status.

## Fora de escopo

- Mudança no `POST /api/mandatos` clássico: o endpoint não-streaming
  segue com o classificador da spec 0007, contrato congelado pelos
  testes e pelo smoke de deploy.
- Novas fontes de documento, campos vigiados ou regras de propagação:
  o motor é consumido, nunca modificado.
- Novos tipos de bloco GenUI: o agente compõe os `BlocoGenUI` que já
  existem em `viewspec.ts`.
- Streaming de `tool_calls` token a token: os deltas de texto são
  streamados; o resultado de cada tool chega como evento `tool`
  inteiro quando ela termina.
- Memória entre sessões: o histórico vive no corpo da requisição,
  enviado pelo front; o servidor não guarda conversa.
- Autenticação, multi-usuário ou papéis de permissão além do modelo
  de workspace da spec 0004.

## Histórias

### US1: juiz conversa com a demo como quem pergunta a um colega

- **Dado** a demo com pedidos visíveis **Quando** envia
  `POST /api/mandatos/stream` com `{"comando": "oi, o que você faz?"}`
  **Então** a resposta chega em SSE com `texto_delta` montando uma
  resposta humana em pt-BR, sem erro 422, e `fim` fecha com o texto
  completo.
- **Dado** o mesmo endpoint **Quando** pergunta "quais pedidos estão
  com divergência?" **Então** o agente chama `listar_pedidos`,
  anuncia a consulta num evento `tool` com resumo legível ("Listando
  pedidos do workspace") e responde com os fatos reais: nomes, chaves
  e contagens que vieram da projeção, não da imaginação do modelo.

### US2: juiz faz acompanhamento sem repetir contexto

- **Dado** uma conversa em que o agente já falou do pedido Krona
  **Quando** o front reenvia o histórico e pergunta "e se atrasar
  mais 3 dias?" **Então** o agente resolve a referência pelo
  histórico, chama `simular_cenario` no pedido certo e responde com
  o impacto previsto, sem pedir o id de novo.
- **Dado** histórico com texto imenso ou malformado **Quando** chega
  **Então** o servidor saneia (teto de turnos e de caracteres),
  ignora o que não for `{papel, texto}` válido e segue a conversa.

### US3: juiz vê a conta real por trás de cada afirmação

- **Dado** a pergunta "o que muda se a entrega sair dia 28?" **Quando**
  o agente roda `simular_cenario` **Então** a resposta cita as
  divergências e tarefas previstas pelo motor, o evento `bloco`
  carrega o `simulador_interativo` e o `domino_impacto` para o
  palco, e nada é gravado no ledger (R-006: simulação não altera
  campo vigiado).
- **Dado** o pedido "avise o CD sobre o atraso" num pedido da seed
  **Quando** a tool `enviar_notificacao` roda **Então** ela devolve
  erro estruturado `seed_somente_leitura`, o agente explica em
  linguagem natural que precisa de uma cópia na sessão e oferece o
  próximo passo, sem quebrar o loop.

### US4: avaliador técnico audita o loop de tools

- **Dado** uma pergunta multi-pedido **Quando** a LLM emite várias
  `tool_calls` num passo **Então** elas executam em paralelo, cada
  erro volta como mensagem `role: tool` estruturada e o agente se
  recupera; um teto de iterações impede loop infinito.
- **Dado** a demo sem `LLM_API_URL`/`LLM_API_KEY` **Quando** qualquer
  comando chega **Então** a resposta é 503 declarativa, igual ao
  endpoint clássico, e o resto da torre funciona.

## Casos de borda

- LLM devolve `tool_call` com argumento inválido (campo fora do enum,
  pedido inexistente, JSON quebrado): a tool responde erro
  estruturado legível para o modelo, que corrige ou explica a falha
  em linguagem natural; nunca exceção solta no SSE.
- LLM ignora as tools e responde texto direto numa pergunta factual:
  aceitável (degradação limpa), mas o system prompt orienta sempre
  consultar antes de afirmar fato de pedido.
- LLM repete a mesma tool em loop: teto de `MAX_ITERACOES = 6`; ao
  estourar, a resposta final resume o que se sabe e declara o limite.
- Provedor sem suporte a tool calling: `chatComTools` devolve texto
  sem `toolCalls` e o agente responde como conversa pura.
- Provedor sem `text/event-stream`: `chatTextoStream` cai no parse
  de resposta JSON comum e emite o delta inteiro de uma vez.
- `enviar_notificacao`/`propagar_divergencias` sobre pedido da seed:
  erro estruturado `seed_somente_leitura`; as escritas exigem pedido
  gravável da sessão (A9, isolamento por workspace).
- `historico` com papéis fora do enum ou textos vazios: saneado na
  entrada, nunca repassado cru ao provedor.
- Comando vazio ou histórico sem `comando`/`texto`: 400 com a mesma
  mensagem do endpoint clássico.
- Pergunta que resolve muitos pedidos para escrita: as tools de
  escrita operam por pedido; o agente pede confirmação em vez de
  atirar em lote.

## Requisitos funcionais

Prioridades: **P0** = sem isso a tese não se mostra; **P1** = fator
wow operacional; **P2** = contrato para a próxima fatia.

### Camada LLM

- **RF1 (P0)** `chatComTools(mensagens, tools, opcoes)` em `llm.ts`:
  chama o endpoint OpenAI-compatível com `tools` tipadas
  (`DefinicaoToolLlm`: nome, descrição, `parameters` em JSON Schema),
  devolve `{texto, toolCalls, finishReason}` com `ChamadaToolLlm`
  validada à mão (id, nome, argumentos já parseados; argumento
  inválido vira `{}` registrado, não exceção). Mesma config, timeout
  (`AbortSignal.timeout(cfg.timeoutMs)`) e erro tipado de
  `chatJson`: `ErroLlm('indisponivel' | 'invalido')`.
- **RF2 (P0)** `MensagemAgenteLlm` cobrindo `system`, `user`,
  `assistant` (com `tool_calls` no formato OpenAI quando houver) e
  `tool` (com `tool_call_id` e `name`). Serialização fiel ao wire
  OpenAI, incluindo `content: null` em assistant com tool calls.
- **RF3 (P1)** `chatTextoStream(mensagens, onDelta, opcoes)`: envia
  `stream: true`, parseia SSE `data:` linha a linha, extrai
  `choices[0].delta.content`, chama `onDelta` por fragmento e devolve
  o texto acumulado. Se a resposta não vier `text/event-stream`,
  parseia como chat comum e emite o delta único. `[DONE]` e frames
  sem `delta.content` encerram/ignoram limpo.
- **RF4 (P0)** `chatJson` e `llmConfigDoEnv` intactos: nenhum
  chamador atual muda.

### Ferramentas internas

- **RF5 (P0)** `app/server/agente/ferramentas.ts`: registro modular
  `{nome, descricao, schema, validar, executar}`. Cada tool valida
  os argumentos da LLM à mão (sem dependência nova) e executa de
  forma determinística sobre `LedgerStore` e o motor compartilhado.
  Resultado sempre `{ok, dados, resumo}`: `dados` JSON-serializável
  para a mensagem `role: tool`, `resumo` uma linha legível para o
  evento `tool` do SSE.
- **RF6 (P0)** Tools de leitura: `listar_pedidos` (todos os pedidos
  visíveis com emitente, chave curta, contagens de divergências e
  tarefas), `consultar_pedido` (resolve id completo, sufixo ou nome
  parcial do emitente; devolve rota, manifesto, campos por fonte,
  divergências, tarefas por parte, sinais e integridade),
  `comparar_fontes` (por campo ou todos divergentes, com valor por
  fonte e versões), `listar_tarefas_setor` (tarefas agrupadas +
  contato da agenda por parte), `consultar_auditoria` (cadeia
  válida, total de eventos, raiz Merkle, âncora).
- **RF7 (P0)** `simular_cenario`: roda `simularHipotese` com campo e
  valor normalizados (mesma normalização de `mandatos.ts`), sem
  gravar nada; devolve divergências, tarefas e partes impactadas e
  sinaliza os blocos `simulador_interativo` + `domino_impacto`.
- **RF8 (P0)** `preparar_notificacao`: monta rascunho por parte a
  partir da divergência real (reuso do texto determinístico de
  `nvoip.ts` ou template equivalente), confere contato e canal na
  agenda e sinaliza `cartoes_despacho`. Não envia nada.
- **RF9 (P0)** `enviar_notificacao` e `propagar_divergencias`:
  escritas reais por `notificarTarefa` e pelo motor de propagação,
  dentro de transação, somente sobre pedido gravável do workspace do
  chamador; pedido resolvido para a seed devolve
  `{ok: false, erro: 'seed_somente_leitura', mensagem}` estruturado
  para o agente explicar, sem exceção.
- **RF10 (P0)** Nenhuma tool escreve campo vigiado sem documento:
  escritas passam só por `eventos.append` do motor com ator e
  timestamp reais; a LLM nunca monta evento.

### Motor do agente

- **RF11 (P0)** `app/server/agente/motor.ts`: recebe `{pergunta,
  pedidoId?, historico?, sessao, store, seedWs, onEvento?}`, monta
  mensagens `[system, ...historico saneado, user]` e itera até
  `MAX_ITERACOES = 6`: `chatComTools`, executa `tool_calls` do passo
  em `Promise.all`, devolve cada resultado como `role: tool`
  (erro vira `{ok:false, erro, mensagem}` serializado), acumula
  trilha de execução.
- **RF12 (P0)** Histórico saneado: aceita só
  `{papel: 'usuario'|'assistente', texto: string}`, corta nos últimos
  10 turnos, trunca texto longo, descarta vazio.
- **RF13 (P0)** System prompt em pt-BR: copiloto sênior de operações
  logísticas; direto, sem jargão de JSON; consulta tools antes de
  afirmar fatos; explica CC-e, divergência e prazo em linguagem de
  operação; oferece próximos passos; nunca pede desculpas de
  tutorial nem repete o schema técnico.
- **RF14 (P1)** Streaming da resposta final: o texto do assistente é
  emitido como `texto_delta` conforme chega (por `chatTextoStream`
  no passo final ou por fatiamento do texto já recebido quando o
  provedor não streamar); `textoFinal` acumula tudo que foi
  emitido.
- **RF15 (P1)** Acoplamento GenUI: após o loop, as tools que
  sinalizaram blocos disparam a composição determinística
  (`comporViewSpecV2Deterministico`) no `pedidoIdResolvido`; os
  blocos saem por eventos `bloco` e a `viewSpec` completa vai no
  `fim`. Sem tool visual consultada, nenhum bloco é composto.

### Endpoint e contrato

- **RF16 (P0)** `POST /api/mandatos/stream` aceita `{comando,
  pedidoId?, historico?}`; `texto` segue aceito como alias de
  `comando` (retrocompatível com o front atual). Mesmas guardas do
  clássico: limite de escrita, `mandatosJanela` por IP, 503 sem LLM,
  body limitado.
- **RF17 (P0)** Eventos SSE: `etapa` (passos legíveis, incluindo o
  que cada tool está consultando), `tool` (`{nome, resumo, status:
  executando|concluida|erro}`), `texto_delta` (`{delta}`), `bloco`
  (`BlocoGenUI`), `fim` (`ResultadoAgente`), `erro`
  (`{status, motivo?, mensagem}`). `concluido` segue emitido com um
  `RespostaMandato` sintetizado (ação `resumir`, resumo = texto
  final) para clientes antigos.
- **RF18 (P0)** Tipos novos em `model.ts`: `TurnoConversa`,
  `ToolExecutada`, `ResultadoAgente` e as variantes novas de
  `EventoStreamMandato`. `etapa.id` passa a `string` livre (era
  união fechada de 4 passos do fluxo antigo).
- **RF19 (P0)** `POST /api/mandatos` intocado: mesmo contrato,
  mesmo comportamento, testes e smoke seguem verdes.

### Frontend

- **RF20 (P0)** `apiOps.ts` envia `historico` (últimos turnos
  `{papel, texto}` montados dos turnos da tela) e entende os eventos
  novos: acumula `texto_delta`, registra `tool`, repassa `bloco` e
  devolve `ResultadoAgente` do `fim`.
- **RF21 (P0)** `PaginaAssistenteIA` renderiza a resposta natural
  com markdown leve e seguro (parágrafos, `**negrito**`, listas
  simples, `` `código` ``) em JSX puro, sem `dangerouslySetInnerHTML`;
  durante a execução mostra as tools em atividade numa trilha
  discreta que se dissolve ao chegar a resposta; blocos GenUI
  seguem no palco abaixo do texto.
- **RF22 (P0)** Visual preservado: `tokens.css` intacto, contraste
  52/52, sem pill badges novas nem padrão `border-left` de slop;
  identificadores e comentários em pt-BR.

## Requisitos não-funcionais

- **NFR1** Zero dependências novas: fetch nativo, validação à mão,
  parser SSE próprio (o parse de frames já existe em `apiOps.ts` no
  front; o servidor escreve o dele, mínimo, sobre `for await` do
  body).
- **NFR2** Timeout e abort: toda chamada LLM respeita
  `LLM_TIMEOUT_MS`; o fechamento da conexão SSE pelo cliente aborta
  o loop (o servidor observa `raw.on('close')`).
- **NFR3** Custo de loop: `MAX_ITERACOES` baixo, tools de leitura
  baratas (uma projeção por chamada), sem re-projeção desnecessária.
- **NFR4** Rate limit e cotas idênticos ao clássico; o agente não
  contorna nenhum limite da spec 0008.
- **NFR5** Testes com LLM mockada por fetch sequenciado, PGlite e
  `buildServer` reais; nenhum teste chama rede.

## Entidades e invariantes

- `TurnoConversa {papel, texto}`: turno da conversa; `papel` só
  `usuario` ou `assistente` (o system prompt não vem do cliente).
- `ToolExecutada {nome, resumo, status}`: registro da trilha visível
  da execução.
- `ResultadoAgente {textoFinal, toolsExecutadas, pedidoIdResolvido?,
  viewSpec?, resultado?}`: payload do evento `fim`; `resultado`
  carrega dados estruturados da última tool relevante (simulação,
  notificação) quando houver.
- Invariante A3 reafirmada: divergência, tarefa, data e valor saem
  só do motor; a LLM escolhe tools e redige prosa, nunca calcula.
- Invariante de isolamento: tools de escrita só agem em pedido cujo
  `workspaceId` é o do cookie da sessão; leitura alcança seed +
  sessão como o resto da API.
- Invariante de auditoria: escritas do agente gravam os mesmos
  eventos que o mandato clássico gravaria (`notificacao`,
  `propagacao`, `mandato`), com ator e intenção reais.

## Critérios de sucesso observáveis

- Pergunta social ("oi") responde em pt-BR natural com `fim`, sem
  422 e sem tool obrigatória.
- "quais pedidos têm divergência?" chama `listar_pedidos` e responde
  com os emitentes e contagens reais da projeção.
- "compare Krona e PackSul" chama `consultar_pedido` duas vezes (ou
  `listar` + duas consultas) e compara fatos reais.
- "e se atrasar 3 dias?" com histórico resolve o pedido do turno
  anterior, roda `simular_cenario` e emite `bloco` de simulador +
  dominó sem nenhum `append` no ledger.
- "avise o CD" na seed explica o bloqueio somente-leitura; na cópia
  da sessão dispara `notificarTarefa` e grava `notificacao`.
- SSE mostra `etapa`/`tool`/`texto_delta`/`bloco`/`fim` na ordem e o
  front digita a resposta em tempo real com a trilha de tools.
- `tsc --noEmit`, build web, testes shared+server e web, guard e
  prose-evals verdes; contraste 52/52.

## Premissas

- O provedor configurado (`LLM_API_URL`) aceita o formato OpenAI de
  tools; quando não aceita, o agente degrada para conversa pura sem
  quebrar o endpoint.
- O front é o único consumidor do SSE novo; o alias `texto` e o
  evento `concluido` cobrem qualquer cliente antigo.
- Custos de tokens crescem com o loop: aceitável dentro da cota por
  IP já existente.

## Perguntas decididas

- Endpoint novo vs. reaproveitar `/api/mandatos`: reaproveitar o
  `/stream` já existente, mantendo `/api/mandatos` clássico intacto.
  Um endpoint, duas gerações de contrato compatíveis.
- Streaming de tool_calls token a token: fora; complexidade sem
  ganho visível, deltas de texto bastam para o efeito de digitação.
- Histórico no servidor: não; stateless por request, o front detém
  a conversa (alinhado ao isolamento por sessão e à LGPD-lite da
  demo: nada de conversa persistida).
