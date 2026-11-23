# LP do Forseti

Landing page institucional do produto Forseti, na identidade do Brandbook
v4: camada de reconciliação e coordenação entre os sistemas que a cadeia
logística já usa.

Projeto Astro próprio, independente de `site/` (o site-diário do processo
do HackBrasil, que continua como está).

## Stack

- Astro 7, página única, sem ilhas de framework.
- `@fontsource-variable/manrope` (comunicação) e
  `@fontsource-variable/geist-mono` (identificadores e dados).
- CSS de tokens por papel em `src/styles/global.css`.
- Motion sem dependência em `src/scripts/motion.ts`: reveals por
  IntersectionObserver, cordas por `stroke-dashoffset`, sinal por
  `offset-path`. `prefers-reduced-motion` e `?reduce=1` entregam o estado
  final (cordas desenhadas, sinal oculto, reveals visíveis).

## Rodar

```bash
npm install
npm run dev      # http://localhost:4321 (ou a porta livre)
npm run build    # gera dist/ com 1 página
```

## Configuração

`src/config.ts`: `DEMO_URL` aponta para a demonstração pública na Railway
e `SITE_URL` guarda a base absoluta para `og:url`/`og:image` quando o
domínio da LP for definido. Valores vazios viram estado honesto na página,
nunca link morto.

## Verificação

Evidências em `evidencias/`: relatório de contraste medido e capturas em
1440px e 390px, uma delas em `?reduce=1`.
