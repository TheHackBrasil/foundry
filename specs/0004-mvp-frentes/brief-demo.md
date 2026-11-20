# Brief · frente `demo`

Escopo: tela da demo, itens da frente B no
[`docs/plano-mvp.pdf`](../../docs/plano-mvp.pdf), seção 03: tela única com
fontes × campos, tarefas por parte e linha do tempo; upload; carregar
cenário; reset e isolamento por sessão; selo de dados fictícios.

Paths: `apps/web/` e este brief (`speckit/frentes.json`).

Base: `main` no commit que criou a spec 0004.

Proibido: merge na `main`, push fora de `wt/demo`, escrever fora dos paths
(inclusive `packages/shared`, que é da `core`), editar imutável, tocar
`.env*`, commitar segredo, criar CI.

Gate: hook de pre-commit verde (`frente-check`, `repo-guard`,
`prose-evals`) e o build de `apps/web`. Para mudança de UI, os quatro itens
de A6 (contraste, foco e teclado, reduced-motion, alt text).

Reporte: no fim deste brief, conclusão e evidência por tarefa.

## Tarefas, na ordem do plano

| # | Tarefa | Pronto até |
|---|---|---|
| 1 | Scaffolding de `apps/web` (React com Vite) consumindo os tipos de `packages/shared` | 21/11 |
| 2 | Upload de XML e planilha ligado à API da `core` | 22/11 |
| 3 | Tela única: fontes × campos com divergência destacada, tarefas por parte, linha do tempo com hash | 25/11 |
| 4 | Selo "dados fictícios" sempre visível | 25/11 |
| 5 | Carregar cenário, resetar e isolar por sessão | 26/11 |
| 6 | Tela legível em 1440px e 390px, para gravar o vídeo | 27/11 |
| 7 | P1, só com o P0 no ar: fila de revisão da IA e recibo com hash na tela | 28/11 |

## Contratos com outras frentes

- Tipos e API vêm da `core`. Precisa de mudança: anote aqui e combine
  antes; não edite `packages/shared`.
- Arquivos de exemplo para download vêm de `corpus/` (frente `produto`).
- As telas para o vídeo v11 são gravadas daqui, com a frente `produto`.

## Decisões da frente

Formato: data · decisão · motivo. A integração copia para `DECISIONS.md`.

## Reporte
