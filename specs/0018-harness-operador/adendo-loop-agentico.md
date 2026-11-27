# Spec 0018 (adendo): harness de partes e julgamento de domínio

**Status:** adendo da spec `0018-harness-operador`. Não propõe escopo
novo: registra o que o julgamento externo produziu e o que fica para
depois do prazo.
**Data:** 2026-11-26 (julgamento consolidado em 27/11; reescrito como
adendo na frente `spec-adendo`).
**Origem:** plano discutido em sessão com thix, julgado por três
revisores externos com pesquisa obrigatória: veterano de logística,
arquiteto de IA/agentes e cético de infraestrutura/dados. A versão
original deste documento propunha o harness como plataforma própria; a
`0018-harness-operador` foi escrita em paralelo e entregou a fatia do
operador. Resta aqui o que o julgamento acrescenta de original.

## 1. Posicionamento: o que a spec-mãe já entrega

A `0018-harness-operador/spec.md` (status `aprovada`) cobre, com código
na branch:

- Fluxos duráveis DBOS sobre o Postgres do app, lock de líder por
  advisory lock e um único executor (RF1, NFR-operação;
  `app/operador/index.ts`).
- Idempotência de efeito externo por `contato_iniciado` com chave única,
  sem retry automático no passo de efeito (RF12;
  `app/server/store.ts:174`).
- Escada fixa e-mail, WhatsApp, ligação, analista; consulta e e-mail saem
  sozinhos, WhatsApp e ligação esperam aprovação com credencial de
  aprovador (RF2, RF7, RF11).
- MCP só de leitura para o agente de voz, projeção em lista fechada e
  token HMAC por workspace, caso e tentativa (RF21;
  `app/operador/mcp.ts`).
- Claude Opus 5.5 decidindo e redigindo, Haiku 5.5 extraindo, saída por
  schema estruturado (RF22; `app/operador/agente/`).
- Fechamento determinístico do caso pelo motor, com `caso_resolvido` de
  origem `motor` (RF5, T716).
- Bancada de voz com transportadora simulada, URA e personas (RF28,
  RF29): aberta nas tasks T780 a T784.

Este adendo acrescenta: o estado real dos oito defeitos P0 que o
julgamento catalogou, o roadmap de domínio logístico do juiz veterano, o
motor de personas da contraparte simulada e as decisões de arquitetura
que ainda valem.

## 2. Estado dos defeitos P0 na branch

O julgamento encontrou oito defeitos de produção no código anterior ao
operador. Estado verificado nesta branch em 27/11:

| # | Defeito | Estado | Evidência |
|---|---|---|---|
| 1 | IMAP só casava cobrança da seed | corrigido | `app/server/pipeline.ts:307-325` (escopo `todos` e `paraWorkspace`), `pipeline.ts:402-414`, `app/server/store.ts:650-655` (T713) |
| 2 | BIGSERIAL volta string e quebra comparação | corrigido | mapeamento com `Number()`: `store.ts:561, 787, 928, 931, 933, 982-983, 1003` |
| 3 | Extração por LLM é primária, não fallback | pendente | `pipeline.ts:257-292`: `extrairCamposDeclarados` chama `chatJson` sem parser determinístico antes |
| 4 | Qualquer resposta fecha a cobrança | corrigido em parte | resposta automática (RFC 3834) não fecha mais: `ingest/eml.ts:26-67`, `pipeline.ts:343`; resposta humana ainda marca `respondida` antes da classificação (`pipeline.ts:357`), e a taxonomia fina fica na seção 3 |
| 5 | NF-e declara previsão pela emissão | corrigido | `ingest/nfe.ts:84-88` sem `previsaoEntrega`, emissão em `dados.dataEmissao` (commit `be62ad4`) |
| 6 | CT-e nasce `em_transito` | corrigido | `ingest/cte.ts:79-84` sem status no documento (commit `be62ad4`) |
| 7 | Corrida na criação de cobrança | pendente | check-then-insert em `store.ts:586-601`, sem índice único parcial (`store.ts:134-141`); tick sem guarda de reentrância (`pendencia.ts:210-225`) |
| 8 | Hash global de evidência entre workspaces | corrigido | PK `(workspace_id, hash)`: `store.ts:162-165`, insert em `753-756` (T705) |

Os dois pendentes ficam mais caros com o operador ativo: o tick e a
escada passam a conviver sobre a mesma cobrança (7), e cada canal novo
(WhatsApp, transcrição) herda a extração LLM-first (3). Nenhum bloqueia a
fatia fina da spec-mãe; os dois entram como primeiros itens de hardening
quando a bancada ligar.

## 3. Roadmap de domínio logístico (pós-prazo)

Correções do juiz veterano que a spec-mãe não cobre. Não são requisito
desta spec: cada item pede spec própria quando entrar na fila do
BACKLOG.

- Taxonomia de exceção do setor, não inventada: OCOREN/PROCEDA e o evento
  CT-e 110190 de insucesso (recebedor ausente, recusa, endereço
  inexistente, estabelecimento fechado, avaria, divergência de
  quantidade, problema fiscal, redespacho). A spec-mãe já marca OCOREN
  como fora de escopo, dependente da pendência P-009.
- Redespacho e custódia: contratada versus executora, trecho atual,
  responsável perante o embarcador, origem da declaração, tempo desde a
  última posição real.
- `vou_verificar` como evento próprio: não é status da carga, é promessa
  de investigação com prazo; o timeout passa a ser o prazo prometido.
- Entrega declarada não é entrega comprovada: estados separados
  (`entrega_declarada`, `entrega_comprovada`, `comprovante_pendente`,
  `comprovante_com_ressalva`); escala quando passa o SLA de prova, não no
  instante da declaração.
- Agregação por viagem, romaneio e transportadora: uma conversa por NF-e
  em carga fracionada vira vinte mensagens sobre o mesmo caminhão.
- Referência operacional na mensagem: NF número e série, CT-e número,
  coleta, origem e destino, placa ou romaneio. A chave de 44 dígitos fica
  no rodapé, só para matching técnico.
- Timeout ancorado no corte operacional (janela de recebimento,
  fechamento da doca, corte de canhoto e faturamento), não em 24 h e
  72 h fixas.
- Classificação fina de resposta: `resposta_humana_com_status`,
  `sem_status`, `pergunta_da_transportadora`, `out_of_office`, `bounce`,
  `wrong_thread`, `documento_sem_relacao`. Resposta tardia vira evento
  `cobranca_resposta_tardia` com evidência, não reabertura automática.
- Escalada imediata sem retry ritual: sinistro, recusa, avaria, entrega
  parcial contestada, destinatário que nega recebimento, nota retida,
  quebra de custódia. O bot fecha sozinho só o informativo de baixa
  reversibilidade (marco confirmado, ETA reafirmado, entrega declarada
  com comprovante válido sem ressalva).
- Transcrição não é evidência por si: gravação original com hash, número
  chamado e que atendeu, papel de quem atendeu, mais confirmação por
  escrito depois. A spec-mãe cobre hash e retenção; a confirmação escrita
  é o RF19 (P1), com a T763 aberta.
- Confiança composta, não o número auto-reportado da LLM: DKIM, threading
  forte contra fallback, schema válido, remetente esperado, concordância
  entre parser e LLM. Depende do item da extração determinística (P0.3).
- Linguagem correta: ciclo de coleta encerrado, não exceção resolvida. O
  bot coleta e reconcilia; não resolve o atraso.
- Pré-requisito exposto: não existe entidade transportadora (BACKLOG 43).
  Aprender por transportadora não tem onde ancorar.

A validação de campo continua pendente como ação externa (contato
TOTVS): como a conversa de cobrança de status acontece de verdade. A
coreografia acima incorpora o veto do veterano, mas segue inferência até
validar.

## 4. Personas e contraparte simulada (complemento das T780 a T784)

Veredito do veterano: temperamento, veracidade, canal e velocidade como
eixos ortogonais é caricatura de engenheiro. Comportamento real vem de
estrutura, incentivo e acesso à informação, não de traço psicológico.

Livros da persona: não existem dois; existem três ou quatro.

1. O que aconteceu fisicamente.
2. O que o motorista ou executor informou.
3. O que a contratada sabe e decide repassar.
4. O que o redespacho informou, quando existe redespacho.

O caso dominante não é mentira: é conhecimento incompleto e atrasado.

Arquétipos correlacionados, em vez de eixos:

- Empresa familiar honesta mas cega: precisa ligar para o motorista,
  responde atrasado sem mentir.
- Transportadora média com TMS: estruturada, defasada, em lote.
- Contratada dependente de redespacho: cooperativa, não sabe a posição,
  responde "vou verificar".
- Agregado ou TAC: áudio, foto de canhoto, não entende chave fiscal.
- Operador otimista sob pressão: omite risco, empurra ETA verbal.
- Transportadora motivada financeiramente: só responde rápido quando
  falta comprovante para faturar.

Cenários adversariais que testam reconciliação de verdade: honesta sem
informação; entrega real com prova atrasada; posição obsoleta; resposta
sem identificação da carga; promessa de retorno quebrada; redespacho em
cadeia com três versões; reentrega operacional; entrega parcial com
ressalva; ruído de canal (áudio, foto, número diferente, fora de
thread).

Encaixe: a T780 (transportadora simulada com URA e personas) recebe os
livros e os arquétipos; a T781 (roteiros com gabarito) recebe os
cenários. A mesma persona serve e-mail e voz: quando a frente
`harness-transp` ligar o transporte real, não se cria um segundo modelo.

## 5. Decisões que sobrevivem

- D2, personas redesignadas na ontologia: eixos psicológicos não geram o
  comportamento que quebra reconciliação; livros de conhecimento, sim.
  Conteúdo na seção 4.
- D7, vetor proibido na autoridade, legítimo como camada assistiva:
  estado corrente, regras, permissões e decisões de loop vivem em dados
  estruturados e projeções do ledger, citados por identificador de regra,
  nunca recuperados por similaridade. Texto livre já é presente (e-mail)
  e cresce (transcrição); a ordem de capacidades é parser determinístico,
  extração LLM com schema rígido, validação determinística, exemplos
  corrigidos por humanos, templates por transportadora, full-text ou
  trigram, e embeddings só com ganho medido (pgvector com isolamento por
  tenant, nunca infraestrutura separada). RAG como copiloto de authoring:
  propõe regra com citação, humano aprova, execução determinística.
  Memória governada: proveniência, escopo por tenant, retenção e delete;
  nada de aprendizado implícito sobre texto não confiável.
- D8, fundações antes do loop: a ordem do julgamento (fundação
  observável, P0 de produção, borda real, persona contraditória, outbox e
  retry com clock virtual, cenários virando regressão permanente) foi
  confirmada pela execução da spec-mãe, que entregou tipos, DDL e
  correções (T704 a T716) antes do primeiro fluxo. Para a frente
  `harness-transp` ficam as peças que faltam: Clock injetável separado em
  relógio de domínio e monotônico de infra, IdGenerator determinístico
  por seed de cenário, reset definido como namespace novo (o ledger é
  append-only), artifact JSONL com runId, cenário, seed e commit, e
  runToIdle observando filas e workers (interval que reagenda explode em
  fake timers sem política de catch-up). Cena simulada fica rotulada no
  domínio e nunca ancora como evidência real (A7).

## 6. O que morreu e por quê

- D5, namespaces em arquivo: rejeitada já no julgamento. Filesystem no
  Railway é efêmero, JSON com leitura-modificação-escrita concorrente
  vira banco mal implementado e o Dockerfile não prepara diretório
  gravável para o usuário node. A substituta (schema `harness` no
  Postgres que já existe, com migrations próprias e FOR UPDATE SKIP
  LOCKED) fica como opção para a frente `harness-transp`; não é decisão
  deste adendo.
- D4, MCP público para agentes externos: não sai. A spec-mãe entregou o
  MCP interno do agente de voz (seção 1), que já nasce com token HMAC por
  tentativa e projeção em lista fechada. Se um MCP externo voltar à fila,
  entra condicionado ao threat model da versão original: bearer token com
  audience, workspace derivado do token e nunca de parâmetro, whitelist
  explícita de tools, role de banco sem escrita, stateless, rate limit
  com cursor e byte cap.
- D1, loopback de transporte como escopo desta spec: a spec-mãe cobre a
  contraparte simulada só para voz (RF28). O loopback de e-mail (sink
  SMTP e IMAP real em serviço controlado, o .eml entrando pelo caminho
  real de parsing, DKIM e threading; webhook por conexão invertida ou
  endpoint público controlado com HMAC, timestamp e event id) migra para
  a frente `harness-transp` (`app/harness/`, sem código ainda). Ficam
  registrados como restrição daquela frente: zero `if` de simulação no
  núcleo, nunca bypass de SSRF, nunca domínio público resolvendo para IP
  privado.
- D6, Turso: morto na spec-mãe (D-064); nada a adicionar.
- A spec original como plataforma AI-first: a narrativa de auditoria e
  contestação financeira de fretes não se sustenta (a Intelipost cobre
  esse território, spec 0010). O espaço validado segue o mesmo: a
  transportadora sem integração mais a prova neutra entre partes. O que
  era plataforma virou operador (spec-mãe, entregue), bancada de voz
  (T780 a T784, aberta) e harness de transporte (frente aberta).

## Riscos que seguem abertos

- A coreografia da seção 3 continua inferência até a validação de campo
  com quem cobra status de verdade (contato TOTVS pendente).
- Os P0 pendentes (extração LLM-first, corrida de cobrança) encarecem
  cada canal novo; endereçar antes de ligar WhatsApp e voz na bancada.
- Tempo virtual nunca contamina prova: cenário simulado rotulado no
  domínio, nunca ancorado como evidência real sem rótulo.
