# AGENTS.md: contrato operacional

## Ordem de leitura

1. `.specify/memory/constitution.md`: regras máximas (A1 a A10).
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
  duas frentes nunca escrevem no mesmo arquivo. Frentes atuais: `app-core`,
  `app-demo`, `escopo-produto` (spec 0004). Os paths de cada uma estão em
  `speckit/frentes.json`, e o hook de pre-commit recusa commit fora deles.
  Protocolo completo em `speckit/frentes.md`, mecanismo na spec 0005.
- Na `main`, decisão do dia entra em `DECISIONS.md` no mesmo commit
  (D/R/P); bloco de trabalho vira `## Sessão N`. Dentro de uma frente, a
  decisão vai para a seção "Decisões da frente" do brief (no fim dele, criada na primeira decisão),
  e quem copia para `DECISIONS.md` é a frente `escopo-produto`, dona de
  `DECISIONS.md`, `BACKLOG.md` e `RULES.md`, ou a integração.
- Prosa segue `STYLE.md` (antislop). Antes de escrever ou editar texto
  para humanos: invocar a skill `humanizer` (docs/prosa) ou
  `antislop-copywriting` (copy do site/pitch) quando disponíveis no
  harness; sem a skill, aplicar o guia à mão. Travessão e meia-risca
  são proibidos em `.md` (o guard falha).
- Commits: atômicos, `<tipo>: <resumo>` (docs|feat|fix|spec|chore),
  autor real: humano commita com seu `user.name`/`user.email` do GitHub;
  agente commita com a identidade de bot da sua sessão (ex.: `devin`
  <158243242+devin-ai-integration[bot]@users.noreply.github.com>),
  nunca a de uma pessoa, sem trailers.

## Definition of Done

```bash
node --check scripts/repo-guard.mjs
node scripts/repo-guard.mjs && node scripts/prose-evals.mjs   # ambos exit 0
```

Mais, quando aplicável: critérios da spec item a item com evidência;
os 4 itens de A6 (contraste, foco/teclado, reduced-motion, alt text)
em mudança de UI. Cole a saída real no commit/PR.

Hook versionado em `scripts/hooks/pre-commit`: roda
`scripts/frente-check.mjs` (paths da frente; `main` só com
`FOUNDRY_INTEGRA=1`), `repo-guard` e `prose-evals`. Ativar uma vez por
clone: `git config core.hooksPath scripts/hooks`.

## Não faça

- Não crie CI, workflow, deploy, preview, branch protection nem tracker
  externo, a fila é `BACKLOG.md`, a validação é local.
- Não crie segunda constituição nem checklist duplicado fora de `specs/`.
- Não invente comando, script, path ou framework: descubra o real.
- Não edite a constituição fora de PR próprio (`speckit/constitution.md`).
- Não apresente simulação/mock como dado medido ou validado (A7).
- Não trabalhe em duas frentes sobre o mesmo arquivo; não integre branch
  sem ler o diff e rodar o guard você mesmo (segunda instância).
