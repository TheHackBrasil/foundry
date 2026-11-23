// Entrega Nvoip (spec 0007, RF8): desligada por padrao; sem credencial nada
// sai para a rede. O texto e da LLM com template deterministico de fallback;
// o resultado vira evento 'notificacao' por pedido com o que saiu de verdade
// ou o motivo da falha (A7). Nunca lanca: falha registrada, fluxo intacto.

import type { CanalContato, Contato, Evento, Notificacao, Parte, Tarefa } from '../shared/model.js';
import { llmConfigDoEnv, chatJson } from './llm.js';
import type { LedgerStore } from './store.js';

// Canais que a Nvoip entrega; 'email' fica de fora e responde canal_incompativel.
export const CANAIS_NVOIP: readonly CanalContato[] = ['whatsapp', 'sms', 'ligacao'];

export interface NvoipConfig {
  url: string;
  chave: string;
  canalPadrao: CanalContato;
  timeoutMs: number;
}

type Ambiente = Record<string, string | undefined>;

function inteiroOuPadrao(env: string | undefined, padrao: number): number {
  const n = Number(env);
  return Number.isSafeInteger(n) && n > 0 ? n : padrao;
}

export function canalPadraoDoEnv(env: Ambiente = process.env): CanalContato {
  const canal = env['NVOIP_CANAL_PADRAO']?.trim().toLowerCase();
  return (CANAIS_NVOIP as readonly string[]).includes(canal ?? '') ? (canal as CanalContato) : 'whatsapp';
}

// Sem URL e chave a provedora esta fora: nada sai para a rede e quem chama
// registra 'desligado' (mandato) ou omite o evento (propagacao).
export function nvoipConfigDoEnv(env: Ambiente = process.env): NvoipConfig | null {
  const url = env['NVOIP_API_URL']?.trim();
  const chave = env['NVOIP_API_KEY']?.trim();
  if (!url || !chave) return null;
  return {
    url,
    chave,
    canalPadrao: canalPadraoDoEnv(env),
    timeoutMs: inteiroOuPadrao(env['NVOIP_TIMEOUT_MS'], 10_000),
  };
}

export function canalCompativel(canal: CanalContato): boolean {
  return (CANAIS_NVOIP as readonly string[]).includes(canal);
}

// Disparo automatico na propagacao de tarefa: so com NVOIP_NOTIFY_ON_TASK
// ligado a criacao de tarefa tenta avisar a parte. O mandato 'notificar'
// nao depende desta chave: e o operador pedindo na hora.
export function notificarEmTarefaDoEnv(env: Ambiente = process.env): boolean {
  const v = env['NVOIP_NOTIFY_ON_TASK']?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'sim';
}

const MAX_MENSAGEM = 300;

// Texto por LLM (emprego "escrever para humanos"); sem ela ou com saida
// invalida, o template deterministico com campo, valores e parte cobre.
export async function textoParaTarefa(tarefa: Tarefa, pedidoId: string): Promise<string> {
  if (llmConfigDoEnv()) {
    try {
      const r = (await chatJson(
        [
          {
            role: 'user',
            content:
              'Escreva uma mensagem curta (ate 240 caracteres) em portugues para a parte ' +
              `"${tarefa.parte}" sobre esta tarefa de pedido logistico, sem saudacao nem assinatura.\n` +
              `Pedido: ${pedidoId}\nTarefa: ${tarefa.titulo}\nDetalhe: ${tarefa.detalhe}\n` +
              'Responda APENAS JSON: {"mensagem": string}',
          },
        ],
        { maxTokens: 200 },
      )) as { mensagem?: unknown };
      if (typeof r.mensagem === 'string' && r.mensagem.trim()) {
        return r.mensagem.trim().slice(0, MAX_MENSAGEM);
      }
    } catch {
      // fallback deterministico cobre indisponivel e invalido
    }
  }
  return `Pedido ${pedidoId}: ${tarefa.titulo}. ${tarefa.detalhe}`.slice(0, MAX_MENSAGEM);
}

// POST no endpoint configurado. Corpo minimo {canal, destino, mensagem}: o
// ajuste fino do contrato acontece quando a credencial de teste chegar.
async function enviar(cfg: NvoipConfig, canal: CanalContato, destino: string, mensagem: string): Promise<boolean> {
  try {
    const resp = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.chave}` },
      signal: AbortSignal.timeout(cfg.timeoutMs),
      body: JSON.stringify({ canal, destino, mensagem }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function eventoNotificacao(n: Notificacao): Record<string, unknown> {
  return { ...n };
}

export interface OpcoesNotificacao {
  // Mandato registra ate 'desligado'; a propagacao normal so registra quando
  // a Nvoip esta ligada (spec: desligada nao gera evento de notificacao).
  registrarSempre?: boolean;
  // Exigida quando tarefa e null (mandato sem tarefa na parte).
  parte?: Parte;
}

// Envia a notificacao da tarefa para a parte e grava o evento 'notificacao'
// no pedido pelo store recebido (dentro da tx do chamador). Devolve o evento
// gravado, ou null quando a Nvoip esta fora e registrarSempre e falso.
export async function notificarTarefa(
  store: LedgerStore,
  pedidoId: string,
  tarefa: Tarefa | null,
  opcoes: OpcoesNotificacao = {},
): Promise<Evento | null> {
  const parte = tarefa?.parte ?? opcoes.parte;
  if (!parte) throw new Error('notificarTarefa: parte obrigatoria quando tarefa e null');
  const registrar = (n: Notificacao) => store.append(pedidoId, 'notificacao', eventoNotificacao(n));

  const cfg = nvoipConfigDoEnv();
  if (!cfg) {
    if (!opcoes.registrarSempre) return null;
    return registrar({ parte, canal: null, destino: null, mensagem: '', status: 'nao_entregue', motivo: 'desligado' });
  }
  if (!tarefa) {
    return registrar({ parte, canal: null, destino: null, mensagem: '', status: 'nao_entregue', motivo: 'sem_tarefa' });
  }
  const contato: Contato | null = await store.contatoDaParte(parte);
  if (!contato) {
    return registrar({ parte, canal: null, destino: null, mensagem: '', status: 'nao_entregue', motivo: 'sem_contato' });
  }
  if (!canalCompativel(contato.canal)) {
    return registrar({
      parte,
      canal: contato.canal,
      destino: contato.destino,
      mensagem: '',
      status: 'nao_entregue',
      motivo: 'canal_incompativel',
    });
  }
  const mensagem = await textoParaTarefa(tarefa, pedidoId);
  const ok = await enviar(cfg, contato.canal, contato.destino, mensagem);
  return registrar({
    parte,
    canal: contato.canal,
    destino: contato.destino,
    mensagem,
    status: ok ? 'entregue' : 'nao_entregue',
    ...(ok ? {} : { motivo: 'falha_envio' }),
  });
}
