# Brief · frente `core`

Escopo: núcleo do MVP, itens da frente A no
[`docs/plano-mvp.pdf`](../../docs/plano-mvp.pdf), seção 03: hospedagem,
modelo canônico, parsers, registro append-only com cadeia de hash, motor de
divergência, API e tempo real.

Paths: `apps/core/`, `packages/shared/`, `infra/` e este brief
(`speckit/frentes.json`).

Base: `main` no commit que criou a spec 0004.

Proibido: merge na `main`, push fora de `wt/core`, escrever fora dos paths,
editar imutável, tocar `.env*`, commitar segredo, criar CI.

Gate: hook de pre-commit verde (`frente-check`, `repo-guard`,
`prose-evals`) e os testes de `apps/core`.

Reporte: no fim deste brief, conclusão e evidência (`arquivo:linha`, saída
de teste) por tarefa.

## Tarefas, na ordem do plano

| # | Tarefa | Pronto até |
|---|---|---|
| 1 | Decidir hospedagem com os requisitos da seção 05 do plano e anotar abaixo | 20/11 |
| 2 | Modelo canônico Pedido, Evento, Parte em `packages/shared` | 20/11 |
| 3 | Cadeia de hash com testes (cadeia vazia válida, adulteração detectada) | 20/11 |
| 4 | Esqueleto no ar com URL pública: upload de XML vira pedido | 22/11 |
| 5 | Registro append-only no Postgres com trigger e auditoria | 23/11 |
| 6 | Parsers de NF-e, CT-e, planilha e cancelamento, testados com o corpus | 24/11 |
| 7 | Motor de divergência com tolerância por campo e tabela regra → tarefa, incluindo a tarefa fiscal condicional | 24/11 |
| 8 | Vínculo entre pedidos (A atrasa, B segura a entrega) | 25/11 |
| 9 | Tempo real para a tela, sem recarregar | 25/11 |
| 10 | P1, só com o P0 no ar: e-mail de entrada, IA no texto livre do fornecedor, recibo com hash | 27/11 |

## Contratos com outras frentes

- A `demo` consome os tipos de `packages/shared` e a API. Mudança de
  contrato vai anotada aqui, com data, antes do commit.
- O corpus vem da frente `produto`, em `corpus/`; aqui só se lê.

## Decisões da frente

Formato: data · decisão · motivo. A integração copia para `DECISIONS.md`.

## Reporte
