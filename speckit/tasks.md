# /speckit tasks — decompor em trabalho executável

**Entrada:** `specs/NNNN/plan.md`.
**Saída:** `specs/NNNN/tasks.md` a partir de `.specify/templates/tasks.md`.

## Procedimento

1. Fases na ordem: contrato → fundação → histórias por prioridade →
   polimento → gates.
2. Formato obrigatório por task:
   `- [ ] TNNN [P?] [USn?] descrição — path — verificação`.
   Sem path e sem verificação = task inválida, reescreva.
3. `[P]` só em task que não toca arquivo de outra task da mesma onda.
4. Numeração contínua T001…T999; faixas livres por fase são permitidas.
5. Task de gate no fim: `node scripts/repo-guard.mjs` exit 0 + aceite da
   spec item a item com evidência.
6. Estime dependências: task que depende de outra fica na fase seguinte.

## Gate de saída

- Toda task cobre exatamente um arquivo/grupo coeso.
- Somadas, as tasks cobrem 100% dos RFs da spec (confira um a um).
