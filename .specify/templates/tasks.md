# Tasks — Spec NNNN — <título>

Formato: `- [ ] TNNN [P] [USn] descrição — path — verificação`
`[P]` = paralelizável · `[USn]` = história da spec · toda task tem path e
verificação; nenhuma task sem os dois.

## Fase 0 — Contrato

- [ ] T001 <decisão/trava que o resto depende> — <path> — <como verifica>

## Fase 1 — Fundação

- [ ] T002 [P] <estrutura base> — <path> — <verificação>

## Fase 2 — Histórias (por prioridade)

- [ ] T010 [US1] <implementação> — <path> — <verificação>
- [ ] T011 [US1] ...

## Fase 3 — Polimento

- [ ] T090 <a11y, copy, índices, links> — <path> — <verificação>

## Gates locais

- [ ] T099 `node scripts/repo-guard.mjs` exit 0 + critérios da spec item a item — evidência colada no commit/PR
