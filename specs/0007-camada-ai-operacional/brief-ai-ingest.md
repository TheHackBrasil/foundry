# Brief · frente `ai-ingest`

Escopo: tudo que entra por arquivo na camada AI (spec 0007). O `.xlsx`
volta pelo caminho literal de D-028: leitura em `worker_threads` com
`resourceLimits` e timeout, checagem estrutural do zip antes de inflar
(diretório central, razão de expansão, nº de arquivos, tamanho
declarado), sem a lib `xlsx` (CVE-2024-22363 + prototype pollution).
Decidido: `exceljs` pinned (>7 dias publicado), porque datas do Excel
são seriais e a conversão precisa de valores formatados. O worker lê
a primeira planilha (ou a de cabeçalho esperado) e emite texto CSV
(data serial sai `AAAA-MM-DD`); o texto entra no `parseCsv` sem
mudança, que segue o único parser tabular. Saída = `DocData[]` fonte
`planilha`. Falha estrutural (fórmula sem cache, mesclada ambígua,
cabeçalho irreconhecível) não falha solto nem some linha: vai para a
revisão com motivo, pelo caminho de RF11. Depois: `detectarTipo`
reconhece a extensão, `pipeline.ts` despacha, `.eml`/IMAP seguem o
mesmo caminho e `seed.ts` entra `.xlsx` na ordem. Também: validação
de tipo dos campos extraídos por LLM em `pdf.ts` (tipo inválido
normalizado ou descartado com registro, essencial inválido para a
revisão, nunca `NaN` em `CamposObservados`); `eml.ts` devolve corpo
de texto e `eventos.ts` expõe o texto da correção; a fiação dos
sinais: `pipeline.ts` chama `extrairSinais` de `app/server/sinal.ts`
e emite evento `sinal` por pedido existente (corpo nunca para ledger
nem log; sinal nunca declara campo vigiado, R-006); o fio do layout
desconhecido (RF11): pipeline manda a planilha não-mapeada para a
revisão com a proposta de `mapeamento.ts` anexa, a aprovação ingere
com o mapeamento e o template reaplica direto para o mesmo
remetente. Fixtures novas: `planilha.xlsx` equivalente à
`planilha.csv`, `.xlsx` de layout fora do schema, `.eml` com corpo,
CC-e com `xCorrecao` de reagendamento. E o fio de notificação por
env global `NVOIP_NOTIFY_ON_TASK` (decidido, desligada por padrão):
`pipeline.ts` chama `nvoip.ts` ao criar tarefa propagada cuja parte
tem contato com canal compatível. E o fone do endereço fiscal da
NF-e (`emitente.fone`) e da CT-e (`transportadora.fone`) alimenta
`bootstrapContatos`: idempotente, nunca sobrescreve contato manual
(RF7).
Tasks T120 a T124, T140 a T142.

Ordem: a spec 0008 integra inteira antes desta frente começar (a base
já vem com o lock de idempotência e o helper doc->divergências->tarefas
da `hardening`; não refaça o que ela fez). Os fios do pipeline (T140,
T141) só escrevem depois que a `ai-mandatos` integra `model.ts` com os
tipos novos, `sinal.ts` e `nvoip.ts` na `main` (T110-T112 e T133).
Enquanto isso não acontece, T120-T123 seguem sem depender de nada dela.

Paths: `app/server/ingest/`, `app/server/pipeline.ts`,
`app/server/seed.ts`, `app/server/fixtures/`, `app/package.json`,
`app/package-lock.json`, `specs/0007-camada-ai-operacional/brief-ai-ingest.md`.
Não escrever em `app/server/index.ts`, `app/server/store.ts`,
`app/server/config.ts`, `app/server/protecao.ts`, `app/server/llm.ts`,
`app/server/{mandatos,contatos,nvoip,sinal,viewspec}.ts`,
`app/shared/` (ai-mandatos; exceção: nenhuma), `app/web/`, `docs/`,
`app/server/mapeamento.ts` (ai-mandatos; esta frente só chama
`proporMapeamento`/`aplicarTemplate` depois de T136 na main),
`DECISIONS.md`, `BACKLOG.md`, `.env*`.

Base: `main` depois da integração da `wt/hardening` (spec 0008); branch
`wt/ai-ingest`; worktree `../foundry-wt-ai-ingest`.

Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*`, escrever fora dos paths, usar a lib `xlsx`, adicionar
dependência sem justificar versão pinned com dias de publicação,
mandar corpo de e-mail ou de CC-e para o ledger/log, deixar a LLM
escrever campo vigiado, travar o event loop com parse de zip,
travessão/meia-risca em `.md`.

Gate: `node scripts/repo-guard.mjs` + `node scripts/prose-evals.mjs`
exit 0; `tsc --noEmit` limpo; `npm test` verde; testes: `.xlsx`
legítimo = eventos do CSV; zip malformado/falso `.xlsx`/expansão
absurda = 422 sem travar e sem inflar; `peso_kg:"12kg"` não vira `NaN`;
`.eml` e CC-e com reagendamento geram `sinal` sem mexer em campo
vigiado; R-006 verde; tarefa propagada com contato e gatilho ligado
gera `notificacao` (sem env, nada acontece); sem `LLM_API_URL` nada
muda; layout desconhecido aprovado vira template por remetente e o
arquivo seguinte entra direto; fone fiscal bootstrapa contato sem
tocar o manual.

Reporte: conclusão + evidência `arquivo:linha` por critério, decisão
`exceljs` x parser próprio com a evidência dos testes, saída de gate.

## Decisões da frente

- D-G1 (23/11): `exceljs` 4.4.0 pinned como leitor do `.xlsx`, em vez
  de parser próprio de OOXML. Publicado em 19/10/2023, mais de três
  anos antes do uso, dentro da regra de sete dias. Motivo: data do
  Excel é serial e o valor correto depende do `numFmt` da célula; o
  exceljs devolve `Date` pronto e o worker formata `AAAA-MM-DD`
  (`xlsx.worker.ts:30`). Um parser próprio reimplementaria inflate,
  `sharedStrings` e formatos numéricos, exatamente a superficie que
  D-028 mandou tirar do processo principal. Alternativa avaliada e
  descartada: a lib `xlsx` (CVE-2024-22363 + prototype pollution,
  proibida por D-028). Evidência: `xlsx.test.ts` prova equivalência
  documento a documento e evento a evento com `planilha.csv`, data
  serial em `AAAA-MM-DD` e escolha da planilha pelo cabeçalho.
- D-G2 (23/11): um worker por vez, em fila serial dentro de
  `xlsx.ts:149-192`. Dois arquivos com o teto de `resourceLimits`
  abririam ~2x o limite de heap e poderiam derrubar o processo da
  demo; a fila serializa a leitura e o custo é um `.xlsx` por vez, que
  o volume do upload (15 MB/dia por sessão) já limita.
- D-G3 (23/11): o `remetente` do template de mapeamento (T124) é o
  nome do arquivo sanitizado por `nomeAnexoSeguro`
  (`pipeline.ts:317`). Upload, IMAP e seed não carregam cabeçalho de
  quem enviou, e criar um identificador novo exigiria tocar paths
  fora da frente; o nome do arquivo é o único rótulo estável que
  atravessa os três caminhos. Registrado para a integração: quando
  existir um remetente de verdade (header, envelope IMAP), basta
  trocar a função que deriva a chave, `registrarTemplate` e
  `aplicarTemplate` não mudam.
- D-G4 (23/11): o corpo do `.eml` gera sinais uma vez e aplica aos
  pedidos que receberam documento no próprio e-mail
  (`pipeline.ts:355-370`). Sinal exige pedido existente e o corpo
  chega junto dos anexos; atribuir o texto aos pedidos que acabaram
  de ganhar evento é a heurística mais curta que respeita as duas
  restrições. O payload gravado é só `{tipo, resumo, confianca,
  fonte}` (`pipeline.ts:119-128`): o corpo cru nunca vira evento
  nem log. Na defesa do zip, a checagem estrutural lê o que o
  diretório central declara; contra declaração mentirosa a última
  linha é o `resourceLimits` do worker, que mata o inflate sem
  derrubar o processo (S3, teste em `xlsx.test.ts`).

## Evidência (23/11)

### Tarefas

- T120: `xlsx.ts:50-137` lê só o diretório central (EOCD, entradas,
  tamanhos declarados) e recusa antes de qualquer inflate: sem EOCD,
  diretório fora dos limites, multi-disco/zip64, senha, método
  desconhecido, mais de 512 partes, mais de 64 MB descomprimidos ou
  razão de expansão >100:1. `xlsx.ts:151-193` roda a leitura em
  `worker_threads` com `resourceLimits` (256 MB de heap velho + 32 MB
  novo) e timeout de 10 s; kill por memória e timeout respondem 422
  de "leitura interrompida". `xlsx.worker.ts:83-146` usa
  `exceljs` 4.4.0: escolhe a planilha cujo cabeçalho tem chave de
  pedido (`csv.ts:31-34`, `parseCsv` sem mudança), emite CSV com
  `Date` em `AAAA-MM-DD` (UTC, nunca o serial nem o `cell.text` do
  fuso local), formula sem cache vira `xlsx_formula_sem_cache` e
  mescla sobre cabeçalho/dados vira `xlsx_mesclada`, ambos para a
  revisão. `xlsx.ts:220-232`: cabeçalho fora do schema vira revisão
  `xlsx_layout_desconhecido` com planilha, cabeçalho e amostra CSV.
  Testes: 25 casos em `xlsx.test.ts`, incluindo equivalência com o
  CSV, bomba declarada, timeout, OOM e os três motivos de revisão.
- T121: `detect.ts:15-18` reconhece `.xlsx` (e `.XLSX`); `.xls` segue
  422 com orientação "salve como .xlsx ou exporte a planilha como
  CSV". `pipeline.ts:197-211` despacha para `parseXlsx` com o nome do
  arquivo. `.eml`: o filtro de anexos já aceitava `.xlsx`
  (`eml.ts:10`) e o anexo segue o mesmo `ingerir`. `seed.ts:19,27`
  põe `.xlsx` na ordem, depois de `.csv` e antes de `.pdf`, com a
  mesma prioridade do CSV. `pipeline.ts:113-116`: item de revisão
  sem `pedidoId` (as falhas estruturais novas) responde null na
  aprovação em vez de 500. Testes: upload, anexo `.eml` e seed geram
  os mesmos eventos do CSV equivalente; `POST /api/ingest` com
  `.xlsx` legítimo responde 200 e o falso responde 422.
- T122: `pdf.ts:40-70` tem regra explícita por tipo
  (`normalizarNumero` aceita número finito ou extrai o número de
  "12kg"/"1.234,56"; `normalizarData` aceita `AAAA-MM-DD` com faixas
  plausíveis e converte `DD/MM/AAAA`). `pdf.ts:80-115` valida campo
  a campo: o que normaliza entra com registro `normalizados`, o que
  não fecha é `descartados` com `de`/`regra`, ambos em `doc.dados`
  (`pdf.ts:230-234`); nunca `NaN` nem string crua em
  `CamposObservados`. Essencial inválido (chave não-string,
  `confianca` não-número) segue invalidando a extração inteira como
  `extracao_invalida` (`pdf.ts:194-205`). Testes: 14 casos em
  `pdf.test.ts`; `"12kg"` vira 12, `"muito pesado"` é descartado com
  registro, `"15/12/2025"` vira `2025-12-15`, `"amanha"` é
  descartado.
- T123: `fixtures/planilha.xlsx` gerada com exceljs, mesmas colunas
  da `planilha.csv` (a fixture `.csv` passou a usar `2026-01-25`
  para a equivalência ser literal);
  `fixtures/t124/planilha-desconhecida.xlsx` com cabeçalho fora do
  schema (Rastreio, Janela, Motorista, Observacao);
  `fixtures/email-corpo.eml` com corpo de texto sobre
  reagendamento e a CC-e anexa; `fixtures/cce-reagendamento.xml`
  cujo `xCorrecao` fala de reagendamento.
- T124 (rodada 2, depois de `mapeamento.ts` na `main`): a revisão
  `xlsx_layout_desconhecido` carrega `csvCompleto` até o teto
  `XLSX_REVISAO_MAX_CSV` (200 KB; acima vira `truncado`,
  `xlsx.ts:206,239`). No `pipeline.ts:308-334`: `aplicarTemplate`
  com o remetente (nome do arquivo sanitizado, D-G3) roda antes da
  LLM; template existente ingere direto, sem LLM e sem fila, e sem
  template o item leva `proposta` de `proporMapeamento(cabecalho,
  amostra)`. A aprovação bifurca em `pipeline.ts:178-213`
  (`aprovarComMapeamento`): resolve o item na tx, aplica
  `aplicarMapeamento` linha a linha do `csvCompleto`, ingere por
  `registrarDoc` com a mesma idempotência do caminho normal e grava
  o template por `(workspace, remetente)` com `registrarTemplate`.
  Item sem proposta ou sem `csvCompleto` responde null como antes.
  O mapeamento só renomeia colunas para campos, nunca inventa valor.
  Teste em `pipeline-ai.test.ts`: revisão com proposta, aprovação
  que ingere e grava template, e segundo arquivo do mesmo remetente
  entrando direto, com o fetch da LLM provado não-chamado.
- T140: `eml.ts:17-38` devolve `{anexos, corpo}` (corpo =
  `parsed.text` trimado). `eventos.ts:74-79` expõe `textoDoEvento`
  (correção + justificativa + descrição). No pipeline, a CC-e gera
  sinais só quando o doc gravou evento, ou seja, pedido existente
  (`pipeline.ts:280-287`); o corpo do `.eml` gera uma extração e
  emite por pedido que recebeu documento no mesmo e-mail
  (`pipeline.ts:351-370`, D-G4). `emitirSinais`
  (`pipeline.ts:119-128`) grava só `{tipo, resumo, confianca,
  fonte}` via `appendVarios`: texto cru nunca vai para ledger nem
  log. R-006 segue: sinal não é documento, não declara campo
  vigiado e não gera divergência. Testes em `pipeline-ai.test.ts`:
  sinal com a fonte certa por caminho, R-006 verde, sem LLM nada
  muda e CC-e de pedido inexistente vai para a revisão sem sinal.
- T141: `pipeline.ts:76-86`: depois de cada `tarefa` propagada, com
  `NVOIP_NOTIFY_ON_TASK` ligado (`nvoip.ts:50-54`), chama
  `notificarTarefa` na mesma tx; o resultado vira evento
  `notificacao` só quando a notificação acontece (entrega, falha,
  sem contato ou canal incompatível), e desligada nada é emitido.
  O módulo nunca lança, então falha da provedora registra
  `nao_entregue`/`falha_envio` sem quebrar a ingestão. Testes:
  com env ligada e contatos da seed, toda tarefa gera uma
  `notificacao` com o motivo certo por parte; sem a env nada
  acontece mesmo com provedora configurada; `fetch` rejeitado vira
  `falha_envio` e o pipeline segue com a cadeia válida.
- T142: `nfe.ts:96-106` escreve `dados.emitente.fone` (e
  `destinatario.fone`, livre) a partir de `enderEmit/enderDest`;
  `cte.ts:89-93` escreve `dados.transportadora.fone`. Campo
  opcional: documento sem fone segue idêntico. `pipeline.ts:261-265`
  chama `bootstrapContatos` depois que NF-e/CT-e gravou evento; o
  bootstrap é idempotente e nunca sobrescreve contato `manual`
  (`contatos.ts`). Testes: NF-e com fone bootstrapa o fornecedor na
  agenda, CT-e com fone a transportadora, doc sem fone não cria
  contato e contato manual fica intacto.
- S1 (achado do revisor): a revisão do `.xlsx` cobria cota só
  depois do parse. `pipeline.ts:301` chama `exigirCabe(1)` antes de
  `parseXlsx` e `pipeline.ts:304` cobre o lote inteiro com
  `exigirCabe(r.docs.length)` antes de gravar, fechando também a
  ingestão parcial por cota. Teste: `documentosPorEnvio: 0`
  responde 413 antes de qualquer parse e a fila fica vazia.
- S3 (achado do revisor): a checagem estrutural lê tamanhos
  declarados no diretório central; um zip pode mentir 1 KB e
  carregar um deflate de dezenas de MB. A última linha de defesa é
  o `resourceLimits` do worker (D-G4), que mata o inflate sem
  derrubar o processo. Teste em `xlsx.test.ts`: diretório mentiroso
  montado à mão passa na checagem e morre no worker com 422, e a
  fixture boa lê normal em seguida (processo em pé).

### Gates

Rodada 1: 19 arquivos, 183 + 27 testes verdes (1 skip
pré-existente). Rodada 2 (T124, T140, T141, T142, S1, S3):

- `npx tsc --noEmit` em `app/`: limpo.
- `npm test` em `app/`: 19 arquivos no server, 240 testes verdes (1
  skip pré-existente) + 2 arquivos web com 27. Os 12 testes novos de
  `pipeline-ai.test.ts` e os 2 novos de `xlsx.test.ts` (diretório
  mentiroso e CSV truncado) incluídos.
- `node scripts/repo-guard.mjs`: 11 checks, exit 0.
- `node scripts/prose-evals.mjs`: 0 duras, 7 leves (pré-existentes),
  exit 0.
