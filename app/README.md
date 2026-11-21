# app/: MVP da camada de coordenação

Demonstração funcional da spec 0004: a camada lê os documentos que
cada parceiro já produz (XML de NF-e, CT-e, CC-e, e-mail, planilha),
monta um registro único do pedido em cadeia de hashes e, quando duas
fontes divergem (atraso, peso, volumes, status), propaga a tarefa que
cabe a cada parte em tempo real. O histórico é verificável e o resumo
é ancorado numa blockchain pública de teste.

**Status:** em construção. Plano, tasks e briefs das frentes em
[`../specs/0004-mvp-atraso-propagado/`](../specs/0004-mvp-atraso-propagado/spec.md);
fila em `../BACKLOG.md` (item 8).

## Partes

| Pasta | Papel |
|---|---|
| `shared/` | Tipos e regras puras: modelo canônico, cadeia de hashes, detecção de divergência, tabela de propagação |
| `server/` | API REST (Fastify) + Postgres append-only (trigger anti UPDATE/DELETE) + SSE + cliente ethers da âncora |
| `server/ingest/` | Parsers: NF-e, CT-e, eventos fiscais (CC-e), CSV, e-mail (.eml), caixa IMAP, PDF por LLM com revisão |
| `web/` | Painel de alertas por papel (Vite + React): upload, propagação ao vivo, linha do tempo, fila de revisão |
| `contracts/` | `FoundryAnchor.sol` (âncora Merkle) em Hardhat, Base Sepolia |
| `seed/` | Corpus de XMLs sintéticos coerentes (mesma chave, CNPJ fictício), rotulado |

## Rodando

Quando a fase 1 fechar: `docker compose up -d` (Postgres) mais
`npm install` em `app/`, `npm run dev` (server mais web) e
`npm run seed`. Contrato de execução e roteiro de demo no `plan.md` e
`tasks.md` da spec 0004.
