# Plano: Spec 0007: camada AI operacional

**Spec:** `specs/0007-camada-ai-operacional/spec.md` · **Data:** 2026-11-23

## Resumo

Duas frentes de código mais uma reservada. `ai-ingest` cobre o que
entra por arquivo: `.xlsx` de volta pelo caminho de D-028 (worker com
limite de recursos + checagem estrutural do zip), a validação de tipo
dos campos extraídos por LLM no PDF, e a fiação dos sinais semânticos
no `.eml` e na CC-e. `ai-mandatos` cobre o que a LLM toca como serviço:
cliente `llm.ts`, o endpoint de mandatos com ação tipada executada pelo
motor e gravada como evento, a agenda de contatos com tabela e
bootstrap, a entrega Nvoip, o extrator de sinais e o contrato
`view-spec`. `ai-web` fica explicitamente reservada: a renderização do
`view-spec` é do usuário com outro agente. A dependência entre as duas
frentes é uma via só: `ai-ingest` consome `sinal.ts` e os tipos de
`model.ts` quando eles existirem na `main`; a fundação da `ai-mandatos`
(modelo + `llm.ts` + `sinal.ts`) integra primeiro.

## Constitution Check

| Artigo | Aplica? | Evidência no plano |
|---|---|---|
| A1 fatia vertical | sim | cada RF é uma capacidade completa com endpoint, efeito no ledger e teste |
| A2 fronteira de dados | sim | credenciais Nvoip/LLM só em `.env`; `.env.example` sem valor |
| A3 escritas/domínio puro | sim | motor determinístico intocado como fonte de verdade; LLM na borda (ingest e serviços), nunca dentro de `rules.ts`/`divergence.ts` |
| A4 superfície pública | sim | rotas novas declaradas nesta spec: `/api/mandatos`, `/api/contatos`, `/api/pedidos/:id/view-spec` |
| A5 dados pessoais | sim | corpo de e-mail passa pela LLM sob a mesma regra do PDF (só sintético, regulamento 6.9) e não vai para ledger nem log; contatos ficam na sessão do dono |
| A6 idioma/identidade/a11y | sim | mensagens pt-BR; front reservado herda A6 quando existir |
| A7 rótulo de ilustrativo | sim | evento `mandato` declara o comando; `notificacao` registra entregue/não-entregue de verdade; sinal leva `confianca`; contatos da seed são fictícios rotulados |
| A8 gate local | sim | `npm test` (com a web depois da 0008), `tsc --noEmit`, guard, prose-evals |
| A9 ledger imutável | sim | eventos novos append-only com hash chain; `contatos` por DDL idempotente de `store.ts`, sem migration numerada |
| A10 intenção registrada | sim | esta spec + decisões sugeridas D-043 em diante, numeradas pela integração |

## Estrutura e caminhos reais

```
specs/0007-camada-ai-operacional/
  spec.md  plan.md  tasks.md
  brief-ai-ingest.md        # frente ai-ingest
  brief-ai-mandatos.md      # frente ai-mandatos
  brief-ai-web.md           # frente reservada (contrato, sem código)
app/server/
  llm.ts                    # ai-mandatos: cliente de chat JSON + timeout
  mandatos.ts               # ai-mandatos: prompt, schema, execução pelo motor
  contatos.ts               # ai-mandatos: agenda + bootstrap + seed fictícia
  nvoip.ts                  # ai-mandatos: entrega + texto + evento notificacao
  sinal.ts                  # ai-mandatos: extração de sinais consultivos
  viewspec.ts               # ai-mandatos: view-spec gerado e validado
  index.ts                  # ai-mandatos: 3 rotas novas + simulate com diverge
  store.ts                  # ai-mandatos: tabela contatos + CRUD
  config.ts                 # ai-mandatos: envs Nvoip/mandatos/LLM timeout
  protecao.ts               # ai-mandatos: mensagens novas
app/server/ingest/          # ai-ingest
  xlsx.ts  xlsx.worker.ts   # parser com limites e checagem de zip
  detect.ts                 # xlsx reconhecido
  pdf.ts                    # validação de tipo (e o que faltar de cap/timeout)
  eml.ts                    # devolve corpo de texto
  eventos.ts                # expõe texto da correção
  csv.ts                    # reuso do mapeamento linha->DocData para o xlsx
app/server/pipeline.ts      # ai-ingest: emite sinal após o doc e, se aprovado, notificação ao propagar
app/server/seed.ts          # ai-ingest: .xlsx na ordem de ingestão
app/server/fixtures/        # ai-ingest: planilha.xlsx, .eml com corpo, cce com texto
app/shared/                 # ai-mandatos
  model.ts                  # TipoEvento + Sinal/Contato/MandatoParseado/ViewSpec
  divergence.ts             # exporta diverge para o simulate
  projection.ts             # expõe sinais e notificações na projeção
app/package.json            # ai-ingest (única dona de dependências)
app/.env.example            # ai-mandatos: documenta as envs novas
```

Dependência entre frentes: `ai-ingest` só escreve os fios do pipeline
(sinais e, se aprovado, notificação ao propagar) depois que
`ai-mandatos` entrega `model.ts` com os tipos novos, `sinal.ts` e
`nvoip.ts` na `main`. A direção é uma via só: `pipeline.ts` fica
inteiro com a `ai-ingest`, que chama os módulos da outra frente já
integrados. Até lá ela trabalha `.xlsx` e a validação do PDF, que não
dependem de nada dela.

## Dados e artefatos

- Artefatos novos: fixtures de teste (`planilha.xlsx`, `.eml` com corpo
  de texto, CC-e com correção que fala de reagendamento), os módulos
  `llm/mandatos/contatos/nvoip/sinal/viewspec.ts`, tabela `contatos`
  (DDL idempotente em `store.ts`), esta spec.
- Artefatos aplicados afetados: nenhum (A9).
- Migrations: nenhuma numerada. A tabela `contatos` entra pelo padrão
  `CREATE TABLE IF NOT EXISTS` de `store.ts`, como `events` e
  `review_queue`. Se a integração preferir migration numerada, a
  implementação para e reporta o SQL antes de escrever.

## Matriz de autorização / publicação

| Conteúdo | Público? | Restrição |
|---|---|---|
| Código `app/` | sim | público por definição |
| Credenciais Nvoip/LLM | não | só `.env` local e vars do deploy |
| Corpo de `.eml` e de CC-e | via LLM | não persiste; só o sinal extraído vai para o ledger |
| Contatos da sessão | na sessão | mesmo isolamento de `events`; contato da seed é fictício |
| Texto de notificação | no ledger | evento `notificacao` com o que saiu de verdade |

## Plano de testes / verificação

- Guard: `node scripts/repo-guard.mjs` e `node scripts/prose-evals.mjs`
  exit 0; `tsc --noEmit` limpo; `npm test` verde.
- `.xlsx`: fixture legítima gera os mesmos eventos do CSV; zip
  malformado, arquivo falso `.xlsx` (renomeado) e razão de expansão
  absurda respondem 422; worker encerrado sem matar o processo.
- Mandatos: LLM mockada; cada ação do conjunto executada pelo motor;
  evento `mandato` com hash chain válido (`audit` segue verde); 422
  para parse falho, ação ambígua, sem alvo e filtro largo; 503 sem
  `LLM_API_URL`.
- Contatos: seed devolve 4 fictícios; upsert por parte; bootstrap por
  documento não sobrescreve manual; isolamento por workspace.
- Nvoip: sem credencial e sem contato => `nao_entregue` com motivo;
  com mock da API => `entregue` com o texto gerado.
- Sinais: `.eml` e CC-e com texto de reagendamento geram `sinal`;
  nenhum campo vigiado muda (teste R-006 segue verde); confiança baixa
  descarta; sem LLM nenhum sinal.
- `view-spec`: resposta sempre validada; LLM fora ou JSON inválido
  devolve o default.
- Correções: `peso_kg:"12kg"` não vira `NaN` nem string em
  `pesoTotal`; simulate com tolerância de peso e `fonteA` real.
- Aceite: critérios da spec item a item com evidência no commit/PR.

## Rollout manual

1. Fase 0: spec + plan + tasks + briefs + `frentes.json` com
   `ai-ingest`, `ai-mandatos` e `ai-web` (reservada, sem paths de
   código). Integração registra as decisões D-043 em diante.
2. Fase 1 (sequencial): a 0008 `hardening` integra inteira. Só depois:
   `ai-mandatos` fundação na `main`: tipos em `model.ts`, `llm.ts`,
   `sinal.ts` (tarefas T110 a T112).
3. Fase 2 (paralelo): `ai-ingest` com `.xlsx`, validação do PDF e
   fixtures; `ai-mandatos` com `mandatos.ts`, `contatos.ts`, rotas,
   projeção e o simulate com `diverge`.
4. Fase 3: `ai-mandatos` entrega `nvoip.ts` e `viewspec.ts` e integra.
5. Fase 4: `ai-ingest` fia os sinais no `.eml`/CC-e chamando
   `sinal.ts` e, se o gatilho por env for aprovado, a notificação ao
   propagar chamando `nvoip.ts`, ambos já na `main`.
6. Fase 5: gates e integração das branches; front `view-spec` fica
   para o trabalho reservado do usuário. Reversão: `git revert`.

## Desvios de complexidade

- `worker_threads` para o `.xlsx`: justificado por D-028 (a alternativa
  sem worker estourou memória e tempo em arquivo de 39 KB). O worker é
  a única thread fora do loop principal; o resto do servidor não ganha
  concorrência nova.
- Dependência `exceljs` x parser próprio: as duas opções de D-028 são
  mantidas na spec; a escolha sai com a evidência dos testes e vira
  decisão da frente. Nenhuma outra dependência nova é admitida (zod e
  sdk de Nvoip ficam fora: validação e chamada à mão, como o resto).
- Cliente `llm.ts` único: hoje `pdf.ts` chama `fetch` inline; o cliente
  novo segue o mesmo formato OpenAI-compatível e passa a servir os
  quatro consumidores. Absorver o fetch do `pdf.ts` fica opcional na
  `ai-ingest`, para não criar dependência de ordem entre as frentes.
- Seed de contatos: 4 fictícios (rotulados, no padrão dos documentos
  da seed) como constante em `contatos.ts`, inseridos por `store.init`
  de forma idempotente, sem tocar `app/seed/` (pasta da
  `escopo-produto` hoje inexistente).
