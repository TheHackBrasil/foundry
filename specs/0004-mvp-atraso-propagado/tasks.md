# Tasks: Spec 0004: MVP da camada de coordenação (documentos + divergência)

Formato: `- [ ] TNNN [P] [USn] descrição: path: verificação`
`[P]` = paralelizável · `[USn]` = história da spec · toda task tem path e
verificação; nenhuma task sem os dois. Prioridade entre parênteses
`(P0|P1|P2)`: corte preserva P0, depois P1 na ordem inversa.

Frentes: `wt/app-core`, `wt/app-demo`, `wt/escopo-produto`. Divisão de
pessoas por frente fica a cargo do time. Onda 0 é sequencial (contrato);
as demais seguem `speckit/frentes.md`.

## Fase 0: Contrato (sexta, 20/11)

- [ ] T001 spec + plan + tasks + briefs + decisões registradas: `specs/0004-mvp-atraso-propagado/`, `DECISIONS.md`: guard exit 0
- [ ] T002 (P0) [core] modelo canônico e tabela de regras: `app/shared/model.ts`, `app/shared/rules.ts`: `tsc --noEmit` limpo
- [ ] T003 [P] (P0) [core] cadeia de hashes pura com testes: `app/shared/chain.ts`, `app/shared/chain.test.ts`: teste prova adulteração e cadeia vazia válida
- [ ] T004 [P] (P0) [demo] wireframe do painel por papel aprovado (5 visões + alerta): `app/web/` mock ou desenho commitado: revisão do time
- [ ] T005 [P] (P0) [produto] corpus de XMLs sintéticos começado (1 NF-e completa, chave 44 dígitos, CNPJ fictício, rotulado): `app/seed/xmls/`: revisão do time + rótulo fictício
- [ ] T006 [P] (P0) [produto] roteiro da call Enviagora atualizado para validar produto + pergunta P-002 enviada ao contato TOTVS + P-005 (critérios oficiais da banca) levantado: evidência no Discord, `RULES.md`: revisão do time

## Fase 1: Walking skeleton P0 (sáb/dom, 21-22/11)

- [ ] T010 (P0) [core] skeleton `app/`: package.json, tsconfig, Fastify boot, Vite boot: `app/package.json`, `app/server/index.ts`, `app/web/`: `npm run dev` sobe server e web
- [ ] T011 (P0) [core] Postgres via `docker-compose.yml` + tabela de eventos append-only (trigger rejeita UPDATE/DELETE): `app/docker-compose.yml`, `app/server/store.ts`: curl cria pedido e 2 eventos encadeados; UPDATE manual falha no banco
- [ ] T012 (P0) [core] parser NF-e (chave 44 dígitos = id do pedido; emitente, destinatário, itens, pesos, datas) + `POST /api/ingest` por upload: `app/server/ingest/nfe.ts`, `app/server/index.ts`: XML da seed vira pedido com partes preenchidas; XML inválido rejeita com erro explícito
- [ ] T013 (P0) [core] `divergence.ts` compara fontes (data, peso, volumes, status) + `rules.ts` mapeia divergência → tarefa por parte: `app/shared/divergence.ts`, `app/shared/rules.ts`: NF-e + evento divergente geram tarefa por parte
- [ ] T014 [P] (P0) [demo] painel de alertas por papel renderizando via GET (5 visões, identidade Foundry) + upload de XML na UI + selo "dados fictícios": `app/web/src/`: screenshot 1440 e 390 sem quebra
- [ ] T015 [P] (P0) [produto] corpus completo: NF-e + CT-e + CC-e de atraso coerentes entre si (mesma chave, CNPJ fictício): `app/seed/xmls/`, `app/seed/cenario.md`: XMLs validam no schema; revisão

## Fase 2: Propagação e prova (dom/seg, 22-23/11)

- [ ] T020 [US1] (P0) [core] `GET /api/stream` SSE entregando evento novo: `app/server/index.ts`: 2 clientes recebem evento em <1s
- [ ] T021 [US1] (P0) [demo] divergência propagando nas 5 visões via SSE sem reload: `app/web/src/`: envio de CC-e acende tarefa certa por parte
- [ ] T022 [US2] (P0) [core] `GET /api/pedidos/:id/audit` verifica cadeia e aponta 1ª adulteração: `app/server/index.ts`: UPDATE via admin (bypass da trigger) faz audit falhar nomeando o evento
- [ ] T023 (P0) [core] parser CT-e (liga transportadora e frete à NF pela chave) + parser de eventos fiscais (CC-e, cancelamento): `app/server/ingest/cte.ts`, `app/server/ingest/eventos.ts`: CT-e da seed vincula à NF; CC-e vira evento de atraso
- [ ] T024 (P0) [core] projeção + `GET /api/pedidos/:id` e `/versoes`: `app/shared/`, `app/server/index.ts`: JSON com versão por parte e tarefas
- [ ] T025 (P1) [core] `FoundryAnchor.sol` + deploy Base Sepolia + `POST /api/anchor` + link do explorer no audit: `app/contracts/`, `app/server/anchor.ts`: tx visível em sepolia.basescan.org

## Fase 3: Fator wow P1 (seg/qua, 23-26/11)

- [ ] T030 [P] (P1) [core] caixa de e-mail IMAP: documento anexado entra sozinho na camada: `app/server/ingest/imap.ts`: e-mail com XML anexo vira pedido/evento
- [ ] T031 [P] (P1) [core] ingestão de CSV/XLSX fazendo papel de ERP/WMS: `app/server/ingest/csv.ts`: planilha da seed gera eventos
- [ ] T032 [P] (P1) [core] simulação "e se?" reusando o grafo com entrada hipotética: `app/shared/rules.ts`, `app/server/index.ts`: entrada hipotética gera tarefas sem gravar evento
- [ ] T033 (P1) [demo] dominó da propagação movido por evento real: `app/web/src/`: evento real anima a queda em cadeia
- [ ] T034 [P] (P1) [demo] linha do tempo do pedido com versões lado a lado + hashes clicáveis + tela da fila de revisão: `app/web/src/`: divergência legível entre versões
- [ ] T035 [P] (P1) [core] extração de PDF por LLM + itens ambíguos para a fila de revisão: `app/server/ingest/pdf.ts`: PDF da seed extrai campos com rótulo de extração
- [ ] T036 [P] (P1) [produto] critérios oficiais da banca registrados + comparação com Emiteaí escrita: `RULES.md`, `docs/` ou spec: revisão do time

## Fase 4: Entrega e polish (qui/seg, 26-30/11)

- [ ] T040 (P1) [core] deploy da demo com URL pública: `app/`: juiz acessa e testa com o próprio XML
- [ ] T041 (P1) [demo] a11y: contraste AA, foco visível, teclado, reduced-motion, alt text: `app/web/src/`: checklist A6 item a item
- [ ] T042 [P] (P1) [produto] pitch v11 com gravação da demo: release/asset do time: vídeo publicado
- [ ] T043 [P] (P1) [produto] `app/README.md` com setup em 3 comandos + roteiro de demo de 3 min: `app/README.md`: revisão + links resolvem
- [ ] T044 (P2) [demo] twin da cadeia (mapa de nós, three.js) se P1 fechar cedo: `app/web/src/`: renderiza a cadeia de um pedido real
- [ ] T045 (P2) [core] impacto estimado em reais por divergência com rótulo de simulação: `app/shared/`, `app/web/src/`: valor aparece rotulado
- [ ] T046 [produto] ensaio final da demo + capítulo no site + sessões em `DECISIONS.md`: `DECISIONS.md`, `site/`: sessão datada commitada

## Gates locais

- [ ] T099 `node scripts/repo-guard.mjs` + `node scripts/prose-evals.mjs` exit 0; `tsc --noEmit` limpo; `node --check` em `.js`/`.mjs`; critérios da spec item a item, evidência colada no commit/PR
