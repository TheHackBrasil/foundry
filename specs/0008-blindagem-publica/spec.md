# Spec 0008: blindagem da demo pública (achados de auditoria)

**Status:** rascunho (aguarda aprovação do usuário)
**Origem:** cinco auditorias independentes de código, executadas em 23/11
sobre a `main` (SOLID, segurança, TypeScript, cobertura de testes e
conformidade com o Brandbook v4) · falha do smoke público de 23/11
(P-008, item 13 do `BACKLOG.md`)
**Data:** 2026-11-23

## Problema e resultado esperado

A demo está no ar e o juiz testa sozinho, com os arquivos dele. As
auditorias acharam defeitos que a suíte atual não pega: uma corrida de
idempotência que duplica evento em upload simultâneo, um bypass da
cota por rotação de cookie, um lookup no web que devolve métodos de
`Object.prototype` para valores vindos da planilha, e um processo que
pode cair por um erro assíncrono do IMAP. Há ainda buracos de cobertura
justo nos caminhos probabilísticos (PDF por LLM, fila de revisão) e
resíduos da marca antiga nas superfícies públicas. Quando isto estiver
pronto, cada achado confirmado tem correção e teste que o prende, e
nenhum caminho novo deixa de funcionar quando a demo estiver sob o
dedo do juiz.

## Fora de escopo

- Funcionalidade nova: nenhuma capacidade entra aqui. A camada AI
  (mandatos, xlsx, sinais, contatos, Nvoip, view-spec) é a spec 0007,
  que integra depois desta.
- Mudança de modelo: `TipoEvento`, campos vigiados e regras de
  propagação não são tocados.
- Refatoração estética sem bug associado: só entra o que as auditorias
  acharam ou o que a correção de um achado exige no mesmo arquivo.
- Autenticação de verdade, contas e login: a demo segue pública sem
  login (RF24 da spec 0004); a proteção continua por sessão e cota.
- Reescrita do IMAP como serviço separado ou fila persistente de
  polling.
- Redesenho das telas: os itens de marca são correções pontuais de
  tokens e assets, não uma passagem nova de identidade (a v4 já é da
  spec 0006).
- CI, workflows e tracker externo: a fila é o `BACKLOG.md`, a
  validação é local (AGENTS.md).

## Histórias

### US1: juiz testa a demo com os próprios arquivos e ela não quebra

- **Dado** a URL pública **Quando** o juiz sobe o mesmo arquivo duas
  vezes em paralelo **Então** o ledger recebe um único documento, sem
  evento duplicado nem buraco de `seq`.
- **Dado** a mesma URL **Quando** ele sobe uma planilha com `status`
  valendo `constructor` ou `__proto__` **Então** a tela renderiza o
  rótulo cru em vez de travar.
- **Dado** um upload acima do limite **Quando** o servidor responde
  **Então** o código é 413 com mensagem em pt-BR, no JSON e no
  multipart, na borda local e na URL pública.

### US2: avaliador técnico audita a demo como quem opera

- **Dado** um atacante sem cookie **Quando** repete envios trocando de
  sessão a cada um **Então** a cota deixa de ser zerada: a sessão nova
  para de escrever quando o teto de criação por IP ou o teto global de
  workspaces é atingido.
- **Dado** o processo com IMAP configurado **Quando** a conexão IMAP
  emite `error` fora do ciclo do polling **Então** o erro fica no log
  e o processo segue em pé.
- **Dado** uma âncora sem configuração ou com RPC falhando **Quando**
  a resposta 503 sai **Então** o corpo não traz a URL da RPC nem
  segredo do ambiente.

### US3: quem lê o código encontra um só lugar para cada coisa

- **Dado** o pipeline de documento **Quando** o avaliador compara
  `processarDoc` e `aprovarRevisao` **Então** o bloco
  documento->divergências->tarefas existe uma vez só.
- **Dado** `ResultadoIngest`, `ResultadoAncora` e `TIPOS_DOCUMENTO`
  **Quando** procura a definição **Então** cada um tem uma única fonte
  e os demais pontos reutilizam.

### US4: juiz vê a marca certa nas superfícies públicas

- **Dado** o dominó e os stickers do site **Quando** olha os estados
  **Então** o estado sincronizado usa a cor de coordenação da v4, os
  metadados usam cinza mineral e os stickers usam a paleta Forseti,
  sem paleta da marca antiga nem asset morto no deploy.

## Casos de borda

- Lock por `workspace+pedido` antes da checagem de existência: dois
  uploads idênticos em paralelo serializam no advisory lock e o
  segundo vira no-op idempotente, não evento repetido.
- `status` da planilha igual a `hasOwnProperty`, `toString`,
  `constructor` ou `__proto__`: o rótulo renderiza como texto cru;
  nenhum lookup de rótulo indexa objeto com protótipo.
- Workspaces criados por IP em janela: acima do teto, a sessão nova
  ainda lê a seed mas não escreve; o teto global de workspaces com
  escrita é a segunda trava e responde 429 com mensagem de casa
  cheia.
- Erro `instanceof ErroParser` dentro do IMAP vai para a fila de
  revisão e marca a mensagem como lida; qualquer outro erro é infra
  e deixa a mensagem não lida para o próximo ciclo.
- Planilha como primeiro documento do pedido: `pedido` mínimo na
  projeção, pinado por teste (decidido).
- PDF que expande demais ao extrair texto ou LLM que não responde:
  o envio falha declarado e o item vai para a revisão, nunca trava
  o processo nem fica pendurado.
- `location.hash` com sequência `%` inválida: `decodeURIComponent`
  não derruba a tela.

## Requisitos funcionais

Prioridades: **P0** = corretude e disponibilidade que o juiz dispara;
**P1** = robustez e cobertura; **P2** = polimento que o juiz lê.

### Corretude e disponibilidade (P0)

- **RF1 [P0]**: fim da corrida de idempotência. A transação de
  `processarDoc` abre com `pg_advisory_xact_lock(hashtext(workspace || ':' || pedido))`
  antes do `eventoExiste` (`app/server/pipeline.ts:57`; hoje o lock só
  existe dentro de `appendVarios`, `app/server/store.ts:136`). Dois
  uploads simultâneos do mesmo arquivo gravam um único documento.
- **RF2 [P0]**: a rotação de cookie não zera a cota. Sem cookie válido,
  `index.ts:143` emite UUID novo e `uso()` volta sempre zero. Correção:
  teto de sessões novas por IP por janela, cap global de workspaces
  com escrita, ou os dois; o mecanismo escolhido fica registrado como
  decisão. O teste prova que N envios sem cookie do mesmo IP param de
  criar sessão nova com direito a escrita.
- **RF3 [P0]**: `ROTULO_STATUS` do web não resolve via protótipo
  (`app/web/src/format.ts:43`). Vira `Map` (o padrão já usado em
  `app/shared/formato.ts:20`) ou objeto sem protótipo; todos os
  lookups de rótulo indexados por valor vindo de fora seguem a mesma
  regra. `formatarValor('status', 'constructor')` devolve
  `'constructor'`.
- **RF4 [P0]**: IMAP seguro de verdade. `client.on('error')` registrado
  antes do `connect` (hoje ausente em `app/server/ingest/imap.ts`:
  erro no emitter vira `uncaughtException` e derruba o processo). A
  classificação documento ruim x falha de infra sai da regex sobre
  mensagem humana (`imap.ts:73`) e passa a `instanceof ErroParser`;
  erro de `simpleParser` vira `ErroParser` como em `eml.ts`. O
  comentário de `detect.ts:14` sobre o texto `nao suportad` morre
  junto com a regex.
- **RF5 [P0]**: planilha sozinha não produz `pedido: null`. Hoje
  `processarDoc` trata `planilha` como criadora de pedido
  (`pipeline.ts:45`) mas `projetar` só monta `pedido` no evento `nfe`
  (`projection.ts:70`), então uma planilha solitária cria eventos e a
  projeção responde `pedido: null`. Comportamento pinado por teste
  na opção decidida: `pedido` mínimo na projeção, com emitente e
  destinatário "a confirmar" e campos consolidados vazios.
- **RF6 [P0]**: `aprovarRevisao` coberto por teste (aprovar grava o
  documento no workspace que enfileirou, a segunda aprovação falha, o
  item da seed não é aprovável pela API) e a fila de revisão não vaza
  a row crua: `GET /api/revisao` serializa `ItemRevisao`
  (`app/shared/model.ts:124`) sem `workspace_id`; o uso interno do
  campo (`pipeline.ts:93`, `index.ts:334`) segue por consulta interna
  separada do contrato.

### Robustez e cobertura (P1)

- **RF7 [P1]**: `npm test` executa a suíte da web. O script atual
  (`app/package.json`: `vitest run shared server`) não roda os testes
  de `app/web` (hoje `matriz.test.ts` com 16 casos). O gate passa a
  incluir a suíte da web na mesma invocação.
- **RF8 [P1]**: fim do flake do `.eml`. `eml.test.ts` sobe um
  `buildServer` por teste (dois por caso, ~1,4 s cada, contra timeout
  de 5 s). Os casos passam a dividir um único servidor com dois
  cookies de sessão distintos, que resolve a isolação que o segundo
  servidor garantia.
- **RF9 [P1]**: cobertura nos caminhos cegos: `parsePdf` (0% hoje; sem
  texto extraível, sem LLM configurada, confiança baixa, falha de
  HTTP, campo com tipo inválido), guardas de `protecao.ts`
  (`JanelaFixa` no limite e na poda, `GuardaEspaco` com medição
  falhando), trigger `TRUNCATE` em `events` (UPDATE e DELETE já têm
  teste; TRUNCATE não), `chaveTarefa` distinta para divergências com
  `fonteA`/`fonteB` diferentes (a chave atual,
  `app/web/src/matriz.ts:124`, ignora as fontes e colapsa tarefas
  distintas).
- **RF10 [P1]**: erros honestos na borda. Upload acima do limite
  responde 413 em todo caminho (a falha do smoke de 23/11, P-008 e
  item 13 do `BACKLOG.md`, investigada e corrigida na raiz). PDF com
  expansão absurda ao extrair texto vira item de revisão ou 422, com
  teto declarado de páginas/texto. Chamada de LLM tem timeout
  (`AbortSignal.timeout`, padrão sugerido 15 s, configurável por env).
  O 503 de `/api/anchor` não devolve a URL da RPC nem parte da chave
  (`anchor.ts:75` hoje repassa `e.message`, que o ethers pode preencher
  com o endpoint): o detalhe fica no log, a resposta fica genérica.
  Nomes de anexo que entram em log IMAP (`imap.ts`, `index.ts:375`)
  passam por sanitização: basename, sem caracteres de controle,
  truncados.

### Polimento (P2)

- **RF11 [P2]**: helper compartilhado para o bloco documento ->
  divergências -> tarefas, hoje duplicado entre `processarDoc`
  (`pipeline.ts:51`) e `aprovarRevisao` (`pipeline.ts:96`).
- **RF12 [P2]**: tipos com fonte única. `ResultadoIngest` existe em
  `app/shared/model.ts:133` (contrato da API) e em
  `app/server/pipeline.ts:20` (resumo interno com `eventos: Evento[]`);
  `ResultadoAncora` existe em `model.ts:141` e `anchor.ts:9`;
  `TIPOS_DOCUMENTO` existe em `store.ts:61` e de novo como
  `FONTES_DOC` em `projection.ts:18`. Cada um passa a ter uma única
  definição reutilizada pelas duas camadas.
- **RF13 [P2]**: higiene do contrato TS: mensagens de erro da API em
  pt-BR consistente (hoje `pedido nao encontrado` sem acento convive
  com mensagens acentuadas); `decodeURIComponent` de
  `useTorre.ts:19` com tratamento de hash malformado;
  `noUnusedLocals`/`noUnusedParameters` ligados no `tsconfig` com o
  código ajustado; código morto removido (`compararFontes` importado
  sem uso em `pipeline.ts:4`, `rotuloTipo` exportado sem uso em
  `app/web/src/format.ts:41`).
- **RF14 [P2]**: marca v4 sem resíduo da marca antiga nas superfícies
  públicas: o estado `synced` do dominó sai do verde `--ok` para a cor
  de coordenação (`site/src/components/domino/Domino.module.css:56`);
  os metadados do dominó que usam `--violet` (`Domino.module.css:13`,
  `:16`) passam ao cinza mineral, porque violeta é reservado ao sinal
  de coordenação; as paletas nomeadas antigas dos stickers
  (`site/src/components/stickers/fun.ts:28`: riso, candy, matcha,
  sunset, clay, aqua) saem de cena e o default passa a ser a paleta
  Forseti; assets mortos da marca antiga (logo Foundry antigo,
  `the-foundry-logo.webp`, restos de sticker/pitch sem referência) saem
  do material publicado depois de confirmada a ausência de
  referências.

## Requisitos não-funcionais

- **NFR-dados:** nenhum dado novo; as correções preservam o ledger de
  produção (append-only, A9). Nenhuma migration numerada: os ajustes
  de tabela, se houver, seguem o padrão DDL idempotente de `store.ts`.
- **NFR-autorização/publicação:** nenhum segredo em código, teste ou
  log; mensagens de erro públicas não carregam detalhe interno (A2, a
  regra que o 500 já segue em `index.ts:116`).
- **NFR-privacidade:** logs de IMAP e fila de revisão não expõem nome
  de anexo cru nem `workspace_id` de outra sessão (A5, RF27 da 0004).
- **NFR-demo:** nenhum comportamento visível piora: mensagens de erro
  seguem em pt-BR e os limites respondem com a mesma voz de hoje (A7).
- **NFR-a11y:** os itens de marca mantêm o contraste medido da v4;
  nenhum estado passa a depender só de cor (A6).
- **NFR-idioma:** pt-BR na prosa e nas mensagens; identificadores em
  inglês (A6).
- **NFR-domínio:** a lógica de divergência, cadeia e projeção segue
  pura em `app/shared/`; efeitos ficam na borda (A3).

## Entidades e invariantes

- `app/server/pipeline.ts`: `processarDoc` ganha o advisory lock no
  início da transação; o bloco doc->divergências->tarefas vira helper
  único usado também por `aprovarRevisao`.
- `app/server/store.ts`: `TIPOS_DOCUMENTO` deixa de ser duplicado; a
  fila de revisão tem leitura de contrato (`ItemRevisao`) separada da
  leitura interna com `workspace_id`.
- `app/server/index.ts`: emissão de cookie ganha contabilidade de
  sessões novas por IP e/ou teto global de workspaces; `/api/anchor`
  sanitiza o motivo do 503.
- `app/server/ingest/imap.ts`: listener `error`, classificação por
  `ErroParser`, nomes sanitizados no log.
- `app/web/src/format.ts`: lookups de rótulo via `Map` ou objeto sem
  protótipo; `rotuloTipo` morto sai.
- `app/package.json`: `npm test` cobre `shared`, `server` e `web`.
- `site/src/components/domino/` e `site/src/components/stickers/`:
  correções pontuais de tokens e paleta; os paths entram na frente
  `hardening` (decidido, com a `site-forseti` parada).
- Invariantes que não mudam: `events` append-only com triggers, hash
  encadeado por pedido, isolamento por workspace, seed só leitura pela
  API, erros de parser como 422 e erros internos sem vazamento.

## Critérios de sucesso observáveis

- [ ] Dois uploads simultâneos e idênticos gravam um documento só;
      `seq` sem buraco e `audit` válido (teste de concorrência novo).
- [ ] Envios repetidos sem cookie do mesmo IP param de zerar o uso;
      a resposta ao exceder o teto é 429 em pt-BR.
- [ ] Planilha com `status: constructor` não trava a tela; teste de
      `formatarValor` e um smoke provam.
- [ ] Processo com IMAP configurado sobrevive a erro emitido pelo
      cliente; classificação por `ErroParser` com teste.
- [ ] Planilha sozinha tem comportamento pinado por teste na opção
      escolhida; a decisão fica registrada.
- [ ] `aprovarRevisao` com teste de aprovação única; `GET /api/revisao`
      serializa sem `workspace_id`.
- [ ] `npm test` executa `shared`, `server` e `web` e falha se qualquer
      uma quebrar.
- [ ] `eml.test.ts` com um servidor só e sem flake em 10 execuções.
- [ ] `parsePdf`, guardas de `protecao.ts`, `TRUNCATE` e `chaveTarefa`
      com testes novos verdes.
- [ ] Upload grande responde 413 na URL pública (smoke refeito, item
      P-008 fechado); 503 de âncora sem RPC URL no corpo.
- [ ] `tsc --noEmit` limpo com `noUnusedLocals`; guard e prose-evals
      exit 0.
- [ ] Domino e stickers na marca v4: `synced` em violeta de
      coordenação, metadados em cinza, paletas antigas fora do
      bundle, assets mortos fora do deploy.

## Premissas

- O worktree `../foundry-wt-hardening` (branch `wt/hardening`) já
  existe, criado sobre a `main` de 23/11, e recebe a frente inteira.
- Os achados das auditorias foram conferidos contra o código na
  escrita desta spec; cada RF cita arquivo e linha do achado.
- A spec 0008 integra antes da 0007 (blindagem primeiro); as frentes
  da 0007 nascem sobre a `main` já blindada.
- PGlite em memória segue como banco da suíte (D-024); o teste de
  concorrência do RF1 usa a mesma base dos testes atuais.

## Perguntas decididas

- Planilha como primeiro documento: `pedido` mínimo na projeção
  (emitente/destinatário "a confirmar", itens vazios, campos
  consolidados). A planilha é o papel de ERP/WMS (RF6 da spec 0004)
  e pode chegar antes da NF-e sem ser erro. Decisão do usuário,
  23/11.
- RF2: os dois. Teto por IP por janela cobre o abuso concentrado; o
  cap global de workspaces com escrita cobre o distribuído e
  responde "demonstração lotada". Decisão do usuário, 23/11.
- Itens de marca em `site/` (RF14): os paths ficam na frente
  `hardening`, com a `site-forseti` parada. Decisão do usuário,
  23/11.
