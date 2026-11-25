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

- Caso é projeção, não tabela: deriva de divergências e pendências
  por (pedido, origem:seq). Ciclo de vida aberto -> em_andamento ->
  resolvido/contestado, com `resolvidoEm` limpo na contestação.
- `mudanca` compara versão N com N-1 da mesma fonte, no pipeline.
- Claims ficam em `dados.claims` do evento; `afirmadoEm` usa a data
  declarada pelo documento quando existe (idempotência preservada).
- Identidade muitos-para-muitos em `pedido_documentos`: NF-e e
  planilha religam por xPed/CNPJ; CT-e, CC-e e e-mail declaram
  `pedidoId` e nunca religam por referência secundária.
- Token do parceiro só vive no evento cru; a projeção do pedido
  não expõe a credencial.
- Comprovante é link-capacidade HMAC stateless (`GET
  /api/comprovante/:ws/:pedido/:t1/:t2/:sig`), sem cookie, sem
  tabela nova; `.eml` bruto nunca sai em resposta pública (só hash).
- Cobrança (spec 0010 absorvida): destinatário re-resolvido da
  agenda no envio; resposta casa por `In-Reply-To`/`References` ou
  chave-44 no assunto/corpo; sem DKIM `pass` a confiança é capada
  em 0.6 e o claim vai para revisão.
- `/api/simulate` aceita `pendenciaHoras` e não persiste nada.

## Demo E2E local (T541)

Banco Postgres real, `SEED_ON_BOOT=1`, sessão de visitante:

1. Ingest de `nfe-ok.xml` na sessão -> pedido `...0000000019` criado.
2. `POST /api/simulate {"pedidoId":"...019","pendenciaHoras":48}` ->
   pendências `sem_atualizacao` + `entrega_sem_confirmacao` e
   `cobrancaSugerida` com assunto pronto; nada persistido.
3. `verificarWorkspace(store, canal, agora+48h)` -> 2 eventos
   `pendencia_aberta` + cobrança `pendente_envio` (sem e-mail na
   agenda, motivo registrado).
4. `POST /api/ingest` com `.eml` citando a chave-44 -> `ok:true`;
   cobrança da sessão -> `respondida`; a cobrança da seed com a
   mesma chave ficou intacta (isolamento por workspace).
5. Claim sem DKIM enfileirado em `/api/revisao` com motivo
   `dkim_nao_verificado`.
6. `GET /api/pedidos/:id/comprovante` -> link; `GET` do link sem
   cookie -> `cadeiaIntegra: true`, casos listados.
