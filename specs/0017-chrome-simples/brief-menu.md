# Brief chrome-menu (item 40)

Worktree: ../foundry-wt-chrome-menu, branch wt/chrome-menu.
Arquivos permitidos: app/web/src/components/menuwiki/dados.ts,
app/web/src/components/menuwiki/MenuWiki.tsx, app/web/src/menuwiki.css
(ou onde o CSS do menuwiki morar), e testes novos desses arquivos.
Nada mais.

Carregue as skills impeccable e interaction-design antes de escrever
codigo e diga no commit que usou.

Tarefa: modo compacto do menu lateral. Hoje cada item tem duas linhas:
titulo + .mw-item-sub (resumo: destinatario/timestamp, parte/canal etc,
ver dados.ts:84-96 e menuwiki.css:171-177). Implementar:

- Modo compacto como padrao: itens de UMA linha (nome + selo/status),
  sem a linha de resumo. O resumo continua acessivel no title/aria-label
  do item (acessibilidade nao pode perder informacao).
- Toggle discreto no cabecalho do MenuWiki (ao lado da busca) alterna
  compacto/expandido, persistido em localStorage com chave versionada
  nova no padrao existente (forseti:menuwiki:v1 existe para secoes;
  crie forseti:menuwiki:modo:v1 ou estenda o schema com migracao leve).
- Secao Pedidos NUNCA nasce fechada (erro/retry moram ali,
  MenuWiki.tsx:327-347).

NAO fazer nesta wave: colapso do rail inteiro, mudancas em styles.css,
mudancas no carregamento lazy de Documentos (IntersectionObserver).

Verificacao obrigatoria: tsc, vitest, build como no brief-toolbar.
Screenshots compacto/expandido nos dois temas se possivel. Commit
thisux1. Sem push.
