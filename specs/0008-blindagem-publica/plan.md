# Plano: Spec 0008: blindagem da demo pública (achados de auditoria)

**Spec:** `specs/0008-blindagem-publica/spec.md` · **Data:** 2026-11-23

## Resumo

Uma frente só, `hardening`, sobre `app/` e os pontos de marca em
`site/`. Os achados se agrupam em três ondas que podem rodar dentro da
mesma branch em commits separados: primeiro os P0 de corretude (lock
de idempotência, cota por rotação de cookie, lookup de protótipo no
web, IMAP, planilha solitária, fila de revisão), depois os P1 de
robustez (suíte da web no gate, flake do `.eml`, cobertura dos caminhos
cegos, erros honestos na borda), por fim o P2 de polimento (helper
compartilhado, tipos com fonte única, higiene TS, marca). A ordem
importa para a integração: esta spec entra antes da 0007, porque as
frentes da camada AI nascem sobre este código e a blindagem muda os
arquivos que elas vão tocar.

## Constitution Check

| Artigo | Aplica? | Evidência no plano |
|---|---|---|
| A1 fatia vertical | sim | cada RF é uma correção fechada com teste; nenhum placeholder |
| A2 fronteira de dados | sim | nenhum segredo novo; 503 de âncora passa a vazar menos, não mais |
| A3 escritas/domínio puro | sim | divergência/cadeia/projeção seguem puras em `app/shared/`; locks e I/O na borda |
| A4 superfície pública | sim | nenhuma rota nova; a blindagem é registrada nesta spec e nos READMEs tocados |
| A5 dados pessoais | sim | logs de IMAP e fila de revisão expõem menos identificadores que hoje |
| A6 idioma/identidade/a11y | sim | mensagens seguem pt-BR; correções de marca mantêm o contraste medido da v4 |
| A7 rótulo de ilustrativo | sim | nenhuma afirmação nova; correções registradas por achado |
| A8 gate local | sim | `npm test` passa a cobrir `shared`, `server` e `web`; guard + prose-evals + `tsc --noEmit` |
| A9 ledger imutável | sim | `events` intocado em produção; triggers e hash chain preservados |
| A10 intenção registrada | sim | esta spec + decisões sugeridas D-039 em diante, numeradas pela integração |

## Estrutura e caminhos reais

```
specs/0008-blindagem-publica/
  spec.md  plan.md  tasks.md  brief-hardening.md
app/server/                    # frente hardening
  pipeline.ts                  # lock antes de eventoExiste; helper doc->div->tarefas
  store.ts                     # ItemRevisao no contrato; TIPOS_DOCUMENTO fonte única
  index.ts                     # cota de sessões novas; anchor sem RPC URL no 503
  protecao.ts                  # mensagens novas (sessões, teto global)
  config.ts                    # envs dos tetos novos
  anchor.ts                    # motivo sanitizado; ResultadoAncora único
  seed.ts                      # sem mudança prevista
  ingest/imap.ts               # listener error, instanceof ErroParser, log sanitizado
  ingest/detect.ts             # comentário da regex removido
  ingest/pdf.ts                # timeout de LLM, cap de expansão (P1)
  pipeline.ts, api.test.ts, endurecimento.test.ts, ingest/eml.test.ts  # testes
app/shared/
  model.ts                     # fonte única de TIPOS_DOCUMENTO / tipos da API
  formato.ts                   # já usa Map: referência para o fix do web
app/web/src/
  format.ts                    # ROTULO_* sem protótipo; rotuloTipo morto sai
  matriz.ts                    # chaveTarefa com fonteA/fonteB
  useTorre.ts                  # decodeURIComponent com try
app/package.json, app/tsconfig.json, app/vitest.config.ts
app/contracts/                 # sem mudança prevista; path reservado
site/src/components/domino/    # synced em cor de coordenação; metadados em cinza
site/src/components/stickers/  # paleta Forseti como default
site/public/assets/            # assets mortos da marca antiga fora do deploy
```

Os paths de `site/` entram na `hardening` apenas se a integração
confirmar que a `site-forseti` está parada; caso contrário o RF14 vira
sub-brief dela (perguntas abertas da spec).

## Dados e artefatos

- Artefatos novos: testes de concorrência e de borda, esta spec.
- Artefatos aplicados afetados: nenhum (A9). O ledger de produção
  segue; nenhum dado é migrado ou regravado.
- Migrations: n/a. Nenhuma tabela nova; se um índice ou coluna for
  preciso para o RF2 (contabilidade de workspaces), segue o padrão DDL
  idempotente de `store.ts` e é registrado aqui antes de escrito.

## Matriz de autorização / publicação

| Conteúdo | Público? | Restrição |
|---|---|---|
| `app/` inteiro | sim | código já público; nenhum `.env` tocado |
| `site/` componentes e assets | sim | só pontos de marca; conteúdo factual preservado |
| Logs e erros | sim | RFC: nunca com segredo, RPC URL ou dado pessoal |

## Plano de testes / verificação

- Guard: `node scripts/repo-guard.mjs` e `node scripts/prose-evals.mjs`
  exit 0.
- `tsc --noEmit` em `app/` e `app/web/` com `noUnusedLocals` ligado.
- `npm test` cobrindo `shared`, `server` e `web` (RF7).
- Testes novos por achado: corrida de idempotência, cota por rotação,
  `formatarValor` com `constructor`, erro IMAP não fatal, planilha
  solitária, `aprovarRevisao`, `parsePdf` com LLM mockada, `TRUNCATE`,
  `chaveTarefa` com fontes distintas, 413 na borda, timeout de LLM,
  anchor sem RPC URL, `decodeURIComponent` malformado.
- Smoke refeito na URL pública: item do 413 verde, fechando P-008.
- `eml.test.ts` rodado 10 vezes seguidas sem falha (flake enterrado).
- Aceite: critérios da spec verificados item a item com evidência no
  commit/PR.

## Rollout manual

1. Fase 0: spec + plan + tasks + brief + `frentes.json` com
   `hardening` na `main` (integração). Decisões D-039 em diante
   registradas pela integração em `DECISIONS.md`.
2. Fase 1 (P0, commits em sequência na `wt/hardening`): lock antes de
   `eventoExiste`; cota de sessões novas; `ROTULO_STATUS`; IMAP;
   planilha solitária; `ItemRevisao` no contrato + teste de
   `aprovarRevisao`.
3. Fase 2 (P1): `npm test` com a web; `eml.test.ts` em um servidor;
   cobertura dos caminhos cegos; 413 consistente, cap de PDF, timeout
   de LLM, anchor e logs sanitizados.
4. Fase 3 (P2): helper compartilhado, tipos com fonte única, higiene
   TS, marca v4 nos pontos achados.
5. Fase 4: gates, smoke público, integração na `main`. Reversão:
   `git revert` por commit.
6. Só depois do merge: frentes da spec 0007 abrem sobre a `main`
   blindada.

## Desvios de complexidade

- RF2 (cota de sessões): nenhuma solução é trivial, porque a sessão é
  um cookie sem estado no servidor. A implementação escolhe entre
  janela por IP (estado em memória, no padrão `JanelaFixa`), cap
  global consultando o banco, ou os dois; a escolha é registrada como
  decisão da frente. O teste de aceite vale independente da escolha.
- RF5 (planilha solitária): depende de decisão do usuário (perguntas
  abertas). A frente implementa a opção aprovada e pina com teste.
- RF14 (marca): depende de `site/` estar fora dos paths de outra
  frente ativa; se a `site-forseti` seguir viva, o item vira trabalho
  dela com o mesmo checklist.
