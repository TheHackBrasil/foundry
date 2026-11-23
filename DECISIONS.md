# DECISIONS: The Foundry · HackBrasil 2026 (documento vivo)

Log cronológico de decisões, achados e pendências do projeto. Inspirado no
padrão do `worcap-hackathon` (mesma convenção D/R/P).

Regra de uso: **toda decisão, achado de pesquisa ou mudança de premissa entra
aqui no mesmo dia**, antes ou junto da mudança correspondente. Specs guardam
o "o quê" de cada entrega; este arquivo guarda a história e o "porquê" datado.

## Convenção de entrada

- **D-NNN** = decisão tomada · **R-NNN** = achado de pesquisa ·
  **P-NNN** = pendência/confirmação em aberto
- Status: `proposto` | `decidido` | `rejeitado` | `em investigação` |
  `confirmado` | `resolvido`
- Vereditos de pesquisa (R): `adotar` | `minerar` | `investigar` |
  `referência` | `descartar`
- Sessões datadas: `## Sessão N: título (data)` para blocos de trabalho.

---

## Decisões vigentes

| ID | Data | Decisão | Status | Motivo |
|---|---|---|---|---|
| D-001 | 19/11 | Repo canônico = `TheHackBrasil/foundry`; `the-foundry` (do Gabriel) fica como referência: sem permissão de escrita para esta conta | decidido | Conta tem só READ no repo antigo; renomear depende do Gabriel |
| D-002 | 16/11 | Direção de escopo: camada de coordenação entre fornecedores/operadores/financeiro-fiscal; roteirização interna fora | decidido | Call de alinhamento: ver `docs/escopo.md` |
| D-003 | 16/11 | Blockchain é opção de registro compartilhado, não requisito | decidido | Call + revisão do dossiê, adotar só se a camada exigir confiança entre desconhecidos |
| D-004 | 19/11 | Call Enviagora remarcada **sem nova data**; seção pós-call do diário fica bloqueada até acontecer | confirmado | Não publicar capítulo com resultado imaginado (A7) |
| D-005 | 19/11 | Pipeline SDD local: sem CI, sem tracker externo, fila = `BACKLOG.md`, gate = `node scripts/repo-guard.mjs` | decidido | Time pequeno + multi-harness; ver `.specify/README.md` |
| D-006 | 19/11 | Comandos speckit agnósticos em `speckit/` (não `.claude/` nem `.opencode/`) | decidido | Repo tocado por Claude Code, Devin e outros; sem duplicação |
| D-007 | 19/11 | Pitch oficial = v9 (`pitch-v9-share.mp4`); publicação via GitHub Release | decidido | Usuário confirmou versão; asset local existe |
| D-008 | 19/11 | Identidade pública = Foundry dark + laranja (`PRODUCT.md`); site reconstruído do zero nela, repo antigo só como referência de conteúdo | decidido | Família única com o pitch v9 |
| D-009 | 19/11 | Convenção DECISIONS/RULES/post-mortem do `worcap-hackathon` adotada | decidido | Auditabilidade + narrativa build-in-public |
| D-010 | 19/11 | Prosa antislop: `STYLE.md` + skills `humanizer`/`antislop-copywriting` antes de escrever + check `prose` no guard banindo travessão | decidido | Texto do repo não pode soar gerado |
| D-011 | 19/11 | `scripts/prose-evals.mjs`: evals de prosa (duro reprova, leve avisa, `--strict` reprova leve); meia-risca (U+2013) também banida, sem exceção de intervalo; registro dos docs = sóbrio, coloquialismo só em citação | decidido | Evals acharam meia-risca que o guard não pegava; voz informal rejeitada pelo time |
| D-012 | 19/11 | Site em `site/` = Astro + TypeScript + ilha React (dominó) + GSAP/Lenis; vanilla descartado a pedido ("usa frameworks modernos"). Narrativa "A Forja" em 5 estações; dominó do atraso é a peça central; isométricos substituídos por cenas em código | decidido | Escolhas do usuário nas clarifications da spec 0002 |
| D-013 | 19/11 | Redesign do site (spec 0003): estrutura editorial da referência em preto e laranja; logo oficial F+bigorna; bigorna 3D do path do logo com MSAA; stickers isométricos animados no lugar do diagrama esquemático; termômetro e temperaturas removidos | decidido | Usuário avaliou a 0002 como genérica; pediu acabamento e reaproveitar elementos da referência |
| D-014 | 19/11 | Pitch oficial passa a ser o v10 (`pitch-v10-share.mp4`), publicado na release `pitch-v10`; substitui o v9 de D-007 | decidido | Pedido do time; o site lê a release pela API e mostra o vídeo |
| D-015 | 20/11 | Fluxo único do MVP = atraso propagado; demais candidatos de `docs/escopo.md` viram tipos de evento do mesmo modelo | decidido | Melhor evidência de campo (exemplo central TOTVS) e narrativa já construída (dominó, slide BR-2048); call Enviagora passa a validar produto, não ideia |
| D-016 | 20/11 | Stack do `app/` = TypeScript ponta a ponta: Fastify, Postgres (tabela de eventos append-only, trigger anti UPDATE/DELETE), Vite + React, ethers + Hardhat, SSE | decidido | Núcleo do problema é event sourcing + integridade criptográfica; Postgres como padrão de produção desde o dia 1; toolchain on-chain TS-native |
| D-017 | 20/11 | Blockchain no MVP = ledger hash-chained + âncora Merkle em Base Sepolia + escrow contract como peça de impacto; rede permissionada e nó por empresa fora | decidido | Prova de integridade verificável sem fricção de adoção (setor não letrado); consortium chain fica como visão de arco |
| D-018 | 20/11 | Recorte operacional refinado: produto = pipeline de documentos reais (NF-e/CT-e/CC-e, e-mail, planilha) → divergência → propagação; atraso propagado vira cenário da demo dentro do motor de divergência; âncora on-chain fica (P1) cobrindo eventos não-fiscais; escrow sai para backlog; twin de nós rebaixado para P2 | decidido | Proposta de escopo do time (doc de trabalho 20/11) + análise: ingestão executa a tese TOTVS de adoção sem mudança de rotina; SEFAZ autentica docs fiscais mas não os eventos da camada; twin é aditivo visual (Schulz) |
| D-019 | 20/11 | Execução do MVP em três frentes paralelas, as da spec 0004 (`wt/app-core`, `wt/app-demo`, `wt/escopo-produto`), cada uma com worktree, dono por pasta (`speckit/frentes.json`) e brief em `specs/0004-mvp-atraso-propagado/`; hook de pre-commit versionado (guard, prose-evals, paths da frente, `main` protegida localmente); decisões de frente ficam no fim do brief da frente e `escopo-produto` ou a integração copiam para `DECISIONS.md` | decidido | Desenvolvimento com agentes em paralelo sem conflito; o protocolo antigo se contradizia (frentes não dividem arquivo, mas todas escreviam em `DECISIONS.md`). Spec 0005 |
| D-020 | 21/11 | Correções na spec 0004 e nas tasks que valem para qualquer versão do escopo: URL pública (T040) e vídeo (T042) viram P0 pelo regulamento 7.2 e 7.3; o atraso entra pela planilha do fornecedor (T031 sobe para P0) e não por CC-e (R-006); XML enviado por visitante fica isolado na sessão dele (`workspaceId`, T027) pelo regulamento 6.9; escrow fora, vale D-018 sobre D-017; o boot do Vite é da frente demo (spec 0005) | decidido | Conferência contra o regulamento e a regra fiscal em 21/11; as escolhas de escopo (âncora, IMAP, uma tela, dominó) seguem em P-006 |
| D-021 | 21/11 | Nova divisão do MVP: Thiago na `app-demo` (design); Gui na nova frente `app-infra` (servidor, banco, hospedagem, deploy, contrato da API); `app-core` fica com `app/shared/` e o ingest; Gab e Gui pesquisam campos úteis e aplicabilidade. O e-mail entra como formato (arquivo `.eml` no upload, P0) e a caixa IMAP ao vivo fica para a final ou para o P0 verde | decidido por Thiago; Gab e Gui ainda não confirmaram o e-mail | Gab acha o e-mail frágil e sem sentido. A documentação de ERPs mostra que o recurso de captura de XML por caixa de e-mail existe (Senior, Omie, Dynamics), mas não que o público-alvo o usa, e a pesquisa de campo do time não registra o uso (o Thiago confirmou em 21/11 que a frase "eles já usam caixa de e-mail" da call 2 veio de um assistente de IA); o `.eml` entrega o canal sem depender de credencial nem de hospedagem de caixa |
| D-022 | 21/11 | A base do código de `app/` é a implementação de Gui na `wt/app-core` (21/11, 00:35): `app/shared/`, `app/server/` com ledger append-only, SSE, anchor e ingest, e `app/contracts/` com Hardhat. Na integração, os conflitos em `app/shared/`, `package.json` e `tsconfig.json` foram resolvidos a favor dela. T002 e T003 de Thiago (commit `d38d173`) ficam no histórico, e o `ingerir()` e o `app/api/contrato.ts` propostos antes foram retirados, porque o despacho (`detectarTipo`) e os tipos de resposta (`app/shared/model.ts`) já existem | decidido | `tsc` limpo e 38 testes passando na integração; cobre o que a spec previa e mais (fila de revisão, simulação, IMAP, PDF); duas implementações paralelas do mesmo núcleo não se sustentam |
| D-023 | 21/11 | `GET /audit` compara o root ancorado contra os eventos que a âncora cobriu (`seq < seq` do evento `ancora`): expõe `rootAtual`, `rootHistorico`, `rootConfere` e `eventosAncorados` (`app/server/index.ts`) | decidido | O teste real na Base Sepolia expôs o bug: comparar contra todos os eventos flaggeava o próprio evento `ancora` e `rootConfere` ficava falso para sempre; teste do ataque de reescrita da cadeia cobre o cenário |
| D-024 | 21/11 | Runtime exige `DATABASE_URL` (Postgres real via Docker): sem ela, `createDb` falha com erro acionável; PGlite sai do runtime e vira só infra de teste via `createLiteDb` injetada no `buildServer`; `dotenv` carrega `.env` só no boot e no seed | decidido | Pedido do usuário: um banco só no produto; PGlite em memória segue nos testes por isolar a suite sem Docker |
| D-025 | 21/11 | IMAP só varre mensagens de hoje em diante (`IMAP_DESDE` configurável) e marca `\Seen` só quando a mensagem tinha anexo elegível processado; validado de ponta a ponta com Gmail real: `nfe-novo-pedido.xml` anexado virou o pedido `...22000000020` no ledger | decidido | A varredura original pegava todas as não lidas e marcava `\Seen` até sem anexo elegível: numa caixa pessoal com 10 mil não lidas, baixaria tudo e marcaria o e-mail do usuário como lido |
| D-026 | 21/11 | Extração de PDF via LLM validada de ponta a ponta com OpenRouter (`nvidia/nemotron-3.5-super-vl:free`, confiança 0,98): `pdf.ts` passou a normalizar a chave NF-e vindo com espaços, formato impresso do DANFE; `app/.env.example` documenta todas as envs | decidido | O teste real expôs o bug: regex `\d{44}` rejeitava a chave em grupos de 4 dígitos com espaços e mandava todo PDF para a revisão |
| D-027 | 21/11 | T029 (`.eml`) e correção da CC-e (T023) implementados: `.eml` desembrulha anexos no mesmo pipeline sem registrar cabeçalho (RF27); CC-e passou a evento de correção sem campo vigiado (R-006), e o atraso da suíte passou a vir da planilha do fornecedor | decidido | A CC-e corrigida pelo regulamento fiscal não é gatilho de atraso; a implementação anterior contradizia a spec; `.eml` era P0 pendente |
| D-028 | 21/11 | A planilha do fornecedor é só CSV no MVP: `.xlsx` e `.xls` respondem 422 pedindo CSV, no upload e dentro do `.eml`, e pelo IMAP vão para a fila de revisão; o `xlsx@0.18.5` sai do `package.json` e do lockfile. Registrada como D-025 na `main` local do Thiago, número que colide com o D-025 do Gui | decidido por Thiago; Gui a confirmar, porque o `.eml` e o IMAP dele aceitavam `.xlsx` | `xlsx@0.18.5`, a única versão instalável pela npm, tem ReDoS (CVE-2024-22363) e prototype pollution ao ler arquivo malicioso; a alternativa `read-excel-file` estourou memória e tempo com arquivos pequenos feitos à mão (um `.xlsx` de 39 KB levou cerca de 2 GB em 2,7 s), medições em D-C13 do `brief-core.md`. O juiz sobe arquivo próprio na URL pública. Custo: Excel é o formato comum de planilha e o usuário precisa exportar CSV. Caminho de volta: ler a planilha num `worker_threads` com limite de recursos e checar o zip antes de inflar |
| D-029 | 22/11 | Integração do MVP no branch `integra/mvp-final`: base `origin/main` (D-027) mais a `wt/app-infra` do Gui por merge. Da `main` local do Thiago entram `app/shared/formato.ts`, os textos pt-BR de `rules.ts` com a tarefa fiscal do atraso corrigida, o boot no Linux, o `.env.example` e a planilha só CSV (D-028). O `.eml` e a CC-e ficam com a implementação do Gui (D-027), e do Thiago entram só os testes que passam nela | decidido por Thiago, integração feita por agente; Gui a revisar os pontos do `.eml` | A CC-e do Gui passou em todos os testes de R-006 do Thiago. A divergência de R-006 estava na tarefa fiscal do atraso, que mandava "Conferir CC-e emitida para a correcao", e o `rules.ts` do Thiago a corrige. O `eml.ts` do Gui falha em 18 testes do Thiago, todos sobre pontos que ele não trata: CT-e anexado antes da NF-e cai na fila de revisão; anexo inválido depois de uma NF-e grava a NF-e e responde 422; anexo sem nome de arquivo é ignorado; e-mail aninhado ao lado de outro anexo é ignorado sem aviso; não há limite de quantidade nem de tamanho por anexo; o nome original do anexo segue no pipeline; e `.eml` sem a extensão não é reconhecido. Portar esses pontos fica para o Gui decidir |
| D-030 | 22/11 | A identidade visual das superfícies é a do Brandbook Forseti v4: petróleo `#163C38`, lavanda `#D7C5EA`, papel mineral `#F5F2EB`, cinza mineral `#52665E`; Manrope para comunicação e Geist Mono para identificadores; gramática de monólitos, cordas e camadas; voz "confiança sem ruído". Ela substitui a direção "Rota 3 Salão" e a marca "Refinada" da spec 0004 (D-W6 a D-W8) | decidido por Thiago | O Brandbook do Gabriel chegou depois do moodboard e é a fonte de verdade da marca; o trabalho anterior fica como evidência de contraste medido e de componentes |
| D-031 | 22/11 | O site `foundry/site` (projeto Vercel `the-foundry`, único site público) é re-vestido inteiro na v4 sem rota nova: o hero passa a apresentar o produto e as seções seguem com conteúdo factual preservado. Alternativas rejeitadas: `/` de produto com `/diario` separado e página `/forseti` isolada | decidido por Thiago | O diário e a apresentação do projeto já vivem nesse site e não existe segundo deploy; re-vestir uma página única custa menos que manter duas |
| D-032 | 22/11 | O logo oficial das superfícies é o vetor extraído do Brandbook v4: 5 SVGs em `forseti-brand/brandbook-v4/` (lockup petróleo e negativo, símbolo petróleo, negativo e isolado), copiados sem alteração para os assets de cada superfície. A marca "Refinada" do moodboard é aposentada e a bigorna fica só como crédito da equipe | decidido | O brandbook proíbe redigitar o wordmark e traz o desenho aprovado em vetor; extrair do PDF evita redesenho divergente |
| D-033 | 22/11 | O `app/web` fica em tema claro por padrão com o alternador preservado; o tema escuro usa a adaptação medida (fundo `#0E1F1D`, texto `#E8F0EE`, coordenação `#C9B2F0` e `#35294A`). O site fica só claro, sem alternador novo | decidido por Thiago | O brandbook não define escuro; no app o dark já existia e custa pouco manter adaptado, no site não existia e não se cria |
| D-034 | 22/11 | A lavanda clara `#D7C5EA` nunca aparece como texto, ícone de estado ou tinta de divergência; o sinal de coordenação nas telas usa o violeta profundo `#654199` (6,78:1 sobre papel) | decidido | Medido com o colorlib do R4: lavanda sobre papel dá 1,44:1 e reprova WCAG; o papel dela na marca é corda, vidro e preenchimento gráfico |
| D-035 | 22/11 | Novas frentes `site-forseti` (dona de `site/`) e `app-brand` (dona de `app/web/`), registradas em `speckit/frentes.json` com briefs na spec 0006; a frente `app-demo` é encerrada, com o trabalho integrado na `integra/mvp-final` | decidido | Divisão por superfície sem sobreposição de paths; a `app-demo` não tem trabalho aberto depois da integração |

| D-036 | 22/11 | Correção de rota: a landing do produto é um site novo do zero em `lp/` (estrutura de empresa real), com deploy Vercel próprio; o site `the-foundry` re-vestido na v4 fica como bônus (site do time). Emenda D-031, que chegou a descartar site separado | decidido por Thiago | O the-foundry apresenta a equipe; a LP apresenta o produto: são superfícies diferentes |
| D-037 | 23/11 | Hospedagem do app no Railway Hobby: um projeto `forseti` com dois serviços, o app construído por `app/deploy/Dockerfile` (build Vite + servidor Fastify na mesma imagem, `tsx` em produção, seed no boot, porta pela env `PORT`) e um Postgres oficial na rede privada (`DATABASE_URL` por reference variable). Sem bucket e sem volume próprio do app: o ledger fica no Postgres e o app é efêmero. `CLIENT_IP_HEADER=x-real-ip`; heartbeat e reciclagem do SSE contra o teto de stream do proxy (`SSE_HEARTBEAT_MS=20000`, `SSE_MAX_CONNECTION_MS=600000`, `SSE_MAX_BYTES=524288`) | decidido por Thiago | Heroku e Supabase saíram na pesquisa de hospedagem da sessão anterior; o Railway sobe app e banco num projeto, resolve a escolha de P-008, e o smoke público já rodou na URL gerada |
| D-038 | 23/11 | URLs públicas: a demo do app responde em `https://forseti-production-fcb91f35.up.railway.app` (domínio gerado pelo Railway) e a LP em `https://forseti-br.vercel.app` (a `forseti.vercel.app` estava tomada por outro projeto; `forseti-br` foi a escolha do usuário). O `the-foundry-alpha.vercel.app` segue como site da equipe | decidido por Thiago | A LP precisava linkar a demo real; os domínios gerados são o que existe sem contratar domínio próprio |
| D-039 | 23/11 | Spec 0008 `blindagem-publica` aprovada: correção dos achados das cinco auditorias independentes (SOLID, segurança, TypeScript, testes, brandbook). Decisões dela: planilha solitária vira `pedido` mínimo na projeção; quota de sessões com teto por IP por janela e cap global; os itens de marca em `site/` entram na frente `hardening` | decidido por Thiago | A planilha é o papel de ERP/WMS e pode chegar antes da NF-e (RF6 da spec 0004); o por-IP cobre abuso concentrado e o global cobre o distribuído; a `site-forseti` está parada |
| D-040 | 23/11 | Spec 0007 `camada-ai-operacional` aprovada: a LLM é camada de acesso e universalidade, nunca de verdade (três empregos fechados: traduzir intenção para ação tipada de conjunto fechado, extrair campos de documento sem parser, escrever texto para humanos). Tudo que ela toca vira evento auditável ou cai na fila de revisão, no padrão de `pdf.ts`. Mandatos executam só pelo motor determinístico e gravam evento `mandato` por pedido alvo; `propagar` é repropagação idempotente; contatos por workspace com bootstrap por `fone` de emitente; Nvoip desligada por padrão (`NVOIP_NOTIFY_ON_TASK` global); sinal consultivo respeitando R-006; contrato `view-spec` com front reservado ao usuário | decidido por Thiago | O núcleo determinístico (ledger, comparação, regras) é o fosso; a LLM é a portaria. A tese do produto aplicada a si mesma: comando agentic auditável |
| D-041 | 23/11 | O `.xlsx` volta por emenda de D-028: `exceljs` em versão pinned (>7 dias de publicação) dentro de `worker_threads` com `resourceLimits` e checagem estrutural do zip antes de inflar (o caminho de volta que a própria D-028 declara); o worker converte a planilha em texto CSV com valores formatados e o `parseCsv` segue como único parser tabular; layout desconhecido vai para a revisão com mapeamento coluna a campo proposto por LLM, e o mapeamento aprovado persiste como template por `(workspace, remetente)` | decidido por Thiago | `exceljs` resolve a serial de datas (precisa de `numFmt`); converter para CSV reaproveita parser, mapeamento e testes existentes; a escolha da LLM para layout é aprovada com revisão humana, nunca escrevendo dado |
| D-042 | 23/11 | Novas frentes `hardening` (spec 0008, dona de `app/` e três paths de `site/`), `ai-ingest`, `ai-mandatos` e `ai-web` (reservada, só contrato `view-spec`) em `speckit/frentes.json`. Ordem dura: a 0008 integra inteira antes das frentes da 0007 | decidido | A blindagem corrige a base que a camada AI vai usar (lock de idempotência, helper doc->tarefas, `ItemRevisao`); `ai-web` fica sem código porque a renderização do `view-spec` é do usuário com outro agente |
| D-043 | 23/11 | `wt/hardening` integrada na `main` após revisão independente ("aprova com ressalva", nada bloqueando). Na integração: `smoke.mjs` corrigido para a fila sem `workspace_id` (D-H7 do brief); `propagar` ganhou guarda `Object.hasOwn` porque `REGRAS_PROPAGACAO[d.campo]` resolvia membros de `Object.prototype` vindos do body de `/api/simulate` (mesma classe de bug do RF3, lado do servidor); `aprovarRevisao` passou a checar `eventoExiste` na mesma transação (dois itens irmãos aprovados não gravam o documento duas vezes). Restantes achados do reviewer viraram itens 20 a 23 do `BACKLOG.md` | decidido | O guard e a dedupe são a mesma classe de correção que a própria spec pediu; fazer fora deixaria o padrão conhecido vivo numa rota pública |
| D-044 | 23/11 | `wt/ai-mandatos` e `wt/ai-ingest` integradas na `main`, as duas após revisão independente com rodada de correção. O reviewer de mandatos achou um bloqueio real: `executarMandato` lia `eventoExiste` antes do advisory lock (a mesma corrida que a spec 0008 corrigiu no pipeline); `travarPedido` agora abre a transação por pedido. Também corrigidos na rodada: guard de tipo/`Object.hasOwn` em `aplicarMapeamento`, `JanelaFixa` por IP na rota `view-spec`, testes dos três motivos restantes de `nao_entregue`, `{"texto":123}` como 400 e `notificarTarefa` que nunca lança. Na ingest: `exigirCabe` na revisão do xlsx e o teste do diretório central mentiroso (a defesa real é o `resourceLimits` do worker). Decisões das frentes em D-043 a D-058 do `brief-ai-mandatos.md` e D-G1 a D-G4 do `brief-ai-ingest.md`; follow-ups conscientes nos itens 25 do `BACKLOG.md` | decidido | Revisão independente pegou o padrão de corrida no código novo antes do juiz; a frente `ai-web` segue reservada (T150), renderização do `view-spec` é do usuário |

## Pendências

| ID | Item | Por quê | Status |
|---|---|---|---|
| P-001 | Nova data da call com Rafael Born (Enviagora) | Define o fluxo único do MVP + destrava capítulo do diário | aberto |
| P-002 | Pergunta ao contato TOTVS: na gestão multi-fornecedor, dói mais documento fiscal, atraso propagado ou contrato/pagamento? | Cada resposta vira um MVP diferente | aberto |
| P-003 | Liz confirmada como 4ª integrante? | Liz saiu do time (Thiago, 20/11); time de 3. Site e docs ainda citam a Liz como pendente | resolvido |
| P-004 | Renomear `foundry` → `the-foundry` se o Gabriel liberar o nome? | Nome mais limpo; não urgente | aberto |
| P-005 | Regras oficiais do HackBrasil | Regulamento oficial lido em 20/11 (R-005, `RULES.md`); restam formato da final (enviado aos finalistas) e nomes dos jurados (até 30/11) | resolvido |
| P-006 | Escolhas de escopo em aberto, cada uma com dono: âncora em Base Sepolia antes de 30/11 (T025) ou só na final, com recibo de hash no alerta antes (Gui); cinco visões por papel (T004, T014) ou tela única com seletor de parte (Thiago); dominó e twin antes de 30/11 ou na final (Thiago); caixa IMAP ao vivo (T030): o `.eml` já está decidido em D-021, falta confirmar com Gab e Gui | A spec 0004 foi fechada na call, que terminou às 02:55 de 20/11; o plano revisado é das 03:03, depois dela. A seção 10 do PDF lista as diferenças linha a linha. As correções de regulamento e fiscal já entraram (D-020) | aberto |
| P-007 | Quem integra as frentes na `main`, e se o GitHub passa a exigir PR para a `main` (D-005 hoje proíbe proteção de branch) | Com três pessoas e agentes em máquinas diferentes, o hook local não protege a `main` remota | aberto |
| P-008 | Stack e hospedagem: decidida e no ar (D-037, D-038). Soak de SSE contra a URL Railway passou em 23/11; o 422 no lugar de 413 foi corrigido na spec 0008 (T226, `file.file.truncated`); resta re-rodar o smoke público após o redeploy e observar custo no plano Hobby até 12/12 | Demo no ar é entregável (regulamento 7.2 e 7.3); Postgres na rede privada e heartbeat de SSE já configurados | aberto |
| P-009 | OCOREN como segundo canal de atraso: arquivo EDI PROCEDA que a transportadora envia ao embarcador (registro 342, código 02 "entrega fora da data programada"), ligado ao pedido por CNPJ do emissor, série e número da NF | O registro não traz a chave de 44 dígitos e o layout varia por versão e por embarcador (R-007); entra como P1 se o Gab confirmar | aberto |
| P-010 | Antes da URL pública, o servidor ainda precisa resolver duas coisas. CORS aberto e escrita sem autenticação (D-C11 do `brief-core.md`): qualquer visitante decide item da fila de revisão da seed (testado ao vivo em 22/11) e ancora pedido da seed que não tem cópia na sessão dele (leitura de `app/server/index.ts`), então a seed não é só leitura. E o cancelamento gravado com fonte `cce`: ele aparece como "CC-e" nas tarefas, e uma CC-e posterior zera o estado da fonte; no seed, a planilha que chega depois não diverge do `cancelada`. Resolvidos em 22/11: isolamento por sessão (D-I1 a D-I3 do `brief-infra.md`), boot no Linux, `xlsx` (D-028) e CC-e (R-006, D-027) | O juiz sobe arquivo próprio na URL pública (regulamento 6.9 e 7.2); dono: Gui (app-infra) para CORS e autenticação, `app-core` para o cancelamento. Fechada na blindagem (spec 0008, D-043): decisão em item da seed responde 403 e âncora em pedido da seed idem, provado no smoke | resolvido |

## Achados de pesquisa

| ID | Item | O que é | Veredito |
|---|---|---|---|
| R-001 | Padrão `worcap-hackathon`: DECISIONS.md (D/R/P) + ADR estável + manifesto com fonte/licença/hash + post-mortem + REPRODUCE | Conjunto de auditabilidade provado em hackathon real | adotar |
| R-002 | Transcrição da call (16/11): decisão de direção já tomada aos ~41min; detalhes operacionais (etiquetas, kits, NF, cascata financeira) | Fonte primária: `docs/transcricao-call-2026-11-16.txt` | referência |
| R-003 | Especialista em armazéns (Insper): roteirização já saturada de soluções; RFID/auto-empilhadeira caros demais p/ PME | Reforça D-002 | referência |
| R-004 | Emiteaí: emissão de doc de rota ~5 min; também gestão financeira/operacional; sem blockchain | Concorrente/referência de comparação: diferenciação em aberto | investigar |
| R-005 | Regulamento oficial ([hackbrasil.com/regulamento](https://hackbrasil.com/regulamento), atualizado em 18/11): quatro critérios de mesmo peso (execução técnica, implementação técnica, impacto, qualidade da comunicação); fase online julgada por repo, demo e vídeo de até 3 min do produto; top 5 por trilha com nota mínima 20/40 vai à final presencial de 12/12; congelamento de 30/11 a 12/12 | Detalhe item a item em `RULES.md`; o FAQ fala em "apresentação", o regulamento (que prevalece) diz "comunicação" | adotar |
| R-006 | Regras fiscais do cenário de atraso: CC-e não corrige data de emissão ou de saída (Convênio SINIEF s/nº 1970, art. 7º, §1º-A); cancelamento de NF-e em regra até 24h e sem circulação da mercadoria (Ajuste SINIEF 07/05); evento de insucesso na entrega do CT-e (110190) | Fontes e consequência em `docs/plano-mvp.pdf`, seção 02; contador confirma antes de virar regra do motor | investigar |
| R-007 | OCOREN (PROCEDA, versão 3.1 de 15/05/2000): arquivo de texto com registros de 120 caracteres (000, 340, 341, 342, 343); o 342 traz CNPJ do emissor da NF (posição 4, 14 dígitos), série (18, 3), número da NF (21, 8), código da ocorrência (29, 2), data DDMMAAAA (31, 8), hora (39, 4) e texto livre (45, 70); o código 02 é "entrega fora da data programada" na tabela de ocorrências da Senior | Fonte: layout PROCEDA (`ocoren.pdf` da Senior) e [manual de EDI da Senior](https://documentacao.senior.com.br/gestao-de-fretes-gko/7.01/manual-processos/edi.htm). A TOTVS publica layout próprio e existem versões posteriores; não li esses | referência; entra no motor só se P-009 for aceito |

---

## Sessões

### Sessão 1: pesquisa consolidada + repo novo (19/11)

- Repo `TheHackBrasil/foundry` criado; commit inicial `fc8eb46` com docs de
  pesquisa (`specs/0001`, entregue).
- Dossiê reposicionado: visão de arco (capacidade ociosa como *dado* na
  camada), não escopo de MVP: ver `docs/escopo.md` § leitura candidata.

### Sessão 2: pipeline SDD local (19/11)

- `.specify/` + `speckit/` + `AGENTS.md` + `scripts/repo-guard.mjs` +
  `DECISIONS.md` + `RULES.md` implantados; guard verde (10 checks).
- Convenção de frentes paralelas para trabalho com agentes: `speckit/frentes.md`.
- 3 audits read-only de subagentes executados; correções aplicadas:
  posição canônica do `checklist` (antes do `plan`, só risco), status
  `implementada` atribuído no `implement`, índice de `docs/` virou check do
  guard, imutabilidade A9 derivada do HEAD (adulterar Status no worktree
  não anula a proteção: testado), links em code fence ignorados, assets de
  HTML checados, `node --check` em todo `.js` versionado.

### Sessão 3: antislop + evals de prosa (19/11)

- `STYLE.md` criado + check `prose` no guard; ~200 travessões limpos dos
  docs mutáveis. Artefatos A9 fora da regra (história congelada).
- `scripts/prose-evals.mjs`: primeira rodada achou 4 meia-risca (U+2013,
  `A1 a A10`) que o guard não cobria: guard e STYLE.md estendidos, ban
  virou total. Também um falso positivo ("de ponta a ponta"), corrigido
  no regex.
- `humanizer` rodado em `docs/escopo.md`: trocou metáfora de estoque e
  auto-elogio por linguagem direta; registro ajustado para sóbrio.

### Sessão 4: redesign do site (19/11)

- Feedback do usuário: a 0002 parece template gerado. Spec 0003 criada
  e decisão D-013 registrada.
- Escopo: estrutura editorial, logo oficial, bigorna com MSAA, stickers
  isométricos e mapa ASCII; termômetro, palavras vazadas e HUD saem.
- Deploy, release do pitch e capítulo pós-call seguem fora.

### Sessão 5: escopo do MVP fechado e frentes abertas (20/11)

- Escopo decidido sem esperar a call Enviagora nem a resposta TOTVS:
  a evidência disponível já apontava o atraso propagado; a call passa
  a validar produto com demo, não ideia.
- Spec 0004 aprovada com plano, tasks e 3 briefs de frente:
  `wt/app-core`, `wt/app-demo`, `wt/escopo-produto`. Divisão de pessoas
  por frente fica a cargo do time.
- Blockchain reposicionada: de "plataforma onde tudo roda" para
  propriedade do registro (cadeia de hashes + âncora pública +
  escrow). Justificativa: a coordenação se resolve com a camada de
  eventos; a chain prova integridade entre empresas que não confiam
  uma na outra.
- Recorte refinado (D-018) a partir da proposta de escopo do time:
  o MVP passa a ser o pipeline de documentos reais + motor de
  divergência, com o atraso propagado como cenário da demo; âncora
  em Base Sepolia mantida (P1) para os eventos não-fiscais; escrow e
  twin de nós viram backlog/P2.
- Item 7 do BACKLOG fechado; item 8 (build do MVP) abre a semana.

### Sessão 6: regulamento, hook das frentes e integração com a spec 0004 (20/11)

- Regulamento oficial lido e conferido item a item (R-005, `RULES.md`).
  Mudou prioridades: demo no ar e vídeo do produto viram P0; o fator
  wow ao vivo vai para a final de 12/12; o site deixa de disputar tempo.
  Detalhe, errata e afirmações sem fonte em `docs/plano-mvp.pdf`.
- A spec 0004 do Gui já estava na `origin/main` (fechada na call). O
  plano revisado e a spec divergem em pontos de regulamento e fiscal:
  reconciliação em aberto (P-006), stack e hospedagem em aberto (P-008).
- Frentes (D-019, spec 0005): worktrees antigos (`domino`, `fx`, `site`)
  removidos, já mergeados; esqueleto próprio (`apps/`, `packages/`)
  descartado em favor do `app/` da spec 0004; frentes `wt/app-core`,
  `wt/app-demo`, `wt/escopo-produto`; hook em `scripts/hooks/`.
- Liz saiu do time (informado por Thiago, 20/11): P-003 resolvido, time
  de 3.

### Sessão 7: correções da spec 0004 e início do código (21/11)

- Sobre o "doc de mvp" da call: o Thiago respondeu "o pdf". A call
  terminou às 02:55 (cabeçalho da transcrição, horário de Brasília) e o
  `docs/plano-mvp.pdf` é das 03:03, então a call fechou o documento do
  Gui. Entraram na spec só as correções que valem para qualquer versão
  (D-020); as escolhas de escopo ficaram em P-006 para o Gab.
- Branches remotas `wt/core`, `wt/demo` e `wt/produto` apagadas, com
  autorização do Thiago.
- Integração real: o mercado troca documento (NF-e, CT-e, arquivo EDI
  PROCEDA, planilha, e-mail), não API de ERP. OCOREN lido no layout
  original (R-007, P-009).
- D-021: frente `app-infra` criada (spec 0005, RF4 e RF6). O
  `package.json` e os scripts passam para a infra; os contratos são
  `ingerir()` (core para infra) e `app/api/contrato.ts` (infra para demo);
  as dependências do ingest foram instaladas na integração.
- Evidência sobre o e-mail: a documentação de ERPs mostra captura de XML
  por caixa de e-mail (eDocs da Senior lê caixa POP/IMAP, a Omie tem
  endereço dedicado, o Dynamics importa de e-mail) e a lei deixa o meio
  de envio do XML livre entre as partes. A pesquisa de campo do time não
  registra o uso; a ideia veio de uma IA consultada na call de 20/11.
- Durante a sessão, Gui empurrou na `origin/main` (regra de identidade de
  commit) e na `origin/wt/app-core` (primeira versão completa do código).
  Integrado sem force (D-022): `tsc` limpo e 38 testes passando. As
  pendências reais estão em P-010 e no cabeçalho do `tasks.md`.

### Sessão 8: âncora real na Base Sepolia, Postgres real e integração app-core (21/11)

- Ambiente de testnet montado do zero: carteira descartável
  `0x2151fD2DD17c8dB3914F888a322EE70F9606d64b` (chave só no `.env`
  local), ETH de teste via faucet CDP (Alchemy/QuickNode exigiam saldo
  na mainnet; pk910 paga só Ethereum Sepolia). Contrato `FoundryAnchor`
  deployado em `0x5CA2F67E27257D2f67E703fe7bF81865d481FF03`.
- Âncora real confirmada: tx
  `0xd5691de312cb1d486304df92dee78043cef0f1eb236f957e0bb075717f683f84`
  sobre 73 eventos do seed. O primeiro uso real da rede expôs e motivou
  o fix de D-023.
- Docker Desktop + WSL2 instalados; `app/docker-compose.yml` sobe
  `postgres:17-alpine`. Validado ao vivo: 74 eventos persistidos,
  UPDATE/DELETE/TRUNCATE rejeitados pelas triggers no psql do
  container, dados intactos após restart do server e `rootConfere: true`.
- Runtime passa a exigir `DATABASE_URL` (D-024); `npm start` funciona
  com o `.env` local via `dotenv`. Suíte: 40 testes, guard e
  prose-evals verdes na `wt/app-core` antes do merge.
- Item de P-006 encaminhado: âncora na Base Sepolia antes de 30/11 está
  feita e tem recibo público em `sepolia.basescan.org`.

### Sessão 9: IMAP ao vivo com Gmail real (21/11)

- Canal de e-mail provado na prática: app password do Gmail em
  `imap.gmail.com:993`, polling de 30 s, anexo `.xml` ingerido e
  mensagem marcada como lida. Evento `nfe` criou o segundo pedido do
  sistema; `/api/pedidos` e o DBeaver refletem.
- Fix D-025 nasceu do uso real: protege caixa pessoal de varredura em
  massa e de marcação indevida de lidas. Segredos ficam só no `.env`
  local; `imap-test.mts` com credencial inline foi removido antes de
  qualquer commit.

### Sessão 10: LLM real na extração de PDF (21/11)

- OpenRouter configurado com modelo gratuito; DANFE sintético ingerido
  via `/api/ingest` produziu 20 eventos no pedido novo (doc + divergências
  + tarefas). Ollama fica como plano B local para o dia da banca.
- Bug encontrado e corrigido no caminho (D-026): chave com espaços.
  Item de revisão residual descartado após o reprocessamento.

### Sessão 11: `.eml` e semântica correta da CC-e (21/11)

- `app/server/ingest/eml.ts` com mailparser: fixture `email-nfe.eml`
  gera o mesmo pedido do XML solto, provado ao vivo no server.
- `cce-atraso.xml` virou `cce-correcao.xml` (correção de endereço);
  CC-e não declara `previsaoEntrega` nem `atrasada`, registrando a
  correção só em `dados` para trilha. Suíte: 41 testes.

### Sessão 12: integração do MVP (22/11)

- Branch `integra/mvp-final` criado da `origin/main` (`5e0aff7`), com a
  `origin/wt/app-infra` (`22cb7d0`) por merge e os commits da `main`
  local do Thiago reaplicados por cima (D-029). Nada foi enviado ao
  GitHub.
- Os testes do Thiago rodaram contra o código do Gui antes de qualquer
  porte: dos 54, passaram 33. Depois dos commits mantidos passam 36, e
  os 18 que falham são todos do `.eml` (D-029).
- Boot no Linux: com o `index.ts` da `wt/app-infra`,
  `PORT=3917 npm start` saía com código 0 em 2 s sem escutar. Com o fix,
  o servidor sobe e responde em `/api/health`.
- Verificação ao vivo em Postgres 16 num contêiner descartável: NF-e,
  CT-e, planilha, CC-e e `.eml` ingeridos; `GET /api/pedidos` e
  `/api/pedidos/:id` filtram por sessão (a outra sessão recebe 404); o
  SSE entrega o evento só à sessão do cookie, nos dois sentidos; CT-e e
  planilha enviados em paralelo no mesmo pedido não bifurcaram a cadeia
  (ao fim, `seq` de 1 a 42 sem buraco e audit `valida: true`); UPDATE,
  DELETE e TRUNCATE são recusados pelas triggers; `.xlsx` responde 422.
- `npx vitest run`: 8 arquivos e 88 testes passando; `tsc --noEmit`
  limpo; guard e prose-evals com exit 0. O `npm audit` cai de 4 para 3
  vulnerabilidades com a saída do `xlsx` e ainda acusa
  `@fastify/static@8.3.0` (high), dependência da `wt/app-infra`.

### Sessão 13: identidade Brandbook v4 registrada (22/11)

- O Brandbook Forseti v4 do Gabriel (`Forseti_Brandbook_V04-1.pdf`)
  chegou depois da direção "Rota 3" do moodboard e passa a reger as
  superfícies (D-030): paleta, tipografia, gramática formal, voz e
  motion definidos pela marca.
- O logo oficial saiu do próprio PDF por extração vetorial (D-032):
  lockup e símbolo nas versões petróleo e negativo, sem redesenho.
- O site `the-foundry` é re-vestido inteiro sem rota nova (D-031) e o
  app segue claro por padrão com o alternador preservado (D-033). A
  lavanda clara fica fora de texto e estado (D-034), medido.
- Spec 0006 aprovada com as frentes `site-forseti` e `app-brand`
  registradas em `speckit/frentes.json` (D-035); a `app-demo` é
  encerrada após a integração na `integra/mvp-final`.

### Errata da Sessão 13 (22/11, mesma data)

- O entendimento inicial de "adaptar o site" cobria só o
  `the-foundry`. Corrigido: a LP do produto nasce do zero em `lp/`
  como site de empresa real (D-036); o trabalho do the-foundry fica.

### Sessão 14: integração das frentes v4 e primeiro deploy público (23/11)

- Merge `integra/mvp-final2` na `main`: traz o app na identidade v4
  (frente `app-brand`, aprovada em revisão independente), o fix do
  stream SSE após o cookie de sessão, o endurecimento da demo pública
  (seed só leitura, rate limit, limites por sessão) e o runtime de
  produção (`tsx` em dependência, seed no boot, `@fastify/static`
  corrigido).
- Conflitos do merge: 19 arquivos. Código de `app/` e specs 0004
  resolvidos a favor da linha integra, que já tinha reconciliado as
  contribuições da `main` (D-029); `DECISIONS.md` ficou com a versão
  da `main` (superset: D-030 a D-036). A referência "D-025" da
  planilha nas specs da `main` era defasada: a canônica é D-028.
- Merge `wt/site-forseti` na `main`: traz `site/` revestido (bônus,
  site da equipe) e a LP nova em `lp/` (D-036). Único conflito:
  `brief-site-forseti.md`, resolvido pela versão da frente (superset
  com D-S1 a D-S19 e a verificação das duas superfícies).
- Railway (D-037): projeto `forseti`, Postgres online em iad, serviço
  do app com `DATABASE_URL` por reference variable e domínio gerado.
  Smoke público `app/deploy/smoke.mjs`: 10 de 11 verdes; a falha é o
  422 no lugar de 413 para upload acima do limite, registrada em P-008.
- Vercel (D-038): LP deployada no projeto `forseti-br` com `DEMO_URL`
  real e `SITE_URL`/`og:` absolutos; `forseti.vercel.app` indisponível.
- Pendente: soak de SSE na URL pública, push da `main` (ainda local)
  e a correção do 413.

### Sessão 15: cinco auditorias, specs 0007 e 0008 aprovadas (23/11)

- Cinco auditorias independentes sobre a `main` integrada: SOLID e
  arquitetura, segurança da demo pública, TypeScript e qualidade,
  testes e cobertura, conformidade com o Brandbook v4 nos dois sites.
  Achados altos confirmados no código: race de idempotência no ingest
  (`pipeline.ts` checa `eventoExiste` antes do advisory lock de
  `store.ts`), bypass de quota por rotação de cookie, lookup de
  `ROTULO_STATUS` que resolve via `Object.prototype`, IMAP sem
  listener de `error` e classificação por regex na mensagem, campos
  da LLM sem validação de tipo (`peso_kg:"12kg"` vira `NaN`),
  `/api/simulate` que diverge de `diverge()` e `pedido: null` com
  planilha solitária. Zero vulnerabilidade de dependência nos dois
  `package.json`; XXE e ReDoS testados e negados.
- Spec 0008 `blindagem-publica` (D-039): corrige o que o juiz pode
  disparar (P0/P1) e o polimento que ele lê (P2), frente única
  `hardening`, integra primeiro.
- Spec 0007 `camada-ai-operacional` (D-040, D-041): mandatos em
  pt-BR viram ações tipadas do conjunto fechado executadas pelo motor
  e gravam evento `mandato` por pedido; agenda de contatos com
  bootstrap por `fone` dos XMLs; notificação Nvoip desligada por
  padrão; sinal consultivo de corpo de e-mail e CC-e; `.xlsx` volta
  pela conversão para CSV em worker blindado (D-041); layout
  desconhecido resolve por mapeamento proposto pela LLM com
  aprovação na revisão e template por remetente; contrato
  `view-spec` com front reservado ao usuário.
- Frentes novas em `speckit/frentes.json` (D-042): `hardening`,
  `ai-ingest`, `ai-mandatos`, `ai-web` (reservada).
- O conceito "cadeia viva" (dominó por evento real + simulate) ficou
  registrado no `BACKLOG.md` item 19, sem implementação nesta rodada.

### Sessão 16: camada AI operacional implementada e integrada (23/11)

- Spec 0008 entregue pela frente `hardening`: todos os achados das
  cinco auditorias corrigidos, revisão independente aprovada, redeploy
  com smoke público 11/11 (D-043). P-010 resolvida.
- Spec 0008 e 0007 implementadas por subagentes com critérios de
  aceite anotados antes e revisão independente depois de cada frente,
  como pedido pelo usuário.
- `wt/ai-mandatos`: tipos novos (`mandato`, `sinal`, `notificacao`),
  `llm.ts`, `sinal.ts`, `POST /api/mandatos` com ações tipadas do
  conjunto fechado e evento auditável por pedido, agenda `contatos`
  com bootstrap por `fone`, `nvoip.ts` desligada por padrão,
  `viewspec.ts`, `mapeamento.ts` + `templates` por remetente. O
  reviewer achou e a rodada corrigiu: corrida de `propagar` sem lock
  (mesmo padrão do RF1 da 0008), guard de protótipo em
  `aplicarMapeamento`, cota por IP no `view-spec`, motivos de
  `nao_entregue` testados, `notificarTarefa` que nunca lança (D-044).
- `wt/ai-ingest` em duas rodadas: `.xlsx` volta por worker com
  `resourceLimits` + checagem de zip antes de inflar, `exceljs` 4.4.0
  pinned, worker emite CSV e `parseCsv` segue único; validação de
  tipo nos campos da LLM do PDF; fios: sinais de `.eml`/CC-e,
  `NVOIP_NOTIFY_ON_TASK`, revisão com proposta de mapeamento e
  template por remetente, bootstrap por `fone` fiscal (D-044, D-G1 a
  D-G4).
- `app/deploy/smoke.mjs` atualizado: `.xlsx` legítimo agora entra
  (200), o falso segue 422, agenda de contatos e mandatos checados.
- Reservada: frente `ai-web` (T150), renderização do `view-spec` é do
  usuário com outro agente.
- Redeploy com a camada AI: `railway up` precisa do link dentro de
  `app/` (link na raiz do repo sobe o arquivo errado e o build falha
  sem achar `deploy/Dockerfile`); smoke público 14/14 na URL de
  produção: `.xlsx` legítimo entra (26 eventos), falso recusa 422,
  `/api/contatos` responde com a seed, `/api/mandatos` devolve 503
  declarado sem LLM configurada.
