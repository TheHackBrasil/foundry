# /speckit analyze, auditoria de coerência pré-implementação

**Entrada:** `specs/NNNN/{spec,plan,tasks}.md`.
**Saída:** relatório de inconsistências + correções aplicadas (ou
bloqueio explícito). Read-only sobre código; pode editar spec/plan/tasks
para corrigir o que encontrar.

## Procedimento

1. **spec ↔ plan:** todo RF tem endereço no plano? Todo item do plano
   serve a um RF (nada de ouro fora do escopo)?
2. **plan ↔ tasks:** todo caminho do plano tem task? Toda task tem path
   que existe ou será criado pelo plano?
3. **tasks ↔ spec:** união das tasks cobre todos os RFs e critérios de
   sucesso? Marque cobertura por RF.
4. **Constituição:** releia os 10 artigos contra a spec: reporte
   violação por artigo, não por sensação.
5. **Fatos:** toda afirmação factual na spec tem fonte (`docs/`, link)?
   Número sem fonte = violação A7.
6. Corrija o que for mecânico; reporte o que exige decisão.

## Gate de saída

- Tabela de cobertura RF → tasks completa.
- Zero inconsistência aberta, ou a spec volta para `clarify`.
