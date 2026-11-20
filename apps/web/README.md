# apps/web: tela da demo

Dona: frente `demo` (branch `wt/demo`, brief em
[`specs/0004-mvp-frentes/brief-demo.md`](../../specs/0004-mvp-frentes/brief-demo.md)).

O que vai aqui: a tela única da demo (fontes × campos, tarefas por parte,
linha do tempo), upload, carregar cenário, reset por sessão e selo de dados
fictícios. Escopo no [`docs/plano-mvp.pdf`](../../docs/plano-mvp.pdf),
seção 03.

Regras de pasta:

- `package.json` e lockfile ficam nesta pasta; a raiz do repo não tem
  `package.json`.
- Tipos do pedido e dos eventos vêm de `packages/shared/` (frente `core`).
  Precisa de mudança no contrato: anote no brief e combine com a `core`.
- Os arquivos de exemplo para download vêm de `corpus/` (frente `produto`).
