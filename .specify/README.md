# .specify — Spec-Driven Development local

Pipeline de qualidade **local e manual**: sem CI, sem deploy automático, sem
tracker externo. A fila é `BACKLOG.md`; a validação é `node scripts/repo-guard.mjs`
mais os comandos do DoD em `AGENTS.md`.

## Precedência documental

```
constitution.md > AGENTS.md > PRODUCT.md + RULES.md + docs/ > spec vigente > BACKLOG.md > README.md
```

`DECISIONS.md` é log cronológico (história), não norma — decisões vigentes
dele são promovidas para os documentos acima quando viram regra.

## Quando a spec é obrigatória

Abra spec (`specs/NNNN-nome/`) quando a mudança for **não-trivial**, ou seja,
qualquer uma das condições:

- nova página, seção ou documento indexado (superfície pública — A4);
- altera fato publicado: escopo, decisão, status, pessoa citada, número;
- adiciona código executável ou script novo;
- muda estrutura de pastas, convenção ou o próprio pipeline;
- toca dados pessoais ou fonte primária (A5/A9 — só via artefato novo).

**Dispensam spec** (guard verde basta): typo, formatação, link quebrado,
alt text, renomear arquivo interno — nunca caminho de `.specify/immutable.txt`
— atualizando referências no mesmo commit.

## Fluxo por mudança

```
BACKLOG.md → specify → clarify → checklist (só se área de risco) → plan
           → tasks → analyze → implement (gates por fase) → converge → commit/PR
```

`checklist` avalia a qualidade dos requisitos da **spec** — roda antes do
`plan` e só quando a spec toca área de risco (`speckit/checklist.md`).

Os comandos vivem em `speckit/` e são agnósticos de harness: leia o `.md`
correspondente e execute o procedimento.

## DoD local (Definition of Done)

```bash
node --check scripts/repo-guard.mjs   # o próprio guard é válido
node scripts/repo-guard.mjs           # exit 0
```

Mais, quando existirem e forem tocados: validação manual de UI (a11y, A6) e
critérios de aceite da spec item a item. Cole a saída real no commit/PR.

Hook git opcional (não instalado): `.git/hooks/pre-commit` chamando
`node scripts/repo-guard.mjs`.

## Numeração e retenção de specs

- Diretório `specs/NNNN-nome-curto/`, número de 4 dígitos, sequencial,
  único e crescente. Próximo livre em `specs/README.md`.
- Lacunas só com registro explícito em `specs/README.md`.
- Status: `rascunho → aprovada → implementada → entregue`; pode ser
  `supersedida` por spec mais nova (apontar qual).
- Specs **nunca são deletadas**. Entregue é imutável (A9): correção via
  errata datada ou spec nova.
