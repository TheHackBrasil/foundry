# Frentes paralelas: vibecode sem conflito

Protocolo para trabalhar em várias frentes deste repo ao mesmo tempo
(humano + agentes, ou vários agentes), sem pisar no pé um do outro e com o
processo registrado. Inspirado no fluxo `wt-*` do `worcap-hackathon`.

## A regra de ouro

**Uma frente = um worktree + uma branch + um brief. Duas frentes nunca
escrevem no mesmo arquivo.**

```bash
git worktree add ../foundry-wt-<nome> -b wt/<nome>
```

- Worktree nomeado `../foundry-wt-<nome>` (fora da raiz principal), branch
  `wt/<nome>`. O nome descreve a frente: `site`, `slides`, `guard`, `docs`.
- O **dono da frente** trabalha lá dentro; a cópia principal (`foundry/`)
  fica na `main` limpa para integração e leitura.
- A área de cada frente é a lista de paths do brief, espelhada em
  `speckit/frentes.json`: se duas frentes precisarem do mesmo arquivo,
  elas viram uma frente só ou se sequenciam.
- Abrir frente nova = entrada nova em `speckit/frentes.json` + brief,
  commitados na `main` pela integração antes do `git worktree add`.

## O brief (obrigatório antes de começar)

Um arquivo na frente ou em `specs/NNNN/`: o que fazer, os paths que são
seus, o que é proibido, como provar que terminou. Frente sem brief é
frente sem dono: qualquer um pode pisar nela.

```markdown
# Brief · <frente>
Escopo: <o que entrega>
Paths: <arquivos/pastas que esta frente pode escrever>
Base: <commit/branch de partida>
Proibido: merge em main, push fora da branch, editar imutável, tocar .env*,
          escrever fora dos paths
Gate: node scripts/repo-guard.mjs exit 0 (+ comandos da spec)
Reporte: conclusão + evidência arquivo:linha por critério
```

## O hook (imposição, não convenção)

Ativar uma vez por clone: `git config core.hooksPath scripts/hooks`. Os
worktrees do mesmo clone herdam a configuração. O `pre-commit` roda:

- `scripts/frente-check.mjs`: em `wt/<nome>`, recusa arquivo fora dos
  paths da frente; na `main`, recusa commit sem `FOUNDRY_INTEGRA=1`;
  branch `wt/` sem entrada no mapa é recusada.
- `scripts/repo-guard.mjs` e `scripts/prose-evals.mjs`.

`git commit --no-verify` pula o hook. Por isso a integração lê o diff
antes de mergear, sempre.

## Proibições em qualquer frente

Merge na `main`, push fora da própria branch, force-push, rebase sobre
trabalho de outra frente, editar arquivo de `.specify/immutable.txt` ou
spec `entregue` (A9), criar/editar `.env*`, commitar segredo, abrir
superfície fora dos paths do brief (A4), criar CI/deploy/tracker externo.

## Integração (quem junta as frentes)

1. Cada frente faz push da própria branch (`git push -u origin
   wt/<nome>`) sempre que um passo do brief fica verde, e a integração
   junta pelo menos uma vez por dia. Integração só no fim vira conflito
   grande no último dia. Para trazer a `main` para a frente, use
   `git merge main` dentro da branch da frente.
2. O orquestrador integra em segunda instância: não confia no relatório:
   lê o diff inteiro, roda `node scripts/repo-guard.mjs` ele mesmo,
   verifica os critérios de aceite item a item.
3. Merge só depois dos gates verdes na branch integrada. Reverter =
   `git revert`, nunca reescrever histórico publicado.
4. Conflito com outra frente recentemente integrada: resolve quem chegou
   por último, dentro da própria branch: nunca editando a frente alheia.

## Trabalho com agentes, extraindo qualidade

- **Várias pessoas, várias máquinas.** O worktree é local; entre máquinas
  o que vale é a branch da frente. Cada pessoa clona, ativa o hook e cria
  o worktree da sua frente a partir da branch remota:
  `git fetch && git worktree add ../foundry-wt-<nome> wt/<nome>`.
  Uma pessoa só integra na `main` (P-007).
- **Agentes de código em paralelo dentro de uma frente**: cada um no seu
  próprio worktree (no Claude Code, subagente com isolamento em worktree),
  nunca dois agentes escrevendo na mesma pasta.
- **Orquestrador em modelo forte** planeja, reparte frentes e valida;
  subagentes fazem investigação read-only e frentes delimitadas com brief.
- Brief por escrito, não por chat: o agente executa o arquivo, reporta
  contra ele.
- Reporte exigido: conclusão + evidência (`arquivo:linha`, saída de gate)
  por critério: "feito" sem evidência não é feito.
- Ondas por dependência: frentes que se tocam não rodam na mesma onda;
  validação integrada no fim de cada onda.
- O orquestrador nunca mergea relatório não verificado.

## Commits limpos

- Atômico: um commit = uma mudança lógica. Nada de "wip", "ajustes",
  "varios".
- Mensagem: `<tipo>: <resumo em pt-BR>`: tipos `docs`, `feat`, `fix`,
  `spec`, `chore`, `refactor`. Referencia a spec quando houver:
  `docs: capítulo FENATRAN no diário: specs/0003`.
- Identidade (regra do usuário): `git -c user.name=thisux1
  -c user.email=125291983+thisux1@users.noreply.github.com commit`,
  sem `Co-authored-by`, sem trailers gerados.
- Guard verde antes de cada commit; saída relevante colada no corpo do PR.

## Anotando o processo

- Decisão tomada no dia → `DECISIONS.md` (D/R/P) no mesmo commit ou antes,
  quando o trabalho é na `main`. Dentro de uma frente, a decisão vai para
  a seção "Decisões da frente" do brief; a integração copia para
  `DECISIONS.md` ao mergear. Assim nenhuma frente escreve no mesmo log.
- Bloco de trabalho relevante → `## Sessão N: título (data)` em
  `DECISIONS.md`: o que se fez, o que se aprendeu, o que ficou aberto.
- É isso que alimenta o diário build-in-public do site, a narrativa sai
  daqui, não é reescrita depois.
