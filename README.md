![The Foundry: camada de coordenação para logística B2B](docs/readme/header.svg)

<p align="center">
  <a href="https://the-foundry-alpha.vercel.app"><b>Site</b></a> ·
  <a href="https://github.com/TheHackBrasil/foundry/releases/tag/pitch-v10"><b>Pitch em vídeo (v10)</b></a> ·
  <a href="./docs/escopo.md">Escopo</a> ·
  <a href="./DECISIONS.md">Decisões</a> ·
  <a href="./BACKLOG.md">Backlog</a>
</p>

**The Foundry** é uma camada de coordenação para logística B2B. Ela conecta os
sistemas que fornecedor, transportadora, centro de distribuição, fiscal e
financeiro já usam e avisa todos quando um pedido muda.

> **Estado:** hipótese em construção, MVP em definição. Time da trilha
> Logística & Automação do HackBrasil 2026, com submissão em 30/11. Este repo
> registra o processo inteiro, da pesquisa de campo à entrega.

## O problema

Quando um parceiro atrasa ou muda algo, o efeito se espalha pela cadeia.
Pedidos, prazos, contratos e documentos ficam em sistemas diferentes, e as
equipes acertam a diferença por ligação e conferência manual.

O galpão mostra o mesmo padrão em escala menor: etiquetas e códigos variam
entre fornecedores, e kits, lotes e peso variável complicam o registro e a
documentação na entrada. A TOTVS trouxe o aprendizado que orienta o desenho:
o setor não é letrado digitalmente, e solução que exige mudança de rotina
morre na gaveta.

## Como funciona (hipótese)

![Diagrama: o fornecedor registra um atraso, a camada compara as versões do pedido e avisa transportadora, CD, fiscal e financeiro](docs/readme/fluxo.svg)

1. **Lê o que cada parceiro já produz.** ERP, XML de NF-e, PDF, planilha.
   Ninguém troca de sistema; a integração precisa ser trivial.
2. **Mantém um registro único do pedido.** Uma versão compartilhada entre
   fornecedores, operadores e áreas financeira e fiscal.
3. **Avisa quando as versões divergem.** Atrasos, divergências e pendências
   aparecem para todos antes de virar efeito dominó.

Isto é a hipótese de produto da call de 16/11, não um sistema em operação.
Ainda não medimos o retorno de uma solução.

## Escopo

**Decidido**

- Direção: coordenação entre fornecedores, operadores logísticos e áreas
  financeira e fiscal (D-002).
- Simplicidade de adoção é requisito. API aberta e documentação que um leigo
  consiga seguir.

**Fora**

- Roteirização interna. O mercado já tem muitas soluções, a decisão exige
  algoritmo determinístico (OR-Tools) e, para PMEs, depende de hardware.
- Blockchain como requisito. É opção de registro compartilhado, adotada só se
  a camada precisar de confiança entre empresas que não se conhecem (D-003).
- Promessa de implantação real antes de 30/11.

**Em aberto**

- Leitura candidata, em discussão: capacidade ociosa (doca livre, espaço de
  retorno, posição de estoque) entraria como tipo de dado na camada, não como
  marketplace.
- Qual sub-dor vem primeiro. Cada resposta vira um MVP diferente:

| Candidato | O que é |
|---|---|
| Atraso propagado | Um parceiro atrasa; alertar e coordenar os demais, incluindo o financeiro |
| Documentos fiscais / NF | Registro e documentação da carga de ponta a ponta |
| Recebimento / etiquetas | Padronizar códigos e conferência na entrada do galpão |
| Contratos / conciliação | Revalidar contratos e pagamentos quando a operação muda |

Detalhes, riscos mapeados e próximos passos em [`docs/escopo.md`](docs/escopo.md).

## Pesquisa de campo

![Linha do tempo: 05/11 lançamento, FENATRAN em novembro, 16/11 call de alinhamento, 19/11 repo e pitch v10, 30/11 submissão](docs/readme/linha-do-tempo.svg)

A investigação veio antes do produto. A maior parte das conversas começou na
**FENATRAN** (São Paulo Expo, novembro de 2026). Na **call de alinhamento de
16/11** (cerca de 1h43), o time escolheu a direção de escopo.

| Fonte | O que trouxe |
|---|---|
| TOTVS (especialista em logística) | Clientes reclamam da gestão de vários parceiros logísticos e da cascata financeira. Vender solução complexa ao setor não funciona. |
| Schulz Tech (mentor) | Roteirização é o ativo real e usa OR-Tools, não LLM. Digital Twin é aditivo visual. |
| Kaufmann (estande FENATRAN) | Automação de esteiras para galpões e fábricas. |
| CAP Logística (diretora, parceria GCCA) | Convite para visitar galpões, pela ponte de Isabela Claro Sanches. |
| Especialista em armazéns, Vivianne Moreira Leite | Gargalos de recebimento, etiquetagem e expedição; caos de etiquetas entre fornecedores. |
| Emiteaí (estande FENATRAN) | Referência de comparação: emissão de documentos de rota. A diferenciação segue em aberto. |
| Enviagora (Rafael Alberto Born, CEO) | Call de descoberta reagendada. Objetivo: um caso real bem entendido e qual dor investigar primeiro. |

Os contatos citados não são depoimentos nem endossos. Fontes completas em
[`docs/fontes-e-contatos.md`](docs/fontes-e-contatos.md); resumo e transcrição
da call em [`docs/`](docs/).

## Estado atual

- **Em execução:** definir o escopo do MVP (item #7 do
  [`BACKLOG.md`](BACKLOG.md)). O fluxo único depende da call com a Enviagora e
  da resposta do contato TOTVS.
- **Pitch:** v10 publicado na
  [release `pitch-v10`](https://github.com/TheHackBrasil/foundry/releases/tag/pitch-v10)
  (D-014).
- **Site:** redesign na identidade da marca em andamento
  ([`specs/0003`](specs/0003-site-redesign/spec.md)).
- Decisões, achados e pendências datados em [`DECISIONS.md`](DECISIONS.md);
  specs em [`specs/`](specs/).

## Como o repo está organizado

| Caminho | O que tem |
|---|---|
| [`docs/`](docs/) | Pesquisa e escopo: resumo e transcrição da call, fontes e contatos, dossiê da visão de arco |
| [`site/`](site/) | Site do diário (Astro + TypeScript) |
| [`slides/`](slides/) | Deck de descoberta preparado para a call Enviagora |
| [`specs/`](specs/) | Specs de cada mudança não trivial |
| [`PRODUCT.md`](PRODUCT.md) · [`DECISIONS.md`](DECISIONS.md) · [`BACKLOG.md`](BACKLOG.md) · [`RULES.md`](RULES.md) | Produto, log de decisões, fila de trabalho, regras da competição |
| [`AGENTS.md`](AGENTS.md) · [`STYLE.md`](STYLE.md) · [`.specify/`](.specify/) · [`speckit/`](speckit/) | Como mudanças acontecem aqui e como a prosa é escrita |
| [`scripts/`](scripts/) | Verificação local: `repo-guard.mjs` e `prose-evals.mjs` |

Antes de qualquer commit:

```bash
node scripts/repo-guard.mjs && node scripts/prose-evals.mjs
```

## Time

| | |
|---|---|
| **Gabriel Sacilotto** | Produto e pesquisa |
| **Guilherme Barreto** | Engenharia e sistemas |
| **Thiago Araujo** | Experiência e design, arquitetura e IA |

---

<sub>The Foundry · HackBrasil 2026 · Logística & Automação. Identidade: preto
<code>#0a0c0e</code> e laranja de forja <code>#EA5808</code>.</sub>
