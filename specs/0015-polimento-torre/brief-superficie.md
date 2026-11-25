# Brief polish-superficie: execucao de superficie visual (wave B)

Frente: polish-superficie (worktree wt/polish-superficie, branch wt/polish-superficie)
Spec: specs/0015-polimento-torre/spec.md
Pre-requisito: wave A integrada na main. Esta frente e transversal por
natureza (styles.css e tokens.css), por isso roda sozinha.

## Paths (a registrar em speckit/frentes.json quando a wave abrir)

- app/web/src/styles.css
- app/web/src/tokens.css
- app/web/src/torre-v2.css
- app/web/src/painel-v2.css
- app/web/src/menuwiki.css
- app/web/src/vistas.css
- app/web/src/fluxo.css (se existir apos a wave A)
- specs/0015-polimento-torre/brief-superficie.md

Proibido: qualquer .tsx (exceto se estritamente necessario para trocar uma
classe; nesse caso registrar nas decisoes e a integracao revisa), servidor.
Skills obrigatorias: impeccable, better-typography, better-colors,
better-layout. Verificacao visual obrigatoria com screenshots antes/depois
em browser proprio (agent-browser, sessao propria, vite do worktree).

## Contexto

Auditoria visual com medicoes de DOM e estudo de screenshots concluiu: o
produto tem ossos serios (tokens, contraste AA medido), mas a execucao de
superficie entrega "caseiro". O gap para Linear/Stripe/hex e 80 por cento
subtracao. Todos os achados abaixo tem evidencia medida no relatorio da
auditoria.

## Escopo (ordem de prioridade)

### S1. Escala tipografica (major)

Medido: 15 tamanhos renderizados, 13 valores em degraus de 0,5px
(0.6875/0.71875/0.75/0.78125/0.8125/0.84375/0.875/0.90625/0.9375/0.96825/1/
1.0625/1.125rem), 6 pesos (400/500/550/600/650/700). Consolidar:

- Escala de no maximo 6 degraus declarada em tokens.css; mapear cada uso
  atual para o degrau mais proximo.
- 3 pesos: 400, 600, 700. Remap dos intermediarios.
- Titulos de card uniformes: hoje "Fontes e campos" 17px vs vizinhos 15px
  por container query; um unico tamanho para titulo de card.
- Texto secundario nunca abaixo de 12px efetivos; preferir 12.5 ou 13.

### S2. Alturas de controle (major)

Medido: 5 alturas na mesma barra (26/30/31/36/38px). Travar 2 tamanhos
(28px compacto, 36px acao) e aplicar sem excecao na barra de vistas, pills,
botoes de card e chips. Font-size uniforme nos pares.

### S3. Marmore de verdade (major, identidade)

Medido: feTurbulence baseFrequency 0.008/0.026 produz manchas de fumaca;
no escuro parece vidro engordurado; o tile de 420px repete identico em
toda slab; slabs aninhados dobram a textura. Redesenhar:

- Veios finos e direcionais (frequencia maior, amplitude menor, bias
  direcional) ou reducao drastica da presenca.
- Nunca em elementos aninhados: chip dentro de card nao herda textura.
- Tema escuro: halvar a opacidade ou remover; superficie escura premium
  e quase sempre lisa.
- Variar o seed/offset por slab para quebrar a repeticao identica.
- Validar contraste medido antes/depois (a variacao de luminancia atras
  do texto miudo e risco de regressao).

### S4. Interior dos cards plano (major)

Medido: elementos aninhados carregam a mesma sombra de 4 camadas do card
que os contem (sameShadowNested); simulador tem 3 a 4 niveis de retangulo
encaixotado. Regra: dentro de um card, conteudo e plano; separar com
espaco e no maximo hairline; elevacao e privilegio do card. Remover bordas
redundantes onde o espaco ja agrupa.

### S5. Matriz sem gaiola (minor-major)

Reguas verticais e horizontais em todas as celulas dentro de um card que
ja tem ring. Remover reguas verticais; divergencia marcada na celula
(dot, canto ou bg da celula) em vez de coluna inteira tintada de lavanda
(efeito zebra quando todas as linhas divergem).

### S6. Roxo so em divergencia (minor)

Medido: 74 elementos com o roxo de "mudou/diverge", incluindo contagens de
abas e metadados que nao divergem. Restringir roxo a deltas e valores
divergentes reais; contagens voltam a texto secundario.

### S7. Uma acao primaria por vista (minor)

Medido: 3 botoes filled identicos (Executar, Ancorar, Aplicar). Apenas a
acao realmente primaria fica filled; as demais viram outline/secondary.

### S8. Preludio comprimido (major de composicao)

Medido: 620px de chrome antes do primeiro card (62 por cento do viewport
de 1000px). Comprimir: fundir a linha meta na rota visual, KPI faixa em
linha unica ou colapsavel, ritmo vertical consistente (gap vistas-grid de
38px quebra o ritmo de 22px das demais secoes). Cuidado: este item pode
exigir mexer em classnames de PainelPedido; se for o caso, documentar e a
integracao avalia.

### S9. Teto de largura (minor)

Em 1920px o painel estica a 1408px fluido. Capar max-width confortavel
(1500 a 1600px na coluna ou no grid) com o excedente virando respiro.

### S10. Detalhes de oficio (nit)

- Raios: consolidar a escala 10/14/18/999; usos avulsos de 2px e 6px e o
  --radius orfao de tokens.css.
- Underline pontilhado: um unico uso reservado (termo com tooltip);
  metadados de conflito viram chip ou dot.
- Scrollbar interna dos cards: estilo custom ou invisivel ate hover.
- Empty state de Sinais: explicar o que e e o que fazer, nao frase morta
  (se exigir tsx, registrar para a integracao).
- Stroke de icones 1.5 vs 1.6 no mesmo set (se exigir tsx, idem).
- Rail lateral: titulo em duas linhas em vez de ellipsis no meio da
  palavra.

## Criterios de aceite

1. No maximo 6 tamanhos de fonte e 3 pesos em uso medido no DOM (script de
   contagem no relatorio, antes e depois).
2. No maximo 2 alturas de controle na barra de vistas e headers de card.
3. Screenshots antes/depois nos dois temas: marmore, matriz, simulador,
   barra de vistas, rail.
4. Contraste dos pares principais medido e mantido AA nos dois temas.
5. Zero regressao de gates: tsc, vitest, build, repo-guard, prose-evals.
6. Nenhum .tsx editado sem registro explicito nas decisoes da frente.

## Decisoes da frente

(preencher aqui; a integracao copia para DECISIONS.md)
