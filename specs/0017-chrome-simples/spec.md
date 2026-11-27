# Spec 0017: chrome simples (itens 39 parcial, 40, 41, 42)

Status: em execucao
Data: 2026-11-26
Origem: BACKLOG itens 39 (recorte minimo), 40, 41 e 42, todos da call de
26/11 enriquecidos por recon. Decisao do usuario: fazer as partes simples
de UI primeiro, em frentes paralelas com agentes com skills.

## Contexto

A call de alinhamento diagnosticou chrome demais antes do conteudo: seis
faixas empilhadas antes do primeiro card, menu lateral poluido, seletor
de pedido que nao escala e controle de largura indescobrivel. Esta spec
cobre o recorte simples e de alto impacto na demo. O recorte completo do
item 39 (barra da IA na topbar, superficie de configuracoes) fica para
spec futura.

## Frentes (arquivos disjuntos)

- chrome-toolbar: item 39 recorte minimo. TorreVistas.tsx e vistas.css.
  Condensar a faixa de vistas num unico menu "Layout": visiveis ficam so
  os 5 presets e o radiogroup de densidade; salvar vista, restaurar
  padrao, pin, excluir e o dropdown de cards vao para dentro de um menu.
  Preservar a a11y existente sem regredir: teclaRadio com setas/Home/End,
  roving tabindex, toast com Desfazer que nao expira, foco devolvido ao
  controle de origem nos fluxos de excluir vista.
- chrome-controles: itens 41 e 42. SeletorPedidoPopover.tsx,
  assistente.css, TorreCard.tsx, torre-v2.css.
  41: input de busca acima do listbox (nunca dentro, invalida o padrao
  ARIA), filtrando por emitente/codigo/status com normalizarConsulta
  (importar de menuwiki/dados.ts se a dependencia for limpa, senao
  duplicar a funcao localmente); indiceAtivo passa a indexar a lista
  filtrada; filtro reseta ao fechar.
  42: o splitter Nx ganha affordance visivel do efeito do ciclo. Hint
  persistente do proximo estado (ex.: "2/3 colunas; proximo clique volta
  a 1") ou menu com opcoes explicitas. Manter o padrao APG separator com
  aria-valuetext.
- chrome-operacao: adaptacao da PaginaOperacao ao estilo da casa
  (brandbook v4), adicionada por outro dev fora do sistema visual.
  Pasta app/web/src/operacao/ inteira, autocontida. Sem mudanca de
  comportamento.
- chrome-menu: item 40. menuwiki/dados.ts, MenuWiki.tsx, menuwiki.css.
  Modo compacto: itens de uma linha sem a linha .mw-item-sub. Decisao de
  implementacao livre entre: compacto como padrao novo, ou toggle
  persistido. Nao implementar colapso do rail inteiro nesta wave (risco
  do IntersectionObserver documentado no item). Secao Pedidos nunca
  nasce fechada.

## Invariantes

- A6: contraste AA, foco visivel, teclado completo, reduced-motion.
- Nenhuma regressao nos fluxos V5/V6 de vistas nem nos testes (212/212).
- Sem travessao nem meia-risca em arquivos .md (o guard falha).
- Nenhuma frente toca App.tsx, styles.css, servidor nem arquivos de
  outra frente.
