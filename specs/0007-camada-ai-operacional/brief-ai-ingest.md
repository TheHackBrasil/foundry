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
tem contato com canal compatível.
Tasks T120 a T124, T140, T141.

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
muda.

Reporte: conclusão + evidência `arquivo:linha` por critério, decisão
`exceljs` x parser próprio com a evidência dos testes, saída de gate.

## Decisões da frente

(preencher na primeira decisão)
