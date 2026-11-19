# Spec 0001 — Publicação dos docs de pesquisa

**Status:** entregue
**Origem:** decisão da sessão — repo canônico novo começa pela pesquisa
**Data:** 2026-11-19

> Spec retroativa (piloto do pipeline): a entrega (`fc8eb46`) precedeu a
> implantação do SDD. Este arquivo registra a baseline e serve de
> referência de formato.

## Problema e resultado esperado

O repo canônico (`TheHackBrasil/foundry`) precisava nascer com a pesquisa
documentada — não com código sem contexto. Resultado: qualquer pessoa
(time, banca, agente) entende o que foi investigado, o que está decidido
e o que continua aberto, lendo `docs/` em ordem.

## Fora de escopo

- Site, slides públicos, pitch em vídeo, README definitivo — itens do
  `BACKLOG.md`, fora desta entrega.
- Escolher o fluxo único do MVP (bloqueado: call Enviagora remarcada).

## Histórias

### US1 — Leitor externo entende o estado da pesquisa

- **Dado** o repo clonado **Quando** abre `docs/README.md` **Então**
  encontra índice ordenado com a função de cada documento.
- **Dado** `docs/escopo.md` **Quando** lê as decisões **Então** distingue
  o decidido (camada de coordenação; roteirização fora) do aberto
  (sub-fluxo do MVP).

### US2 — Time/agente não repete pesquisa

- **Dado** `docs/fontes-e-contatos.md` **Quando** procura uma empresa ou
  contato **Então** encontra origem, canal e o que cada um trouxe.

## Casos de borda

- Transcrição é fonte primária: só a versão revisada/compartilhável entra
  no repo (A5).
- Dossiê é visão de arco, não escopo: rotulado como tal nos dois
  documentos que o citam (A7).

## Requisitos funcionais

- **RF1** — `docs/` contém resumo (md + docx), transcrição, fontes,
  escopo e dossiê, com índice em `docs/README.md`.
- **RF2** — Todo fato de pesquisa referencia fonte (transcrição, call ou
  link) dentro do próprio documento.
- **RF3** — Status real registrado: call Enviagora "remarcada, sem nova
  data" — nunca "agendada 18/11".
- **RF4** — Links relativos entre documentos resolvem.

## Requisitos não-funcionais

- **NFR-dados:** transcrição/docx/pdf são fontes primárias — entram em
  `.specify/immutable.txt` (A9).
- **NFR-autorização/publicação:** todo conteúdo tratado como público;
  transcrição só na versão compartilhável (A2/A5).
- **NFR-privacidade:** pessoas citadas inventariadas em
  `docs/fontes-e-contatos.md` (A5).
- **NFR-demo:** dossiê rotulado "visão de arco, não escopo de MVP" (A7).
- **NFR-a11y:** n/a — documentos.
- **NFR-idioma:** pt-BR (A6).

## Entidades e invariantes

- `docs/README.md` lista todos os arquivos da pasta (A4).
- Fontes primárias: `transcricao-call-2026-11-16.txt`,
  `resumo-call-2026-11-16.docx`, `dossie-physical-capacity-orchestrator.pdf`
  — imutáveis.
- `README.md` raiz aponta para `docs/`.

## Critérios de sucesso observáveis

- [x] `docs/` contém os 6 artefatos + índice (commit `fc8eb46`).
- [x] `escopo.md` separa decidido/aberto e nomeia as 4 candidatas de fluxo.
- [x] Call Enviagora registrada como remarcada sem data (`escopo.md`,
      `fontes-e-contatos.md`, `resumo-call-2026-11-16.md`).
- [x] `node scripts/repo-guard.mjs` exit 0 sobre o estado com os docs.

## Premissas

- A transcrição revisada é a versão autorizada para publicação.
- Nomes/contatos listados já são públicos ou consentidos pelo time.

## Perguntas abertas

Nenhuma.

## Entrega

- **Data:** 2026-11-19 · **Commit:** `fc8eb46` (docs) — pipeline SDD
  implantado em commit posterior.
- **Evidência:** `ls docs/`; guard verde pós-implantação.
