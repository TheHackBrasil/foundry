# Plano: Spec 0004: MVP da camada de coordenação (documentos + divergência)

**Spec:** `specs/0004-mvp-atraso-propagado/spec.md` · **Data:** 2026-11-20

## Resumo

O problema é um pipeline: documento que cada parceiro já produz (NF-e,
CT-e, CC-e, e-mail, planilha) entra na camada, vira evento num ledger
append-only e dispara divergência + propagação determinística por
parte. Núcleo = parsers + event sourcing + detecção de divergência,
não CRUD. Stack escolhida pelo problema, não por moda: TypeScript
ponta a ponta porque a toolchain on-chain (ethers v6, Hardhat), os
parsers de XML e os tipos compartilhados server x web vivem nele;
Postgres porque é padrão de produção e permite reforçar append-only no
próprio banco (trigger anti UPDATE/DELETE); Fastify porque a API
aberta valida JSON Schema nativamente; SSE porque a propagação é
unidirecional; Base Sepolia porque é L2 pública com explorer e custo
zero. Alternativas descartadas: CRUD (apaga história, que é o
produto), blockchain permissionada (governança inviável e fricção de
adoção, caso TradeLens), EventStoreDB (só responde storage; não
dispensa hash chain nem âncora).

## Constitution Check

| Artigo | Aplica? | Evidência no plano |
|---|---|---|
| A1 fatia vertical | sim | demo ponta a ponta: XML → pedido → divergência → visões → audit; sem placeholder |
| A2 fronteira de dados | sim | sem dados reais; segredo só em `.env` local (gitignore); autorização real fora de escopo |
| A3 escritas/domínio puro | sim | `app/shared/` puro e testado; efeitos em `app/server/` (store, parsers, anchor) |
| A4 superfície pública | sim | `app/` indexado no `README.md` raiz + `specs/README.md` |
| A5 dados pessoais | sim | corpus sintético; upload de visitante isolado por sessão (RF27) |
| A6 idioma/identidade/a11y | sim | UI pt-BR na identidade Foundry; 4 itens a11y nos critérios |
| A7 rótulo de ilustrativo | sim | selo "dados fictícios"; extração por LLM e impacto em R$ rotulados |
| A8 gate local | sim | guard + prose-evals + `node --check` + `tsc --noEmit` + critérios item a item |
| A9 ledger imutável | sim | só artefatos novos; nenhum caminho de `.specify/immutable.txt` |
| A10 intenção registrada | sim | esta spec + D-015 a D-018 |

## Estrutura e caminhos reais

```
app/
  README.md              # visão do app + roteiro da demo
  package.json           # workspace único: server + web + shared
  tsconfig.json
  shared/
    model.ts             # Parte, TipoEvento, Evento, Pedido, VersaoPedido
    chain.ts             # hashEvento, verificarCadeia (puro, testado)
    rules.ts             # divergência → tarefas por parte
    divergence.ts        # compara fontes: data, peso, volumes, status
    chain.test.ts        # prova adulteração e cadeia vazia
  server/
    index.ts             # Fastify: rotas + SSE
    store.ts             # Postgres append-only (efeito na borda)
    anchor.ts            # ethers: POST /api/anchor → tx Base Sepolia
    seed.ts              # carrega seed/ (idempotente)
    ingest/
      nfe.ts             # parser NF-e (RF1)
      cte.ts             # parser CT-e (RF2)
      eventos.ts         # parser CC-e / cancelamento (RF3)
      csv.ts             # planilha CSV (RF6; XLSX fora, D-023)
      eml.ts             # e-mail .eml com anexos (RF28)
      imap.ts            # caixa de e-mail dedicada (RF5)
      pdf.ts             # extração por LLM + fila de revisão (RF7)
  web/
    index.html, src/     # Vite + React: painel de alertas por papel
  contracts/
    FoundryAnchor.sol    # anchor(bytes32 root)
    hardhat.config.ts
  seed/
    xmls/                # corpus sintético coerente (RF21)
    cenario.md           # descrição do cenário, rotulado fictício
  docker-compose.yml     # Postgres 17 local
```

## Dados e artefatos

- Artefatos novos: `app/` inteiro, `specs/0004-mvp-atraso-propagado/`.
- Artefatos aplicados afetados: nenhum (A9).
- Migrations: n/a. O store nasce vazio e a seed recria o cenário.

## Matriz de autorização / publicação

| Conteúdo | Público? | Restrição |
|---|---|---|
| `app/` código e docs | sim | tudo versionado é público (A2) |
| `.env` (chave testnet, credencial IMAP) | não | gitignore já cobre; nunca commitar |
| `seed/` corpus de XMLs | sim | sintético rotulado, CNPJ fictício (A7) |
| Endereço do contrato em testnet | sim | rede pública de teste |
| Caixa de e-mail dedicada | não | conta de demo, credencial em `.env` |

## Plano de testes / verificação

- Guard: `node scripts/repo-guard.mjs` exit 0 e
  `node scripts/prose-evals.mjs` exit 0.
- `node --check` em todo `.js`/`.mjs`; `tsc --noEmit` limpo em `app/`.
- `chain.test.ts`: cadeia válida, adulteração aponta o evento, vazia ok.
- Parser: corpus sintético parseia com campos corretos; XML inválido
  rejeita com erro explícito.
- Manual: demo E2E (XML entra, pedido aparece, divergência propaga nas
  5 visões), audit com link do explorer, a11y item a item.
- Aceite: critérios da spec verificados item a item com evidência.

## Rollout manual (10 dias de calendário)

1. Fase 0 (sexta): spec commitada, `shared/` (modelo + chain + rules)
   pronto e testado; corpus de XMLs começado.
2. Fase 1 (sáb/dom): walking skeleton P0: upload → parser NF-e →
   pedido → divergência → painel SSE. Demo honesta na segunda.
3. Fase 2 (seg/qua): completa P0 (CT-e, eventos fiscais, planilha de atraso, isolamento
   por sessão, testes, hospedagem decidida até 24/11) e começa P1 (IMAP, audit + anchor, linha do tempo).
4. Fase 3 (qui/sáb): P1 wow: dominó por evento, fila de revisão,
   simulação "e se?", PDF por LLM se couber.
5. Fase 4 (dom/seg 30): URL pública estável e vídeo de até 3 min (P0),
   pitch v11 com gravação, capítulo do site,
   comparação Emiteaí, twin de nós se sobrar, gates e ensaio final.
Reversão: `git revert`; frentes integram via `wt/` (`speckit/frentes.md`).

## Desvios de complexidade

- React no `web`: 5 visões sincronizadas por SSE justificam estado
  reativo; a alternativa vanilla cresce frágil na mesma semana.
- Hardhat separado em `app/contracts/`: toolchain Solidity puxa deps
  pesadas; isolar mantém `npm install` do app leve.
- Postgres via Docker: stack de produção desde o dia 1 (decisão do
  time em 20/11); custo aceito é um serviço a mais no setup local.
- Parsers próprios de XML (não lib de NF-e completa): o recorte usa
  só chave, emitente, destinatário, itens, pesos e datas; libs de
  emissão fiscal resolvem um problema que não temos (autorização
  SEFAZ fora de escopo).
- LLM só em `ingest/pdf.ts` com revisão humana: posição recomendada
  pela Schulz para IA em logística; nunca decide sobre a carga.
