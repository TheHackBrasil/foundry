// Cobranca de status a transportadora (spec 0010): pendencia por tempo
// sugere cobranca; o envio sai pelo canal de e-mail do contato da agenda,
// sempre com template do servidor — a sessao nunca injeta destinatario nem
// corpo livre (RF4/RF5). Janela anti-spam e opt-in COBRANCA_AUTO.

import type { Cobranca } from '../shared/model.js';
import { novoMessageId, smtpConfigDoEnv, criarRemetente, type Remetente } from './smtp.js';
import type { LedgerStore } from './store.js';

export interface ConfigCobranca {
  intervaloHoras: number; // COBRANCA_INTERVALO_HORAS: minimo entre envios do mesmo pedido
  expiraHoras: number; // COBRANCA_EXPIRA_HORAS: espera por resposta
  auto: boolean; // COBRANCA_AUTO=1: o verificador envia sem aprovacao humana
}

export function configCobrancaDoEnv(): ConfigCobranca {
  const intervalo = Number(process.env['COBRANCA_INTERVALO_HORAS']);
  const expira = Number(process.env['COBRANCA_EXPIRA_HORAS']);
  return {
    intervaloHoras: Number.isFinite(intervalo) && intervalo > 0 ? intervalo : 24,
    expiraHoras: Number.isFinite(expira) && expira > 0 ? expira : 72,
    auto: process.env['COBRANCA_AUTO'] === '1',
  };
}

// A cobranca nasce mesmo sem contato de e-mail: fica pendente com o motivo
// visivel e o operador corrige a agenda antes de enviar (RF1).
export async function criarCobrancaParaPendencia(
  store: LedgerStore,
  pedidoId: string,
  expiraHoras: number,
): Promise<{ cobranca: Cobranca; criada: boolean }> {
  const contato = await store.contatoDaParte('transportadora');
  const emailOk = contato?.canal === 'email' ? contato : null;
  const r = await store.criarCobrancaPendente(
    pedidoId,
    contato?.id ?? null,
    emailOk?.destino ?? null,
    new Date(Date.now() + expiraHoras * 3_600_000),
  );
  if (r.criada && contato && contato.canal !== 'email') {
    await store.atualizarCobranca(r.cobranca.id, {
      status: 'pendente_envio',
      motivo: `contato da transportadora usa ${contato.canal}, nao e-mail`,
    });
    r.cobranca = (await store.cobrancaPorId(r.cobranca.id)) ?? r.cobranca;
  }
  return r;
}

// Assunto e corpo fixos do servidor (RF4): a chave de 44 digitos na linha de
// assunto e a via de matching da resposta quando o In-Reply-To se perde.
export function assuntoECorpo(pedidoId: string): { assunto: string; corpo: string } {
  return {
    assunto: `Status de entrega - NF-e ${pedidoId}`,
    corpo: [
      'Ola,',
      '',
      `Sobre a entrega referente a NF-e ${pedidoId}:`,
      'qual a previsao de entrega atual e o status da carga?',
      '',
      'Responda este e-mail apenas com a data prevista e o status',
      '(ex.: "entrega prevista para 28/11, em transito").',
      '',
      'Este pedido de status foi gerado pela camada de reconciliacao do embarcador.',
    ].join('\n'),
  };
}

export interface ResultadoEnvio {
  ok: boolean;
  status: Cobranca['status'];
  motivo?: string;
}

// Envia a cobranca pendente. Sem SMTP configurado, marca pendente_envio sem
// erro; falha de envio vira erro_envio com o motivo — nunca retry cego.
export async function enviarCobranca(
  store: LedgerStore,
  cobranca: Cobranca,
  remetente?: Remetente | null,
): Promise<ResultadoEnvio> {
  const cfg = smtpConfigDoEnv();
  const enviar = remetente === undefined ? (cfg ? criarRemetente(cfg) : null) : remetente;
  if (!enviar || !cfg) {
    await store.atualizarCobranca(cobranca.id, {
      status: 'pendente_envio',
      motivo: 'SMTP nao configurado (SMTP_HOST/SMTP_FROM)',
    });
    return { ok: false, status: 'pendente_envio', motivo: 'SMTP nao configurado' };
  }
  // Re-resolve na hora do envio: o operador pode ter corrigido a agenda
  // depois que a pendencia criou a cobranca sem e-mail valido.
  const contato = await store.contatoDaParte('transportadora');
  const destinatario = contato?.canal === 'email' ? contato.destino : cobranca.destinatario;
  if (contato && (contato.id !== cobranca.contatoId || destinatario !== cobranca.destinatario)) {
    await store.atualizarCobranca(cobranca.id, {
      contatoId: contato.id,
      destinatario: destinatario ?? null,
    });
  }
  if (!destinatario) {
    await store.atualizarCobranca(cobranca.id, {
      status: 'pendente_envio',
      motivo: 'contato da transportadora sem canal de e-mail',
    });
    return { ok: false, status: 'pendente_envio', motivo: 'sem destinatario de e-mail na agenda' };
  }
  const messageId = novoMessageId(cfg.dominio);
  const { assunto, corpo } = assuntoECorpo(cobranca.pedidoId);
  try {
    await enviar.enviar({ para: destinatario, assunto, corpo, messageId, de: cfg.from });
  } catch (e) {
    const motivo = (e as Error).message.slice(0, 200);
    await store.atualizarCobranca(cobranca.id, { status: 'erro_envio', motivo });
    return { ok: false, status: 'erro_envio', motivo };
  }
  await store.atualizarCobranca(cobranca.id, { status: 'enviada', messageId });
  return { ok: true, status: 'enviada' };
}

// Janela anti-spam (RF5): o ultimo envio deste pedido precisa respeitar
// COBRANCA_INTERVALO_HORAS antes de reenviar.
export function dentroDaJanela(cobranca: Cobranca, intervaloHoras: number, agora = new Date()): boolean {
  if (!cobranca.enviadaEm) return false;
  return agora.getTime() - new Date(cobranca.enviadaEm).getTime() < intervaloHoras * 3_600_000;
}
