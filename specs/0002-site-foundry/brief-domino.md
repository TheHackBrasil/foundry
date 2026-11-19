# Brief · frente `domino` (subagent)

Escopo: implementar a ilha React "dominó do atraso" da spec 0002,
dentro do projeto Astro em `site/`.

## Paths desta frente (só estes)

- `site/src/components/domino/Domino.tsx` (obrigatório, default export)
- `site/src/components/domino/*.tsx`, `*.module.css`, `*.ts` livres
- Nada fora de `site/src/components/domino/`. Tokens e layout vêm de fora.

## Contrato do componente

`<Domino />` sem props, hidratado com `client:visible` na página.
Deve renderizar HTML completo em SSR (sem JS funciona como painel
estático legível).

Visual: painel dark industrial (ver global.css `--panel`, `--line`,
`--ember`, `--ink`, `--ink-dim`, `--ink-faint`, fonte mono =
`var(--font-m)`). Canto superior esquerdo com "cantoneira" laranja
(2px). Rótulo `SIMULAÇÃO FICTÍCIA` visível sempre.

## Conteúdo e comportamento

Cinco nós em sequência vertical com haste conectora entre eles:

1. FORNECEDOR · expedição do pedido · SEG 08:00
2. TRANSPORTADORA · coleta · SEG 14:00
3. CENTRO DE DISTRIBUIÇÃO · janela de doca · TER 09:00
4. FISCAL · NF e documentos · TER 10:30
5. FINANCEIRO · pagamento programado · TER 16:00

Controles:

- Slider "ATRASO NO FORNECEDOR" 0 a 72h, step 6, output `+Nh`.
- Toggle de cenário: `01 · SEM CAMADA` (default) / `02 · COM CAMADA`.

Regras de propagação (delay = h horas):

- h=0: estado neutro "OPERAÇÃO NO TRILHO".
- SEM CAMADA: nó 1 registra o atraso; transportadora +h; CD +h mais 6h
  de fila se h>=24; FISCAL bloqueia doc se h>=24; FINANCEIRO cancela
  pagamento se h>=48 (senão "contrato em revalidação"). Timestamps
  recompute por dia (SEG a DOM) + hora.
- COM CAMADA: nó 1 registra atraso + "alerta emitido"; downstream
  recompute com h*0.4 (arredondado) e status replanejados: "coleta
  remarcada cedo", "doca realocada em tempo", "NF emitida na nova
  data", "pagamento reagendado".
- Veredito dinâmico: SEM CAMADA "4 REAGENDAMENTOS[, 1 DOC BLOQUEADO][,
  PAGTO CANCELADO]" + sub "Ninguém foi avisado. Cada sistema descobriu
  sozinho."; COM CAMADA "4 AVISOS ANTECIPADOS · 0 CANCELAMENTOS" + sub
  "O alerta saiu da origem antes do efeito chegar nas pontas." (marcas X e ok).

Motion (só transform/opacity, 60fps):

- Ao aplicar estado, classe `.hit` (laranja) ou `.absorbed` (verde)
  entra em stagger ~160ms por nó, descendo; haste acende na mesma cor.
- `prefers-reduced-motion` e `?reduce=1`: stagger 0, sem translateX.

A11y: slider e botões nativos focáveis, `aria-pressed` no toggle,
`role="status"` no veredito, contraste AA.

## Proibido

Merge em main, push fora de `wt/domino`, escrever fora de
`site/src/components/domino/`, libs novas (react + CSS module bastam),
emoji em UI, travessão/meia-risca em qualquer `.md`.

## Gate (rodar antes de reportar)

- `cd site && npm run build` exit 0
- `npx astro check` limpo
- `node ../scripts/prose-evals.mjs` exit 0 (do root do repo)
- Sem erro de console no SSR; componente hidrata e alterna modos.

## Reporte

Conclusão + arquivos criados + saída dos gates + decisões de
implementação tomadas (ex.: como o stagger foi feito).
