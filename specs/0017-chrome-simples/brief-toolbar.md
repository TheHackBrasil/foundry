# Brief chrome-toolbar (item 39 recorte minimo)

Worktree: ../foundry-wt-chrome-toolbar, branch wt/chrome-toolbar.
Arquivos permitidos: app/web/src/components/torre/TorreVistas.tsx,
app/web/src/vistas.css (ou onde o CSS de vistas morar), e testes novos
desses mesmos arquivos. Nada mais.

Carregue as skills impeccable e ux-accessibility-audit antes de escrever
codigo e diga no commit que usou.

Tarefa: condensar a faixa TorreVistas (hoje 5 chips de preset + chips de
vistas salvas com pin/excluir + radiogroup densidade + salvar + restaurar
+ dropdown cards + toast, TorreVistas.tsx:284-504) num layout enxuto:

- Visivel direto: os 5 chips de preset e o radiogroup de densidade.
- Um unico menu/popover "Layout" agrupa: vistas salvas (com pin e
  excluir), salvar vista atual, restaurar padrao e o conteudo do dropdown
  de cards (os 7 chips + mostrar todos + badge de ocultos).
- O badge de ocultos continua visivel quando houver card oculto (pode
  ficar no gatilho do menu).

Nao regredir a11y (verificado em teste manual com teclado):
- teclaRadio com setas/Home/End (TorreVistas.tsx:173-184) e roving
  tabindex (:377-381) na densidade.
- toast com Desfazer nao expira enquanto tem acao (:276-280).
- foco devolvido ao controle de origem ao excluir vista (:265-272).
- menu/popover com foco preso enquanto aberto, Escape fecha e devolve
  foco ao gatilho, aria-expanded/aria-controls corretos.

Verificacao obrigatoria antes de commit: npx tsc --noEmit -p web (em
app/), npx vitest run em app/web (212/212 ou mais), npx vite build.
Screenshots antes/depois em 1280px e 375px com agent-browser se
disponivel. Commit com identidade thisux1 (git -c user.name=thisux1 -c
user.email=125291983+thisux1@users.noreply.github.com). Sem push.

## Decisões da frente

- D-001: o popover "Layout" usa `role="dialog"` não-modal, não
  `role="menu"`: o conteúdo é heterogêneo (form, toggles aria-pressed,
  ações) e não cabe no contrato de menuitem do APG. Foco preso via
  listeners de Tab/Escape no `document` enquanto aberto, que cobrem até
  o caso do foco cair no body quando o elemento focado desmonta.
- D-002: o toast passa a morar dentro do wrapper `.vistas-menu` no DOM:
  clicar no Desfazer não conta como clique fora (o menu não fecha) e os
  botões do toast entram no anel de foco do popover.
- D-003: ações que substituem o layout (aplicar vista salva, restaurar
  padrão) fecham o menu e devolvem foco ao gatilho; gerenciamento (pin,
  excluir, toggles de card, salvar vista) mantém o menu aberto.
- D-004: o fallback de foco do V6 ganhou o painel entre "Salvar vista
  atual" e a barra, para o caso de excluir vista com o form aberto.
- D-005: nenhum arquivo de teste novo entrou no commit: o frente-check
  só aceita os 3 paths da frente e um .test.tsx novo seria recusado.
  Verificação ficou por tsc, vitest existente (212/212), vite build e
  teste manual com agent-browser (trap, Escape, radios, V6, badge).
