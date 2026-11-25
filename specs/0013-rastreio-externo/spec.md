# Spec 0013: rastreio externo em página pública da transportadora

**Status:** rascunho (aguarda aprovação)
**Origem:** backlog itens 32/33 (pedido do usuário 24/11) +
`docs/transportadoras-rastreio.md` (lista verificada ao vivo) +
Linear THE-30. Canal complementar à spec 0010: a cobrança por
e-mail cobre a transportadora **sem** página pública; esta spec
cobre a que **tem**.
**Data:** 2026-11-24

## Problema e resultado esperado

A transportadora publica a própria versão da entrega numa página
pública de rastreio. Hoje o produto só enxerga versões que chegam
como documento (NF-e, CT-e, planilha, e-mail). A página pública é
mais uma versão da mesma verdade e entra na tese de reconciliação
como fonte consultiva com origem e data.

O resultado esperado: o servidor consulta periodicamente a página
de rastreio da transportadora do CT-e, extrai o status com parser
declarado e registra a consulta como evidência datada no painel.
Quando a página muda de layout ou não responde, o sistema declara
`ilegivel` em vez de inventar status.

## O que esta spec NÃO faz

- Não entra na matriz de divergência: o vocabulário de status varia
  por transportadora e um parser quebrado não pode acender
  divergência falsa. A integração com comparação de campos fica
  como decisão futura, e a cobrança por claim da spec 0010 cobre o
  caso que exige contraditório.
- Não faz scraping com credencial: só páginas públicas que aceitam
  o identificador que o pedido já tem (chave NF-e de 44 dígitos,
  CNPJ + número da NF ou número do CT-e).
- Não implementa retry sofisticado, proxy rotation ou quebra de
  captcha: página com captcha é marcada como `protegida` e sai da
  fila automática.

## Registro de transportadoras

Dados, não código: um registro declara por slug a forma da página
(template de URL, identificador aceito, modo de extração). Versão
inicial cobre só os endpoints GET puros verificados em 24/11:

| Slug | Endpoint | Identificador | Extração |
|---|---|---|---|
| `braspress` | `braspress.com.br/site/w/tracking/search?cnpj={cnpj}&documentType=NOTAFISCAL&numero={nf}` | CNPJ + nº NF | parser regex/JSON |
| `ssw` | `ssw.inf.br/2/rastreamento` | CNPJ/CPF + NF ou chave NF-e | parser regex (server-rendered) |
| `jadlog` | `jadlog.com.br/tracking` | CPF ou nº remessa | parser regex (legado JSF) |
| `jamef` | `jamef.com.br/rastrear/` | NF + CPF/CNPJ | parser regex |
| `gollog` | `servicos.gollog.com.br/Rastreamento` | AWB 11d | parser regex |

Páginas SPA (Rodonaves, Loggi, Latam parcial) ficam marcadas
`requer_navegador` e só rodam com `FIRECRAWL_API_KEY` configurada;
sem ela, a fila pula e registra o motivo. Correios e Azul Cargo têm
captcha: `protegida`, fora da fila automática.

O identificador vem do pedido: chave NF-e (= `pedidoId`), CNPJ do
emitente e número da NF estão no documento; número do CT-e está no
parser (`chaveCte`/`nCT`). Nenhum identificador é digitado pelo
visitante.

## Polling e evidência

- Um tick periódico (`RASTREIO_INTERVALO_MS`, padrão 30 min) varre
  pedidos da sessão que têm transportadora mapeada no registro e
  pelo menos um evento nas últimas `RASTREIO_JANELA_HORAS` horas.
- Cada consulta vira evento `rastreio` no pedido:
  `{ transportadora, statusBruto, statusNormalizado, url, httpStatus, consultadoEm, hashHtml }`.
  O HTML bruto nunca entra no ledger; o hash permite provar o que
  foi lido sem guardar a página (A7 e privacidade).
- Dedup: só grava quando `statusNormalizado` muda desde o último
  evento `rastreio` do mesmo pedido; a consulta sem mudança fica só
  em log.
- `statusNormalizado` pertence a um vocabulário pequeno:
  `aguardando_coleta`, `em_transito`, `saiu_para_entrega`,
  `entregue`, `excecao`, `ilegivel`, `protegida`, `sem_registro`.
  `statusBruto` guarda o texto original extraído.
- Endpoint manual `POST /api/pedidos/:id/rastreio` força consulta
  na hora (botão "consultar agora" no painel), com rate limit.
- A consulta roda fora de transação de escrita: HTTP demorado não
  segura lock de pedido (mesma regra da Nvoip na spec 0012).

## Superfície

Painel do pedido ganha a seção/bloco "versão da transportadora":
último status normalizado + texto bruto + quando foi consultado +
link para a página pública. O bloco GenUI correspondente pode ser
emitido pelo agente quando a pergunta for sobre entrega.

## Riscos e regras duras

- Layout que muda: parser retorna `ilegivel` com a resposta em
  evidência interna (log), nunca chuta status. Parser novo exige
  teste com fixture do HTML real.
- SSRF: URLs saem do registro controlado, mas cada consulta passa
  pelo mesmo guard `destinoWebhookValido` (defesa em profundidade;
  redirects seguem `manual` e host resolvido a privado é recusado).
- Honestidade (A7): pedido sem código real de rastreio mostra o
  estado `sem_registro` ou não mostra a seção; nada de fixture
  apresentado como consulta ao vivo na demo.
- Rate limit por host e timeout curto (10s) para não derrubar nem
  ser derrubado.

## Dependências e conflitos

- `app/server/` e `app/shared/` pertencem à frente `app-operacao`
  (spec 0011) enquanto ela estiver ativa: a implementação desta
  spec espera a frente fechar ou entra por coordenação explícita
  de paths (novo módulo `server/rastreio/` + evento novo).
- O evento `rastreio` é tipo novo em `shared/model.ts`: mesma
  colisão, mesmo tratamento.

## Critérios de aceite

- Registro data-driven: adicionar transportadora não exige código
  novo além do parser e da linha de registro.
- Consulta real a endpoint GET puro (Braspress ou SSW) grava
  evento `rastreio` com status normalizado e bruto, e uma segunda
  consulta sem mudança não grava nada.
- Página alterada ou inalcançável resulta em `ilegivel`/`sem_registro`,
  nunca em status inventado.
- `POST /api/pedidos/:id/rastreio` responde o resultado da consulta
  e respeita rate limit; pedido da seed recusa.
- Sem `FIRECRAWL_API_KEY`, página `requer_navegador` é pulada com
  motivo registrado, sem erro no resto da fila.
- Painel mostra a seção com origem e data; testes cobrem parser,
  dedup e guard SSRF.
