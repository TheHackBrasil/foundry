# Brief · frente `app-core`

Escopo: núcleo de domínio e ingest da spec 0004: `app/shared/` (modelo,
cadeia de hashes, divergência, regras, projeção, Merkle) e
`app/server/ingest/` (parsers de NF-e, CT-e, eventos fiscais, CSV,
IMAP, PDF por LLM e, se o P-009 for aceito, OCOREN). A primeira versão
foi escrita por Gui na `wt/app-core` em 21/11 e é a base do código
(D-022).
Paths: `app/shared/**`, `app/server/ingest/**`. Não escrever em
`app/server/*.ts` (rotas, store, SSE e pipeline são da `app-infra`),
`app/package.json`, lockfile e `app/tsconfig*.json` (`app-infra`),
`app/web/**` nem `app/seed/**`.
Dependência nova: peça à `app-infra` no Linear.
Contratos: com a `app-infra`, os parsers de `app/server/ingest/`
(`detectarTipo` e um parser por tipo, que lançam `ErroParser` para
entrada ruim); `app/server/pipeline.ts` os chama e grava. Com a
`app-demo`, os tipos de resposta de `app/shared/model.ts`
(`ResultadoIngest`, `ProjecaoPedido`, `RespostaAuditoria`,
`RespostaSimulacao`). Parser não grava e não loga cabeçalho de `.eml`
(traz endereço de pessoa, RF27).
Base: `main` com spec 0004 commitada; branch `wt/app-core`; worktree
`../foundry-wt-app-core`.
Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*` no repo, escrever fora dos paths, dado real de empresa ou
de pessoa nos testes.
Gate: `node scripts/repo-guard.mjs` e `node scripts/prose-evals.mjs`
exit 0; `npm run typecheck` limpo; `npm test` verde; corpus da seed
parseia com campos corretos; XML inválido rejeita com erro explícito;
CC-e nunca vira atraso (R-006); `.eml` com a NF-e em anexo gera os
mesmos eventos que o upload do XML; a verificação da cadeia nomeia o
evento adulterado.
Reporte: conclusão + evidência `arquivo:linha` e saídas de comando por
critério; "feito" sem evidência não é feito.

## Decisões da frente

- **D-C1 (D)**: sem Docker na máquina, o store cai para PGlite
  (Postgres real em WASM, `@electric-sql/pglite`) quando
  `DATABASE_URL` não está definida; com a variável, usa `pg` Pool.
  Mesma interface `Db` nos dois lados (`app/server/db.ts:7`). A
  trigger append-only é testada de verdade, sem mock.
- **D-C2 (D)**: seq por pedido serializada com
  `pg_advisory_xact_lock(hashtext(pedido_id))` dentro da tx
  (`app/server/store.ts:99`). `FOR UPDATE` não bastaria: a tx
  concorrente não enxerga a linha nova e calcularia o mesmo seq.
- **D-C3 (D)**: doc + divergências + tarefas gravados numa única tx
  (`app/server/pipeline.ts:52`). Falha no meio não deixa doc sem
  tarefa nem divergência duplicada por corrida.
- **D-C4 (D)**: reingestão idêntica é no-op por igualdade `jsonb`
  (`app/server/store.ts:146`), não por texto serializado, que
  dependeria de ordem de chaves e espaçamento.
- **D-C5 (D)**: `events` tem triggers anti UPDATE/DELETE por linha e
  anti TRUNCATE por statement (`app/server/store.ts:38` a `48`). O
  audit reconta a cadeia e, havendo âncora, confere o Merkle root
  atual contra o ancorado (`app/server/index.ts:87`), o que pega
  truncamento de cauda que a cadeia sozinha não vê.
- **D-C6 (D)**: divergência é derivada e gravada como evento, não só
  computada na leitura: cada doc novo compara com a última declaração
  de cada outra fonte e grava `divergencia` + `tarefa` no ledger
  (`app/server/pipeline.ts:52` a `78`), o que propaga via SSE como
  evento normal.
- **D-C7 (D)**: aprovação na fila de revisão reingere o doc guardado
  como se tivesse acabado de chegar, forçando aceite
  (`app/server/pipeline.ts:85`); descarte só marca o status.
- **D-C8 (R)**: IMAP marca `\Seen` só depois do processamento do
  anexo; doc rejeitado por parser vai para a fila de revisão e erro
  de infra deixa a mensagem não lida para o próximo ciclo
  (`app/server/ingest/imap.ts:56` a `78`).
- **D-C9 (R)**: âncora grava evento `ancora` só com receipt
  `status === 1`; sem RPC/chave/contrato ou tx revertida, devolve
  `ok:false` com motivo e o ledger local segue
  (`app/server/anchor.ts:62` a `67`).
- **D-C10 (P)**: `app/vitest.config.ts` não está nos paths da frente;
  a exclusão de `contracts/` dos testes ficou no filtro posicional do
  script (`app/package.json`, `vitest run shared server`). Pedido à
  integração: incluir um config central se a demo quiser vitest na raiz.
- **D-C11 (P)**: CORS aberto e rotas de escrita sem auth são escopo
  de demo local; endurecer (token ou bind localhost) fica para a
  integração se a demo for exposta.
- **D-C12 (D)**: `.eml` entra como formato (RF28, D-021). `detectarTipo`
  reconhece a extensão ou, fora de `.xml`, um `MIME-Version:` ou
  `Content-Type: multipart/` no começo de linha nos primeiros 2 KB
  (`app/server/ingest/detect.ts`). `extrairAnexos`
  (`app/server/ingest/eml.ts`) devolve só anexos `.xml`, `.csv` e `.pdf`
  (ou o content-type equivalente; um `.xlsx` derruba o e-mail com o 422
  de D-C13), no máximo 10 por e-mail e 5 MB cada, renomeados
  `anexo-N.<ext>` e com a NF-e antes do CT-e. E-mail
  dentro de e-mail é rejeitado, sem recursão. Nenhum cabeçalho é lido,
  devolvido nem repetido em erro (RF27); o erro do `mailparser` também
  não é repassado, porque pode citar trecho da mensagem. Tipo de anexo
  desconhecido derruba o e-mail antes de gravar qualquer um; um erro de
  parser num anexo depois de outro já gravado deixa o anterior no
  ledger, e reenviar é seguro porque a reingestão é no-op (D-C4). Em
  `app/server/pipeline.ts` (frente app-infra) entrou só o `case 'eml'`
  de `ingerir`, que passa cada anexo pelo mesmo caminho do upload solto.
- **D-C13 (D)**: o leitor de XLSX sai do MVP e a planilha fica só em
  CSV. `xlsx@0.18.5` da npm tem ReDoS (CVE-2024-22363) e prototype
  pollution, e a correção só sai pela CDN da SheetJS. Duas trocas foram
  medidas antes de remover. `exceljs@4.4.0` traz 193 pacotes (50 MB) e
  o `npm audit` acusa 2 vulnerabilidades moderadas (`uuid`).
  `read-excel-file@9.3.14` fecha o audit em 0 e traz 7 pacotes, mas em
  teste local arquivo pequeno derrubou o processo: um `.xlsx` de 39 KB
  com referência de célula absurda consumiu cerca de 2 GB de memória, um
  de 2,3 MB com 200 mil atributos num elemento levou cerca de 70 s, uma
  folha de 15 MB só de linhas vazias levou cerca de 52 s e um zip de
  411 KB que infla para 400 MB levou cerca de 70 s, todos terminando em
  `RangeError`. Limite de tamanho não resolve, porque o de 39 KB passa em
  qualquer teto. A demo pública recebe arquivo de qualquer visitante, e
  um processo só atende o juiz, então `.xlsx` e `.xls` viram 422 com
  "exporte a planilha como CSV" (`app/server/ingest/detect.ts`). O texto
  casa com `nao suportad` em `imap.ts`, que manda o anexo para a fila de
  revisão em vez de retentar para sempre. Como o erro sai de
  `detectarTipo`, um `.eml` com NF-e e `.xlsx` falha inteiro antes de
  gravar. Caminho de volta, se a demo precisar de XLSX: ler a planilha
  num `worker_threads` com `resourceLimits` e timeout, mais checagem dos
  tamanhos do diretório central do zip antes de inflar.
  Documentos que diziam CSV/XLSX (RF6, `plan.md`, T031, `app/README.md`,
  P-010) foram ajustados na integração (D-025).

## Evidência por critério do gate

- `tsc --noEmit` limpo: `npm run typecheck` sem saída de erro.
- Testes: `npm test` -> `Test Files 5 passed (5)`, `Tests 38 passed (38)`.
- Contrato: `npx hardhat test` em `app/contracts/` -> 4/4 passando
  (emit, get, root repetido não sobrescreve).
- Cadeia válida, adulteração nomeia o 1o evento afetado e cadeia
  vazia é válida: `app/shared/chain.test.ts`, `verificarCadeia` em
  `app/shared/chain.ts:51`.
- NF-e seed parseia chave 44, emitente, destinatário, itens, peso e
  data: `app/server/ingest/nfe.ts` + `server/fixtures/nfe-ok.xml`;
  teste `parsers` em `app/server/api.test.ts`.
- XML inválido -> 422 `{erro, tipo:"parser"}` explícito, não 500:
  `app/server/index.ts:52` a `56`; teste "XML invalido responde 422".
- CT-e vincula ao pedido pela chave NF-e em `infDoc/infNFe`:
  `app/server/ingest/cte.ts`.
- CC-e (110110) é evento informativo, com o texto da correção e sem
  campos observados (R-006, corrigido em 21/11); cancelamento (110111)
  vira status `cancelada`: `app/server/ingest/eventos.ts`.
- UPDATE/DELETE manual rejeitado por trigger e bypass via
  `DISABLE TRIGGER ALL` é pego pelo audit nomeando `seq`: testes
  "trigger do banco rejeita" e "bypass da trigger" em
  `app/server/api.test.ts`; triggers em `app/server/store.ts:38` a `48`.
- Dois clientes SSE recebem evento em <1s: `app/server/sse.test.ts`;
  hub em `app/server/sse.ts`.
- `POST /api/simulate` devolve tarefas sem gravar (RF12):
  `app/server/index.ts:99`; `REGRAS_PROPAGACAO` em
  `app/shared/rules.ts:13`.
- Doc sem pedido vai para `review_queue`, não 500; aprovação
  reingere: `app/server/pipeline.ts:26` a `35` e `85`.
- `POST /api/anchor` sem credenciais -> 503 com `motivo` declarado e
  `root` computado: `app/server/anchor.ts`; teste "anchor sem config".
- Seed idempotente e ordenada por tipo (NF-e primeiro):
  `app/server/seed.ts`; saída `5 doc(s) processados` na mesma chave.
- `node scripts/repo-guard.mjs` exit 0 (11 checks); `prose-evals`
  0 duras, 2 leves pré-existentes.

## Pendências conhecidas (para a integração)

- Deploy real na Base Sepolia exige `ANCHOR_PRIVATE_KEY` +
  `BASE_SEPOLIA_RPC_URL` + `ANCHOR_CONTRACT_ADDRESS` locais;
  `npm run deploy` em `app/contracts/` publica e imprime a URL do
  basescan. Sem chave não há tx visível; o caminho está implementado
  e testado em rede local hardhat.
- Postgres real via `app/docker-compose.yml` não foi validado aqui
  (sem Docker); PGlite cobre os mesmos testes.
- Extração de PDF por LLM implementada (OpenAI-compatible via
  `LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL`); sem provider, todo PDF vai
  para a fila de revisão com motivo `llm_nao_configurada`.
- `dev:all` em `app/package.json` pressupõe `app/web/` da frente
  app-demo; sem ela, `npm run dev` sobe só a API.
- Cancelamento e CC-e compartilham `fonte: 'cce'` em `eventos.ts`. Efeitos:
  o cancelamento aparece como "CC-e" nas divergências e nas tarefas, e uma
  CC-e que chega depois (campos vazios) substitui o estado da fonte em
  `camposPorFonte` e `consolidarCampos`, apagando o status `cancelada`.
  Caminhos: uma `FonteDocumento` própria para o cancelamento (mexe em
  `model.ts` e nos rótulos da web) ou não deixar um documento sem campos
  substituir o estado da fonte em `projection.ts`.
- `app/server/fixtures/cancelamento.xml` tem `dhEvento` cerca de 46 h depois
  da emissão da NF-e: o seed demonstra um cancelamento que a tarefa fiscal
  do atraso diz não caber (limite de 24 h sem circulação da mercadoria).
- O ledger é append-only: tarefas já gravadas mantêm o texto antigo. Só um
  seed em banco limpo gera os textos novos de `app/shared/rules.ts`.
