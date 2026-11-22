# Plano: Spec 0006: identidade Brandbook v4 no site e nas telas

**Spec:** `specs/0006-identidade-forseti-v4/spec.md` · **Data:** 2026-11-22

## Resumo

Duas frentes em paralelo, uma por superfície. `site-forseti` re-veste
a página única inteira na identidade v4 sobre a base
`wt/site-entrega1`: hero reescrito para apresentar o produto com copy
v4 real, seções existentes recoloridas e retipografadas, logo oficial
copiado dos SVGs extraídos do brandbook. `app-brand` remapeia os tokens
por papel de `app/web/` sobre a base `integra/mvp-final`, sem reescrever
componentes: o sistema já é por papel, então a troca é de valores, não
de estrutura. A alternativa considerada e rejeitada pelo usuário era
separar landing do produto e diário da equipe (`/` + `/diario`): o site
é um só e recebe a marca inteira, sem manter duas identidades nem duas
rotas.

## Constitution Check

| Artigo | Aplica? | Evidência no plano |
|---|---|---|
| A1 fatia vertical | sim | seções preservadas, links que resolvem; `config.ts` cobre demo/vídeo ausentes com "Em preparação", nunca link morto; seção sem asset compõe com gramática vetorial, nunca placeholder |
| A2 fronteira de dados | sim | nenhum dado novo nem segredo; assets de marca são públicos por definição (Pages) |
| A3 escritas/domínio puro | sim | só CSS, assets e componentes de apresentação; script de medição read-only no padrão de `moodboard/scripts/build.py` |
| A4 superfície pública | sim | nenhuma rota nova; a repintura é registrada nesta spec, em `specs/README.md`, `site/README.md` e `README.md` raiz |
| A5 dados pessoais | sim | retratos e contatos já inventariados seguem nas mesmas seções; ninguém novo entra |
| A6 idioma/identidade/a11y | sim | RF9 exige medição colorlib em todos os pares; 4 itens a11y nos gates; pt-BR |
| A7 rótulo de ilustrativo | sim | copy sem afirmação não provada; estado da entrega vem do `config.ts` |
| A8 gate local | sim | guard + prose-evals + `tsc --noEmit` + `astro build` + relatório colorlib |
| A9 ledger imutável | sim | só artefatos novos; specs entregues e conteúdo factual das seções preservados |
| A10 intenção registrada | sim | esta spec + decisões D-030 a D-035 registradas pela integração em `DECISIONS.md` |

## Estrutura e caminhos reais

```
specs/0006-identidade-forseti-v4/
  spec.md  plan.md  tasks.md
  brief-site-forseti.md        # frente site-forseti
  brief-app-brand.md           # frente app-brand
site/                          # frente site-forseti (base wt/site-entrega1)
  src/pages/index.astro        # hero v4 + seções re-vestidas (mesma rota)
  src/layouts/Base.astro       # fontes Manrope/Geist Mono, favicon, meta light
  src/styles/global.css        # tokens v4 + gramática
  src/components/              # recoloridos onde o estilo é próprio
  src/config.ts                # DEMO_URL/VIDEO_URL (já existe)
  public/favicon.svg           # derivado do símbolo oficial
  public/assets/forseti-*.svg  # cópias dos 5 SVGs oficiais do brandbook
  public/assets/og.png         # refeito na v4
  package.json                 # + @fontsource manrope, geist-mono; − space-grotesk, jetbrains-mono
app/web/                       # frente app-brand (base integra/mvp-final)
  src/tokens.css               # valores v4, mesmos nomes de papel
  src/styles.css               # ajustes mínimos de materialidade
  src/components/Marca.tsx     # serve o símbolo oficial v4
  src/assets/ ou public/       # cópias dos SVGs oficiais necessários
  src/main.tsx                 # imports @fontsource novos
  package.json                 # troca de pacotes de fonte
  index.html                   # favicon v4
```

Medição: script novo da frente `app-brand` em `app/web/scripts/`
(ou cópia adaptada de `forseti-brand/moodboard/scripts/build.py`),
usando `colorlib.py` do R4 como biblioteca; saída é o relatório de
pares exigidos de RF9. A mesma lista de pares mede o site.

## Dados e artefatos

- Artefatos novos: cópias dos 5 SVGs oficiais (`forseti-lockup-petroleo`,
  `forseti-lockup-negativo`, `forseti-simbolo-petroleo`,
  `forseti-simbolo-negativo`, `forseti-simbolo-isolado`), favicon
  derivado, `og.png` refeito, script de medição, esta spec.
- Artefatos aplicados afetados: nenhum (A9). Specs 0002 a 0005 seguem;
  o conteúdo factual das seções do site é preservado na repintura.
- Migrations: n/a (nenhum backend tocado).

## Matriz de autorização / publicação

| Conteúdo | Público? | Restrição |
|---|---|---|
| `site/` inteiro | sim | superfície pública por definição |
| `app/web/` tokens, marca | sim | código já público |
| SVGs oficiais do logo | sim | artefato de marca versionado |
| Relatório de contraste | sim | evidência de a11y versionada |
| `forseti-brand/` | n/a | repo irmão fora deste versionamento |

## Plano de testes / verificação

- Guard: `node scripts/repo-guard.mjs` exit 0 e
  `node scripts/prose-evals.mjs` exit 0.
- `tsc --noEmit` em `app/web/`; `npm run build` em `site/`.
- Colorlib: relatório com todos os pares de RF9 passando (dois temas do
  app, tema claro do site).
- Manual: screenshots 1440/390 das duas superfícies; `?reduce=1` e
  `prefers-reduced-motion` mostram estado final; foco e teclado no site
  e no app; âncoras internas e links externos resolvem.
- Aceite: critérios da spec verificados item a item com evidência.

## Rollout manual

1. Fase 0: spec + plan + tasks + briefs + `frentes.json` na `main`
   (integração). Decisões D-030 a D-035 registradas pela integração em
   `DECISIONS.md`.
2. Fase 1 (paralelo): `site-forseti` copia os SVGs oficiais, troca
   fontes e tokens e reescreve o hero; `app-brand` troca tokens,
   fontes e marca e gera o relatório de contraste.
3. Fase 2: re-vestida das seções do site, gramática e motion v4,
   materialidade mineral nas telas do app.
4. Fase 3: screenshots, a11y item a item, gates e integração das duas
   branches. Reversão: `git revert`.

## Desvios de complexidade

- Script de medição por cópia adaptada do build do moodboard: justificado
  porque o colorlib já é a fonte única de contraste do projeto.
- Tema escuro do app sem definição do brandbook: adaptação medida
  registrada como decisão da frente, não invenção livre; light segue
  padrão e o alternador é preservado.
- Dois sistemas de tokens paralelos (site e app): cada pasta já tem o
  seu; unificar num pacote compartilhado custa mais do que devolve até
  30/11.
