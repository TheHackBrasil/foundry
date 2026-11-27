# BACKLOG: fila local

Fila versionada de trabalho. Ordem = prioridade. Item não-trivial entra
em execução só via spec (`speckit/specify.md`). Status: `todo` /
`spec` (→ NNNN) / `doing` / `done` / `blocked`.

## Em execução

- Entrega da fase online (30/11, 23h59): repositório, demo pública e
  vídeo do produto de até 3 minutos. Demo já no ar (D-038); o vídeo do
  produto segue na fila.

## Fila

| # | Item | Status | Nota |
|---|---|---|---|
| 12 | Vídeo do produto (até 3 min) para a entrega de 30/11 | todo | regulamento 7.3; o `pitch-v10` existe mas é anterior ao produto funcionando |
| 14 | Faixa `.vtt` de legendas no vídeo `pitch-v10` do site | todo | axe `video-caption` |
| 20 | `og:url`/`og:image` em `site/src/layouts/Base.astro` apontam o domínio antigo da marca (resíduo no `<head>` do site da equipe) | todo | achado do reviewer da `hardening`, 23/11; path é da `escopo-produto` |
| 21 | Nota de deploy do `CLIENT_IP_HEADER`: ausente atrás de proxy vira bucket global (demo congela para visitante novo); presente sem proxy que sobrescreva é spoofável | todo | documentar no README/`deploy/`; achado do reviewer da `hardening`, 23/11 |
| 22 | `MAX_WRITING_WORKSPACES=0` recusa toda primeira escrita: documentar como kill-switch ou exigir mínimo 1 em `config.ts` | todo | achado do reviewer da `hardening`, 23/11 |
| 23 | Menores da revisão da `hardening`: `parser.destroy()` no `finally` pode mascarar `ErroParser` em `pdf.ts`; `confianca > 1` aceito; `e.message` do mailparser entra no payload de revisão visível a outras sessões; `JanelaFixa` poda só acima de 10 mil chaves expiradas | todo | achados do reviewer da `hardening`, 23/11 |
| 25 | Follow-ups da spec 0007 (F-01 a F-05 do `brief-ai-mandatos.md` + D-G3 do `brief-ai-ingest.md`): fetch LLM/Nvoip dentro da tx segurando conexão do pool; teto de `eventosPorWorkspace` para derivados; `simular` sem validação de tipo do `valor`; `alvo` no payload do mandato; `bateFornecedor` lê só a primeira NF-e; `remetente` do template é o nome do arquivo (trocar a derivação da chave quando existir envelope/remetente real) | todo | registrados como decisões conscientes em 23/11 |

| 27 | Notificação por e-mail transacional (Resend/Postmark free tier): canal `email` da agenda hoje devolve `canal_incompativel`; juiz cadastra o próprio e-mail e recebe a tarefa ao vivo, sem a fricção de template da Nvoip | todo | sugestão aceita 23/11; tapa o buraco da Nvoip no wow de entrega |
| 29 | Ingest por imagem (foto de DANFE/screenshot -> versão): `gpt-6.2-sol` aceita `image_url` no mesmo endpoint; falta `llm.ts` aceitar conteúdo de imagem e o front aceitar `image/*` | todo | sugestão aceita 23/11; estende "manda qualquer documento" até o papel |
| 30 | QR de onboarding de contato na agenda ("convidar parte" -> form que PUT o contato no papel): dramatiza a história de onboarding real | todo | sugestão aceita 23/11 |
| 31 | Descartados para demo: passkeys (sessão anônima é a wedge; roadmap de auth), verificação facial (fora da tese), mapas/rastreio (território de tracker, não da camada de verdade) | todo | registrado 23/11 para não reabrir |

| 33 | Fonte externa de rastreio: polling de páginas públicas das transportadoras da lista (item 32) como fonte consultiva no painel; spec 0013 escrita em 24/11 (registro data-driven, evento `rastreio` com dedup, vocab normalizado, guard SSRF, Firecrawl só para SPA) | spec pronta | THE-30; implementação aguarda frente `app-operacao` (dona de `app/server/`) ou coordenação de paths |
| 34 | Cadastrar Resend (conta, domínio de envio, API key) para destravar o item 27; ação externa do usuário | todo | pedido do usuário 24/11; bloqueia 27 |
| 35 | Busca fuzzy global no site inteiro: campo único que varre pedidos, documentos, campos, contatos, tarefas e eventos; destaque do trecho casado no resultado, preview rico do alvo ao lado (card do pedido, trecho do documento, status da cadeia), navegação completa por teclado e UI/UX polida | todo | pedido do usuário 25/11; fuzzy search com preview rico e highlight dos matches |
| 36 | Log completo de e-mail com histórico acessível pelo harness do agente: toda mensagem enviada ou recebida (SMTP/IMAP) persistida com thread, anexos e linha do tempo consultável; usuário vai mandar a transcrição da call como material | todo | pedido do usuário 25/11 |

| 38 | Tela de entrada de insights ("stories"): abrir `#/` sem pedido mostra sequencia de insights prontos cross-pedido ("N notas divergem do CT-e", maior atraso, tarefas por setor, R$ em risco com rotulo de simulacao), cada um navegavel para o pedido/divergencia exata; compositor deterministico sem LLM sobre GETs existentes; a lista de ate 8 pedidos com selos que hoje ocupa a entrada (`App.tsx:451-524`) vira fallback degradado | spec pronta | spec 0016; decisao central da call 26/11: jurado leigo decide em segundos. Recon 26/11: dados ja saem por GETs (`index.ts:413`, `atrasoDias` `model.ts:478`, metricas `index.ts:964-969`, sinais `model.ts:253-258`); deep-link + `AlvoFocoGenUI`/`focoPendenteTorre` ja existem; sem auth ja e o design (P-010). Insights por transportadora ficam fora ate o item 43 |
| 48 | Higiene de demo para o juri: documentar `SEED_ON_BOOT` e `RATE_LIMIT_NEW_SESSIONS_PER_10MIN` em `app/.env.example` (ambas ausentes); avaliar cota de sessoes novas por IP (juri inteiro no mesmo IP compartilha o bucket na primeira escrita de cada um, `config.ts:141` + `index.ts:375-380`, amarra no item 21); aviso na UI quando `MAX_WRITING_WORKSPACES=0` (estende o item 22); IDs seed hardcoded no front (`api.ts:28-29`) degradam silenciosamente se o corpus mudar | todo | achados do recon de 26/11; risco real no dia do juri; esforco S |
| 50 | Harness: livro-verdade da carga como maquina de estados de ciclo de vida (coletado, transito, excecao, entrega) que evolui entre cobrancas, no lugar do snapshot estatico de hoje | todo | lacuna de produto da frente harness-transp, registrada na integracao 27/11; adendo da spec 0018 secao 4 |
| 51 | Harness: variedade semeada nas respostas (PRNG com seed explicita, imperfeicao de texto operacional, ruido de canal) para o parser e a extracao trabalharem de verdade; resposta limpa demais nao prova nada | todo | mesma lacuna; principio "produto, nao hardcode pra demo" do usuario em 27/11 |
| 49 | Confirmar no regulamento se commits apos 30/11 23h59 sao permitidos (resultados saem 02/12) | todo | call 26/11 [1:14:19]; acao externa do usuario, nao e codigo |
| 39 | Toolbar da torre enxuta (recorte minimo entregue 26/11 na spec 0017: menu Layout; resta mover IA p/ topbar + superficie de configuracoes): condensar TorreVistas num unico menu "Layout" (visiveis so presets+densidade; salvar/restaurar/pin/excluir/cards vao para dentro); recorte completo move a barra da IA para a topbar no modo leve (campo captura e navega via `abrirAssistente(comando)`, `App.tsx:169-175`) e o toggle de tema para superficie de configuracoes nova | spec 0017 | call 26/11 [40:04]: "muita coisa, ate o cara descer ja desistiu". Recon: 6 faixas antes do primeiro card, ~15-25 controles; so o TorreVistas soma 5 presets+3 densidades+2 acoes+dropdown (`TorreVistas.tsx:284-504`). Preservar a11y APG (`teclaRadio` :173-184, roving tabindex :377-381, toast com Desfazer :276-280). `comandoInicialIA` ja executa na pagina IA; prop `aoAbrirAssistente` morta em `BarraMandatos.tsx:95`. Esforco M (menu) a L (recorte completo) |
| 47 | Contestacao em um clique com retry: fluxo canal oficial, WhatsApp, ligacao, transcricao, interpretacao com retry automatico; amarrar com os itens 36 (log de e-mail como evidencia) e 27/34 (sem e-mail transacional a perna "canal oficial" nao entrega) | spec (→ 0017) | call 26/11: diferencial central do pitch; divisao fechada: Gui no harness/bot de chamadas (entrega quinta de manha). Spec 0017 em rascunho: escada e-mail, WhatsApp e ligação com aprovação |
| 43 | Transportadora como entidade do pedido + agregado de casos por transportadora: `Pedido` nao tem campo transportadora (`model.ts:102-110`; hoje e so um valor do union `Parte`); desbloqueia os insights por transportadora fora de escopo na spec 0016 | todo | call 26/11; pre-requisito de insights por transportadora. Esforco M-L |
| 45 | API/MCP read-only para consulta externa da camada de verdade | spec (→ 0017) | decidido na call 26/11; a 0017 entrega o MCP só de leitura preso a um caso (RF15) para o agente de voz; consulta externa ampla fica para depois |
| 46 | Heatmap de calendario de entregas | todo | decidido na call 26/11 |
| 44 | Custodia entre transportadoras (ultimo do ultimo do roadmap) | todo | decidido na call 26/11 como o item mais distante |
| 4 | Publicar `slides/` do deck de descoberta Enviagora | todo | arquivos já portados; subir no mesmo deploy |
| 6 | Capítulo pós-call Enviagora no diário | blocked | call remarcada sem data: escrever só com resultado real |
| 10 | Capítulo "MVP no ar" no site | todo | demo pública no ar desde 23/11 (D-038) |

## Feito

| # | Item | Data |
|---|---|---|
| 37 | Migração para Turso avaliada e descartada: o Postgres fica (D-064). O ledger depende de trigger PL/pgSQL, inclusive para TRUNCATE; o Turso não tem NOTIFY nem suporte a DBOS ou Temporal | 2026-11-26 |
| 8 | Build do MVP (atraso propagado): demo funcional em 23/11 (`specs/0004`) | 2026-11-23 |
| 15 | Identidade Brandbook v4 nas telas do app e no site (`specs/0006`, D-030 a D-035) | 2026-11-23 |
| 16 | LP do produto em `lp/` no ar: forseti-br.vercel.app (D-036, D-038) | 2026-11-23 |
| 17 | Demo pública no ar: app + Postgres na Railway (D-037, smoke 10/11, soak SSE ok) | 2026-11-23 |
| 18 | Integração das frentes v4 e deploy na `main` (sessão 14 do `DECISIONS.md`) | 2026-11-23 |
| 13 | Responder 413 (não 422) em upload acima do limite | 2026-11-23 |
| 24 | Blindagem pública (spec 0008): auditorias corrigidas, review aprovado, redeploy com smoke 11/11 | 2026-11-23 |
| 19 | "Cadeia viva": GrafoDomino + SimuladorVivo entregues como blocos GenUI na onda 2 (D-045); twin 3D segue fora (plano-mvp) | 2026-11-24 |
| 32 | Pesquisa de transportadoras por setor: `docs/transportadoras-rastreio.md` com ~28 mapeadas, top 5 por cobertura e 17/20 URLs vivas (D-049) | 2026-11-24 |
| 28 | Webhook de saída: canal `webhook` na agenda entrega tarefa por POST JSON sem Nvoip (spec 0012, D-049; smoke 18/18) | 2026-11-24 |
| 36 | P2/P3 da revisão da onda 2 corrigidos (D-048): teto de 8k na saída de tool no contexto, tools novas recusadas após abort, `destino` mascarado em contexto e payload `fim`, dedup de chamada idêntica no turno, `max_completion_tokens`, shape de `ev.bloco`, helpers deduplicados | 2026-11-24 |
| 26 | Voz -> mandato: `useVoz` (Web Speech, pt-BR) + `VisualizadorVoz` ligados na `BarraMandatos`; limitação conhecida: SpeechRecognition depende do serviço de nuvem do Chrome | 2026-11-24 |
| 35 | Retrabalho visual do front `ai-web`: absorvido pela reforma craft da onda 2 (materialidade mineral/papel, tipografia editorial, motion 60fps, anti-slop) | 2026-11-24 |
| 7 | Escopo do MVP fechado: atraso propagado (`specs/0004`, D-015 a D-018) | 2026-11-20 |
| 11 | Frentes do MVP: worktrees por frente, dono por pasta, hook de pre-commit | 2026-11-20 → `specs/0005` |
| · | Publicação dos docs de pesquisa | 2026-11-19 → `specs/0001` |
| · | Pipeline SDD local (constitution, speckit, guard, DECISIONS, RULES) | 2026-11-19 |
| 9 | `site/assets/` + `slides/` portados e commitados | 2026-11-19 |
| 2 | Release `pitch-v10` com `pitch-v10-share.mp4` + vídeo no site (D-014) | 2026-11-19 |
| 1 | Site público na identidade Foundry (specs 0002 + 0003) | 2026-11-19 |
| 3 | README definitivo com SVG animado + OG/Twitter | 2026-11-19 |
| 5 | Site no ar e verificado em the-foundry-alpha.vercel.app | 2026-11-19 |

## Regras da fila

- Um item `doing` por vez; `blocked` sempre com o desbloqueio nomeado.
- Reordenação é edição livre; remoção de item pede motivo no commit.
- Nada aqui vira trabalho sem spec quando a mudança for não-trivial.
