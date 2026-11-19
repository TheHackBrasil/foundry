# regression-map: invariante ↔ proteção

O que não pode regredir neste repo e o que o protege. Atualizar quando uma
invariante nova nascer (via spec) ou uma proteção mudar.

| Invariante | Proteção | Tipo |
|---|---|---|
| Nenhum `.env*`/segredo versionado | `repo-guard.mjs` → check `secrets` | comando |
| Link relativo em markdown nunca quebra | `repo-guard.mjs` → check `md-links` (pula code fences) | comando |
| Asset referenciado em HTML/SVG existe | `repo-guard.mjs` → check `html-assets` | comando |
| Fontes primárias jamais editadas (transcrição, docx, pdf) | `.specify/immutable.txt` → check `immutable` | comando |
| Spec `entregue` nunca muda | `repo-guard.mjs` → check `immutable` (spec entregue vs HEAD) | comando |
| Numeração de specs única e crescente, lacunas registradas | `repo-guard.mjs` → check `specs` (detecta duplicados e lacunas) | comando |
| Toda spec tem entrada no índice `specs/README.md` | `repo-guard.mjs` → check `specs` | comando |
| Todo arquivo de `docs/` consta no índice da pasta (A4) | `repo-guard.mjs` → check `docs-index` | comando |
| Marcadores estruturais do `AGENTS.md` intactos | `repo-guard.mjs` → check `agents` | comando |
| Todo `.js`/`.mjs`/`.cjs` versionado é sintaticamente válido | `repo-guard.mjs` → check `scripts` (`node --check`) | comando |
| Todo JSON versionado é válido | `repo-guard.mjs` → check `json` | comando |
| Versão de runtime coerente entre config e docs (quando houver) | `repo-guard.mjs` → check `runtime` (dormente sem `.nvmrc`/`engines`) | comando |
| Nenhum travessão (U+2014) em markdown | `repo-guard.mjs` → check `prose` (pula artefatos A9) + `STYLE.md` | comando |
| Prosa sem padrão de IA (conectivos, infladores, tríades) | `STYLE.md` + skill `humanizer`/`antislop-copywriting` + revisão | revisão |
| Pessoa citada consta no inventário público | `docs/fontes-e-contatos.md` + revisão em PRs de `docs/` (A5) | revisão |
| Conteúdo ilustrativo sempre rotulado | templates spec/checklist + revisão (A7) | revisão |
| Fatos publicados têm fonte | `docs/` exige fonte inline + revisão (A7) | revisão |
| UI mantém a11y mínima (contraste, foco, reduced-motion, alt) | critérios da spec + revisão A6 | revisão |
| Decisões ficam datadas e rastreáveis | `DECISIONS.md` (D/R/P + sessões), obrigatório no mesmo commit | revisão |
| Duas frentes nunca escrevem no mesmo arquivo | `speckit/frentes.md`: paths no brief + revisão do orquestrador | revisão |
| Commits atômicos com identidade única | convenção `speckit/frentes.md` § commits + revisão | revisão |
| Restrições da competição só com fonte | `RULES.md`: lacunas vão para `DECISIONS.md` (P-NNN) | revisão |

## Quando um teste real existir

Suíte automatizada (se/quando houver código) entra nesta matriz como tipo
`comando`, com o comando exato: nunca "rode os testes" sem nomear qual.
