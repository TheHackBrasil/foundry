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

Cada spike registra aqui a resposta, a fonte e o comando usado.

### T702: DBOS sobre PGlite (26/11)

Resposta: não roda. O DBOS 5.7.0 só conecta por `systemDatabaseUrl` ou por
um `Pool` do `pg` (`systemDatabasePool`, em
`app/node_modules/@dbos-inc/dbos-sdk/dist/src/dbos-executor.d.ts`), e o
PGlite não abre socket sem o `pglite-socket`, que não está nas
dependências. Os testes de fluxo usam o Postgres do
`app/docker-compose.yml`, num banco próprio (`foundry_teste_operador`, criado
pelo teste se faltar), e são pulados quando o banco não responde, então o
`npm test` continua passando sem Docker.

Versões: `@dbos-inc/dbos-sdk` 5.7.0, Postgres 17.12 (imagem
`postgres:17-alpine`), Node 22.19.0.

Estado do DBOS: schema `dbos` no mesmo Postgres do app
(`systemDatabaseSchemaName: 'dbos'`). O launch criou 14 tabelas (entre elas
`workflow_status`, `operation_outputs`, `notifications`) sem tocar o schema
`public`. O checkpoint do passo transacional fica em
`dbos.transaction_completion`, criado pela fonte de dados do ledger.

Versão do app: o DBOS só recupera fluxo pendente da mesma
`applicationVersion`; sem valor, ele calcula um hash do código e um deploy
novo deixa os fluxos antigos órfãos. O operador exige `OPERADOR_VERSAO` e não
sobe sem ela.

Comandos:

```bash
docker compose -f app/docker-compose.yml up -d
cd app
npx vitest run operador/db-dbos.test.ts operador/index.test.ts operador/fluxo/caso.test.ts
# sem banco, as suítes com Postgres aparecem como puladas:
DATABASE_URL=postgres://x:x@localhost:5999/x npx vitest run operador
```

Consequências no código (T723 a T725):

- O SDK 5.7 tira as transações do núcleo e as põe em fontes de dados
  (`@dbos-inc/dbos-sdk/datasource`). O pacote pronto para `pg` não está nas
  dependências, então `app/operador/db-dbos.ts` implementa o contrato público
  `DataSourceTransactionHandler`: evento e checkpoint na mesma transação,
  replay do checkpoint depois de queda e conferência de dono do fluxo antes
  do COMMIT.
- O `contato_iniciado` é gravado com commit próprio dentro do passo do
  efeito, logo antes da chamada ao fornecedor, porque precisa estar no banco
  antes do efeito. Passo que roda de novo e acha a intenção já gravada
  consulta o fornecedor pela chave em vez de reenviar.
- Recusa definitiva do fornecedor (`contato_falhou`) sobe de degrau como
  prazo vencido; falha ambígua sem resposta na consulta (`contato_incerto`)
  devolve o caso ao analista.
- Duas instâncias no mesmo processo não sobem o DBOS (singleton): o teste
  de liderança usa um lançador falso sobre o lock real do Postgres, e o
  lançador real sobe uma vez no teste do Fastify.

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
- DF-6 (27/11, T760): a ligação sai pela Retell (Claude Haiku 5.5 no cérebro, voz Cartesia em pt-BR) com número próprio da Telnyx ligado por tronco SIP, porque o número comprado dentro da Retell não liga para o Brasil. Enquanto a Telnyx analisa o número brasileiro, sai de um número dos EUA.
- DF-7 (27/11, RF18): a resposta de e-mail à cobrança passa pelo mesmo schema da declaração no Claude Haiku (`extrairDeclaracaoEmail`); o teto por falta de DKIM continua no pipeline. O LLM antigo fica só como reserva sem `ANTHROPIC_API_KEY`.
- DF-8 (27/11): backoffice em `/#/admin`, com a senha `OPERADOR_APROVADOR_TOKEN`, guarda no banco (`operador_config`) os números que a IA pode contatar, a aprovação sem senha da demo e os prazos, limites e horário de contato. O banco vale por cima do env, e o ajuste vale para casos acionados depois de salvar.
- DF-9 (27/11): na demo pública `OPERADOR_WORKSPACES=*` habilita toda sessão menos a seed. `WORKSPACE_LOCAL` junta os navegadores do PC numa sessão só, e vale apenas para conexão local direta, nunca pelo túnel.
- DF-10 (27/11, RF17): o servidor registra o próprio webhook no agente da Retell ao subir (`URL_PUBLICA`); no PC, `npm run tunel` faz o mesmo com o túnel da Cloudflare. Cada ambiente usa o próprio agente.
- DF-11 (27/11, T762): o operador espera a `ligacao_concluida` antes de encerrar a escada, com limite de 30 minutos se o aviso não chegar. A consulta por chave na Retell devolve desconhecido, e o fluxo leva o caso ao analista.
- DF-12 (27/11, T762): o CDN da Retell serve a gravação como `binary/octet-stream`; o download aceita esse tipo só do host da Retell e confere os primeiros bytes de áudio antes de guardar.
