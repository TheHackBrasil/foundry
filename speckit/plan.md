# /speckit plan — especificar o como

**Entrada:** `specs/NNNN/spec.md` aprovada (sem clarificações abertas).
**Saída:** `specs/NNNN/plan.md` preenchido a partir de
`.specify/templates/plan.md`.

## Procedimento

1. Constitution Check A1–A10 **artigo por artigo**, com evidência — "n/a"
   precisa de justificativa de uma linha, não só a sigla.
2. Caminhos reais: verifique no repo que os arquivos/pastas citados
   existem ou serão criados; nunca cite comando ou path inventado.
3. Matriz de publicação: todo artefato novo listado como público ou
   restrito (Pages torna tudo público — A2/A4).
4. Dados e artefatos: o que é novo vs. o que não pode ser tocado (A9,
   `.specify/immutable.txt`).
5. Plano de verificação com comandos reais + inspeções manuais nomeadas.
6. Desvios de complexidade: cada um justificado em uma linha.

## Gate de saída

- Toda linha do Constitution Check preenchida.
- Nenhum caminho, comando ou framework que não exista no repo.
