# Constituição — The Foundry · HackBrasil 2026

Documento normativo máximo deste repositório. Dez artigos + governança.
Emenda: somente em PR próprio, com justificativa e atualização dos artefatos
afetados (guard, templates, AGENTS.md).

## A1 — Fatia vertical completa

Toda entrega publicada funciona de ponta a ponta: links resolvem, assets
existem, conteúdo é real e final. Proibido placeholder, stub, lorem ipsum,
"em breve" sem ponteiro para a fila, ou seção que promete o que não existe.

**Verificação:** `node scripts/repo-guard.mjs` (links e assets) + revisão de
diff: nenhum texto provisório em arquivo publicado.

## A2 — Autorização na fronteira de dados

Quando o repositório tiver código que lê ou escreve dados, a autorização é
verificada na camada de dados (RLS, policies ou camada equivalente) — nunca
apenas escondendo UI. Até lá, o análogo vigora para publicação: nada privado
entra no repo, porque tudo versionado aqui é tratado como público.

**Verificação:** plan lista a fronteira de dados da mudança; guard bloqueia
segredos (check `secrets`) e revisão confere o que entra como público (A4/A5).

## A3 — Escritas previsíveis e domínio puro

Código com efeito (rede, disco, geração de arquivo) falha de forma explícita
na fronteira — nunca throw solto para o usuário final. Regras de negócio
ficam em funções puras e testáveis. Scripts em `scripts/` são determinísticos
e read-only, salvo declaração explícita no cabeçalho do arquivo.

**Verificação:** `node --check` em todo script (via guard); revisão confirma
tratamento de erro na fronteira de cada função com efeito.

## A4 — Superfície pública é exceção explícita

Nova página, documento indexado, spec, asset público ou endpoint é decisão
registrada: item na spec/plan + entrada no índice da pasta (`docs/README.md`,
`specs/README.md`, `README.md` raiz). Nada "aparece" no repo sem estar
listado.

**Verificação:** guard checa índice de `specs/`; revisão confere índice de
qualquer pasta tocada.

## A5 — Dados pessoais com inventário e consentimento

Nomes, fotos, contatos e voz de pessoas (time, entrevistados, contatos) só
entram no repo se já forem públicos ou consentidos, e ficam inventariados em
`docs/fontes-e-contatos.md`. Transcrições somente na versão revisada e
compartilhável. Pedido de remoção é atendido na mesma PR.

**Verificação:** pessoa nomeada em arquivo publicado consta no inventário;
revisão obrigatória em PRs que tocam `docs/`.

## A6 — Idioma, identidade e acessibilidade

Produto e documentos em pt-BR; identificadores técnicos em inglês conforme a
convenção do repo. UI segue a identidade The Foundry (`PRODUCT.md`) e a
a11y mínima: contraste legível, foco visível e navegação por teclado,
`prefers-reduced-motion`, alt text em mídia.

**Verificação:** critérios de aceite da spec + revisão manual dos quatro
itens de a11y antes do merge de qualquer mudança de UI.

## A7 — Material ilustrativo é rotulado

Simulação, mock, dado fictício ou projeção é rotulado como tal no próprio
artefato. Nada ilustrativo aparece como medido ou validado. Material de
demonstração mantém paridade com a realidade: se a simulação diverge da
operação real, a simulação está errada — e é corrigida ou removida.

**Verificação:** checklist da spec exige rótulo onde há conteúdo não-factual;
revisão procura número ou afirmação sem fonte.

## A8 — Qualidade é gate local executável

O DoD é uma lista de comandos (`AGENTS.md`), não de intenções. Nada entra no
histórico sem guard verde e sem as checagens da spec. A saída real dos
comandos acompanha o commit/PR.

**Verificação:** `node scripts/repo-guard.mjs` exit 0; evidência colada na
descrição do commit ou PR.

## A9 — Artefato aplicado é ledger imutável

Fontes primárias (transcrições, documentos recebidos, dumps), specs com
Status "entregue" e — quando existirem — migrations e releases publicados
nunca são editados nem apagados. Correção = artefato novo ou errata datada
no mesmo diretório.

**Verificação:** guard compara `.specify/immutable.txt` e specs entregues
contra o HEAD git.

## A10 — Mudança com intenção registrada

Mudança não-trivial (definição em `.specify/README.md`) só acontece a partir
de spec em `specs/`. Correções triviais — typo, link quebrado, formatação —
dispensam spec, mas não dispensam guard verde.

**Verificação:** commit/PR referencia `specs/NNNN`; `specs/README.md`
contém a entrada.

## Governança

Precedência: **esta constituição > `AGENTS.md` > convenções (`PRODUCT.md`,
`docs/`) > spec vigente > `BACKLOG.md` > `README.md`.** Conflito entre
níveis resolve-se a favor do superior; a emenda registra a resolução.
