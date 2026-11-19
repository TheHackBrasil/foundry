# Plano: Spec NNNN: <título>

**Spec:** `specs/NNNN-nome/spec.md` · **Data:** AAAA-MM-DD

## Resumo

<abordagem em 2-4 linhas + por que essa e não a alternativa óbvia>

## Constitution Check

| Artigo | Aplica? | Evidência no plano |
|---|---|---|
| A1 fatia vertical | sim/não | <como garante> |
| A2 fronteira de dados | sim/não | <camada onde autorização vive / por que n/a> |
| A3 escritas/domínio puro | sim/não | <onde ficam efeitos vs lógica pura> |
| A4 superfície pública | sim/não | <novas superfícies + índices atualizados> |
| A5 dados pessoais | sim/não | <inventário tocado? consentimento?> |
| A6 idioma/identidade/a11y | sim/não | <tokens, pt-BR, 4 itens a11y> |
| A7 rótulo de ilustrativo | sim/não | <o que é simulação e como é rotulado> |
| A8 gate local | sim | <comandos que provam> |
| A9 ledger imutável | sim/não | <artefatos novos vs edição de aplicados> |
| A10 intenção registrada | sim | esta spec |

## Estrutura e caminhos reais

```
<arvore de arquivos tocados · caminhos que existem ou serão criados>
```

## Dados e artefatos

- Artefatos novos: <lista>
- Artefatos aplicados/imediatos afetados: <nenhum deve ser editado, A9;
  correção via artefato novo>
- Migrations (quando houver backend): número, retroativo?, rollback: n/a hoje

## Matriz de autorização / publicação

| Conteúdo | Público? | Restrição |
|---|---|---|
| <arquivo/artefato> | sim/não | <por que> |

## Plano de testes / verificação

- Guard: `node scripts/repo-guard.mjs` exit 0
- Scripts: `node --check` em cada arquivo tocado
- Manual: <inspeções que não têm comando, a11y, copy, render>
- Aceite: critérios da spec verificados item a item com evidência

## Rollout manual

<ordem de aplicação local; o que verificar depois de cada passo; como
reverter (revert de commit: nunca editar artefato aplicado)>

## Desvios de complexidade

<todo desvio de simplicidade justificado em 1 linha, ou "nenhum">
