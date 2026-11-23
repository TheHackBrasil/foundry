# Brief · frente `ai-mandatos`

Escopo: a camada de serviços de IA do servidor (spec 0007). Ordem dos
módulos: (1) tipos em `model.ts` (`mandato`, `sinal`, `notificacao` em
`TipoEvento`; `Sinal`, `Contato`, `CanalContato`, `MandatoParseado`,
`AcaoMandato`, `ViewSpec`; `ProjecaoPedido` com `sinais` e
`notificacoes`); (2) `llm.ts` (cliente de chat JSON OpenAI-compatível
com timeout e erro tipado); (3) `sinal.ts` (`extrairSinais` com
limiar); depois, em paralelo: `mandatos.ts` + `POST /api/mandatos`
(schema fechado, execução só pelo motor determinístico, evento
`mandato` por pedido alvo na mesma transação, 422 para parse/ambíguo/
sem alvo/filtro largo, 503 sem LLM, cotas por IP e por minuto),
`contatos.ts` + tabela `contatos` + `GET`/`PUT /api/contatos` + 4
contatos fictícios da seed + bootstrap por `fone` de
`enderEmit`/`enderDest` sem sobrescrever manual, `nvoip.ts` (envio por
canal, texto por LLM com template de fallback, evento `notificacao`
`entregue`/`nao_entregue`, desligada por padrão, nunca quebra o fluxo),
`viewspec.ts` + `GET /api/pedidos/:id/view-spec` (geração por LLM,
validação server-side, default determinístico), `diverge` exportada e
`/api/simulate` reusando `compararFontes` com tolerância e `fonteA`
real, projeção expondo `sinais`/`notificacoes`, `mapeamento.ts`
(proposta de mapeamento coluna a campo por LLM, tabela `templates`
por `(workspace, remetente)`, tipo do item de revisão com proposta,
funções `proporMapeamento`/`aplicarTemplate` que a `ai-ingest` chama
em T124), envs novas em `config.ts` e `.env.example`, mensagens em
`protecao.ts`. Tasks T110-T113, T130-T136.

Ordem: a spec 0008 integra inteira antes desta frente começar. A
fundação (T110 a T112) integra primeiro na `main`: a `ai-ingest`
precisa de `model.ts` e `sinal.ts` para o T140 dela. Combine a ordem
de publicação com a integração se a outra frente estiver esperando.

Paths: `app/server/llm.ts`, `app/server/mandatos.ts`,
`app/server/contatos.ts`, `app/server/nvoip.ts`, `app/server/sinal.ts`,
`app/server/viewspec.ts`, `app/server/mapeamento.ts`,
`app/server/index.ts`, `app/server/store.ts`,
`app/server/config.ts`, `app/server/protecao.ts`,
`app/shared/`, `app/.env.example`,
`specs/0007-camada-ai-operacional/brief-ai-mandatos.md`. Não escrever
em `app/server/ingest/`, `app/server/pipeline.ts`, `app/server/seed.ts`, `app/server/fixtures/`
(ai-ingest; `pipeline.ts` fica inteiro dela: o fio de notificação da
tarefa propagada, se aprovado, é escrito por ela em T141 chamando o
`nvoip.ts` daqui já integrado), `app/package.json`/lock (dependência
nova pede à `ai-ingest` pela integração; meta: zero dependência nova
nesta frente),
`app/web/`, `docs/`, `DECISIONS.md`, `BACKLOG.md`, `.env*`.

Base: `main` depois da integração da `wt/hardening` (spec 0008); branch
`wt/ai-mandatos`; worktree `../foundry-wt-ai-mandatos`.

Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*`, escrever fora dos paths, LLM escrevendo campo vigiado ou
regra de propagação, executar texto gerado como código, ação fora do
conjunto `{propagar, simular, resumir, notificar}`, gravar corpo de
e-mail/CC-e ou prompt bruto no ledger, dependência nova (zod, sdk),
ligar a Nvoip por padrão, travessão/meia-risca em `.md`.

Gate: `node scripts/repo-guard.mjs` + `node scripts/prose-evals.mjs`
exit 0; `tsc --noEmit` limpo; `npm test` verde; testes com LLM e Nvoip
mockadas: cada ação do conjunto executa pelo motor e grava `mandato`
com `audit` válido; 422 por motivo; 503 sem LLM; `contatos` com
isolamento por sessão e bootstrap sem sobrescrever manual;
`notificacao` com `entregue` (mock) e `nao_entregue` por motivo;
`view-spec` sempre válido; simulate com tolerância de peso e `fonteA`
real.

Reporte: conclusão + evidência `arquivo:linha` por critério, payload de
exemplo de cada rota nova, saída de gate, decisões tomadas nas
perguntas abertas (escopo do evento `mandato`, semântica de `propagar`,
gatilho de notificação).

## Decisões da frente

- D-043: o evento `mandato` fica por pedido alvo, gravado na mesma
  transação da execução da ação, e fora da projeção: ele já é trilha do
  próprio ledger, não estado consolidado (`mandatos.ts`,
  `projection.ts`).
- D-044: `propagar` é repropagação idempotente das divergências já
  registradas, como a spec decidiu: o executor recomputa por
  `camposPorFonte` + `divergenciasDaNovaFonte` + `propagarTodas` e grava
  só o que `eventoExiste` não encontra; criar documento novo pelo
  mandato fica fora.
- D-045: a resolução de alvo olha só o workspace da sessão (a seed é
  somente leitura até quando é citada de propósito, 403). `pedidoId`
  aponta direto; fornecedor casa CNPJ por dígitos ou trecho do nome do
  emitente da NF-e; `parte` filtra pedidos com tarefa daquela parte.
  Acima de `MANDATOS_MAX_ALVOS` (5) responde `filtro_largo`.
- D-046: o `simular` do mandato e o `POST /api/simulate` dividem
  `simularHipotese` (`divergence.ts`): `fonteA` é a fonte real da última
  declaração do campo, `fonteB` é `manual` e a tolerância de peso é a
  mesma do motor. O mandato grava só o evento `mandato`.
- D-047: `notificar` exige `parte` no filtro e dispara pela última
  tarefa daquela parte na projeção do pedido. Nvoip desligada registra
  `notificacao` `nao_entregue` com motivo `desligado`, sem tráfego de
  rede; `email` existe na agenda mas a Nvoip não entrega
  (`canal_incompativel`). O texto sai da LLM com template determinístico
  de fallback. `NVOIP_NOTIFY_ON_TASK` governa só o disparo automático na
  propagação (o fio da `ai-ingest` em T141), não o mandato.
- D-048: motivos fixos de `nao_entregue`: `desligado`, `sem_tarefa`,
  `sem_contato`, `canal_incompativel` e `falha_envio`. Falha de
  notificação nunca quebra o mandato: vira evento e segue.
- D-049: `view-spec` é validado no servidor (versão 1, enums de fonte,
  coluna e parte, dedup de listas); ausência de LLM, JSON inválido ou
  enum inventado caem no padrão determinístico, e a rota nunca responde
  500 por causa da camada de linguagem.
- D-050: agenda com um contato por parte por workspace. A leitura da
  sessão soma a seed como fallback e o contato da própria sessão vence
  na mesma parte; PUT grava sempre `manual` no workspace do chamador;
  bootstrap por `fone` usa `INSERT ... ON CONFLICT DO NOTHING` e nunca
  sobrescreve contato existente.
- D-051: sinal fora do schema ou abaixo do limiar (0,7) é descartado sem
  fila de revisão: é trilha informativa, não documento.
- D-052: `mapeamento` propõe só `coluna -> campo canônico` do conjunto
  fechado `CAMPOS_MAPEAVEIS` (os vigiados + `pedidoId`), com coluna
  inexistente e campo inventado filtrados; proposta inválida não gera
  nada. O template aprovado fica por `(workspace, remetente)` na tabela
  `templates`, DDL idempotente em `store.ts` sem migration numerada.
- D-053: os testes da camada moram em
  `app/shared/ai-mandatos.test.ts` porque os paths da frente cobrem
  `app/shared/` inteiro e só os `.ts` nomeados de `app/server/`. LLM e
  Nvoip sempre com `fetch` mockado; banco PGlite como no `api.test.ts`.
