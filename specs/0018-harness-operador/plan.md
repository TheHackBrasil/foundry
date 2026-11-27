# Plano: Spec 0017: harness de operações

**Spec:** `specs/0018-harness-operador/spec.md` · **Data:** 2026-11-26

## Resumo

O operador é um módulo novo (`app/operador/`) que roda dentro do processo do app, com fluxos duráveis do DBOS Transact gravando no mesmo Postgres. O DBOS é uma biblioteca que roda dentro do processo do app (o tutorial oficial usa Fastify), então não há serviço novo no Railway (`AGENTS.md:61`) nem endpoint interno. O SSE em memória continua chegando à tela. Só a instância que segura um lock de líder no Postgres executa os fluxos; qualquer instância grava eventos. O fluxo relê o ledger ao acordar, e `DBOS.send` só acelera.

A escada e a política são funções puras. Os canais ficam atrás de interfaces com adaptadores por fornecedor. O app continua dono do ledger, das regras e dos casos. Toda resposta passa pelo mesmo pipeline do e-mail e, sem assinatura, vai para a revisão do analista.

Ordem do trabalho:

1. Spikes e contas no dia 0.
2. Correções do código atual que a escada pressupõe: RF6, RF13, RF20 e RF27.
3. Fundação do operador.
4. Fatia fina: e-mail, WhatsApp e ligação até a declaração.
5. Bancada de voz, em paralelo e fora do caminho crítico.

Decisões técnicas (D-063, D-064):

- O Postgres fica.
- O DBOS Transact (`@dbos-inc/dbos-sdk`, MIT) é o engine durável; o Temporal Cloud fica como plano B.
- O SDK oficial da Anthropic (`@anthropic-ai/sdk`) serve o operador: Claude Opus 5.5 decide e redige, Claude Haiku 5.5 extrai. O cliente de `app/server/llm.ts` segue servindo o resto do app.
- O MCP só de leitura usa `@modelcontextprotocol/sdk`.

## Constitution Check

| Artigo | Aplica? | Evidência no plano |
|---|---|---|
| A1 | sim | A fatia fina atravessa gatilho, operador, canal, webhook, revisão, motor e tela; canal sem credencial degrada declarado com motivo no evento |
| A2 | sim | O operador abre o store escopado pelo workspace do caso (`store.paraWorkspace`, `app/server/index.ts:283-286`) e nunca usa o store raiz para escrever; o token do MCP assina workspace, caso e tentativa; aprovação exige credencial de aprovador; nada de áudio, transcrição ou telefone no repo |
| A3 | sim | `escada.ts`, `politica.ts` e a projeção do plano são funções puras; efeitos só na fronteira: `canais/`, `webhooks.ts`, `evidencia.ts`, `mcp.ts`, `agente/`, `db-dbos.ts`, `fluxo/caso.ts` e `index.ts`; falha vira `contato_falhou` ou `contato_incerto` |
| A4 | sim | Rotas, envs e o módulo novos entram em `app/.env.example` (T707) e `app/README.md` (T796) |
| A5 | sim | Voz e telefone das pessoas do time ficam no Postgres, nunca no repo; consentimento registrado em `docs/fontes-e-contatos.md` antes da primeira ligação (T797); a saída da T798 vai sem telefone nem transcrição; o contato da TOTVS já consta em `docs/fontes-e-contatos.md:16` |
| A6 | sim | Linha do tempo e painel de aprovação em pt-BR, com os tokens e a identidade da tela `#/operacao`, contraste, foco e teclado, reduced-motion e texto alternativo (T797) |
| A7 | sim | Transportadora simulada, custo estimado e fixtures de voz aparecem rotulados como simulação ou teste; afirmação de fornecedor tem fonte nas Premissas da spec |
| A8 | sim | Gate T799: `npm --prefix app test`, `npm --prefix app run typecheck`, `npm --prefix app/web run typecheck`, `node --check scripts/repo-guard.mjs`, `node scripts/repo-guard.mjs`, `node scripts/prose-evals.mjs`, com a saída colada no commit |
| A9 | sim | Nenhum arquivo de `.specify/immutable.txt` nem spec `entregue` é tocado. O DDL de `contatos` e `evidencias` não é aditivo: muda chaves únicas em DDL idempotente no boot, testado em base existente (T705) |
| A10 | sim | Spec 0017 aprovada em 26/11 depois do clarify |

## Estrutura e caminhos reais

```
app/
  operador/                      novo
    index.ts                     registra fluxos, lock de líder, DBOS.launch, rotas de webhook e MCP no Fastify
    fluxo/caso.ts                fluxo DBOS por caso (id workspace:pedido:seqOrigem:ciclo)
    fluxo/escada.ts              pura: próximo degrau, prazos, encerramento
    politica.ts                  pura: aprovação, destinos, janela, tentativas, orçamento, kill switch
    db-dbos.ts                   adaptador Db (app/server/db.ts:8-13) sobre o client transacional do DBOS
    agente/claude.ts             @anthropic-ai/sdk, redação por schema estruturado, recusa tratada
    agente/extracao.ts           declaração a partir de mensagem ou transcrição (Haiku 5.5)
    canais/email.ts              degrau de e-mail sobre app/server/cobranca.ts
    canais/whatsapp.ts           interface e adaptador (Nvoip ou Meta, decidido em T703)
    canais/voz/discador.ts       interface Discador (idempotência, consulta por chave)
    canais/voz/roteiro.ts        modelo de roteiro com campos tipados
    canais/voz/*.ts              adaptadores do teste comparativo
    webhooks.ts                  entrada de fornecedor: assinatura, janela, dedupe, id externo
    mcp.ts                       servidor MCP só de leitura, projeção em lista fechada
    evidencia.ts                 download com lista de hosts, sha256, retenção
    bancada/                     transportadora simulada, roteiros, runner, relatório, eval de modelos
    *.test.ts
  server/
    store.ts                     contatos por canal, evidencias por workspace, índice da chave, consultas
    contatos.ts                  agenda por canal, fonte manual, nao_contatar_ia
    pipeline.ts                  resposta genérica por fonte; NVOIP_NOTIFY_ON_TASK sob o operador
    pendencia.ts                 só eventos de documento; cobrança só com caso aberto; gatilho do operador
    cobranca.ts                  eventos de cobrança; Message-ID pela chave; COBRANCA_AUTO sob o operador
    index.ts                     IMAP por Message-ID em qualquer workspace; rotas de plano, acionamento,
                                 linha do tempo e evidência; registra o módulo do operador
  shared/
    model.ts                     TipoEvento, FonteDocumento, FONTES_DOCUMENTO, plano de contato
    formato.ts                   rótulos das fontes novas
    casos.ts                     projeção pura do plano, da linha do tempo e do fechamento (RF5)
    comprovante.ts               nunca expõe payload com dado do operador (rota em server/index.ts:982-1006)
  web/src/
    operacao/LinhaTempoCaso.tsx  novo
    operacao/PainelAprovacao.tsx novo
    operacao/PaginaOperacao.tsx, operacao/api.ts
    components/DrawerAgenda.tsx  agenda por canal
    format.ts                    rótulos das fontes novas
  deploy/Dockerfile              copia operador/
  tsconfig.json, vitest.config.ts, package.json, .env.example
```

Frentes: `speckit/frentes.json` ainda lista `app/server/`, `app/shared/` ou `app/web/` em `app-core`, `app-infra`, `hardening`, `ai-ingest`, `ai-mandatos`, `app-brand`, `ai-web` e `app-operacao`, e `polish-fluxo` é dona de `app/web/src/format.ts`. A integração confere se estão integradas e encerra também as `v2-*`, `polish-*`, `motion-fisica` e `adapt-generica`. Todas estão integradas na `main`. A integração encerra essas entradas e os worktrees `foundry-wt-app-core`, `foundry-wt-infra` e `foundry-wt-operacao`, atualiza `AGENTS.md:24-25` e `speckit/frentes.md:17-18`, registra a mudança numa decisão e abre a frente `harness` com os arquivos acima listados um a um. Pastas inteiras entram só para `app/operador/` e `specs/0018-harness-operador/`, para não travar a spec 0013.

## Dados e artefatos

Eventos novos em `TipoEvento` (`app/shared/model.ts:16-36`). Todos são gravados com o `pedidoId` do caso (exigido pelo append e pela cadeia, `app/server/store.ts:213-251`) e levam no payload só ids, `contatoId` e hashes:

| Evento | Quando | Payload |
|---|---|---|
| `operador_assumiu` | fluxo começa | fluxoId, casoId, gatilho, snapshot da política (lista de destinos só como hash) |
| `contato_planejado` | antes de WhatsApp ou ligação | planoId, versão, canal, contatoId, hash do roteiro, prazo, custo estimado |
| `contato_aprovado`, `contato_recusado` | decisão do analista | planoId, versão, hash do roteiro, aprovador |
| `contato_expirado` | prazo de decisão vence | planoId |
| `contato_iniciado` | antes do efeito | chave, canal, fornecedor |
| `contato_aceito` | fornecedor aceitou | chave, idExterno |
| `contato_incerto`, `contato_falhou` | falha ambígua ou erro | chave, motivo |
| `ligacao_concluida` | webhook verificado | idExterno, resultado, duração, custo, hash do áudio e da transcrição |
| `contato_optout` | atendente pede para parar | contatoId |
| `cobranca_enviada`, `cobranca_expirada` | degrau de e-mail | cobrancaId, chave |
| `operador_escalou`, `operador_encerrou` | troca de degrau ou fim | de, para, motivo |

O fechamento do caso usa o `caso_resolvido` que já existe, com `resolvidoPor: 'motor'` (o campo `origem` já existe em `Caso`, `app/shared/casos.ts:26`).

Mudanças de banco em `app/server/store.ts`, por DDL idempotente no boot:

- `contatos`: `UNIQUE(workspace_id, parte)` vira `UNIQUE(workspace_id, parte, canal)`. Muda o `ON CONFLICT` em `store.ts:194, 618, 629`, `contatoDaParte` (593-601) e seus chamadores (`cobranca.ts:33, 94`, `nvoip.ts:142`, `pipeline.ts:123`, `index.ts:507`, `agente/toolsEscrita.ts:46`, `agente/toolsLeitura.ts:243`) e `listarAgenda` (`contatos.ts:22-30`). Ganha `nao_contatar_ia`.
- `evidencias`: a chave passa de `hash` a `(workspace_id, hash)` (hoje `store.ts:108, 578`) e ganha `apagar_em` para a retenção de 90 dias.
- `events`: índice único parcial em `(workspace_id, pedido_id, (payload->>'chave')) WHERE tipo = 'contato_iniciado'`; os eventos seguintes repetem a chave sem colidir.
- `operador_controle` (nova): kill switch global e por workspace, mudado por rota com credencial de aprovador e lido antes de cada efeito.
- `cobrancas`: ganha `caso_id`.
- O DBOS guarda o estado em `DBOS_SYSTEM_DATABASE_URL` (banco `foundry_dbos` ou schema próprio, decidido em T701).

Envs novas, todas em `app/.env.example`:

- ativação e limites: `OPERADOR_ATIVO=0`, `OPERADOR_WORKSPACES`, `OPERADOR_DESTINOS_PERMITIDOS`, `OPERADOR_APROVADOR_TOKEN`, `OPERADOR_APROVACAO_VALIDADE_MIN`
- prazos e política: `OPERADOR_PRAZO_EMAIL_H=4`, `OPERADOR_PRAZO_WHATSAPP_H=1`, janela, tentativas, `OPERADOR_TETO_CASO_BRL=5`, `OPERADOR_TETO_DIA_BRL=50`, `OPERADOR_RETENCAO_DIAS=90`
- modelos: `ANTHROPIC_API_KEY`, `OPERADOR_MODELO_AGENTE=claude-opus-5-5`, `OPERADOR_MODELO_EXTRACAO=claude-haiku-5-5`
- integração: `MCP_TOKEN_SEGREDO`, credenciais e segredos de webhook por fornecedor, lista de hosts de áudio

## Matriz de autorização / publicação

| Conteúdo | Público? | Restrição |
|---|---|---|
| Linha do tempo e evidência do caso | não | sessão dona do pedido; seed só leitura |
| Aprovar, ajustar ou recusar plano | não | credencial de aprovador; trava do pedido; 409 fora do estado |
| Acionar o operador | não | sessão dona e workspace habilitado; uma vez por divergência |
| Webhook de fornecedor | sim, só para o fornecedor | assinatura, janela de timestamp, dedupe por id de evento, mapeamento por id externo |
| MCP | sim, só com token | token HMAC por workspace, caso e tentativa; projeção em lista fechada; só leitura |
| Comprovante público | sim | payload do operador só com ids e hashes |
| Repo: fixtures, roteiros, relatório da bancada | sim | sintéticos e rotulados; nada de áudio, transcrição ou telefone real |

## Plano de testes / verificação

- Puras (`escada.ts`, `politica.ts`, projeção em `casos.ts`): vitest sem banco.
- Eventos, aprovação, pipeline, contatos por canal e migração de base existente: vitest com PGlite (`app/server/db.ts:116-119`).
- Fluxo DBOS: teste de recuperação com queda em três pontos (antes de `contato_iniciado`, entre ele e o aceite, depois do aceite). Se o DBOS não rodar sobre PGlite, o teste usa o Postgres do `app/docker-compose.yml` (T702).
- MCP: recusa escrita, outro caso, token vencido; nunca devolve token do caso nem telefone.
- Webhooks: recusa sem assinatura, fora da janela, repetido e com id externo desconhecido.
- Payload: varredura dos eventos do operador sem telefone nem transcrição.
- Componentes: `renderToStaticMarkup`, como em `app/web/src/components/evidencia/evidencia.test.ts`; foco e teclado do A6 com evidência manual.
- Fatia fina: roteiro manual com contato do time, resultado no brief com telefone mascarado.
- Bancada: 10 a 12 roteiros, 3 rodadas por candidato, latência medida na gravação do lado simulado, gabarito automático e nota cega.

## Rollout manual

1. Integração (T700): fechar as frentes antigas e abrir a `harness`.
2. Dia 0: conta na Anthropic; números +55 na Fluke e na Telnyx; spikes T701 a T703; conta na Meta se a Nvoip não receber resposta.
3. Banco: `foundry_dbos` (ou schema) local e no Railway.
4. Deploy no mesmo serviço, com o `Dockerfile` copiando `operador/` e sem sobreposição entre versões.
5. `OPERADOR_ATIVO=1`, `OPERADOR_WORKSPACES` com o workspace de teste e `OPERADOR_DESTINOS_PERMITIDOS` com os números do time; rodar a fatia fina.

## Desvios de complexidade

- DBOS Transact: sem ele, idempotência, retry, espera por aprovação e recuperação seriam reescritos à mão sobre o tick.
- Módulo no mesmo processo: evita criar deploy, endpoint interno e repasse de SSE. O preço é dividir a instância com o web; o lock de líder impede dois executores.
- Seis adaptadores de voz: existem só na bancada; a fatia fina usa o primeiro adaptador com webhook confirmado, atrás da interface `Discador`.
