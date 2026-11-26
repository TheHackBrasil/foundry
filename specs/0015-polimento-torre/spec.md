# Spec 0015: polimento da Torre (auditoria multi-persona)

Status: em execucao
Data: 2026-11-25
Origem: auditoria read-only com 5 subagentes especialistas (motion, visual,
acessibilidade, usabilidade, performance) sobre a Torre pos-spec-0014, cada
um com skills dedicadas carregadas e browser isolado. Relatorios brutos na
sessao; decisoes do usuario registradas nesta spec.

## Contexto

A auditoria encontrou 4 bugs objetivos, 2 defeitos estruturais de layout,
divida de performance (memoizacao inerte, fanout de rede, ResizeObserver em
ciclo), divida de superficie visual e falhas de WCAG nivel A. Verificacao
independente da integracao confirmou no codigo: bug da assinatura de vistas,
arraste travavel sem safety net, pill de largura sem semantica APG e coluna
morta do packing em viewport largo.

## Decisoes do usuario (2026-11-25)

1. Grafo domino em repouso: arestas passam de opacity 0 para aproximadamente
   0,2 em repouso (estrutura visivel mas quieta), escalando para 1 no hover,
   clique ou foco. Revisita a decisao THE-15 sem trair o espirito.
2. Movimento: fluido sempre. Width e height continuam animados em todo
   retile, inclusive reflow global de densidade. O custo de longtask medido
   (80ms) e aceito; a performance vem das outras frentes (memoizacao, rede,
   refs), nunca de cortar a animacao.
3. Execucao em waves paralelas com worktrees disjuntas, como na spec 0014.

## Frentes (D-059)

Tres frentes na wave A, arquivos disjuntos em speckit/frentes.json:

- polish-motor: motor do grid (TorreGrid.tsx, TorreCard.tsx, torre-v2.css).
  Safety net do arraste, controle de largura como window splitter APG,
  ordem DOM igual a ordem visual, setas espaciais 2-D, packing sem coluna
  morta, auto-scroll no arraste, refs estaveis e ResizeObserver em lote,
  opacity de repouso do grafo.
- polish-vistas: persistencia e sistema de vistas (layout.ts, layout.test.ts,
  TorreVistas.tsx). Assinatura sem spans para presets (alinha D-T5 da spec
  0014), densidade como segmented control nomeado, reset e undo com toast,
  vista padrao global entre pedidos, vista salva completa (recolhidos e
  densidade), foco devolvido ao controle de origem, renomear presets para
  matar a colisao Fiscal vezes dois.
- polish-fluxo: performance e estrutura de conteudo (PainelPedido.tsx,
  useTorre.ts, useStream.ts, menuwiki/, format.ts, GrafoDomino.tsx,
  StatusCadeia.tsx, TarefasPorParte.tsx, MatrizFontes.tsx, torre/Card*.tsx).
  Memoizacao real, dedup de rede sem tocar o servidor, formatters Intl
  cacheados, pulsos sem espelhamento em state, tarefas agrupadas por setor,
  telefone sem truncamento, roving tabindex para reduzir 118 tab stops,
  timestamp compacto da matriz.

Contrato tolerante entre motor e vistas: a prop `aoDefinirDensidade` do
TorreVistas e opcional; vistas consome se existir, motor prove. Assinatura
exata registrada nos briefs. Nenhuma frente toca em App.tsx, styles.css,
tokens.css nem no servidor.

## Wave B (apos merge da wave A)

polish-superficie, sozinha por natureza transversal: escala tipografica
(15 tamanhos para 6 degraus, 6 pesos para 3), alturas de controle (5 para
2), textura de marmore (veios finos, nunca aninhada, escuro liso), interior
dos cards plano sem elevacao aninhada, roxo restrito a divergencia real,
uma acao primaria por vista, preludio de 620px comprimido, scrollbar,
empty states. Detalhada apos a integracao da wave A.

## Invariantes

- Contratos publicos intocados: rotas, SSE, endpoints.
- Movimento respeita prefers-reduced-motion (A6) mesmo com fluido sempre.
- Gates por frente: tsc, vitest, build, repo-guard, prose-evals.
- Testes novos para assinatura de vistas e para o que for logica pura.

## Adendo wave C (sessao 12)
- motion-fisica: duracao proporcional a distancia, curva sem velocidade
  inicial nos retargets (anti-flicker do arraste), stretch de span mais lento
- adapt-generica: camada de adaptacao estrutural por formato (nao por
  componente), contrato documentado para cards futuros
