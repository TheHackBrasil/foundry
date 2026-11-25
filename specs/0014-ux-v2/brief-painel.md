# Brief frente v2-painel (THE-16, THE-17)

Escopo na spec `specs/0014-ux-v2/spec.md` e nas issues THE-16/17 do Linear.

## Ordem interna

1. THE-16: reconstruir `EvidenciaLateralIA.tsx` como painel contextual
   autonomo: funciona tanto com projecao da torre quanto com o que o agente
   respondeu; incorpora micro-blocos GenUI (reusar `genui/` existente, sem
   editar a pasta; se faltar bloco, criar dentro de `components/evidencia/`).
   Menos dependente: o painel decide o que mostra a partir do contexto
   (pedido selecionado, ultima resposta, foco clicado), nao de props
   rigidamente casadas.
2. THE-17: clique em campo, divergencia ou setor abre mini-descricao
   detalhada gerada em tempo real via SSE reutilizando
   `/api/mandatos/stream` com mandato de leitura (ex.: "explica o campo X
   do pedido Y citando a evidencia"). Cache por (pedido, alvo) em
   `lenteCache`-like local ao painel. Se o contrato do endpoint nao servir,
   registrar no brief e deixar a UI atras de flag.

## Restricoes

- CSS novo em `app/web/src/painel-v2.css`. Nao editar `styles.css`.
- `PaginaAssistenteIA.tsx` pode ser ajustada para a nova fiacao do painel;
  contrato de props com `App.tsx` nao muda.
- A6 completo; streaming textual respeita reduced-motion (sem typewriter).
- Skills: accessible-animation; prosa segue `docs/STYLE.md`; textos de UI
  curtos, sem hype.
- Teste novo: render do painel com contexto minimo e resposta de stream
  mockada.

## Decisoes da frente
