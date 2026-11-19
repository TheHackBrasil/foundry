# /speckit specify, abrir uma spec

**Entrada:** item do `BACKLOG.md` ou decisão registrada.
**Saída:** `specs/NNNN-nome-curto/spec.md` (Status: rascunho) + entrada no
índice de `specs/README.md` + item do backlog marcado `→ specs/NNNN`.

## Procedimento

1. Confirme que a mudança é não-trivial (`.specify/README.md` § regra de
   obrigatoriedade). Se for trivial, não abra spec: faça direto.
2. Pegue o próximo número livre em `specs/README.md`; crie
   `specs/NNNN-nome-curto/`.
3. Copie `.specify/templates/spec.md` e preencha **todas** as seções.
   O que não souber, marque `[NEEDS CLARIFICATION]`: não invente.
4. Histórias com Dado/Quando/Então observáveis; RFs numerados e
   verificáveis; fora de escopo explícito.
5. Atualize `specs/README.md` (índice + próximo número) e o item do
   `BACKLOG.md`.
6. Nomeie pessoas novas? Atualize `docs/fontes-e-contatos.md` na mesma
   mudança (A5).

## Gate de saída

- Spec completa ou com clarificações marcadas: nunca com seção vazia
  disfarçada.
- `node scripts/repo-guard.mjs` exit 0.
