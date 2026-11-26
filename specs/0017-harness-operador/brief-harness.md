# Brief · harness

Escopo: implementar a spec 0017 (harness de operações) pelas tasks de
`specs/0017-harness-operador/tasks.md`, começando pela fase 0.
Paths: os da entrada `harness` em `speckit/frentes.json`.
Base: branch `feat/0017-harness`, a partir de `ed00fd8`. O usuário pediu
o trabalho fora da `main` até a integração; o worktree `wt/harness` só
nasce se a frente precisar rodar em paralelo com outra.
Proibido: merge em main, push fora da branch, editar imutável, tocar
`.env*` real, escrever fora dos paths, credencial ou telefone real no repo.
Gate: `npm --prefix app test`, `npm --prefix app run typecheck`,
`npm --prefix app/web run typecheck` e `node scripts/repo-guard.mjs` com
exit 0.
Reporte: conclusão por task com evidência `arquivo:linha` e a saída do
gate colada no commit.

## Pendências de integração

- Os worktrees `foundry-wt-app-core`, `foundry-wt-infra` e
  `foundry-wt-operacao` continuam no disco. Os três branches estão
  integrados na `main`; remover com `git worktree remove` fica com o
  usuário.

## Spikes (T701 a T703)

Sem resultado ainda. Cada spike registra aqui a resposta, a fonte e o
comando usado.

## Contas (T709)

- [ ] Anthropic
- [ ] Fluke, plano Início com número
- [ ] Telnyx, número +55 (CNPJ e comprovante de endereço)
- [ ] Meta, Cloud API de WhatsApp, só se o T703 pedir

## Decisões da frente
