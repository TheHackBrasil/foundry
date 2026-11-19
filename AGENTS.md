# AGENTS.md: contrato operacional

## Ordem de leitura

1. `.specify/memory/constitution.md`: regras máximas (A1–A10).
2. Este arquivo.
3. `PRODUCT.md` + `docs/`, o que o produto é e o que a pesquisa provou.
4. `specs/` vigente → `BACKLOG.md` → `README.md`.
Conflito resolve-se a favor do primeiro da lista.

## Regras duras

- Mudança não-trivial exige spec em `specs/` (regra em `.specify/README.md`).
  Triviais (typo, link, formato) dispensam spec, nunca dispensam o guard.
- Nunca editar nem apagar: arquivos de `.specify/immutable.txt`, specs com
  Status `entregue`, migrations e releases publicados (A9). Correção =
  artefato novo ou errata datada.
- Nunca commitar `.env*`, credencial, fonte primária não-revisada ou
  afirmação sem fonte (A5/A7).
- Tudo neste repo é tratado como público (Pages expõe tudo, A2).
- Fluxo SDD: `speckit/` (specify → clarify → checklist se risco → plan →
  tasks → analyze → implement → converge). Agnóstico: leia e execute.
- Frentes paralelas: 1 worktree + branch `wt/<nome>` + brief por frente;
  duas frentes nunca escrevem no mesmo arquivo. Protocolo completo em
  `speckit/frentes.md`.
- Decisão do dia entra em `DECISIONS.md` no mesmo commit (D/R/P);
  bloco de trabalho vira `## Sessão N`.
- Prosa segue `STYLE.md` (antislop). Antes de escrever ou editar texto
  para humanos: invocar a skill `humanizer` (docs/prosa) ou
  `antislop-copywriting` (copy do site/pitch) quando disponíveis no
  harness; sem a skill, aplicar o guia à mão. Travessão é proibido em
  `.md` (o guard falha).
- Commits: atômicos, `<tipo>: <resumo>` (docs|feat|fix|spec|chore),
  `user.name=thisux1`,
  `user.email=125291983+thisux1@users.noreply.github.com`, sem trailers.

## Definition of Done

```bash
node --check scripts/repo-guard.mjs
node scripts/repo-guard.mjs    # exit 0
```

Mais, quando aplicável: critérios da spec item a item com evidência;
os 4 itens de A6 (contraste, foco/teclado, reduced-motion, alt text)
em mudança de UI. Cole a saída real no commit/PR.

Hook git opcional (não instalado): `.git/hooks/pre-commit` →
`node scripts/repo-guard.mjs`.

## Não faça

- Não crie CI, workflow, deploy, preview, branch protection nem tracker
  externo, a fila é `BACKLOG.md`, a validação é local.
- Não crie segunda constituição nem checklist duplicado fora de `specs/`.
- Não invente comando, script, path ou framework: descubra o real.
- Não edite a constituição fora de PR próprio (`speckit/constitution.md`).
- Não apresente simulação/mock como dado medido ou validado (A7).
- Não trabalhe em duas frentes sobre o mesmo arquivo; não integre branch
  sem ler o diff e rodar o guard você mesmo (segunda instância).
