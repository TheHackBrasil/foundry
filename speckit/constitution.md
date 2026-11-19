# /speckit constitution, emendar a constituição

**Entrada:** proposta de mudança em `.specify/memory/constitution.md`.
**Saída:** emenda aplicada em PR próprio, com efeitos propagados.

## Procedimento

1. A emenda é sempre um PR **dedicado**: nunca embutida em outra
   entrega. Título: `constituição: <o que muda>`.
2. Justificativa no corpo: qual problema real motivou (violou? ficou
   ambíguo? ficou impossível de verificar?).
3. Propague efeitos na mesma PR: `AGENTS.md`, templates, guard, docs:
   tudo que referencia o artigo tocado.
4. Artigo novo ou alterado precisa de "Verificação" executável: comando
   ou inspeção nomeada. Artigo sem verificação é texto morto.
5. Proibido na constituição: número de teste, contagem de migration,
   referência a ambiente, estado de sprint: só o durável.
6. Numeração de artigos é estável: emendar não reordena A1 a A10; artigo
   revogado fica `~~riscado~~` com ponteiro, não some (histórico).

## Gate de saída

- Todo artigo tem Verificação executável.
- `node scripts/repo-guard.mjs` exit 0 com os marcadores de AGENTS.md
  intactos.
