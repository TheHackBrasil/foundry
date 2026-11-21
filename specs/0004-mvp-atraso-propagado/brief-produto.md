# Brief · frente `escopo-produto`

Escopo: tudo que não é código da spec 0004: corpus de XMLs sintéticos
(`app/seed/xmls/` + `app/seed/cenario.md`: NF-e, CT-e, planilha de atraso do fornecedor
coerentes entre si, mesma chave de 44 dígitos, CNPJ fictício,
rotulado), roteiro da call Enviagora atualizado (valida produto com a
demo, não ideia), envio da pergunta P-002 ao contato TOTVS,
levantamento dos critérios oficiais da banca (P-005, resolvido em 20/11), comparação documentada com a Emiteaí (R-004),
`app/README.md` (setup em 3 comandos + roteiro de demo de 3 min),
copy da demo revisada por `STYLE.md`, pitch v11 com gravação da demo,
sessões e decisões em `DECISIONS.md`, `BACKLOG.md` atualizado,
ensaio e gravação da demo.
Paths: `app/seed/**`, `app/README.md`, `DECISIONS.md`, `BACKLOG.md`,
`RULES.md` (P-005), `docs/` (comparação Emiteaí), roteiros de call e
demo podem viver em `specs/0004-mvp-atraso-propagado/`.
Não escrever em `app/server/**`, `app/shared/**`, `app/web/**`,
`app/contracts/**`, `site/**` (capítulo entra na fase 4, combinado),
`slides/**`.
Base: `main` com spec 0004 commitada; branch `wt/escopo-produto`;
worktree `../foundry-wt-escopo`.
Proibido: merge em main, push fora da branch, editar imutável (A9),
tocar `.env*`, escrever fora dos paths, afirmação sem fonte (A7),
travessão/meia-risca em `.md`.
Gate: guard + prose-evals exit 0; XMLs da seed válidos no schema e
rotulados; DECISIONS com sessão datada; roteiro de demo ensaiado de
ponta a ponta.
Reporte: conclusão + evidência `arquivo:linha` por item.
