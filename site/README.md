# site/

Site público do Forseti: página única estática na identidade do Brandbook
v4 (papel, petróleo, lavanda gráfica, violeta-sinal). Construído pela equipe
The Foundry no HackBrasil 2026.

## Stack

- Astro 7 (SSG) + TypeScript, sem backend
- Ilha React 19 no componente do dominó (`src/components/domino/`)
- GSAP 3 + ScrollTrigger + MotionPath para a sequência do v4 (surgir,
  conectar, propagar, estabilizar); Lenis para scroll suave
- Manrope e Geist Mono locais via `@fontsource-variable` (sem CDN em runtime)
- Tema só claro: `color-scheme: light`, sem modo escuro
- Saída estática em `dist/` (ignorada pelo git)

## Comandos

```bash
npm install
npm run dev        # desenvolvimento
npm run build      # gera dist/
npm run preview    # serve dist/ localmente
npx astro check    # typecheck dos .astro
```

O build lê o repositório pela API do GitHub sem token (60 requisições
por hora por IP). Para builds seguidos, passe um token só pelo ambiente:
`GITHUB_TOKEN=$(gh auth token) npm run build`. Ele fica no build e não
vai para o navegador.

## Links da entrega

`src/config.ts` guarda `DEMO_URL` e `VIDEO_URL`. Vazios, a página mostra
"Em preparação" e não renderiza link. Para publicar, preencha com a URL
completa (`https://...`), rode `npm run build` e publique o `dist/`.

## Publicação na Vercel

O projeto `the-foundry` (escopo `thisux1s-projects`) recebe o `dist/`
pronto, sem build na Vercel: o preset do projeto serviria a pasta
`public/` se recebesse o código-fonte.

```bash
vercel link --yes --project the-foundry --team thisux1s-projects  # uma vez
npm run build
mkdir -p dist/.vercel && cp .vercel/project.json dist/.vercel/
(cd dist && vercel deploy)          # pré-visualização
(cd dist && vercel deploy --prod)   # produção: the-foundry-alpha.vercel.app
```

A URL de pré-visualização pede login na Vercel (proteção padrão do
projeto); só o domínio de produção é aberto. O `vercel link` também cria
um `.env.local` com um token temporário da Vercel. Ele é ignorado pelo
git e não faz falta para publicar o `dist/`, então pode ser apagado.

## Regras

- Copy segue `../STYLE.md` (formal-direto, sem travessão nem meia-risca).
- Identidade: `../specs/0006-identidade-forseti-v4/` e os SVGs oficiais em
  `public/assets/forseti-*.svg`, usados sem alteração de geometria.
- Lavanda `#D7C5EA` é só gráfica (cordas, preenchimentos): nunca texto nem
  único sinal de estado. Violeta `#654199` é o sinal de coordenação.
- Motion: só `transform`/`opacity` e traço das cordas;
  `prefers-reduced-motion` ou `?reduce=1` mostra o estado final já desenhado.
- Fatos com data e fonte: nunca apresentar simulação como validação (A7).
  O dominó é simulação fictícia e diz isso na própria peça.
- Specs do site: `../specs/0002-site-foundry/`, `../specs/0003-site-redesign/`
  (entregues) e `../specs/0006-identidade-forseti-v4/`.
- Decisões: `../DECISIONS.md`. Processo: `../docs/`.
