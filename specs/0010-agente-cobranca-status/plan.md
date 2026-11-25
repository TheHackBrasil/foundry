# Plano: Spec 0010: agente de cobrança de status com claim verificável

**Spec:** `specs/0010-agente-cobranca-status/spec.md` · **Data:** 2026-11-24

## Resumo

Três fatias sequenciais com contrato na frente: (1) contrato:
`Cobranca` em `model.ts`, migração de schema, tipo de evento
`status_declarado` e campos de `dados`; (2) backend: verificador de
pendência, canal SMTP, matching resposta-cobrança, verificação
DKIM e entrada da fonte `email_transportadora` na comparação;
(3) superfície: selo DKIM, pendências na UI e `pendenciaHoras` no
simulate. A fatia 1 trava o contrato que 2 e 3 consomem.

## Constitution Check

| Artigo | Aplica? | Evidência no plano |
|---|---|---|
| A1 fatia vertical | sim | pendência, cobrança, claim, divergência e selo numa fatia só |
| A2 fronteira de dados | sim | envs novas `SMTP_*`, `COBRANCA_*`, `PENDENCIA_*` documentadas sem valores; opt-in off por padrão |
| A3 escritas/domínio puro | sim | claim entra como `Evento` normal; comparação e propagação inalteradas; LLM só extrai campos |
| A4 superfície pública | sim | rota declarada: `POST /api/cobrancas/:id/enviar`; seed 403; visitante nunca escolhe destinatário |
| A5 dados pessoais | sim | destinatário só da agenda do workspace; logs mascaram endereço; raw de e-mail fora de resposta pública |
| A6 UI | parcial | selo DKIM e badge de pendência seguem contraste AA da spec 0006 |
| A7 honestidade | sim | DKIM ausente nunca recebe selo; claim sem verificação vai para revisão; valor jurídico não é afirmado |
| A8 custo/latência | sim | verificador em tick de 5 min; SMTP com timeout; sem polling externo |
| A9 imutabilidade | sim | specs anteriores intocadas; migração só `ALTER ADD` |
| A10 simplicidade | sim | reusa IMAP, `chatJson`, contatos, notificar; um arquivo novo (`smtp.ts`) além de extensões |

## Frentes

Sugestão de corte, sujeita ao time: `app-infra` (SMTP, verificador,
rotas, schema) + `app-core` (`eml.ts` matching, `divergence.ts`
mesma fonte, `model.ts`) + `ai-web` (selo e badge). Se a carga
apertar, fatias 1 e 2 inteiras numa frente única e a 3 separada.
