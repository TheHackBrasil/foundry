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
