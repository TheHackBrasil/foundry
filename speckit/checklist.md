# /speckit checklist — revisão de requisitos em área de risco

**Entrada:** `specs/NNNN/spec.md` tocando área de risco: dados pessoais
(A5), publicação/superfície (A2/A4), imutabilidade (A9), afirmação
factual ou material ilustrativo (A7).
**Saída:** `specs/NNNN/checklist.md` a partir de
`.specify/templates/checklist.md`, respondido.

## Procedimento

1. Só crie quando houver área de risco — checklist não é burocracia
   padrão.
2. Copie o template; nomeie a área; escreva itens `CHK###` que avaliem a
   **qualidade dos requisitos** ("todo X está rotulado?", "a spec proíbe
   Y?"), não a implementação.
3. Responda item a item com evidência (`arquivo:linha`), não com "sim".
4. Item falho → a spec está incompleta: volte para `specify`/`clarify`
   e corrija o requisito, não só o checklist.

## Gate de saída

- Veredito preenchido: spec apta para `plan` ou lista do que falta.
