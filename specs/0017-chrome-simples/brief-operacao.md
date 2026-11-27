# Brief chrome-operacao (adaptar PaginaOperacao ao estilo da casa)

Worktree: ../foundry-wt-chrome-operacao, branch wt/chrome-operacao.
Arquivos permitidos: app/web/src/operacao/ inteiro. Nada mais.

Carregue as skills impeccable e interaction-design antes de escrever
codigo e diga no commit que usou.

Contexto: a pagina Operacao (#/operacao, visao cross-pedido de casos e
metricas) foi adicionada por outro dev e esta fora do estilo que o resto
do app segue (brandbook v4: superficies de papel/marmore, tipografia
editorial em escala de tokens, interior plano sem elevacao aninhada,
roxo restrito a divergencia real, uma acao primaria por vista, raios
consolidados). Sua tarefa e adaptar operacao.css e o markup de
PaginaOperacao.tsx para o estilo da casa SEM mudar comportamento.

Referencias de estilo (leia antes de escrever):
- app/web/src/tokens.css: escala tipografica de 6 degraus, pesos 400/600/700,
  tokens de cor/raio/sombra. Use tokens, nao valores soltos.
- app/web/src/torre-v2.css e painel-v2.css: como cards, faixas e botoes
  se vestem na torre.
- specs/0006-identidade-forseti-v4/spec.md se existir: decisoes da marca.

Regras duras:
- Mesma altura de controle da casa (28px chips/botoes pequenos, 36px
  acoes), mesmos raios, tipografia so nos degraus da escala.
- Interior plano: sem sombra empilhada dentro de card; hierarquia por
  borda e fundo.
- Roxo (cor de divergencia) so onde ha divergencia real; selection,
  hover e contadores usam as tintas neutras.
- Uma unica acao primaria filled por vista; o resto e contorno/fantasma.
- Dark mode impecavel: superficies quase lisas, sem textura pesada.
- Nao mude texto de UX copy salvo inconsistencia clara; nao mude
  comportamento, endpoints ou estrutura de dados.

Verificacao obrigatoria: npx tsc --noEmit -p web (em app/), npx vitest
run (em app/web, baseline 212), npx vite build. Screenshots antes/depois
em 1280px nos dois temas com agent-browser se disponivel (vite dev
aponta para backend local ou demo publica). Commit thisux1, sem push.
