# Spec 0017: revisão e próximos passos (passagem de sessão, 26/11)

Documento de passagem para quem continuar a spec 0017. Reúne o estado
dos arquivos, as respostas do usuário no clarify, os achados das três
revisões independentes e a ordem do trabalho que falta. Nada foi
commitado.

## 1. Estado dos arquivos

Criados nesta sessão, fora de commit:

- `specs/0018-harness-operador/spec.md` (status `rascunho`)
- `specs/0018-harness-operador/plan.md`
- `specs/0018-harness-operador/tasks.md`
- `specs/0018-harness-operador/checklist.md`
- este arquivo

Editados:

- `specs/README.md`: linha da 0017 e próximo número `0018`
- `BACKLOG.md`: item 37 marcado `done` (Turso não migra), 45 e 47 em `spec (→ 0017)`
- `DECISIONS.md`: linha D-063 na tabela de decisões vigentes e bloco de sessão no fim

Gate atual: `node scripts/repo-guard.mjs` verde nos 11 checks;
`node scripts/prose-evals.mjs` com 0 dura e uma leve nova (negrito em
excesso na spec, vindo do template).

Problema de fluxo: o speckit exige spec `aprovada`, sem marcadores, antes
de `plan.md` e `tasks.md` (`speckit/plan.md:3`, `speckit/clarify.md:20-21`).
Os dois arquivos foram escritos cedo e precisam ser revistos depois que a
spec for aprovada pelo usuário.

## 2. Respostas do usuário (clarify de 26/11)

Escolhas anteriores, com o texto exato das opções:

- Autonomia: "Consulta e e-mail saem sozinhos; WhatsApp e ligação esperam um OK; qualquer compromisso sempre espera."
- Primeiro corte: "Um caso percorre e-mail, WhatsApp e ligação de teste até virar declaração, em versão simples (o item 47 do backlog). Depois aprofundo cada camada."
- Banco: o melhor por critério técnico, de preferência Postgres.
- Voz: testar todos os candidatos necessários para a melhor experiência.
- Modelos: sem amarra ao modelo gratuito de produção (D-026).

Respostas do clarify desta sessão:

- Orçamento: R$ 5 por caso e R$ 50 por dia, ajustável por env.
- Retenção de áudio e transcrição: 90 dias.
- Número +55: Fluke e Telnyx em paralelo (Fluke para o primeiro fornecedor; Telnyx para ElevenLabs, Retell, LiveKit e GPT-Live).
- Prazos: opção "mais agressiva": e-mail espera 4 h e WhatsApp 1 h. Ligação sai logo após o OK. Seguem as propostas de até 2 tentativas por transportadora por dia e janela das 8h às 18h (horário de Brasília) em dias úteis.

Decisões tomadas sem perguntar, para registrar na spec:

- Quem aprova: só quem tem credencial de aprovador (env), nunca o cookie anônimo.
- Nvoip com webhook de resposta de WhatsApp: vira spike T703. Sem webhook, o degrau usa a Cloud API da Meta.

## 3. Achados das revisões, por prioridade

### Alta: mudar a spec antes de aprovar

1. Discador aberto ao público. O workspace é cookie anônimo; qualquer visitante cadastra telefone, contesta e aprova. Exigir lista de workspaces habilitados (`OPERADOR_WORKSPACES`), lista de destinos permitidos em E.164 (`OPERADOR_DESTINOS_PERMITIDOS`), contato só `fonte='manual'` do próprio workspace (nunca da seed nem de documento) e credencial de aprovador. Checar na política e de novo no adaptador.
2. Id do fluxo colide entre workspaces. `casoId = pedidoId:seq` (`app/shared/casos.ts:24`) não tem workspace, e a seed é pública. Usar `workspace:pedidoId:seqOrigem:ciclo`, um fluxo ativo por workspace, pedido e contraparte. Token do MCP e mapeamento de webhook levam o workspace.
3. Exactly-once incompleto. Trocar `contato_enviado` por `contato_iniciado{chave}`, depois `contato_aceito{idExterno}`, `contato_incerto` ou `contato_falhou`. Chave = hash(fluxo, degrau, tentativa), com índice único parcial no payload. Passo de efeito sem retry automático. O `Discador` declara `suportaIdempotencia` e `consultarPorChave`. Intenção sem aceite: consulta o fornecedor; sem resposta, humano. O Message-ID do e-mail nasce da chave e é gravado antes do envio. O append do ledger precisa rodar no passo transacional do DBOS, com um adaptador `Db` (`app/server/db.ts:8-13`) sobre o client do DBOS.
4. Corrida na aprovação. Evento de aprovação com `planoId`, `versao` e `hashRoteiro`; rota sob `travarPedido` exige plano proposto, prazo vigente e caso aberto (senão 409); editar cria versão nova; antes de discar o operador revalida tudo sob lock; aprovação com validade por env. O sinal é o ledger (o operador sempre relê ao acordar); HTTP e `DBOS.send` só aceleram.
5. Ligação e WhatsApp nunca viram `status_declarado` sozinhos: teto 0,6 abaixo do mínimo 0,7 (`app/server/pipeline.ts:211-212, 315`). Decidir: aprovação na revisão gera `status_declarado` e sinal ao operador, ou teto próprio por canal. Criar o RF de fechamento determinístico: `sem_atualizacao` fecha com declaração aceita posterior; `entrega_sem_confirmacao` só com `entregue`; o app grava `caso_resolvido{origem:'motor'}`. Resposta em revisão pausa a escada.
6. Envios sem aprovação que já existem: `NVOIP_NOTIFY_ON_TASK` (`app/server/pipeline.ts:117-127`) e `COBRANCA_AUTO` (`app/server/pendencia.ts:99`) furam a invariante 2 ou duplicam o degrau de e-mail. Desligar ou subordinar ao operador quando ele estiver ativo.
7. Dado pessoal no ledger fica público e eterno: o comprovante público expõe o payload inteiro (`app/server/comprovante.ts:1-6, 55-60`) e os triggers barram DELETE. O payload leva só `contatoId` e hashes; telefone, roteiro e transcrição ficam em `evidencias`, com job de retenção de 90 dias (`limpar-workspaces.mjs:110-111` hoje não apaga `evidencias`, `contatos` nem `cobrancas`). Mandar o mínimo à Anthropic, sem telefone nem nome.

### Média

8. RF21 vira P0: o IMAP só casa cobrança da seed (`app/server/index.ts:246, 1028-1044`) e só com status `enviada` (`app/server/store.ts:509-516`); resposta tardia nunca casa. Casar só por Message-ID; WhatsApp só por `context.id`; o resto vai para revisão.
9. Injeção pelo roteiro: o roteiro do agente de voz é template com slots tipados e perguntas fechadas; evidência nunca é copiada para ele; "editar roteiro" só mexe nos slots. Saída do Opus por structured outputs. O MCP expõe projeção em allowlist, nunca o `token` do caso (credencial da 0011), telefones, e-mails ou `.eml`. Token preso a workspace, caso e tentativa, revogado em `ligacao_concluida`. Confirmar com quem atendeu antes de ler a chave.
10. Webhook: além da assinatura, janela de timestamp, dedupe por id de evento do fornecedor e mapeamento pelo `idExterno` de `contato_aceito`, nunca pelo corpo. Download de áudio só de host do fornecedor em allowlist, com limite de tamanho e tipo.
11. DBOS no Railway: overlap de deploy zero e lock de líder (`pg_try_advisory_lock`) antes do `DBOS.launch`; verificar no T701 a recuperação entre versões; snapshot da política em `operador_assumiu` (env lida dentro do fluxo quebra o determinismo); dois listeners (público para webhooks e MCP, privado para o interno). O deploy usa `app/deploy/Dockerfile`, que copia só `server/`, `shared/` e `seed/` (35-41); a T795 deve tocar o Dockerfile, não o Procfile nem o `app.json`. Segundo serviço no Railway é decisão de deploy (`AGENTS.md:61`).
12. Controles P0 que faltam: kill switch global e por workspace lido antes de cada efeito; teto de custo com reserva antes de discar; duração máxima e detecção de caixa postal no fornecedor; limite por número de destino somando workspaces; opt-out dito na conversa vira `contato_optout` e para a escada; janela de 24 h do WhatsApp (fora dela, só template).
13. Modelo de eventos: `detectarPendencias` usa o último evento de qualquer tipo (`app/server/pendencia.ts:38-45`), então eventos do operador mascaram a pendência; filtrar por `TIPOS_DOCUMENTO`. A pendência é idempotente para sempre por motivo (`app/server/store.ts:427-434`). Evitar ciclo: caso nascido de canal do operador não dispara escada; contestar só uma vez por divergência. `contato_*` sobrepõe `notificacao` (`app/shared/model.ts:290-300`): decidir entre reusar e excluir. SSE é em memória: evento gravado pelo operador não chega à tela sem LISTEN/NOTIFY ou repasse.
14. Contato por canal: trocar `UNIQUE(workspace_id, parte)` (`app/server/store.ts:54`) quebra `ON CONFLICT` em `store.ts:194, 618, 629` e exige reescrever `contatoDaParte` (593-601) e seus 7 chamadores, além de `listarAgenda` (`app/server/contatos.ts:22-30`) e `app/web/src/components/DrawerAgenda.tsx`. O DDL não é aditivo: corrigir o A9 do plano e criar task. `evidencias` tem hash como PK global (`store.ts:108, 578`): a mesma fixture em dois workspaces fica ilegível no segundo.
15. Contestar divergência precisa de parte de destino (hoje fixa em transportadora), de template e extração para peso e volumes (`app/server/cobranca.ts:53-68`, `pipeline.ts:233-235`) e de `caso_id` na cobrança (hoje é por pedido, `store.ts:482-489`). Renomear: na 0011, "contestar" é ação do parceiro e "operador" é o humano.
16. RF20 corrigido no texto: a cobrança renasce depois de `respondida`, `expirada` ou `erro_envio`, mesmo após `entregue`, num ciclo por expiração (72 h); com SMTP falhando e `COBRANCA_AUTO=1`, a cada tick de 5 min. Condicionar a criação a caso aberto. A frase da `spec.md:9` ("ninguém insiste") contradiz a linha 67.

### Processo e forma

17. Gate não cobre o código novo: `app/vitest.config.ts`, `app/tsconfig.json` e o script `test` só incluem `shared/` e `server/`. Nova task T708 inclui `operador/`; o gate usa `npm --prefix app test` e `npm --prefix app run typecheck`. A T704 também precisa de `FONTES_DOCUMENTO` (`model.ts:46`), `shared/formato.ts:17`, `web/src/format.ts:23` e `shared/formato.test.ts:54`.
18. Frentes: `app-core`, `app-infra`, `hardening`, `ai-ingest`, `ai-mandatos`, `app-brand` e `ai-web` ainda listam `app/server/`, `app/shared/` ou `app/web/` em `speckit/frentes.json`. A T700 precisa encerrar essas entradas e os worktrees `foundry-wt-app-core`, `foundry-wt-infra` e `foundry-wt-operacao` (todos integrados na `main`), atualizar `AGENTS.md:24-25` e `speckit/frentes.md:17-18` e registrar numa decisão. Preferir paths por arquivo, para não travar a spec 0013. Incluir `app/tsconfig.json`, `app/vitest.config.ts`, `app/deploy/` e `app/web/src/format.ts`.
19. Checklist: veredito deve ser "não apta" até zerar os marcadores; remover "sem efeito no desenho"; corrigir linhas citadas (CHK011 `spec.md:141`, CHK022 `:140`, CHK023 `:139`, CHK020 `plan.md:96-106`); criar CHK033 para afirmação factual com fonte (TOTVS "5 a 15", Telnyx "3 dias úteis", documentação lida, Turso, DBOS e Temporal) com links nas Premissas.
20. Registros: item 37 do BACKLOG vai para a seção "Feito"; D-063 está `proposto`, então separar a parte do Turso como `decidido`; item 36 sem nota; cabeçalho da sessão no DECISIONS deve seguir `## Sessão 24: harness de operações, spec 0017 (26/11)`.
21. STYLE: "por fim" (`spec.md:11`), "eleva a confiança" (`spec.md:92`, `tasks.md:55`), "transforma cada resposta" (`plan.md:7`), "o melhor modelo" (`spec.md:111`), "é evidência, não instrução" (`spec.md:62`), "melhor estrutura" no DECISIONS. Tirar negrito das entidades para reduzir os 65 pares.
22. Escopo: seis adaptadores de voz e a bancada com nota cega pesam no P0. Proposta do revisor: P0 com um fornecedor de webhook confirmado e bancada em spec própria. O usuário pediu testar todos; manter a bancada, mas fora do caminho crítico da fatia fina. T703, o modelo da Meta e os números (Fluke e Telnyx) começam no dia 0; T713, T714 e RF21 antes do operador; T795 antes de T798.
23. Modelos: IDs `claude-opus-5-5` e `claude-haiku-5-5` corretos. `tool_choice` forçado dá 400 no Opus 5.5 e no Sonnet 5.5: usar structured outputs. Tratar `stop_reason: refusal`; o Haiku 5.5 não tem fallback no servidor. O Fable 5.2 do eval exige retenção de 30 dias.

## 4. Pesquisas que sustentam a spec

- Infraestrutura: manter Postgres; DBOS Transact (`@dbos-inc/dbos-sdk` 5.7.0, MIT, Node 20+) no processo; Temporal Cloud como plano B; Turso não serve (sem PL/pgSQL, trigger de TRUNCATE e NOTIFY; DBOS e Temporal não rodam nele). Fontes: docs.dbos.dev, docs.temporal.io, docs.turso.tech, docs.railway.com.
- Voz, lineup de teste: Fluke (nuvem no Brasil, plano Início R$ 199); ElevenLabs com Claude e MCP sobre SIP da Telnyx; Retell com Claude e variante fala a fala; Telnyx Voice AI completo; LiveKit Agents em Node; GPT-Live delegando ao Claude. Não confirmados: SIP e exportação de gravação da Fluke; tarifa de saída da Telnyx para o Brasil; webhook de resposta e tronco SIP da Nvoip; pt-BR no GPT-Live. WhatsApp Calling exige permissão prévia e fica para depois.
- Documento de análise de mercado e arquitetura (artefato do Claude, revisão 32, 26/11): base das decisões de escada, modelos e riscos.

## 5. Ordem do trabalho que falta

1. Feito em 26/11: a `spec.md` recebeu as respostas do clarify e os achados 1 a 16 e não tem mais `[NEEDS CLARIFICATION]`. A numeração dos RF mudou (RF1 a RF31); o `plan.md` e o `tasks.md` ainda citam a numeração antiga.
2. Feito em 26/11: `checklist.md` refeito com as linhas novas e veredito "apta depois do aceite do usuário".
3. Feito em 26/11: o usuário aprovou a spec; status `aprovada` na spec e no índice.
4. Feito em 26/11: `plan.md` e `tasks.md` reescritos contra RF1 a RF31. Mudança de desenho: o operador virou módulo no mesmo processo do app (DBOS é biblioteca feita para rodar no Fastify), o que evita criar deploy (`AGENTS.md:61`), endpoint interno e repasse de SSE; um lock de líder no Postgres garante um executor só.
4b. Feito em 26/11: `analyze` independente. Corrigidos os três bloqueios (índice único só em `contato_iniciado`; kill switch no banco com task T731; snapshot da política sem telefones) e as correções mecânicas (comprovante em `app/shared/comprovante.ts`, typecheck da web no gate, `[P]` tirado dos spikes, consentimento do time em T699 antes do T703, frentes `polish-*`, `v2-*`, `motion-fisica` e `adapt-generica` na T700, verificações de destino e de degradação nos adaptadores). Sugestões não aplicadas: testes de revogação do token do MCP e da pausa por revisão pendente; T792 sem RF.
5. Feito em 26/11 para os registros: item 37 movido para "Feito" do BACKLOG; Turso separado na D-064 (`decidido`); sessão renomeada para `## Sessão 24`. Falta o estilo do achado 21 no `plan.md` e no `tasks.md`, junto com a revisão do passo 4.
6. Commit na `main` só quando o usuário pedir: pelo `AGENTS.md`, decisão do dia entra no mesmo commit, com `FOUNDRY_INTEGRA=1`, mensagem `spec: ...` e a saída do guard colada.
7. Depois do commit: T700 (frentes), spikes T701 a T703 e contas (Anthropic, Fluke, Telnyx, Meta).

## 6. Estado da implementação e como continuar (26/11, noite)

### Onde está

Branch `feat/0017-harness` (nada na `main`, a pedido do usuário). Commits:

| Commit | Conteúdo |
|---|---|
| `ed00fd8` | spec 0017 aprovada, plano, tasks, checklist, D-063 e D-064 |
| `cc81892` | T700: frentes antigas encerradas, frente `harness` aberta (D-065) |
| `37ee8ec` | T710 e T711: pendência só por documento, cobrança sem renascer |
| `8050f05` | T704, T707, T708, T720, T721: tipos, envs, escada e política puras |
| `c9f9ad4` | T706: `@dbos-inc/dbos-sdk`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk` |

Tasks feitas e marcadas em `tasks.md`: T700, T704, T706, T707, T708, T710, T711, T720, T721. Decisões tomadas no caminho: DF-1 a DF-5 em `brief-harness.md`.

### Em andamento, sem commit

Três agentes estavam trabalhando em paralelo quando a sessão parou. O trabalho deles pode estar completo, parcial ou ausente na árvore de trabalho. Os grupos não compartilham arquivo:

| Grupo | Tasks | Arquivos |
|---|---|---|
| Núcleo do servidor | T705, T712, T713, T714, T715, T716 | `app/server/store.ts`, `contatos.ts`, `cobranca.ts`, `nvoip.ts`, `pipeline.ts`, `pendencia.ts`, `index.ts`, `agente/toolsEscrita.ts`, `agente/toolsLeitura.ts`, `app/shared/model.ts`, `comprovante.ts`, `casos.ts` e testes |
| Agente Claude | T726, T727 | `app/operador/agente/claude.ts`, `extracao.ts` e testes |
| Borda do operador | T728, T729, T730 | `app/operador/mcp.ts`, `webhooks.ts`, `evidencia.ts`, testes e `app/deploy/limpar-workspaces.mjs` |

Nomes combinados entre os grupos, que precisam bater:

- `evidencias` com chave `(workspace_id, hash)` e coluna `apagar_em TIMESTAMPTZ`;
- `cobrancas.caso_id`;
- índice único parcial `(workspace_id, pedido_id, (payload->>'chave')) WHERE tipo = 'contato_iniciado'`;
- `contatos` único por `(workspace_id, parte, canal)` e coluna `nao_contatar_ia`;
- `Contato.naoContatarIa` em `model.ts`, já usado por `app/operador/politica.ts`;
- `caso_resolvido` com `resolvidoPor: 'motor'`.

### Como retomar, passo a passo

1. `git switch feat/0017-harness` e `git status --short`, para ver o que os agentes deixaram.
2. Rodar o gate em `app/`: `npm test`, `npm run typecheck`, `npm --prefix web run typecheck`; na raiz, `node scripts/repo-guard.mjs` e `node scripts/prose-evals.mjs`.
3. Para cada grupo da tabela, conferir a verificação de cada task em `tasks.md`.
   - Task completa e gate verde: marcar `[x]` e fazer um commit atômico por grupo, com a saída do gate no corpo e sem trailers. Exemplos de mensagem: `feat: agenda por canal, eventos de cobrança, IMAP por Message-ID e fechamento do caso (T705, T712 a T716)`, `feat: cliente Claude e extração de declarações (T726, T727)`, `feat: MCP só de leitura, webhooks verificados e evidência com retenção (T728 a T730)`.
   - Task parcial: terminar seguindo a task e os RF citados nela, ou descartar os arquivos do grupo com `git checkout --` (e apagar os novos) e refazer.
4. Regras do cliente Claude (T726, T727): ids `claude-opus-5-5` e `claude-haiku-5-5`; no Opus 5.5 não dá para desligar o thinking (usar `output_config.effort`); `tool_choice` forçado dá 400 (usar saída estruturada); checar `stop_reason === 'refusal'`; sem prefill e sem `temperature`; testes nunca chamam a API real; sem telefone nem nome no que vai para a API.
5. Regras do MCP (T728): só leitura, projeção em lista fechada (chave da nota, datas, status, pergunta pendente), token HMAC por workspace, caso e tentativa com expiração; nunca devolver o token do caso, telefone, e-mail ou `.eml`.

### Próximas tasks, na ordem

1. T722: projeção do plano e da linha do tempo em `app/shared/casos.ts`, depois que o núcleo estiver commitado.
2. T699, T701, T702, T703 e T709, que dependem do usuário: consentimento das pessoas do time, acesso ao Railway, Postgres local (`docker compose up -d` em `app/`), número para o teste de WhatsApp e contas na Anthropic, Fluke e Telnyx.
3. T723, T724, T725 e T731: adaptador do DBOS, módulo com lock de líder, fluxo por caso com queda em três pontos e kill switch. Dependem dos spikes T701 e T702.
4. T740 a T743: gatilhos e degraus de e-mail e WhatsApp.
5. T750 a T752: aprovação com credencial, versão e 409.
6. T760 a T763: discador, roteiro e fim da ligação. Dependem das contas de voz.
7. T770 a T772: linha do tempo, evidência na tela e agenda por canal.
8. T780 a T784: bancada de voz, em paralelo e fora do caminho crítico.
9. T791 a T799: polimento, Dockerfile, README, A6, fatia fina manual e gate final.

Cuidados que já apareceram:

- Os testes com PGlite e socket real são lentos; o `testTimeout` foi para 20 s (DF-5). Se `stream.test.ts` ou `endurecimento.test.ts` falharem só por tempo, rode isolados antes de concluir que é regressão.
- O hook de pre-commit roda guard e prose-evals. No branch `feat/0017-harness` ele não aplica a checagem de frente.
- Commit na `main` só na integração, com `FOUNDRY_INTEGRA=1` e quando o usuário pedir.
