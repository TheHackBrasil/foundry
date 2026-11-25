# Spec 0012: webhook de saída por contato

Status: implementada
Data: 24/11
Backlog: item 28 · Linear THE-31

## Contexto

A agenda de contatos por workspace (`contatos`, spec 0007) já modela
como avisar cada parte: `canal` + `destino`. Hoje os canais são
whatsapp, sms, ligacao e email, e a entrega depende da Nvoip, que está
desligada por padrão e sem credencial. Um canal `webhook` transforma a
mesma agenda em integração de saída: o destino é uma URL e a tarefa é
entregue como POST JSON. É a resposta universal para "integra com o
quê" e não depende de provedora nenhuma.

## Escopo

1. `CanalContato` ganha `'webhook'`. O `destino` de contato webhook é
   uma URL `http(s)` validada na escrita.
2. `notificarTarefa` despacha webhook sem depender da Nvoip: contato
   webhook recebe POST JSON `{ pedidoId, parte, tarefa }` e o evento
   `notificacao` registra `canal: 'webhook'`. Canais Nvoip seguem o
   caminho atual sem mudança de comportamento.
3. Na propagação automática (`pipeline.ts`), tarefa nova dispara o
   webhook quando o contato da parte é webhook, mesmo com
   `NVOIP_NOTIFY_ON_TASK` desligado: a flag governa a Nvoip, não uma
   URL que a própria sessão cadastrou.
4. O form da agenda no web oferece o canal webhook com dica de URL.
5. SSRF: `destino` webhook só aceita http/https em host público.
   Loopback, IPs privados/link-local literais e hosts internos óbvios
   são recusados no `validarContato` e novamente no envio.

## Fora de escopo

- Retry, assinatura HMAC e fila de entrega (uma tentativa por evento).
- Webhook por evento genérico (só tarefa, o mesmo gatilho da Nvoip).
- UI de gerenciamento além do form de contato existente.

## Critérios de aceite

- PUT `/api/contatos` com `canal: 'webhook'` e URL https pública
  persiste; URL http em host privado ou esquema inválido responde 400.
- Propagar divergência que cria tarefa para parte com contato webhook
  faz POST JSON no destino e grava `notificacao` com `entregue`.
- Contato whatsapp sem Nvoip configurada segue `nao_entregue
  (desligado)`; contato webhook funciona sem NVOIP_NOTIFY_ON_TASK e
  sem Nvoip configurada.
- Mandato `notificar` e `enviar_notificacao` do agente despacham
  webhook pelo mesmo caminho.
- `npx tsc --noEmit` limpo; testes novos cobrindo webhook entregue,
  falha de envio e SSRF recusado.
