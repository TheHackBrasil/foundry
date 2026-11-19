# Brief livre: transformar o site da Foundry em algo bizarro de bem feito

Voce e uma frente autonoma na worktree `/home/thiago/hackbrasil/foundry-wt-fx`.
Peca central do feedback do usuario sobre a versao atual: "parece vibecoded,
todo estatico, ficou muito pior que a referencia". Ele quer WebGL, Three.js,
movimento de verdade, acabamento profissional. O alvo e "bizarro de bem feito":
algo que uma banca ve e lembra, sem parecer template nem demo de tutorial.

## Contexto (leia antes de projetar)

1. `site/` nesta worktree: app Astro 7 + TS, ilha React no domino, GSAP +
   Lenis, fontes locais. `npm install` primeiro (node_modules nao existe).
2. `site/src/pages/index.astro`: a narrativa em 5 estacoes da forja
   (MATERIA-PRIMA / FOGO / FORMA / TEMPERA / A FORJA), cada uma com leitura de
   temperatura. A metafora e boa. Ficou estatica.
3. Referencia do que o usuario achou melhor: `/home/thiago/hackbrasil/the-foundry/build-in-public/`
   (READ-ONLY, nunca edite). O que fazia ela parecer viva: um mapa ASCII do
   Brasil animado com flicker e labels de estados, uma demo interativa com
   toggle, reveals por scroll, um sticker isometrico em video. Denso,
   artesanal, com personalidade.
4. `site/src/components/domino/` e a ilha React da frente wt/domino,
   ja integrada. E a peca memoravel do site. MANTENHA `<Domino client:visible />`
   montado; pode estilizar em volta, reposicionar, dar moldura de destaque,
   mas nao quebre o contrato do componente.
5. `docs/`, `PRODUCT.md`, `DECISIONS.md`: os fatos reais do projeto
   (datas, nomes, status "remarcada sem nova data" da Enviagora). Tudo que
   esta no site hoje e verdade; nao invente fato novo nem remova datas.
6. `STYLE.md` (tom formal-direto), `AGENTS.md`, `specs/0002-site-foundry/`.

## Liberdade criativa (o que voce PODE fazer)

- `npm i three` (+ `@types/three` devDep) e construir WebGL de verdade:
  hero em 3D, bigorna/forja procedural, particulas, shader com grain,
  camera que responde a scroll, cena que conta a metafora da forja.
- Reprojetar a direcao de arte das secoes: layout, hierarquia, densidade,
  molduras, texturas, SVGs/canvas codificados novos.
- Transicoes entre capitulos, parallax, efeitos de scroll (GSAP ja esta ai),
  estados de hover elaborados, cursor, o que a metafora pedir.
- Trocar/adicionar dependencias de visual se fizer sentido; explique no relatorio.
- Reescrever `motion.ts`, `global.css`, e qualquer arquivo dentro de `site/`.

## Restricoes duras (nao negociaveis)

- **Sem-JS funciona**: todo o conteudo legivel sem JavaScript; ilhas falham
  isoladas sem quebrar a pagina. WebGL degrade gracioso (fundo/cor estatica).
- **Reduced-motion real**: `prefers-reduced-motion` OU `?reduce=1` removem
  Tier-1 (Lenis, WebGL/pesado, grandes deslocamentos) e amortecem Tier-2;
  transicoes de opacidade/foco podem ficar. Teste os dois caminhos.
- **Motion budget DOM**: animacoes de elementos DOM so em `transform`/`opacity`.
  Canvas/WebGL nao conta nesse orcamento mas nao pode derrubar o fps.
- **Fatos sao fatos**: datas, nomes, status, "SIMULACAO FICTICIA" no domino,
  disclaimers de retratos. Nao prometa produto; nao apresente simulacao como
  medicao (A7).
- **Prosa**: pt-BR formal-direto. Sem travao (U+2014) nem meia-risca (U+2013)
  em `.md` e na copy do site. O guard falha nisso.
- **A11y**: alt real, foco visivel, teclado navega tudo interativo, contraste AA.
- **Escopo de escrita**: apenas dentro de `site/` (+ este brief em specs/).
  Nao toque em `.specify/`, `speckit/`, docs de pesquisa, specs entregues,
  scripts do repo, arquivos de outros worktrees.
- **Nada de CI/deploy/tracker/protecao de branch**. Sem CDN em runtime:
  tudo via npm/bundle local.
- **Commits**: atomicos, `<tipo>: <resumo>` (feat/fix/chore), identidade
  `git -c user.name=thisux1 -c user.email=125291983+thisux1@users.noreply.github.com`.
  Commite seu trabalho na branch `wt/fx` quando terminar. NAO de push, NAO faca merge.

## Ferramentas uteis

- Build: `cd site && npm install && npm run build`. Typecheck: `npx astro check`.
- Preview: `npm run preview -- --port 8473` (sirva dist e aponte screenshots pra 8473).
- Chromium headless: `/home/thiago/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`
  com `--headless --disable-gpu --screenshot=... --window-size=1440,900`.
- Harness de screenshots com scroll: `/tmp/shot/shoot.mjs`
  (`node /tmp/shot/shoot.mjs 'http://127.0.0.1:8473/?reduce=1' /tmp/fx`):
  instale `playwright-core` num dir scratch se precisar; ja existe em `/tmp/shot/node_modules`.
- Gates do repo (rode da raiz da worktree): `node scripts/repo-guard.mjs`
  e `node scripts/prose-evals.mjs`: precisam sair verdes.
- Screenshots em 1440px E 390px, varias posicoes de scroll: o DoD exige
  revisao visual, entao olhe suas proprias capturas antes de declarar pronto.

## Relatorio (ao terminar)

Liste: arquivos criados/alterados, dependencias adicionadas e por que, saida
real dos gates (guard, prose-evals, astro check, build), caminho dos
screenshots de evidencia, e os desvios do brief. O orquestrador vai ler o
diff e rerodar tudo antes de integrar.
