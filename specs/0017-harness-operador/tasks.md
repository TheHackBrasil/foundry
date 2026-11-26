# Tasks: Spec 0017: harness de operações

Formato: `- [ ] TNNN [P] [USn] descrição: path: verificação`
`[P]` = pode rodar em paralelo com as outras da mesma fase; `[USn]` =
história da spec. Numeração T7xx, prioridade entre parênteses. Frente:
`harness` (worktree `foundry-wt-harness`, branch `wt/harness`), aberta
pela integração em T700. Tasks marcadas "(integração)" rodam na `main`.

## Fase 0: Contrato, spikes e contas

- [ ] T700 (P0) (integração) encerrar `app-core`, `app-infra`, `hardening`, `ai-ingest`, `ai-mandatos`, `app-brand`, `ai-web`, `app-operacao`, as `v2-*`, as `polish-*`, `motion-fisica` e `adapt-generica`, conferindo antes que estão integradas, e os worktrees; abrir a `harness` com os paths do plano e o brief; atualizar `AGENTS.md` e `speckit/frentes.md`; registrar numa decisão: `speckit/frentes.json`, `specs/0017-harness-operador/brief-harness.md`: `frente-check` aceita commit em `wt/harness` só nos paths listados
- [ ] T699 (P0) (integração) consentimento das pessoas do time que vão receber mensagem e ligação de teste, antes do T703: `docs/fontes-e-contatos.md`: registro sem telefone, guard verde
- [ ] T701 (P0) spike do estado do DBOS: banco `foundry_dbos` ou schema próprio, local e no Railway; recuperação de fluxo depois de um deploy de versão nova: `specs/0017-harness-operador/brief-harness.md`: resultado e comando registrados no brief
- [ ] T702 (P0) spike do DBOS sobre PGlite; sem suporte, os testes de fluxo usam o Postgres do `app/docker-compose.yml`: `specs/0017-harness-operador/brief-harness.md`: decisão e comando de teste registrados
- [ ] T703 (P0) spike de WhatsApp: a Nvoip entrega resposta recebida por webhook? Sem isso, Cloud API da Meta com modelo aprovado: `specs/0017-harness-operador/brief-harness.md`: fonte citada e uma mensagem de ida e volta com contato do time
- [ ] T704 (P0) tipos: eventos novos, fontes `whatsapp_transportadora` e `ligacao_transportadora`, `FONTES_DOCUMENTO`, rótulos e plano de contato: `app/shared/model.ts`, `app/shared/formato.ts`, `app/shared/formato.test.ts`, `app/web/src/format.ts`: `npm --prefix app test`, `npm --prefix app run typecheck` e `npm --prefix app/web run typecheck` limpos
- [ ] T705 (P0) DDL idempotente: contatos por canal com `nao_contatar_ia`; `evidencias` por workspace e hash com `apagar_em`; índice único da chave em `events`; `caso_id` em `cobrancas`; `contatoDaParte`, `listarAgenda` e os sete chamadores ajustados: `app/server/store.ts`, `app/server/contatos.ts`, `app/server/cobranca.ts`, `app/server/nvoip.ts`, `app/server/pipeline.ts`, `app/server/index.ts`, `app/server/agente/toolsEscrita.ts`, `app/server/agente/toolsLeitura.ts`: teste com PGlite sobe base nova e base existente sem perder contato
- [ ] T706 (P0) dependências `@dbos-inc/dbos-sdk`, `@anthropic-ai/sdk` e `@modelcontextprotocol/sdk`: `app/package.json`, `app/package-lock.json`: `npm --prefix app install` e typecheck limpos
- [ ] T707 (P0) envs novas com padrão seguro (`OPERADOR_ATIVO=0`): `app/.env.example`: guard verde
- [ ] T708 (P0) incluir `operador/` no typecheck e nos testes: `app/tsconfig.json`, `app/vitest.config.ts`, `app/package.json`: `npm --prefix app test` lista arquivos de `operador/`
- [ ] T709 (P0) contas: Anthropic, Fluke (plano Início com número), Telnyx (CNPJ e comprovante) e Meta se o T703 pedir; credenciais só em env: `specs/0017-harness-operador/brief-harness.md`: checklist de contas no brief, check `secrets` do guard verde

## Fase 1: Correções que a escada pressupõe

- [ ] T710 (P0) pendência considera só eventos de documento (RF6): `app/server/pendencia.ts`: teste com evento do operador não renova a última atualização
- [ ] T711 (P0) cobrança só nasce com caso aberto e não renasce depois de `respondida`, `expirada` ou `erro_envio` (RF13): `app/server/pendencia.ts`, `app/server/store.ts`: teste com três ticks seguidos para cada status não cria segunda cobrança
- [ ] T712 (P0) eventos `cobranca_enviada` e `cobranca_expirada`, Message-ID derivado de `cobrancaId` e da tentativa e gravado antes do envio (RF13): `app/server/cobranca.ts`, `app/server/store.ts`, `app/server/pendencia.ts`: teste confere os eventos e o Message-ID
- [ ] T713 (P0) IMAP casa cobrança de qualquer workspace só por Message-ID, inclusive depois da expiração (RF27): `app/server/index.ts`, `app/server/store.ts`, `app/server/pipeline.ts`: teste com resposta tardia de workspace de sessão
- [ ] T714 (P0) `NVOIP_NOTIFY_ON_TASK` e `COBRANCA_AUTO` não disparam com operador ativo no workspace (RF20): `app/server/pipeline.ts`, `app/server/pendencia.ts`: teste com os dois ligados e o operador ativo não envia nada em paralelo
- [ ] T715 (P0) comprovante público nunca expõe dado do operador (RF25): `app/shared/comprovante.ts`, `app/server/index.ts`: teste do comprovante de um caso trabalhado sem telefone nem transcrição
- [ ] T716 (P0) fechamento determinístico do caso e gravação de `caso_resolvido` com origem `motor` (RF5): `app/shared/casos.ts`, `app/server/pipeline.ts`: teste para `sem_atualizacao` e `entrega_sem_confirmacao`

## Fase 2: Fundação do operador

- [ ] T720 (P0) [P] escada pura: ordem, prazos, pulo de canal, encerramento (RF2, RF3): `app/operador/fluxo/escada.ts`: `app/operador/fluxo/escada.test.ts` (novo) cobre os casos de borda da spec
- [ ] T721 (P0) [P] política pura: workspaces, destinos, contato manual, janela America/Sao_Paulo, tentativas somando workspaces, orçamento com reserva, kill switch (RF7 a RF9): `app/operador/politica.ts`: `app/operador/politica.test.ts` (novo)
- [ ] T731 (P0) kill switch global e por workspace no banco, rota com credencial de aprovador, lido antes de cada efeito (RF10): `app/server/store.ts`, `app/server/index.ts`, `app/operador/fluxo/caso.ts`: teste: com a chave desligada nenhum efeito sai, inclusive no meio de um fluxo
- [ ] T722 (P0) [P] projeção do plano de contato, da linha do tempo e do estado de cada tentativa: `app/shared/casos.ts`: `app/shared/casos.test.ts` (novo) com eventos sintéticos
- [ ] T723 (P0) adaptador `Db` sobre o client transacional do DBOS para o append do ledger rodar no passo: `app/operador/db-dbos.ts`: teste grava evento e checkpoint na mesma transação
- [ ] T724 (P0) módulo do operador: lock de líder, `DBOS.launch`, rotas no Fastify, desligado sem `OPERADOR_ATIVO=1`: `app/operador/index.ts`, `app/server/index.ts`: duas instâncias locais, só uma executa fluxos
- [ ] T725 (P0) fluxo por caso com id `workspace:pedido:seqOrigem:ciclo`, snapshot da política e `contato_iniciado`, `contato_aceito`, `contato_incerto`, `contato_falhou` sem retry automático (RF1, RF12): `app/operador/fluxo/caso.ts`: teste de queda em três pontos sem efeito repetido; segundo caso da mesma contraparte não abre fluxo novo
- [ ] T726 (P0) cliente Claude com o SDK da Anthropic, schema estruturado, recusa tratada e evidência marcada como dado (RF22, RF23): `app/operador/agente/claude.ts`: teste com cliente injetado; sem `ANTHROPIC_API_KEY` degrada declarado (NFR-demo); payload enviado sem telefone nem nome
- [ ] T727 (P0) extração com Claude Haiku 5.5 que manda para a revisão; aprovar na revisão grava `status_declarado` e sinaliza o operador (RF18): `app/operador/agente/extracao.ts`, `app/server/pipeline.ts`: teste com transcrição sintética que tenta instruir o agente
- [ ] T728 (P0) servidor MCP só de leitura, projeção em lista fechada, token por workspace, caso e tentativa, `caso_encerrado` quando o caso fecha (RF21): `app/operador/mcp.ts`: `mcp.test.ts` recusa escrita, outro caso e token vencido e nunca devolve token do caso nem telefone
- [ ] T729 (P0) webhooks com assinatura, janela de timestamp, dedupe e mapeamento por id externo (RF17): `app/operador/webhooks.ts`: `webhooks.test.ts`
- [ ] T730 (P0) evidência: download só de host permitido, limite de tamanho e tipo, sha256, `apagar_em` de 90 dias e job de retenção (RF25): `app/operador/evidencia.ts`, `app/deploy/limpar-workspaces.mjs`: teste com áudio sintético e varredura de payload sem dado pessoal

## Fase 3: Fatia fina (histórias por prioridade)

### US1 e US3: gatilhos e escada

- [ ] T740 (P0) [US1] operador assume ao abrir `pendencia_aberta` fora da seed, em workspace habilitado (RF4): `app/server/pendencia.ts`, `app/operador/index.ts`: teste grava `operador_assumiu` uma vez por caso
- [ ] T741 (P0) [US3] "Acionar o operador" num caso de divergência, uma vez por divergência; caso nascido de canal do operador não aciona (RF4): `app/server/index.ts`, `app/web/src/operacao/PaginaOperacao.tsx`: teste de rota, seed responde 403, segundo clique responde 409
- [ ] T742 (P0) [US1] degrau de e-mail no fluxo: `app/operador/canais/email.ts`: teste envia uma vez e sobe de degrau em 4 h
- [ ] T743 (P0) [US1] degrau de WhatsApp com o adaptador do T703 e casamento da resposta pelo id da mensagem (RF14): `app/operador/canais/whatsapp.ts`: teste de contrato com fixture rotulada; adaptador recusa destino fora da lista; sem credencial degrada declarado

### US2: aprovação

- [ ] T750 (P0) [US2] rotas de plano com credencial de aprovador, versão, hash do roteiro e 409 fora do estado (RF11): `app/server/index.ts`: teste de prazo vencido, duplo clique e caso fechado
- [ ] T751 (P0) [US2] fluxo espera a aprovação relendo o ledger ao acordar e revalida tudo sob lock antes do efeito: `app/operador/fluxo/caso.ts`: teste: aprovação válida sai uma vez; vencida ou de versão antiga não sai
- [ ] T752 (P0) [US2] painel de aprovação com canal, contato, campos do roteiro, motivo e custo: `app/web/src/operacao/PainelAprovacao.tsx`: teste com `renderToStaticMarkup` e evidência manual do A6

### US4: ligação

- [ ] T760 (P0) [US4] interface `Discador` com idempotência e consulta por chave, e adaptador do primeiro fornecedor com webhook confirmado (RF15): `app/operador/canais/voz/discador.ts`: teste de contrato; adaptador recusa destino fora da lista; sem credencial degrada declarado
- [ ] T761 (P0) [US4] roteiro com campos tipados e perguntas fechadas: confirma com quem fala, identificação, aviso de gravação, oferta de pessoa, opt-out, nada de compromisso (RF16): `app/operador/canais/voz/roteiro.ts`: teste confere as frases obrigatórias e recusa evidência copiada para o roteiro
- [ ] T762 (P0) [US4] fim da ligação: webhook, evidência, extração e revisão; opt-out grava `contato_optout` e para a escada (RF17, RF18): `app/operador/webhooks.ts`, `app/operador/fluxo/caso.ts`: teste ponta a ponta com fixture rotulada
- [ ] T763 (P1) [US4] confirmação por escrito depois da ligação; resposta com DKIM aumenta a confiança (RF19): `app/operador/canais/email.ts`: teste da declaração com confiança maior depois da resposta assinada

### US5: revisão

- [ ] T770 (P0) [US5] rotas de linha do tempo e de evidência do caso, só para a sessão dona (RF26): `app/server/index.ts`: teste de autorização por workspace
- [ ] T771 (P0) [US5] linha do tempo com ações, áudio, transcrição e declaração, recebendo eventos pelo SSE (RF26): `app/web/src/operacao/LinhaTempoCaso.tsx`, `app/web/src/operacao/api.ts`: teste com `renderToStaticMarkup` e evidência manual do A6
- [ ] T772 (P0) [US5] agenda por canal com fonte e `nao_contatar_ia`: `app/web/src/components/DrawerAgenda.tsx`, `app/server/contatos.ts`: teste da rota de contatos e do componente

### US6: bancada de voz (paralela, fora do caminho crítico)

- [ ] T780 (P0) [US6] transportadora simulada com URA e personas, rotulada como simulação (RF28): `app/operador/bancada/simulada/`: ligação de teste atende e grava os dois lados
- [ ] T781 (P0) [US6] 10 a 12 roteiros com gabarito: `app/operador/bancada/roteiros/`: revisão humana registrada no brief
- [ ] T782 (P0) [US6] adaptadores: Fluke, ElevenLabs com Claude, Retell com Claude e variante fala a fala, Telnyx Voice AI, LiveKit Agents e GPT-Live delegando ao Claude: `app/operador/canais/voz/`: cada um completa uma ligação para a simulada
- [ ] T783 (P0) [US6] runner e relatório com latência p50 e p95 do lado simulado, acerto, nota cega, evidência, caller ID e custo (RF29): `app/operador/bancada/relatorio.ts`: tabela gerada e rotulada como teste
- [ ] T784 (P1) eval de modelos do agente do caso (RF30): `app/operador/bancada/eval-modelos/`: tabela de acerto e custo por modelo, com versão fixada

## Fase 4: Polimento

- [ ] T791 (P1) traces OpenTelemetry e Phoenix local (RF31): `app/operador/index.ts`: trace de um caso visível ponta a ponta
- [ ] T792 (P1) (integração) status das specs 0010 e 0011 e a 0010 completada a partir da linha 174: `specs/0010-agente-cobranca-status/spec.md`, `specs/0011-modelo-excecao/spec.md`, `specs/README.md`: guard verde
- [ ] T795 (P0) imagem de deploy copia `operador/`; deploy sem sobreposição entre versões: `app/deploy/Dockerfile`, `specs/0017-harness-operador/brief-harness.md`: imagem sobe local, o operador assume o lock e a configuração de deploy sem sobreposição fica registrada no brief
- [ ] T796 (P0) (integração) registrar rotas, envs e o módulo novos: `app/README.md`: guard verde
- [ ] T797 (P0) A6 nas telas novas: `app/web/src/operacao/`: evidência item a item no commit
- [ ] T798 (P0) fatia fina manual com contato do time: e-mail, WhatsApp e ligação até a declaração aprovada e o caso fechado: `specs/0017-harness-operador/brief-harness.md`: resultado no brief com telefone mascarado, saída colada no commit

## Gates locais

- [ ] T799 (P0) gate: `npm --prefix app test`, `npm --prefix app run typecheck`, `npm --prefix app/web run typecheck`, `node --check scripts/repo-guard.mjs`, `node scripts/repo-guard.mjs` e `node scripts/prose-evals.mjs` com exit 0; critérios de sucesso da spec item a item com evidência
