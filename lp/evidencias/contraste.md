# Contraste medido da LP Forseti

Medido em 22 nov 2026 com `research/R4-assets/scripts/colorlib.py`
(`contrast(fg, bg)`, WCAG 2.2). Razão bruta, sem arredondar no corte
(4,47 reprova quando o mínimo é 4,5).

| Par | fg | bg | Razão | Mínimo | Resultado |
|---|---|---|---|---|---|
| Texto principal sobre papel | #163C38 | #F5F2EB | 10.81 | 4.5 | passa |
| Texto secundário sobre papel | #52665E | #F5F2EB | 5.49 | 4.5 | passa |
| Metadados sobre papel | #5D7068 | #F5F2EB | 4.72 | 4.5 | passa |
| Violeta (eyebrow, dt, situação) sobre papel | #654199 | #F5F2EB | 6.78 | 4.5 | passa |
| Violeta sobre tinta de célula divergente | #654199 | #EDE5FE | 6.23 | 4.5 | passa |
| Petróleo sobre papel profundo (faixa) | #163C38 | #ECE7DA | 9.79 | 4.5 | passa |
| Secundário sobre papel profundo | #52665E | #ECE7DA | 4.97 | 4.5 | passa |
| Texto sobre cartão claro | #163C38 | #FBF9F3 | 11.48 | 4.5 | passa |
| Secundário sobre cartão | #52665E | #FBF9F3 | 5.83 | 4.5 | passa |
| Papel sobre botão petróleo | #F5F2EB | #163C38 | 10.81 | 4.5 | passa |
| Papel sobre ilha stone (fecho) | #F5F2EB | #0E1F1D | 15.24 | 4.5 | passa |
| Secundário sobre ilha stone | #A8B5AF | #0E1F1D | 8.03 | 4.5 | passa |
| Petróleo sobre botão claro (fecho) | #0E1F1D | #F5F2EB | 15.24 | 4.5 | passa |
| Borda de controle e botão ghost sobre papel | #52665E | #F5F2EB | 5.49 | 3.0 | passa |
| Anel de foco violeta sobre papel | #654199 | #F5F2EB | 6.78 | 3.0 | passa |
| Anel de foco lavanda sobre stone | #D7C5EA | #0E1F1D | 10.60 | 3.0 | passa |
| Borda do botão ghost sobre stone | #F5F2EB | #0E1F1D | 15.24 | 3.0 | passa |
| Lavanda (cordas) sobre papel | #D7C5EA | #F5F2EB | 1.44 | n/a | só gráfico, nunca texto |

## Capturas

- `lp-hero-1440.png`: hero em 1440px com a cena de monólitos e cordas.
- `lp-matriz-1440.png`: seção "como funciona" com a matriz de divergência.
- `lp-fecho-1440.png`: ilha de fecho em petróleo profundo.
- `lp-reduce-1440.png`: `?reduce=1`, cordas desenhadas e reveals visíveis.
- `lp-hero-390.png` e `lp-matriz-390.png`: mobile 390px, sem overflow.
