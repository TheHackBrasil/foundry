# DECISIONS: The Foundry · HackBrasil 2026 (documento vivo)

Log cronológico de decisões, achados e pendências do projeto. Inspirado no
padrão do `worcap-hackathon` (mesma convenção D/R/P).

Regra de uso: **toda decisão, achado de pesquisa ou mudança de premissa entra
aqui no mesmo dia**, antes ou junto da mudança correspondente. Specs guardam
o "o quê" de cada entrega; este arquivo guarda a história e o "porquê" datado.

## Convenção de entrada

- **D-NNN** = decisão tomada · **R-NNN** = achado de pesquisa ·
  **P-NNN** = pendência/confirmação em aberto
- Status: `proposto` | `decidido` | `rejeitado` | `em investigação` |
  `confirmado` | `resolvido`
- Vereditos de pesquisa (R): `adotar` | `minerar` | `investigar` |
  `referência` | `descartar`
- Sessões datadas: `## Sessão N: título (data)` para blocos de trabalho.

---

## Decisões vigentes

| ID | Data | Decisão | Status | Motivo |
|---|---|---|---|---|
| D-001 | 19/11 | Repo canônico = `TheHackBrasil/foundry`; `the-foundry` (do Gabriel) fica como referência: sem permissão de escrita para esta conta | decidido | Conta tem só READ no repo antigo; renomear depende do Gabriel |
| D-002 | 16/11 | Direção de escopo: camada de coordenação entre fornecedores/operadores/financeiro-fiscal; roteirização interna fora | decidido | Call de alinhamento: ver `docs/escopo.md` |
| D-003 | 16/11 | Blockchain é opção de registro compartilhado, não requisito | decidido | Call + revisão do dossiê, adotar só se a camada exigir confiança entre desconhecidos |
| D-004 | 19/11 | Call Enviagora remarcada **sem nova data**; seção pós-call do diário fica bloqueada até acontecer | confirmado | Não publicar capítulo com resultado imaginado (A7) |
| D-005 | 19/11 | Pipeline SDD local: sem CI, sem tracker externo, fila = `BACKLOG.md`, gate = `node scripts/repo-guard.mjs` | decidido | Time pequeno + multi-harness; ver `.specify/README.md` |
| D-006 | 19/11 | Comandos speckit agnósticos em `speckit/` (não `.claude/` nem `.opencode/`) | decidido | Repo tocado por Claude Code, Devin e outros; sem duplicação |
| D-007 | 19/11 | Pitch oficial = v9 (`pitch-v9-share.mp4`); publicação via GitHub Release | decidido | Usuário confirmou versão; asset local existe |
| D-008 | 19/11 | Identidade pública = Foundry dark + laranja (`PRODUCT.md`); site reconstruído do zero nela, repo antigo só como referência de conteúdo | decidido | Família única com o pitch v9 |
| D-009 | 19/11 | Convenção DECISIONS/RULES/post-mortem do `worcap-hackathon` adotada | decidido | Auditabilidade + narrativa build-in-public |
| D-010 | 19/11 | Prosa antislop: `STYLE.md` + skills `humanizer`/`antislop-copywriting` antes de escrever + check `prose` no guard banindo travessão | decidido | Texto do repo não pode soar gerado |
| D-011 | 19/11 | `scripts/prose-evals.mjs`: evals de prosa (duro reprova, leve avisa, `--strict` reprova leve); meia-risca (U+2013) também banida, sem exceção de intervalo; registro dos docs = sóbrio, coloquialismo só em citação | decidido | Evals acharam meia-risca que o guard não pegava; voz informal rejeitada pelo time |
| D-012 | 19/11 | Site em `site/` = Astro + TypeScript + ilha React (dominó) + GSAP/Lenis; vanilla descartado a pedido ("usa frameworks modernos"). Narrativa "A Forja" em 5 estações; dominó do atraso é a peça central; isométricos substituídos por cenas em código | decidido | Escolhas do usuário nas clarifications da spec 0002 |
| D-013 | 19/11 | Redesign do site (spec 0003): estrutura editorial da referência em preto e laranja; logo oficial F+bigorna; bigorna 3D do path do logo com MSAA; stickers isométricos animados no lugar do diagrama esquemático; termômetro e temperaturas removidos | decidido | Usuário avaliou a 0002 como genérica; pediu acabamento e reaproveitar elementos da referência |
| D-014 | 19/11 | Pitch oficial passa a ser o v10 (`pitch-v10-share.mp4`), publicado na release `pitch-v10`; substitui o v9 de D-007 | decidido | Pedido do time; o site lê a release pela API e mostra o vídeo |
| D-015 | 20/11 | Fluxo único do MVP = atraso propagado; demais candidatos de `docs/escopo.md` viram tipos de evento do mesmo modelo | decidido | Melhor evidência de campo (exemplo central TOTVS) e narrativa já construída (dominó, slide BR-2048); call Enviagora passa a validar produto, não ideia |
| D-016 | 20/11 | Stack do `app/` = TypeScript ponta a ponta: Fastify, Postgres (tabela de eventos append-only, trigger anti UPDATE/DELETE), Vite + React, ethers + Hardhat, SSE | decidido | Núcleo do problema é event sourcing + integridade criptográfica; Postgres como padrão de produção desde o dia 1; toolchain on-chain TS-native |
| D-017 | 20/11 | Blockchain no MVP = ledger hash-chained + âncora Merkle em Base Sepolia + escrow contract como peça de impacto; rede permissionada e nó por empresa fora | decidido | Prova de integridade verificável sem fricção de adoção (setor não letrado); consortium chain fica como visão de arco |
| D-018 | 20/11 | Recorte operacional refinado: produto = pipeline de documentos reais (NF-e/CT-e/CC-e, e-mail, planilha) → divergência → propagação; atraso propagado vira cenário da demo dentro do motor de divergência; âncora on-chain fica (P1) cobrindo eventos não-fiscais; escrow sai para backlog; twin de nós rebaixado para P2 | decidido | Proposta de escopo do time (doc de trabalho 20/11) + análise: ingestão executa a tese TOTVS de adoção sem mudança de rotina; SEFAZ autentica docs fiscais mas não os eventos da camada; twin é aditivo visual (Schulz) |
| D-019 | 20/11 | Execução do MVP em três frentes paralelas, as da spec 0004 (`wt/app-core`, `wt/app-demo`, `wt/escopo-produto`), cada uma com worktree, dono por pasta (`speckit/frentes.json`) e brief em `specs/0004-mvp-atraso-propagado/`; hook de pre-commit versionado (guard, prose-evals, paths da frente, `main` protegida localmente); decisões de frente ficam no fim do brief da frente e `escopo-produto` ou a integração copiam para `DECISIONS.md` | decidido | Desenvolvimento com agentes em paralelo sem conflito; o protocolo antigo se contradizia (frentes não dividem arquivo, mas todas escreviam em `DECISIONS.md`). Spec 0005 |
| D-020 | 21/11 | Correções na spec 0004 e nas tasks que valem para qualquer versão do escopo: URL pública (T040) e vídeo (T042) viram P0 pelo regulamento 7.2 e 7.3; o atraso entra pela planilha do fornecedor (T031 sobe para P0) e não por CC-e (R-006); XML enviado por visitante fica isolado na sessão dele (`workspaceId`, T027) pelo regulamento 6.9; escrow fora, vale D-018 sobre D-017; o boot do Vite é da frente demo (spec 0005) | decidido | Conferência contra o regulamento e a regra fiscal em 21/11; as escolhas de escopo (âncora, IMAP, uma tela, dominó) seguem em P-006 |
| D-021 | 21/11 | Nova divisão do MVP: Thiago na `app-demo` (design); Gui na nova frente `app-infra` (servidor, banco, hospedagem, deploy, contrato da API); `app-core` fica com `app/shared/` e o ingest; Gab e Gui pesquisam campos úteis e aplicabilidade. O e-mail entra como formato (arquivo `.eml` no upload, P0) e a caixa IMAP ao vivo fica para a final ou para o P0 verde | decidido por Thiago; Gab e Gui ainda não confirmaram o e-mail | Gab acha o e-mail frágil e sem sentido. A documentação de ERPs mostra captura de XML por caixa de e-mail como recurso comum (Senior, Omie, Dynamics), mas a pesquisa de campo do time não registra isso; o `.eml` entrega o canal sem depender de credencial nem de hospedagem de caixa |
| D-022 | 21/11 | A base do código de `app/` é a implementação de Gui na `wt/app-core` (21/11, 00:35): `app/shared/`, `app/server/` com ledger append-only, SSE, anchor e ingest, e `app/contracts/` com Hardhat. Na integração, os conflitos em `app/shared/`, `package.json` e `tsconfig.json` foram resolvidos a favor dela. T002 e T003 de Thiago (commit `d38d173`) ficam no histórico, e o `ingerir()` e o `app/api/contrato.ts` propostos antes foram retirados, porque o despacho (`detectarTipo`) e os tipos de resposta (`app/shared/model.ts`) já existem | decidido | `tsc` limpo e 38 testes passando na integração; cobre o que a spec previa e mais (fila de revisão, simulação, IMAP, PDF); duas implementações paralelas do mesmo núcleo não se sustentam |

## Pendências

| ID | Item | Por quê | Status |
|---|---|---|---|
| P-001 | Nova data da call com Rafael Born (Enviagora) | Define o fluxo único do MVP + destrava capítulo do diário | aberto |
| P-002 | Pergunta ao contato TOTVS: na gestão multi-fornecedor, dói mais documento fiscal, atraso propagado ou contrato/pagamento? | Cada resposta vira um MVP diferente | aberto |
| P-003 | Liz confirmada como 4ª integrante? | Liz saiu do time (Thiago, 20/11); time de 3. Site e docs ainda citam a Liz como pendente | resolvido |
| P-004 | Renomear `foundry` → `the-foundry` se o Gabriel liberar o nome? | Nome mais limpo; não urgente | aberto |
| P-005 | Regras oficiais do HackBrasil | Regulamento oficial lido em 20/11 (R-005, `RULES.md`); restam formato da final (enviado aos finalistas) e nomes dos jurados (até 30/11) | resolvido |
| P-006 | Escolhas de escopo em aberto, cada uma com dono: âncora em Base Sepolia antes de 30/11 (T025) ou só na final, com recibo de hash no alerta antes (Gui); cinco visões por papel (T004, T014) ou tela única com seletor de parte (Thiago); dominó e twin antes de 30/11 ou na final (Thiago); caixa IMAP ao vivo (T030): o `.eml` já está decidido em D-021, falta confirmar com Gab e Gui | A spec 0004 foi fechada na call, que terminou às 02:55 de 20/11; o plano revisado é das 03:03, depois dela. A seção 10 do PDF lista as diferenças linha a linha. As correções de regulamento e fiscal já entraram (D-020) | aberto |
| P-007 | Quem integra as frentes na `main`, e se o GitHub passa a exigir PR para a `main` (D-005 hoje proíbe proteção de branch) | Com três pessoas e agentes em máquinas diferentes, o hook local não protege a `main` remota | aberto |
| P-008 | Stack e hospedagem: D-016 fixou linguagem, banco e SSE; falta hospedagem (Heroku em avaliação) e validar o conjunto (sem hibernação até 12/12, Postgres com trigger, SSE atrás do roteador, deploy sem Docker, custo com o crédito disponível) | Demo no ar é entregável (regulamento 7.2 e 7.3) e a hospedagem não está decidida (prazo proposto: 24/11; até lá o código roda em qualquer host: `DATABASE_URL`, `PORT`, heartbeat no SSE) (dono: Gui, frente app-infra) | aberto |
| P-009 | OCOREN como segundo canal de atraso: arquivo EDI PROCEDA que a transportadora envia ao embarcador (registro 342, código 02 "entrega fora da data programada"), ligado ao pedido por CNPJ do emissor, série e número da NF | O registro não traz a chave de 44 dígitos e o layout varia por versão e por embarcador (R-007); entra como P1 se o Gab confirmar | aberto |
| P-010 | Antes da URL pública, o servidor precisa de: isolamento por sessão (RF27, hoje inexistente), CORS aberto e escrita sem autenticação (D-C11 do `brief-core.md`), `xlsx@0.18.5` da npm (afetada por ReDoS e por prototype pollution ao ler arquivo malicioso, e a correção sai só pela CDN da SheetJS) e o cancelamento gravado com fonte `cce` (a CC-e que virava atraso foi corrigida em 21/11, R-006) | O juiz sobe arquivo próprio na URL pública (regulamento 6.9 e 7.2); dono: Gui (app-infra) para as três primeiras, `app-core` para o cancelamento e a troca do parser de planilha | aberto |

## Achados de pesquisa

| ID | Item | O que é | Veredito |
|---|---|---|---|
| R-001 | Padrão `worcap-hackathon`: DECISIONS.md (D/R/P) + ADR estável + manifesto com fonte/licença/hash + post-mortem + REPRODUCE | Conjunto de auditabilidade provado em hackathon real | adotar |
| R-002 | Transcrição da call (16/11): decisão de direção já tomada aos ~41min; detalhes operacionais (etiquetas, kits, NF, cascata financeira) | Fonte primária: `docs/transcricao-call-2026-11-16.txt` | referência |
| R-003 | Especialista em armazéns (Insper): roteirização já saturada de soluções; RFID/auto-empilhadeira caros demais p/ PME | Reforça D-002 | referência |
| R-004 | Emiteaí: emissão de doc de rota ~5 min; também gestão financeira/operacional; sem blockchain | Concorrente/referência de comparação: diferenciação em aberto | investigar |
| R-005 | Regulamento oficial ([hackbrasil.com/regulamento](https://hackbrasil.com/regulamento), atualizado em 18/11): quatro critérios de mesmo peso (execução técnica, implementação técnica, impacto, qualidade da comunicação); fase online julgada por repo, demo e vídeo de até 3 min do produto; top 5 por trilha com nota mínima 20/40 vai à final presencial de 12/12; congelamento de 30/11 a 12/12 | Detalhe item a item em `RULES.md`; o FAQ fala em "apresentação", o regulamento (que prevalece) diz "comunicação" | adotar |
| R-006 | Regras fiscais do cenário de atraso: CC-e não corrige data de emissão ou de saída (Convênio SINIEF s/nº 1970, art. 7º, §1º-A); cancelamento de NF-e em regra até 24h e sem circulação da mercadoria (Ajuste SINIEF 07/05); evento de insucesso na entrega do CT-e (110190) | Fontes e consequência em `docs/plano-mvp.pdf`, seção 02; contador confirma antes de virar regra do motor | investigar |
| R-007 | OCOREN (PROCEDA, versão 3.1 de 15/05/2000): arquivo de texto com registros de 120 caracteres (000, 340, 341, 342, 343); o 342 traz CNPJ do emissor da NF (posição 4, 14 dígitos), série (18, 3), número da NF (21, 8), código da ocorrência (29, 2), data DDMMAAAA (31, 8), hora (39, 4) e texto livre (45, 70); o código 02 é "entrega fora da data programada" na tabela de ocorrências da Senior | Fonte: layout PROCEDA (`ocoren.pdf` da Senior) e [manual de EDI da Senior](https://documentacao.senior.com.br/gestao-de-fretes-gko/7.01/manual-processos/edi.htm). A TOTVS publica layout próprio e existem versões posteriores; não li esses | referência; entra no motor só se P-009 for aceito |

---

## Sessões

### Sessão 1: pesquisa consolidada + repo novo (19/11)

- Repo `TheHackBrasil/foundry` criado; commit inicial `fc8eb46` com docs de
  pesquisa (`specs/0001`, entregue).
- Dossiê reposicionado: visão de arco (capacidade ociosa como *dado* na
  camada), não escopo de MVP: ver `docs/escopo.md` § leitura candidata.

### Sessão 2: pipeline SDD local (19/11)

- `.specify/` + `speckit/` + `AGENTS.md` + `scripts/repo-guard.mjs` +
  `DECISIONS.md` + `RULES.md` implantados; guard verde (10 checks).
- Convenção de frentes paralelas para trabalho com agentes: `speckit/frentes.md`.
- 3 audits read-only de subagentes executados; correções aplicadas:
  posição canônica do `checklist` (antes do `plan`, só risco), status
  `implementada` atribuído no `implement`, índice de `docs/` virou check do
  guard, imutabilidade A9 derivada do HEAD (adulterar Status no worktree
  não anula a proteção: testado), links em code fence ignorados, assets de
  HTML checados, `node --check` em todo `.js` versionado.

### Sessão 3: antislop + evals de prosa (19/11)

- `STYLE.md` criado + check `prose` no guard; ~200 travessões limpos dos
  docs mutáveis. Artefatos A9 fora da regra (história congelada).
- `scripts/prose-evals.mjs`: primeira rodada achou 4 meia-risca (U+2013,
  `A1 a A10`) que o guard não cobria: guard e STYLE.md estendidos, ban
  virou total. Também um falso positivo ("de ponta a ponta"), corrigido
  no regex.
- `humanizer` rodado em `docs/escopo.md`: trocou metáfora de estoque e
  auto-elogio por linguagem direta; registro ajustado para sóbrio.

### Sessão 4: redesign do site (19/11)

- Feedback do usuário: a 0002 parece template gerado. Spec 0003 criada
  e decisão D-013 registrada.
- Escopo: estrutura editorial, logo oficial, bigorna com MSAA, stickers
  isométricos e mapa ASCII; termômetro, palavras vazadas e HUD saem.
- Deploy, release do pitch e capítulo pós-call seguem fora.

### Sessão 5: escopo do MVP fechado e frentes abertas (20/11)

- Escopo decidido sem esperar a call Enviagora nem a resposta TOTVS:
  a evidência disponível já apontava o atraso propagado; a call passa
  a validar produto com demo, não ideia.
- Spec 0004 aprovada com plano, tasks e 3 briefs de frente:
  `wt/app-core`, `wt/app-demo`, `wt/escopo-produto`. Divisão de pessoas
  por frente fica a cargo do time.
- Blockchain reposicionada: de "plataforma onde tudo roda" para
  propriedade do registro (cadeia de hashes + âncora pública +
  escrow). Justificativa: a coordenação se resolve com a camada de
  eventos; a chain prova integridade entre empresas que não confiam
  uma na outra.
- Recorte refinado (D-018) a partir da proposta de escopo do time:
  o MVP passa a ser o pipeline de documentos reais + motor de
  divergência, com o atraso propagado como cenário da demo; âncora
  em Base Sepolia mantida (P1) para os eventos não-fiscais; escrow e
  twin de nós viram backlog/P2.
- Item 7 do BACKLOG fechado; item 8 (build do MVP) abre a semana.

### Sessão 6: regulamento, hook das frentes e integração com a spec 0004 (20/11)

- Regulamento oficial lido e conferido item a item (R-005, `RULES.md`).
  Mudou prioridades: demo no ar e vídeo do produto viram P0; o fator
  wow ao vivo vai para a final de 12/12; o site deixa de disputar tempo.
  Detalhe, errata e afirmações sem fonte em `docs/plano-mvp.pdf`.
- A spec 0004 do Gui já estava na `origin/main` (fechada na call). O
  plano revisado e a spec divergem em pontos de regulamento e fiscal:
  reconciliação em aberto (P-006), stack e hospedagem em aberto (P-008).
- Frentes (D-019, spec 0005): worktrees antigos (`domino`, `fx`, `site`)
  removidos, já mergeados; esqueleto próprio (`apps/`, `packages/`)
  descartado em favor do `app/` da spec 0004; frentes `wt/app-core`,
  `wt/app-demo`, `wt/escopo-produto`; hook em `scripts/hooks/`.
- Liz saiu do time (informado por Thiago, 20/11): P-003 resolvido, time
  de 3.

### Sessão 7: correções da spec 0004 e início do código (21/11)

- Sobre o "doc de mvp" da call: o Thiago respondeu "o pdf". A call
  terminou às 02:55 (cabeçalho da transcrição, horário de Brasília) e o
  `docs/plano-mvp.pdf` é das 03:03, então a call fechou o documento do
  Gui. Entraram na spec só as correções que valem para qualquer versão
  (D-020); as escolhas de escopo ficaram em P-006 para o Gab.
- Branches remotas `wt/core`, `wt/demo` e `wt/produto` apagadas, com
  autorização do Thiago.
- Integração real: o mercado troca documento (NF-e, CT-e, arquivo EDI
  PROCEDA, planilha, e-mail), não API de ERP. OCOREN lido no layout
  original (R-007, P-009).
- D-021: frente `app-infra` criada (spec 0005, RF4 e RF6). O
  `package.json` e os scripts passam para a infra; os contratos são
  `ingerir()` (core para infra) e `app/api/contrato.ts` (infra para demo);
  as dependências do ingest foram instaladas na integração.
- Evidência sobre o e-mail: a documentação de ERPs mostra captura de XML
  por caixa de e-mail (eDocs da Senior lê caixa POP/IMAP, a Omie tem
  endereço dedicado, o Dynamics importa de e-mail) e a lei deixa o meio
  de envio do XML livre entre as partes. A pesquisa de campo do time não
  registra o uso; a ideia veio de uma IA consultada na call de 20/11.
- Durante a sessão, Gui empurrou na `origin/main` (regra de identidade de
  commit) e na `origin/wt/app-core` (primeira versão completa do código).
  Integrado sem force (D-022): `tsc` limpo e 38 testes passando. As
  pendências reais estão em P-010 e no cabeçalho do `tasks.md`.
