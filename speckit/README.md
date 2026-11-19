# speckit/: comandos do fluxo SDD

Comandos agnósticos de harness: para executar um comando, leia o `.md`
correspondente e siga o procedimento. Cada arquivo define entrada, saída,
passos e gate de saída.

## Mapa

| Comando | Arquivo | Faz |
|---|---|---|
| specify | `speckit/specify.md` | `BACKLOG.md` item → `specs/NNNN-nome/spec.md` |
| clarify | `speckit/clarify.md` | resolve `[NEEDS CLARIFICATION]` |
| checklist | `speckit/checklist.md` | qualidade dos requisitos (só área de risco; antes do plan) |
| plan | `speckit/plan.md` | spec → `plan.md` com Constitution Check |
| tasks | `speckit/tasks.md` | plan → `tasks.md` por fases |
| analyze | `speckit/analyze.md` | coerência spec↔plan↔tasks antes de implementar |
| implement | `speckit/implement.md` | executa tasks com gates por fase |
| converge | `speckit/converge.md` | fecha: aceite item a item + evidência + commit |
| constitution | `speckit/constitution.md` | emenda da constituição (só PR próprio) |
| frentes | `speckit/frentes.md` | trabalho paralelo: worktrees, briefs, integração, agentes |

## Regras transversais

- Nunca pule `analyze` antes de `implement`.
- Gate local a cada fase: `node scripts/repo-guard.mjs` exit 0.
- Evidência real (saída de comando, `arquivo:linha`): nunca "verificado".
- Mudança trivial não passa por aqui: veja `.specify/README.md` § "Quando a
  spec é obrigatória".
