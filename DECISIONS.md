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
