// Canal 'webhook' da agenda (spec 0012): o destino e uma URL e a tarefa
// sai como POST JSON. Independe da Nvoip; a sessao cadastra a URL no
// proprio contato. Uma tentativa por evento, sem retry nem fila.

import type { Parte, Tarefa } from '../shared/model.js';

export interface PayloadWebhookTarefa {
  tipo: 'tarefa';
  pedidoId: string;
  parte: Parte;
  tarefa: { titulo: string; detalhe: string };
}

export function payloadWebhook(pedidoId: string, tarefa: Tarefa): PayloadWebhookTarefa {
  return {
    tipo: 'tarefa',
    pedidoId,
    parte: tarefa.parte,
    tarefa: { titulo: tarefa.titulo, detalhe: tarefa.detalhe },
  };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Guard SSRF: o visitante escreve a URL que o servidor vai chamar, entao
// so http(s) em host publico. Loopback, privado e link-local literais sao
// recusados aqui e no envio. Limitacao assumida: nao resolve DNS (um
// hostname publico que resolve para IP privado passa); para o MVP o risco
// fica aceito e registrado na spec.
export function destinoWebhookValido(destino: string): boolean {
  let url: URL;
  try {
    url = new URL(destino);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === 'metadata' || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  const v4 = IPV4.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      return false;
    }
  }
  // IPv6: hostname chega com colchetes ([::1], [fe80::...]).
  if (host === '[::1]' || host.startsWith('[fe80:') || host.startsWith('[fec0:') || host.startsWith('[::ffff:')) {
    return false;
  }
  return true;
}

// POST JSON no destino. Nunca lanca: a entrega vira 'entregue' ou
// 'falha_envio' no evento 'notificacao'. redirect 'manual' evita que um
// redirecionamento leve o POST para host privado que o guard barrou.
export async function enviarWebhook(destino: string, payload: PayloadWebhookTarefa, timeoutMs = 5_000): Promise<boolean> {
  if (!destinoWebhookValido(destino)) return false;
  try {
    const resp = await fetch(destino, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return resp.status >= 200 && resp.status < 300;
  } catch {
    return false;
  }
}
