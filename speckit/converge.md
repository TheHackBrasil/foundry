# /speckit converge: fechar a entrega

**Entrada:** implementação concluída, todos os tasks `- [x]`.
**Saída:** spec Status `entregue`, índices atualizados, commit/PR com
evidência.

## Procedimento

1. Releia a spec e marque cada critério de sucesso: passou com evidência
   (`arquivo:linha`, saída de comando): item a item, na frente de quem
   pediu.
2. DoD completo (`AGENTS.md`): `node --check scripts/repo-guard.mjs` +
   `node scripts/repo-guard.mjs` exit 0 + verificações manuais do plano
   executadas e registradas.
3. Atualize `specs/NNNN/spec.md` → Status `entregue` + seção
   `## Entrega` (data, commit, evidências). A partir daí a spec é
   imutável (A9).
4. Atualize `specs/README.md` (status), `BACKLOG.md` (item feito) e o
   índice de qualquer pasta tocada (A4).
5. Validação em segunda instância: quem integrou revisa o diff inteiro e
   os critérios: não confie só no relatório de quem implementou.
6. Commit/PR referenciando `specs/NNNN` com as saídas reais coladas.
   Merge e publicação são manuais e fora deste fluxo.

## Gate de saída

- 100% dos critérios de sucesso verificados com evidência.
- Nenhum item "quase pronto": spec parcial não vira `entregue`.
