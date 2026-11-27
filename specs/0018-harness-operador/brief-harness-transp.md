# Brief · harness-transp (transportadora simulada)

Frente: `harness-transp` (worktree `foundry-wt-harness`, branch
`wt/harness-transp`). Paths: `app/harness/` e este arquivo.
Escopo: a contraparte que fecha o loop da demo ao vivo. O operador cobra a
transportadora por e-mail de verdade; a simulada recebe a cobrança num SMTP
sink local e responde como uma transportadora brasileira responderia, sem
humano e sem internet, pelas bordas reais (SMTP, IMAP, HTTP) e por env.
Zero acoplamento interno: nada no núcleo foi editado.

## Peças (app/harness/)

- `servidor-smtp.ts`: sink SMTP em `node:net` (EHLO, MAIL, RCPT, DATA,
  RSET, NOOP, QUIT). Sem STARTTLS e sem AUTH de propósito.
- `servidor-imap.ts`: caixa IMAP4rev1 mínima sobre TLS (`node:tls`):
  CAPABILITY, LOGIN, NAMESPACE, ENABLE, SELECT, SEARCH/UID SEARCH
  (UNSEEN/SINCE), FETCH/UID FETCH (BODY.PEEK[], FLAGS, INTERNALDATE,
  RFC822.SIZE, ENVELOPE, BODYSTRUCTURE), STORE/UID STORE (\Seen), NOOP,
  IDLE, CLOSE, LOGOUT. Cobre o ciclo `coletarEIngerir` verbatim.
- `tls-dev.ts`: certificado self-signed (CN=localhost, SAN localhost,
  CA:TRUE) gerado pelo openssl do sistema em `os.tmpdir()`, fora do repo
  (o guard barra `.pem`/`.key` versionados).
- `personas.ts`: máquinas de estado determinísticas, sem LLM. Cada roteiro
  tem dois livros: `verdade` (o que aconteceu com a carga) e `declarado`
  (o que a transportadora afirma). A divergência entre os dois é o que a
  plataforma deve detectar.
- `cenarios.ts`: roteiros `cooperativa`, `evasiva`, `silenciosa`, datas
  relativas a hoje (a demo não vence).
- `mensagens.ts`: lê a cobrança capturada pelo parser real
  (`server/ingest/eml.ts`), extrai a chave de 44 dígitos e compõe a
  resposta .eml com `In-Reply-To`/`References` no Message-ID da cobrança,
  quoted-printable pt-BR e `X-Forseti-Simulacao: harness` (rótulo A7).
- `harness.ts`: CLI orquestrador (ver abaixo).
- `vitest.config.ts`, `tsconfig.json`: config local de teste e typecheck,
  porque `app/vitest.config.ts` e `app/tsconfig.json` são paths de outra
  frente e não cobrem `harness/`.

## Como subir a demo local completa

Ordem dos comandos:

```bash
# 1. Postgres do ledger
docker compose -f app/docker-compose.yml up -d

# 2. Transportadora simulada (sobe SMTP :2525 e IMAP :10993, imprime os envs)
cd app && npx tsx harness/harness.ts --cenario evasiva
```

3. Env do app (`app/.env` ou ambiente do processo):

```bash
DATABASE_URL=postgres://foundry:foundry@localhost:5432/foundry
WORKSPACE_LOCAL=<uuid fixo>            # navegadores locais dividem 1 sessão
SEED_ON_BOOT=1
SMTP_HOST=127.0.0.1 SMTP_PORT=2525
SMTP_FROM=sistema@forseti.local SMTP_DOMAIN=forseti.local
IMAP_HOST=localhost IMAP_PORT=10993
IMAP_USER=caixa IMAP_PASS=caixa IMAP_POLL_MS=2000
PENDENCIA_HORAS=0.01 PENDENCIA_TICK_MS=10000
COBRANCA_EXPIRA_HORAS=0.05
OPERADOR_ATIVO=1 OPERADOR_VERSAO=demo1 OPERADOR_WORKSPACES=*
OPERADOR_PRAZO_EMAIL_H=0.02 OPERADOR_PRAZO_WHATSAPP_H=0.02
```

`NODE_EXTRA_CA_CERTS=<cert.pem impresso pelo harness>` precisa estar no
AMBIENTE do processo do app (o Node o lê na partida, antes do dotenv):

```bash
NODE_EXTRA_CA_CERTS=/tmp/forseti-harness-tls/cert.pem npm run dev
```

4. Na UI: agenda, cadastrar contato da transportadora canal `email` com
   destino `ops@transp-sim.dev` (fonte `manual`, exigência da política).
5. Upload de NF-e/planilha com previsão no passado: o tick abre
   `pendencia_aberta`, o operador envia o e-mail, o sink captura, a persona
   responde, a resposta cai na caixa IMAP e o polling a ingere: cobrança
   `respondida` + item na revisão. Sem DKIM local (ver limitações), a
   confiança fica sob o teto e o claim espera aprovação; aprovado, a
   declaração divergente aparece na projeção.

Alternativa sem IMAP: `--sem-imap --upload http://localhost:3000/api/ingest
--workspace <uuid>` posta o .eml na borda HTTP; só casa cobrança do próprio
workspace, então exige o cookie/`WORKSPACE_LOCAL` da sessão dona.

## Descoberta (arquivo:linha)

- Envio SMTP é todo env (`app/server/smtp.ts:19-31`): `SMTP_HOST/PORT/FROM`,
  `SMTP_USER/PASS` opcionais (`auth` omitido sem usuário) e TLS só na 465
  (`smtp.ts:49`). Porta local sem auth funciona.
- Destinatário vem da agenda (`app/server/cobranca.ts:37`,
  `app/operador/canais/email.ts:46-49`): `contatoDaParte('transportadora',
  'email')` com `fonte === 'manual'` e sem `naoContatarIa`.
- Message-ID derivado de `cobranca.id + tentativa + segredo`
  (`cobranca.ts:81-93`); a resposta casa por In-Reply-To/References
  (`pipeline.ts:307-324`); `respondida` não casa de novo
  (`store.ts:650-656`).
- IMAP: env em `server/ingest/imap.ts:19-38`, `secure: true` fixo em
  `imap.ts:62`, fetch `seen:false since:` em `imap.ts:73`, marca `\Seen`
  em `imap.ts:123`. TLS é obrigatório; o cert local se resolve por
  `NODE_EXTRA_CA_CERTS` (env, zero código).
- Resposta .eml por upload: `POST /api/ingest` (`index.ts:393-446`,
  `pipeline.ts:717-727`), escopo do workspace da sessão.
- Sem DKIM a confiança fica ≤ 0.6 e o claim vai à revisão
  (`pipeline.ts:246-247`); DKIM exige DNS real (`ingest/dkim.ts:20-37`).
- Prazos por env, frações aceitas: `OPERADOR_PRAZO_*`
  (`operador/index.ts:88-92`), `COBRANCA_*` (`cobranca.ts:18-26`),
  `PENDENCIA_*` (`pendencia.ts:17-20` e `:211`). Sem clock virtual.
- `OPERADOR_WORKSPACES=*` habilita qualquer sessão fora a seed
  (`operador/index.ts:312-328`, DF-9); `WORKSPACE_LOCAL` junta os
  navegadores locais numa sessão (`index.ts:96-113`).

## Decisões da frente

- DF-T1: entrega primária pela caixa IMAP (matching global por Message-ID,
  funciona para qualquer workspace); upload `.eml` fica como alternativa
  (`--upload`), mas só casa cobrança do workspace que envia.
- DF-T2: cert TLS em `os.tmpdir()` via openssl do sistema; confiança no
  app por `NODE_EXTRA_CA_CERTS`. Nada de `.pem` versionado (guard).
- DF-T3: `vitest.config.ts` e `tsconfig.json` locais em `app/harness/`:
  os do app pertencem à frente `harness` e não cobrem esta pasta. Testes:
  `npx vitest run --config harness/vitest.config.ts`; typecheck:
  `npx tsc -p harness/tsconfig.json --noEmit` (além do `npm run typecheck`
  global, que segue verde e não toca a pasta).
- DF-T4: resposta sempre rotulada `X-Forseti-Simulacao: harness` (A7): a
  evidência .eml fica distinguível de e-mail real sem poluir o corpo.
- DF-T5: "segunda cobrança" da evasiva = cobrança de outro caso de
  pendência do mesmo pedido (respondida não renasce e cada caso tem direito
  a uma). Dois motivos de pendência geram dois e-mails em ticks seguidos.
- DF-T6: datas do roteiro relativas a hoje (`previsaoDias`, dd/mm no corpo
  e ISO derivável), em vez de data fixa que envelhece.
- DF-T7: sem dependência nova: SMTP e IMAP mínimos com `node:net`/`node:tls`.

## Limitações encontradas

- DKIM `pass` é impossível numa demo 100% local: `verificarDkim` resolve
  DNS TXT real sem injeção por env. Efeito: toda resposta vai para a fila
  de revisão e o claim direto só existe em produção ou com resolver
  injetado em teste (provado em `integracao.test.ts`). A fila é o desenho
  do produto (RF9), então a demo conta essa história.
- Sem LLM (`LLM_API_*` ou `ANTHROPIC_API_KEY`), o extrator devolve nulo e o
  item de revisão fica sem campos: aprovado, grava `status_declarado`
  vazio, sem divergência. Para a divergência ao vivo a demo precisa de uma
  das duas envs de LLM, ou aprovação manual com campos.
- A escada não reenvia e-mail no mesmo caso: a segunda mensagem da evasiva
  depende de um segundo caso de pendência (ver DF-T5).
- `iniciarPolling` não entra no teste (o `NODE_EXTRA_CA_CERTS` é lido na
  partida do processo); `servidor-imap.test.ts` prova o protocolo com o
  ImapFlow real e `tls.rejectUnauthorized=false`, replicando verbatim a
  sequência de `coletarEIngerir`.
- IMAP mínimo: uma mailbox, sem APPEND/COPY/EXPUNGE real e busca reduzida
  (UNSEEN/SEEN/ALL/SINCE/UID/seq). Suficiente para o polling da spec.

## Verificação

- `npx vitest run --config harness/vitest.config.ts`: 5 arquivos, 13
  testes, todos verdes (inclui SMTP real com nodemailer do sistema, ImapFlow
  real sobre TLS e o loop completo até a divergência na projeção).
- `npm run typecheck` em `app/`: limpo. `npx tsc -p harness/tsconfig.json
  --noEmit`: limpo.
- `node scripts/repo-guard.mjs` e `node scripts/prose-evals.mjs`: ver
  saída no commit.
