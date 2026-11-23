# Contraste medido: `app/web` na identidade Brandbook v4

Gerado por `app/web/scripts/check_contrast.py` a partir dos valores de
`src/tokens.css` (WCAG 2.2, luminância relativa). Texto exige 4,5:1;
borda de controle e anel de foco, 3:1; pares marcados como informativo
documentam usos gráficos sem exigência de contraste.

## Tema claro: 26 de 26 pares exigidos passam

| par | frente | fundo | razão | mín. | resultado | onde |
|---|---|---|---|---|---|---|
| texto / fundo | `#163c38` | `#f5f2eb` | 10,81 | 4,5 | passa | texto principal |
| texto / superfície | `#163c38` | `#fcfaf6` | 11,59 | 4,5 | passa | texto em botão e cartão |
| texto / superfície 2 | `#163c38` | `#ece8df` | 9,88 | 4,5 | passa | texto em faixa |
| texto 2 / fundo | `#52665e` | `#f5f2eb` | 5,49 | 4,5 | passa | legenda, selo e metadado |
| texto 2 / superfície | `#52665e` | `#fcfaf6` | 5,89 | 4,5 | passa | legenda em cartão |
| texto 2 / superfície 2 | `#52665e` | `#ece8df` | 5,02 | 4,5 | passa | rótulo de coluna da matriz |
| on-primary / primary | `#f5f2eb` | `#163c38` | 10,81 | 4,5 | passa | botão marcado e link 'pular' |
| primary / superfície | `#163c38` | `#fcfaf6` | 11,59 | 3,0 | passa | preenchimento do controle ativo |
| borda forte / superfície | `#52665e` | `#fcfaf6` | 5,89 | 3,0 | passa | borda de botão, aba e régua da matriz |
| borda forte / fundo | `#52665e` | `#f5f2eb` | 5,49 | 3,0 | passa | borda de controle sobre o fundo |
| foco / superfície | `#163c38` | `#fcfaf6` | 11,59 | 3,0 | passa | anel de foco |
| foco / fundo | `#163c38` | `#f5f2eb` | 10,81 | 3,0 | passa | anel de foco sobre o fundo |
| mudança / mudança-bg | `#654199` | `#ede5fe` | 6,23 | 4,5 | passa | rótulo na célula divergente |
| mudança / fundo | `#654199` | `#f5f2eb` | 6,78 | 4,5 | passa | 'Diverge', 'Nova' e variação |
| mudança / superfície | `#654199` | `#fcfaf6` | 7,27 | 4,5 | passa | rótulo de divergência em cartão |
| mudança / superfície 2 | `#654199` | `#ece8df` | 6,20 | 4,5 | passa | rótulo na barra do quadro |
| texto / mudança-bg | `#163c38` | `#ede5fe` | 9,92 | 4,5 | passa | valor da célula divergente |
| texto 2 / mudança-bg | `#52665e` | `#ede5fe` | 5,04 | 4,5 | passa | 'antes' riscado sobre a tinta |
| on-rail / rail | `#f5f2eb` | `#163c38` | 10,81 | 4,5 | passa | texto do monólito lateral |
| rail-soft / rail | `#a9beb4` | `#163c38` | 6,16 | 4,5 | passa | metadado dentro do monólito |
| ok / ok-bg | `#31693f` | `#dff3e2` | 5,60 | 4,5 | passa | chip 'Confere' |
| ok / fundo | `#31693f` | `#f5f2eb` | 5,83 | 4,5 | passa | 'Confere' e 'ao vivo' sobre o fundo |
| warn / warn-bg | `#865812` | `#fbebcf` | 5,23 | 4,5 | passa | estado de atenção |
| warn / fundo | `#865812` | `#f5f2eb` | 5,49 | 4,5 | passa | 'conectando' sobre o fundo |
| erro / erro-bg | `#ac3031` | `#fee6e6` | 5,49 | 4,5 | passa | estado de erro |
| erro / fundo | `#ac3031` | `#f5f2eb` | 5,83 | 4,5 | passa | aviso de erro sobre o fundo |
| corda / rail | `#d7c5ea` | `#163c38` | 7,52 | n/a | informativo | fio lavanda do monólito (decorativo) |
| petróleo / lavanda | `#163C38` | `#D7C5EA` | 7,52 | n/a | informativo | cordas da marca (informativo) |
| lavanda / papel | `#D7C5EA` | `#F5F2EB` | 1,44 | n/a | informativo | prova de que a lavanda clara não serve de texto |

## Tema escuro: 26 de 26 pares exigidos passam

| par | frente | fundo | razão | mín. | resultado | onde |
|---|---|---|---|---|---|---|
| texto / fundo | `#e8f0ee` | `#0e1f1d` | 14,71 | 4,5 | passa | texto principal |
| texto / superfície | `#e8f0ee` | `#152825` | 13,31 | 4,5 | passa | texto em botão e cartão |
| texto / superfície 2 | `#e8f0ee` | `#1c332f` | 11,59 | 4,5 | passa | texto em faixa |
| texto 2 / fundo | `#a8bdb5` | `#0e1f1d` | 8,61 | 4,5 | passa | legenda, selo e metadado |
| texto 2 / superfície | `#a8bdb5` | `#152825` | 7,79 | 4,5 | passa | legenda em cartão |
| texto 2 / superfície 2 | `#a8bdb5` | `#1c332f` | 6,78 | 4,5 | passa | rótulo de coluna da matriz |
| on-primary / primary | `#0e1f1d` | `#e8f0ee` | 14,71 | 4,5 | passa | botão marcado e link 'pular' |
| primary / superfície | `#e8f0ee` | `#152825` | 13,31 | 3,0 | passa | preenchimento do controle ativo |
| borda forte / superfície | `#7e968e` | `#152825` | 4,87 | 3,0 | passa | borda de botão, aba e régua da matriz |
| borda forte / fundo | `#7e968e` | `#0e1f1d` | 5,39 | 3,0 | passa | borda de controle sobre o fundo |
| foco / superfície | `#e8f0ee` | `#152825` | 13,31 | 3,0 | passa | anel de foco |
| foco / fundo | `#e8f0ee` | `#0e1f1d` | 14,71 | 3,0 | passa | anel de foco sobre o fundo |
| mudança / mudança-bg | `#c9b2f0` | `#35294a` | 7,09 | 4,5 | passa | rótulo na célula divergente |
| mudança / fundo | `#c9b2f0` | `#0e1f1d` | 9,01 | 4,5 | passa | 'Diverge', 'Nova' e variação |
| mudança / superfície | `#c9b2f0` | `#152825` | 8,16 | 4,5 | passa | rótulo de divergência em cartão |
| mudança / superfície 2 | `#c9b2f0` | `#1c332f` | 7,10 | 4,5 | passa | rótulo na barra do quadro |
| texto / mudança-bg | `#e8f0ee` | `#35294a` | 11,57 | 4,5 | passa | valor da célula divergente |
| texto 2 / mudança-bg | `#a8bdb5` | `#35294a` | 6,77 | 4,5 | passa | 'antes' riscado sobre a tinta |
| on-rail / rail | `#f5f2eb` | `#163c38` | 10,81 | 4,5 | passa | texto do monólito lateral |
| rail-soft / rail | `#a9beb4` | `#163c38` | 6,16 | 4,5 | passa | metadado dentro do monólito |
| ok / ok-bg | `#95d7a2` | `#1c3422` | 8,01 | 4,5 | passa | chip 'Confere' |
| ok / fundo | `#95d7a2` | `#0e1f1d` | 10,16 | 4,5 | passa | 'Confere' e 'ao vivo' sobre o fundo |
| warn / warn-bg | `#f0c374` | `#3f2c10` | 8,08 | 4,5 | passa | estado de atenção |
| warn / fundo | `#f0c374` | `#0e1f1d` | 10,36 | 4,5 | passa | 'conectando' sobre o fundo |
| erro / erro-bg | `#ffa098` | `#4e201e` | 6,93 | 4,5 | passa | estado de erro |
| erro / fundo | `#ffa098` | `#0e1f1d` | 8,71 | 4,5 | passa | aviso de erro sobre o fundo |
| corda / rail | `#d7c5ea` | `#163c38` | 7,52 | n/a | informativo | fio lavanda do monólito (decorativo) |
| petróleo / lavanda | `#163C38` | `#D7C5EA` | 7,52 | n/a | informativo | cordas da marca (informativo) |
| lavanda / papel | `#D7C5EA` | `#F5F2EB` | 1,44 | n/a | informativo | prova de que a lavanda clara não serve de texto |
