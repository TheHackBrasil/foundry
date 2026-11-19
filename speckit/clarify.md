# /speckit clarify: resolver clarificações

**Entrada:** `specs/NNNN/spec.md` com `[NEEDS CLARIFICATION]`.
**Saída:** spec sem marcadores pendentes, ou lista curta de perguntas
para o usuário quando a resposta não está no repo.

## Procedimento

1. Liste todos os `[NEEDS CLARIFICATION]` da spec.
2. Para cada um, procure a resposta primeiro em: `docs/` (transcrição,
   escopo, fontes), `PRODUCT.md`, specs anteriores, o próprio artefato
   referenciado. Pergunta que o repo responde não vai para o usuário.
3. Respondeu? Substitua o marcador pelo conteúdo e registre a fonte.
4. Não respondeu? Agrupe em no máximo 4 perguntas objetivas com opções
   quando fizer sentido, e pergunte ao usuário de uma vez só.
5. Atualize Status para `aprovada` quando não restar marcador.

## Gate de saída

- Zero `[NEEDS CLARIFICATION]` sem resposta, ou perguntas entregues ao
  usuário (a spec só avança para `plan` com os marcadores resolvidos).
