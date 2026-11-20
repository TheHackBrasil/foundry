# Brief · frente `produto`

Escopo: tudo que prova o MVP para o júri, itens da frente C no
[`docs/plano-mvp.pdf`](../../docs/plano-mvp.pdf), seção 03: corpus
sintético, números de impacto com fonte, README para jurado, roteiro e
vídeo v11, validação com Enviagora e TOTVS, comparação com a Emiteaí.

Paths: `corpus/`, `docs/`, `site/`, `README.md` e este brief
(`speckit/frentes.json`). No `site/`, só atualizar os links da demo e do
vídeo: o site não é avaliado (`RULES.md`).

Base: `main` no commit que criou a spec 0004.

Proibido: merge na `main`, push fora de `wt/produto`, escrever fora dos
paths, editar imutável (`.specify/immutable.txt`), tocar `.env*`, dado
pessoal real no corpus, número sem fonte aberta e conferida (A7).

Gate: hook de pre-commit verde (`frente-check`, `repo-guard`,
`prose-evals`); corpus validado contra o XSD oficial.

Reporte: no fim deste brief, conclusão e evidência por tarefa.

## Tarefas, na ordem do plano

| # | Tarefa | Pronto até |
|---|---|---|
| 1 | Corpus: pedidos A e B (NF-e, CT-e, planilhas do CD e do fornecedor) com variações, CNPJ fictício, validado contra o XSD | 22/11 |
| 2 | Regras fiscais do cenário confirmadas com contador (R-006) | 24/11 |
| 3 | Problema em números, só com fonte primária aberta | 26/11 |
| 4 | Comparação com a Emiteaí; outros concorrentes só com fonte | 27/11 |
| 5 | README para jurado: problema, demo, vídeo, diagrama, como rodar, testes, limites | 28/11 |
| 6 | Roteiro e gravação do vídeo v11, até 3 min, do produto real | 28/11 |
| 7 | Vídeo publicado sem login e links atualizados no README e no site | 29/11 |

## Contratos com outras frentes

- `core` e `demo` só leem o corpus. Mudança de formato do corpus vai
  anotada aqui antes do commit.
- O README descreve o que existe na `main`; não descreve recurso que
  ainda não foi integrado.

## Decisões da frente

Formato: data · decisão · motivo. A integração copia para `DECISIONS.md`.

## Reporte
