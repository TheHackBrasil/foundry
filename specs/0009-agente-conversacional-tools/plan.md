# Plano: Spec 0009: agente conversacional com tool calling interno

**Spec:** `specs/0009-agente-conversacional-tools/spec.md` · **Data:** 2026-11-24

## Resumo

Uma frente única de trabalho nesta sessão (sem worktree por frente;
a spec 0007/0008 já integraram e a mudança é coesa demais para
dividir). O corte interno é em três fatias sequenciais com contrato
na frente: (1) contrato em `model.ts` + spec, (2) backend: extensões
de `llm.ts`, registro de tools, motor ReAct e reescrita do handler
`/api/mandatos/stream`, (3) frontend: parser dos eventos novos,
histórico multi-turn e renderização de texto natural + GenUI. A
fatia 1 define os tipos que 2 e 3 consomem; 2 e 3 rodam em paralelo
depois dela.

## Constitution Check

| Artigo | Aplica? | Evidência no plano |
|---|---|---|
| A1 fatia vertical | sim | capacidade completa: endpoint SSE, loop de tools, resposta natural, blocos e testes numa fatia só |
| A2 fronteira de dados | sim | mesmas envs `LLM_*`; nenhum segredo novo; `.env.example` sem valor |
| A3 escritas/domínio puro | sim | tools só consomem `LedgerStore`, `projetar`, `simularHipotese`, `propagarTodas`, `notificarTarefa`; LLM nunca calcula nem monta evento |
| A4 superfície pública | sim | rota declarada nesta spec: `POST /api/mandatos/stream` estendida; `/api/mandatos` congelado |
| A5 dados pessoais | sim | histórico vem no corpo, nunca persiste; contatos seguem na sessão |
| A6 idioma/identidade/a11y | sim | system prompt e respostas pt-BR; trilha de tools com `role=status`; texto natural com a tipografia editorial já existente |
| A7 rótulo de ilustrativo | sim | simulação segue rotulada (layout `simulacao` + selo); bloqueio de seed explicado como regra real, não como erro genérico |
| A8 gate local | sim | `vitest shared server` + `web test`, `tsc --noEmit`, build web, guard, prose-evals, contraste |
| A9 ledger imutável | sim | tools de escrita só `append` por motor com ator/timestamp; `simular_cenario` grava nada; seed somente leitura |
| A10 intenção registrada | sim | esta spec + decisões em `DECISIONS.md` na integração |

## Estrutura e caminhos reais

```
specs/0009-agente-conversacional-tools/
  spec.md  plan.md  tasks.md
app/shared/
  model.ts                  # contrato: TurnoConversa, ToolExecutada,
                            # ResultadoAgente, EventoStreamMandato estendido
app/server/
  llm.ts                    # chatComTools + chatTextoStream + tipos de tool
  agente/
    ferramentas.ts          # registro das 9 tools + validação + execução
    motor.ts                # loop ReAct, histórico, GenUI, emissão de eventos
  index.ts                  # /api/mandatos/stream: body novo + motor do agente
  agente.test.ts            # testes do agente (LLM mockada, PGlite)
app/web/src/
  apiOps.ts                 # envia historico; parse tool/texto_delta/fim
  components/
    PaginaAssistenteIA.tsx  # multi-turn, texto natural, trilha de tools
    PalcoGenUI.tsx          # sem mudança estrutural; recebe os mesmos props
```

## Sequência

1. Contrato (eu, na integração): `model.ts` + spec registrada. Tudo
   que backend e frontend precisam conhecer fica tipado aqui antes.
2. Backend (subagente implementer): `llm.ts`, `agente/`, `index.ts`,
   `agente.test.ts`.
3. Frontend (subagente implementer, em paralelo com 2): `apiOps.ts`,
   `PaginaAssistenteIA.tsx`, ajuste fino de `PalcoGenUI.tsx` se
   necessário.
4. Integração (eu): compila tudo, roda os testes, corrige
   divergências de contrato entre as fatias.
5. DoD completo: guard, prose-evals, contraste, tsc, build web,
   testes. Sem commit, sem deploy.

## Riscos e mitigações

- Provedor sem tool calling: degradação desenhada em RF1/US4; o
  endpoint responde conversa pura em vez de falhar.
- Contrato SSE drift entre backend e front: tipos únicos em
  `model.ts` escritos antes das duas fatias; `apiOps.ts` parseia por
  `tipo` desconhecido com descarte silencioso.
- Loop infinito de tools: teto `MAX_ITERACOES = 6` + erro
  estruturado por tool, cobertos por teste.
- Regressão do `/api/mandatos`: o handler clássico não é tocado;
  testes existentes são a prova.
