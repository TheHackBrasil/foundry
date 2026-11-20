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

## Pendências

| ID | Item | Por quê | Status |
|---|---|---|---|
| P-001 | Nova data da call com Rafael Born (Enviagora) | Define o fluxo único do MVP + destrava capítulo do diário | aberto |
| P-002 | Pergunta ao contato TOTVS: na gestão multi-fornecedor, dói mais documento fiscal, atraso propagado ou contrato/pagamento? | Cada resposta vira um MVP diferente | aberto |
| P-003 | Liz confirmada como 4ª integrante? | Atualiza site/docs/time | aberto |
| P-004 | Renomear `foundry` → `the-foundry` se o Gabriel liberar o nome? | Nome mais limpo; não urgente | aberto |
| P-005 | Regras oficiais do HackBrasil (formato de avaliação, tamanho de time, critérios) | `RULES.md` tem lacunas marcadas | aberto |

## Achados de pesquisa

| ID | Item | O que é | Veredito |
|---|---|---|---|
| R-001 | Padrão `worcap-hackathon`: DECISIONS.md (D/R/P) + ADR estável + manifesto com fonte/licença/hash + post-mortem + REPRODUCE | Conjunto de auditabilidade provado em hackathon real | adotar |
| R-002 | Transcrição da call (16/11): decisão de direção já tomada aos ~41min; detalhes operacionais (etiquetas, kits, NF, cascata financeira) | Fonte primária: `docs/transcricao-call-2026-11-16.txt` | referência |
| R-003 | Especialista em armazéns (Insper): roteirização já saturada de soluções; RFID/auto-empilhadeira caros demais p/ PME | Reforça D-002 | referência |
| R-004 | Emiteaí: emissão de doc de rota ~5 min; também gestão financeira/operacional; sem blockchain | Concorrente/referência de comparação: diferenciação em aberto | investigar |

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
