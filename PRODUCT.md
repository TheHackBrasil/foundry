# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: static HTML/CSS/JS served by GitHub Pages: consistent with the
reference projects (`build-in-public`, `slides-enviagora`), zero build step,
works on free org Pages.

## Users

- Banca do HackBrasil 2026 (juízes e mentores) avaliando maturidade de processo
  e escopo: lê rápido, julga dezenas de times.
- Contatos e mentores do setor logístico (TOTVS, Schulz Tech, Kaufmann, CAP
  Logística, Enviagora) que podem virar referência ou validação.
- O próprio time, como registro público do processo ("build in public").

## Product Purpose

Site-diário público do time The Foundry no HackBrasil 2026: provar que a
investigação veio antes do produto, encontros reais, FENATRAN, contatos de
mercado, e hospedar os artefatos do processo (pitch em vídeo, slides de
descoberta, documentos de pesquisa). Sucesso = a banca reconhecer método e
domínio do problema, não promessa inflada.

## Positioning

Enquanto outros times apresentam uma ideia, a The Foundry mostra um processo:
campo (FENATRAN), escuta (mentores nomeados), hipóteses marcadas como
hipóteses. O diferencial é evidência real e honestidade de validação: nada é
apresentado como provado antes de ser.

## Operating Context

- HackBrasil 2026, trilha Logística & Automação; submissão em 30/11/2026.
- Repo canônico: `github.com/TheHackBrasil/foundry` (site + slides + docs).
- Repo de referência (Gabriel): `github.com/TheHackBrasil/the-foundry-archive`.
- Entregáveis: pitch em vídeo (v9, mp4 via release), site, repo.
- Call de descoberta com Rafael Born (CEO Enviagora): remarcada, sem nova data.

## Capabilities and Constraints

- Time: Gabriel Sacilotto (produto/pesquisa), Guilherme Barreto
  (engenharia/sistemas), Thiago (experiência/design, arquitetura & IA).
  Liz é 4ª integrante pendente de confirmação/registro.
- Hipótese de produto em exploração: camada de eventos compartilhados entre
  fornecedores/operadores/financeiro-fiscal, sem exigir troca de sistemas.
  Blockchain é alternativa sob avaliação, não decisão.
- Conteúdo sensível: nomes e fotos de contatos reais: sempre com disclaimer
  ("não são depoimentos nem endossos"). Nunca inventar claims comerciais.
- Setor não-letrado digitalmente: simplicidade de adoção é requisito de tese,
  refletido também no tom do site (sem jargão de venda).

## Brand Commitments

- Nome: THE FOUNDRY · marca: F + bigorna laranja (logo em
  `site/assets/the-foundry-logo.webp`).
- Identidade visual confirmada (do pitch v9): fundo `#0A0C0E`, laranja
  `#EA5808`, texto `#F4F4F5`, metadados `#71717A`; Space Grotesk (títulos) +
  JetBrains Mono (tarjas/dados); atmosfera "industrial tech": grade de pontos,
  linhas de rota, faísca de forja.
- Tom: investigação real, sem storytelling de venda; hipóteses sempre
  rotuladas como tal.

## Evidence on Hand

- `site/assets/`: fotos reais (serena, fiap, fenatran ×2), retratos do time e
  dos contatos (isabela, vivianne, rafael), logo, ilustração isométrica GIF.
- `slides/`: deck de descoberta Enviagora (7 slides + notas do apresentador).
- `docs/`: resumo da call de alinhamento, decisões de escopo, transcrição.
- `out`/release: `pitch-v9-share.mp4` (pitch inicial, ~2min40s).
- Fatos de pesquisa documentados na transcrição da call (TOTVS, Schulz,
  Kaufmann, CAP, Emiteaí; dor de propagação de atraso; caos de etiquetas).

## Product Principles

- Evidência antes de adjetivo: cada afirmação carrega prova ou disclaimer.
- O diário é vivo: capítulos novos entram conforme o processo avança.
- Uma família visual: site, slides, README e pitch compartilham a identidade.
- Estático e leve: sem build, sem dependência, carrega em qualquer rede.

## Open Decisions

- Resultado da call Enviagora (remarcada, sem data) → próximo capítulo.
- Entrada formal da Liz no time → seção "pessoas" quando confirmada.
- Definição do fluxo único do MVP (NF/fiscal vs atraso vs contratos).
