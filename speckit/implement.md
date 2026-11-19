# /speckit implement, executar as tasks

**Entrada:** `specs/NNNN/tasks.md` com `analyze` verde.
**Saída:** mudança implementada fase a fase, com gates locais.

## Procedimento

1. Trabalhe por fase, na ordem do tasks.md. Marque `- [x]` só quando a
   verificação da task passou de verdade (rode ou inspecione: nunca
   assuma).
2. Gate a cada fase concluída: `node scripts/repo-guard.mjs` exit 0.
   Vermelho = pare e conserte antes da próxima fase.
3. Descobriu que a spec/plan está errada ou incompleta? Pare, corrija a
   spec (clarify/plan), refaça analyze: não "improvise no código".
4. Tasks `[P]` da mesma fase podem rodar em paralelo; nunca duas tasks
   no mesmo arquivo.
5. Proibido nesta fase: editar artefato de `.specify/immutable.txt` ou
   spec entregue (A9), commitar `.env*`/segredo, criar superfície fora
   do plano (A4), deixar placeholder (A1).
6. Mudança de UI: antes de fechar a fase, confira os 4 itens de A6
   (contraste, foco/teclado, reduced-motion, alt text).

## Gate de saída (por fase e no fim)

- `node scripts/repo-guard.mjs` exit 0.
- `node --check` em todo script novo/alterado.
- Tasks da fase marcadas com verificação real.
- Todas as tasks concluídas → Status da spec para `implementada`
  (`entregue` só no `converge`, após verificação em segunda instância).
