# apps/core: núcleo do MVP

Dona: frente `core` (branch `wt/core`, brief em
[`specs/0004-mvp-frentes/brief-core.md`](../../specs/0004-mvp-frentes/brief-core.md)).

O que vai aqui: API, parsers de NF-e, CT-e e planilha, registro append-only
com cadeia de hash, motor de divergência e tempo real. Stack de referência
no [`docs/plano-mvp.pdf`](../../docs/plano-mvp.pdf), seção 05.

Regras de pasta:

- `package.json` e lockfile ficam nesta pasta. A raiz do repo não tem
  `package.json`, para que nenhuma frente dispute arquivo de dependência.
- Tipos compartilhados vêm de `packages/shared/` por caminho relativo.
- O corpus em `corpus/` é fixture de teste: aqui se lê, não se escreve.
- Configuração de deploy e banco local ficam em `infra/`, também da frente
  `core`.
