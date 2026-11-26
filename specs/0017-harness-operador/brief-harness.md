# Brief · harness

Escopo: implementar a spec 0017 (harness de operações) pelas tasks de
`specs/0017-harness-operador/tasks.md`, começando pela fase 0.
Paths: os da entrada `harness` em `speckit/frentes.json`.
Base: branch `feat/0017-harness`, a partir de `ed00fd8`. O usuário pediu
o trabalho fora da `main` até a integração; o worktree `wt/harness` só
nasce se a frente precisar rodar em paralelo com outra.
Proibido: merge em main, push fora da branch, editar imutável, tocar
`.env*` real, escrever fora dos paths, credencial ou telefone real no repo.
Gate: `npm --prefix app test`, `npm --prefix app run typecheck`,
`npm --prefix app/web run typecheck` e `node scripts/repo-guard.mjs` com
exit 0.
Reporte: conclusão por task com evidência `arquivo:linha` e a saída do
gate colada no commit.

## Pendências de integração

- Os worktrees `foundry-wt-app-core`, `foundry-wt-infra` e
  `foundry-wt-operacao` continuam no disco. Os três branches estão
  integrados na `main`; remover com `git worktree remove` fica com o
  usuário.

## Spikes (T701 a T703)

Sem resultado ainda. Cada spike registra aqui a resposta, a fonte e o
comando usado.

## Contas (T709)

- [ ] Anthropic
- [ ] Fluke, plano Início com número
- [ ] Telnyx, número +55 (CNPJ e comprovante de endereço)
- [ ] Meta, Cloud API de WhatsApp, só se o T703 pedir

## Decisões da frente

- DF-1 (26/11, T707): `OPERADOR_APROVACAO_VALIDADE_MIN=30` e janela no formato `OPERADOR_JANELA=8-18`; a spec não fixava os valores.
- DF-2 (26/11, T720): a declaração tem três estados na escada: `em_revisao` pausa a escada (RF18); `aceita` sem fechar o caso reinicia o prazo do degrau; o prazo da ligação conta a partir do fim da chamada (`decorridoMs: null` enquanto o contato não saiu).
- DF-3 (26/11, T721): as regras de contato (`manual` e `naoContatarIa`) valem também para o e-mail (RF8, invariante 4); lista de destinos, janela e tentativas valem só para WhatsApp e ligação; orçamento para os três canais; sem feriados, dia útil é de segunda a sexta; a janela inclui o início e exclui o fim; chegar no teto exato é permitido.
- DF-4 (26/11, T711): sem `caso_id` (T705), cada caso de pendência aberto tem direito a uma cobrança, vinculada por tempo (nascida em `abertoEm` ou depois); por isso `criada_em` passou a vir do relógio do app. Pedido entregue ou cancelado não gera cobrança até a T716 fechar o caso pela regra do RF5.
- DF-5 (26/11, T708): `testTimeout` de 20 s no `vitest.config.ts`. Testes com PGlite e socket real já rodavam perto dos 5 s isolados e estouravam por tempo com a suíte inteira em paralelo; isolados, passam antes e depois das mudanças.
