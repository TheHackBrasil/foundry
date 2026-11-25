# Brief app-operacao: modelo de exceção (spec 0011)

**Frente:** `app-operacao` · **Branch:** `wt/app-operacao` · **Worktree:** `D:\Projects\foundry-wt-operacao`
**Operador:** Gui · **Spec:** `specs/0011-modelo-excecao/spec.md`

## Escopo

Implementar a spec 0011 inteira: mudança mesma-fonte, casos com
ciclo de vida, claims, identidade muitos-para-muitos, métricas,
custo simulado, link do parceiro e a tela `#/operacao`. Também
absorve o backend da spec 0010 (tick de pendência, SMTP, matching,
DKIM) se ela for aprovada e ninguém tiver começado.

## Paths

`app/shared/`, `app/server/`, `app/web/src/` (apenas telas novas:
`operacao/` + componentes próprios; nunca LP, `#/ia` nem arquivos
do agente), `app/contracts/`, `app/package.json`,
`app/package-lock.json`, `app/.env.example`,
`specs/0011-modelo-excecao/`.

Coordenação com `ai-web` (Thiago): colisão só em arquivo igual,
antes de tocar arquivo existente de `app/web/src/`, checar com ele.

## Decisões da frente

(criada na primeira decisão)
