# Brief · frente `hardening`

Escopo: corrigir os achados confirmados das cinco auditorias de 23/11
(SOLID, segurança, TypeScript, testes, brandbook) sobre a `main`, na
ordem P0, P1, P2 da spec 0008. São eles: corrida de idempotência entre
`eventoExiste` e o lock (lock passa a abrir a transação de
`processarDoc`); bypass de cota por rotação de cookie (teto por IP e/ou
cap global, com envs e mensagem pt-BR); `ROTULO_STATUS` do web
resolvendo via `Object.prototype` (Map ou objeto sem protótipo em
todos os lookups por valor externo); IMAP sem listener `error` e com
classificação por regex (listener + `instanceof ErroParser` + log
sanitizado); planilha solitária que gera `pedido: null` (opção
aprovada pinada por teste); `aprovarRevisao` sem cobertura e fila
vazando `workspace_id` (contrato `ItemRevisao` na API); `npm test` sem
a suíte da web; flake do `.eml` (um servidor, duas sessões);
cobertura de `parsePdf`, guardas de `protecao.ts`, `TRUNCATE` e
`chaveTarefa` com `fonteA`/`fonteB`; 413 consistente no smoke público;
cap de expansão do PDF e timeout de LLM; `/api/anchor` sem RPC URL no
503; helper compartilhado doc->divergências->tarefas; tipos
`ResultadoIngest`/`ResultadoAncora`/`TIPOS_DOCUMENTO` com fonte única;
mensagens pt-BR consistentes; `decodeURIComponent` com try;
`noUnusedLocals`; código morto (`compararFontes` importado,
`rotuloTipo`); e os pontos de marca: `synced` do dominó em cor de
coordenação, metadados violeta em cinza mineral, paletas antigas dos
stickers fora (Forseti default), assets mortos da marca antiga fora do
deploy. Tasks T210 a T233, T299.

Paths: `app/server/`, `app/shared/`, `app/web/`, `app/contracts/`,
`app/package.json`, `app/package-lock.json`, `app/tsconfig.json`,
`app/vitest.config.ts`, `specs/0008-blindagem-publica/brief-hardening.md`.
Se a integração aprovar: `site/src/components/domino/`,
`site/src/components/stickers/`, `site/public/assets/`. Não escrever em
`site/` fora desses três paths, nem em `app/seed/`, `docs/`,
`DECISIONS.md`, `BACKLOG.md`, `RULES.md`, `README.md` (escopo-produto),
`lp/`, `.env*`, `specs/` fora desta pasta.

Base: `main` de 23/11 (`58a8454`); branch `wt/hardening`; worktree
`../foundry-wt-hardening` (já criado). Integra antes de qualquer frente
da spec 0007: elas nascem sobre a `main` com esta blindagem.

Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*`, escrever fora dos paths, criar rotas ou capacidades
novas (isso é da spec 0007), mudar `TipoEvento` ou campos vigiados,
afrouxar limite, trigger ou isolamento de workspace, apagar teste sem
substituto, travessão/meia-risca em `.md`.

Gate: `node scripts/repo-guard.mjs` + `node scripts/prose-evals.mjs`
exit 0; `tsc --noEmit` limpo em `app/` e `app/web/` com
`noUnusedLocals` ligado; `npm test` verde executando `shared`,
`server` e `web`; testes novos por achado (cada RF tem a verificação
na linha da task); `eml.test.ts` 10 execuções sem falha; smoke
público `node app/deploy/smoke.mjs` com o item do 413 verde; build do
site limpo se `site/` for tocado.

Reporte: conclusão + evidência `arquivo:linha` por critério, saída de
gate e do smoke, e a decisão tomada nas perguntas abertas (cota de
sessões, planilha solitária, paths de `site/`) na seção abaixo.

## Decisões da frente

- D-H1 (23/11): cota de sessões com os dois mecanismos do RF2. Janela
  fixa por IP (`JanelaFixa`) cobrada só na primeira escrita de um
  workspace ainda vazio, env `RATE_LIMIT_NEW_SESSIONS_PER_10MIN`
  (padrão 10, `config.ts`), mais teto global de workspaces com escrita
  (`MAX_WRITING_WORKSPACES`, padrão 500, `store.workspacesComEscrita`
  não conta a seed). Sessão que já gravou não reconta: trocar de
  cookie deixa de renovar cota sem punir quem já usa a demo.
- D-H2 (23/11): planilha solitária cria a projeção mínima do pedido
  (opção "pedido mínimo" do RF5), não a fila de revisão nem
  `pedido: null`: emitente e destinatário "a confirmar", `itens` e
  `campos` vazios, todas as partes, `criadoEm` do evento. O pedido
  aparece na hora e a divergência emerge quando a NF-e chega. Pinado
  em `app/shared/projection.test.ts`.
- D-H3 (23/11): a serialização do RF1 fica na borda da transação:
  `travarPedido` (`app/server/store.ts`) faz
  `pg_advisory_xact_lock(hashtext(workspace || ':' || pedido))` no
  início de `processarDoc` e de `aprovarRevisao`, antes do
  `eventoExiste`. `registrarDoc` (`app/server/pipeline.ts`) é o helper
  único documento -> divergências -> tarefas usado pelos dois caminhos
  (RF11); o lock interno de `appendVarios` vira no-op aninhado.
- D-H4 (23/11): erros na borda ficam genéricos na resposta e detalhados
  no log (RF10): `/api/anchor` responde motivo fixo
  "falha na ancoragem: provedor de rede indisponivel" e o erro cru do
  provedor vai para `req.log` via callback `onErro` de `ancorar`;
  anexo IMAP e arquivo do seed entram em log/fila só pela forma de
  `nomeAnexoSeguro` (basename, sem controle, truncado em 120).
- D-H5 (23/11): teto de expansão do PDF declarado em `OpcoesPdf` e envs
  `PDF_MAX_PAGINAS` (100), `PDF_MAX_TEXTO_CHARS` (500 mil): estouro é
  `ErroParser` (422), antes de chamar o LLM. Timeout do LLM por
  `AbortSignal.timeout(LLM_TIMEOUT_MS)`, padrão 15 s; estouro vira
  revisão `llm_falhou`, não 500 nem pendura o envio.
- D-H6 (23/11): paths de `site/` aprovados usados só para a marca
  (RF14): `synced` do dominó em `--violet`; metadados `.fic` e
  `.ctl output` em `--ink-faint`; FORSETI vira a paleta default dos
  stickers e `RISO`/`PALETTES`/`PaletteName` saem; assets mortos da
  marca antiga (`foundry-logo.svg`, `foundry-mark.svg`,
  `the-foundry-logo.webp`, `centro-logistico.webp`) removidos após
  grep sem referência. O kit `forseti-lockup-*`/`forseti-simbolo-*`
  fica: é material oficial da spec 0006 e `app/web` usa os símbolos.
- D-H7 (23/11): `app/deploy/smoke.mjs` está fora dos paths da frente.
  A checagem "a seed recusa escrita" usa `i.workspace_id`, campo que o
  T215 tirou do contrato: sem correção ela pula a fila da seed em
  silêncio. Ajuste sugerido para a frente dona/integração: na sessão B,
  que não enviou nada, todo item `pendente` visível é da seed; e
  assert `!('workspace_id' in i)` pinando a não-fuga.

## Evidência (23/11)

### Tarefas

- T210: `store.ts` `travarPedido` + `pipeline.ts` lock antes do
  `eventoExiste`; `pipeline.test.ts`: dois uploads idênticos em
  paralelo gravam um documento, `seq` contínuo, cadeia válida; docs
  diferentes do mesmo pedido não perdem nem duplicam evento.
- T211: `index.ts` cobra `sessoesNovas` por IP e `workspacesComEscrita`
  na primeira escrita; `config.ts` com as duas envs; `protecao.ts` com
  `sessoesNovasDemais`/`demoLotada`; `endurecimento.test.ts`: rotação
  de cookie não renova cota, cota por IP e cap global em 429 pt-BR.
- T212: `web/src/format.ts` com os quatro lookups em `Map` e `textoCru`
  para desconhecidos; `format.test.ts`: `constructor`,
  `hasOwnProperty`, `toString`, `__proto__` renderizam crus.
- T213: `imap.ts` com `client.on('error')`, `instanceof ErroParser` na
  classificação, `simpleParser` falho vai para revisão, infra fica não
  lida; `imap.test.ts` 6 testes; comentário da regex fora de
  `detect.ts`.
- T214: `shared/projection.ts` monta o pedido mínimo em evento de
  planilha (D-H2); `projection.test.ts` 2 testes.
- T215: `store.listarRevisao` seleciona só `id, origem, motivo, payload,
  status, ts` (`ItemRevisao`, `model.ts`); dono via `buscarRevisao`;
  `pipeline.aprovarRevisao` exige o workspace do item; testes:
  serialização sem `workspace_id`, aprovação única, seed protegida.
- T220: `app/package.json` `test` = `vitest run shared server && npm
  --prefix web run test`; suíte da web no gate.
- T221: `eml.test.ts` com um `buildServer` e sessões por cookie; 10
  execuções seguidas, 6/6 verdes em cada, sem flake.
- T222: `pdf.test.ts` 10 casos com `pdf-parse` e `fetch` mockados:
  sem texto, sem `LLM_API_URL`, confiança baixa, HTTP erro, tipo
  inválido, caminho feliz; nenhum toca a rede.
- T223: `protecao.test.ts`: `JanelaFixa` no máximo, chaves isoladas e
  reset na borda da janela; `GuardaEspaco` com medição falhando (deixa
  gravar), acima do teto (507) e reuso dentro da validade.
- T224: `api.test.ts`: `TRUNCATE events` rejeitado pelo trigger com
  `/append-only/` e eventos intactos.
- T225: `matriz.ts` `chaveTarefa` com `fonteA`/`fonteB`; `matriz.test.ts`
  pinando par de fontes distinto com mesma divergência.
- T226: `index.ts` `file.file.truncated` -> 413 após `toBuffer()`;
  `endurecimento.test.ts` sobe socket real e recebe 413, não 422, sem
  gravar nada; smoke local abaixo com o item verde.
- T227: `pdf.ts` tetos de páginas/texto e `AbortSignal.timeout` (D-H5);
  testes de estouro (ErroParser, LLM não chamado) e de timeout
  (`llm_falhou` em menos de 5 s).
- T228: `anchor.ts` motivo fixo + `onErro` para o log; `anchor.test.ts`
  prova corpo limpo sem URL/chave; `imap.ts` e `seed.ts` logam só
  `nomeAnexoSeguro`.
- T230: `registrarDoc` centraliza append + divergências + tarefas;
  `processarDoc` e `aprovarRevisao` o usam; suíte verde.
- T231: `TIPOS_DOCUMENTO` único em `shared/model.ts`, reusado por
  `store.ts` e `projection.ts`; resumo interno renomeado para
  `ResumoIngest` (`ResultadoIngest` segue só o contrato);
  `ResultadoAncora` definido só em `anchor.ts`.
- T232: mensagens da API em pt-BR acentuado consistente; `lerHash` de
  `useTorre.ts` com `try` no `decodeURIComponent`; `noUnusedLocals` e
  `noUnusedParameters` ligados nos dois `tsconfig`, `tsc` limpo;
  `compararFontes` e `rotuloTipo` já fora do código.
- T233: `Domino.module.css` `synced` em `--violet` e metadados em
  `--ink-faint` (contraste medido 4,72:1 sobre papel, AA);
  `fun.ts` com FORSETI default; 4 assets mortos removidos; build do
  site limpo.

### Gates

- `npm test` em `app/`: 16 arquivos, 153 testes passados (1 skip
  pré-existente em `boot.test.ts`) + `web`: 2 arquivos, 27 testes.
- `npx tsc --noEmit` limpo em `app/` e `app/web/` com
  `noUnusedLocals`/`noUnusedParameters`.
- `node --check scripts/repo-guard.mjs` ok; `node
  scripts/repo-guard.mjs`: 11 checks, exit 0; `node
  scripts/prose-evals.mjs`: 0 duras, 7 leves (todas pré-existentes),
  exit 0.
- `npm --prefix web run build` limpo; `npm run build` em `site/`:
  1 página, exit 0, `dist/` sem os 4 assets mortos.
- `eml.test.ts`: 10 execuções consecutivas, exit 0 em todas.
- Smoke ponta a ponta local (`buildServer` + PGlite + seed + socket
  real, `BASE_URL=http://127.0.0.1:8977 node deploy/smoke.mjs`): 11
  passaram, 0 falharam, inclusive "arquivo acima do limite responde
  413 em português". O smoke público depende do redeploy, fora da
  frente; a correção da linha `workspace_id` está em D-H7.
