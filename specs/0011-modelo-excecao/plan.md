# Plano: Spec 0011: modelo de exceção completo

**Spec:** `specs/0011-modelo-excecao/spec.md` · **Data:** 2026-11-24

## Resumo

Frente única `app-operacao`, quatro fatias em sequência de
fundação: (1) contrato: `Caso`, transições `caso_*`, `claims`,
`mudanca`, `pedido_documentos` em `model.ts` + schema; (2) motor:
divergence same-source, projeção de caso, identidade, custo,
métricas; (3) servidor: rotas de caso, resposta de parceiro por
token, tick de pendência por documento esperado; (4) web: fila e
detalhe de caso em `#/operacao` + métricas.

## Constitution Check

| Artigo | Aplica? | Evidência no plano |
|---|---|---|
| A1 fatia vertical | sim | cada fatia entrega valor observável: mudanca acende, caso flui, parceiro responde, fila aparece |
| A2 fronteira de dados | sim | nenhuma env nova nesta spec (tick reusa `PENDENCIA_*` da 0010) |
| A3 escritas/domínio puro | sim | caso e métricas são projeção de eventos; custo em módulo puro `shared/custo.ts` |
| A4 superfície pública | sim | rotas declaradas; token opaco; seed 403 em transições |
| A5 dados pessoais | sim | parceiro responde por token sem conta; token hasheado em `dados` |
| A6 UI | sim | `#/operacao` segue identidade v4 e AA |
| A7 honestidade | sim | custo rotulado `simulacao`; nenhuma métrica inventada, tudo de eventos |
| A8 custo/latência | sim | tick único de pendência; projeções incrementais já existentes |
| A9 imutabilidade | sim | trilha antiga sem claims projeta vazio; migração só ADD |
| A10 simplicidade | sim | caso é projeção como as demais; identidade é uma tabela de ligação, não reescrita de chave |

## Dependências e overlaps

- Spec 0010: tick de pendência compartilhado; cobrança por e-mail
  consome o token do parceiro criado aqui. Se 0010 implementar o
  tick antes, RF9 desta spec só adiciona os tipos de documento
  esperado.
- `ai-web`: coordenação por arquivo em `app/web/src/`.
