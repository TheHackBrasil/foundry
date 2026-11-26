// Cobranca de status a transportadora (spec 0010): pendencia por tempo
// sugere cobranca; o envio sai pelo canal de e-mail do contato da agenda,
// sempre com template do servidor: a sessao nunca injeta destinatario nem
// corpo livre (RF4/RF5). Janela anti-spam e opt-in COBRANCA_AUTO.
// Spec 0017 (T712): o Message-ID e derivado da cobranca e da tentativa e
// gravado antes do envio; envio e expiracao viram eventos no ledger.

import { CANAIS_CONTATO, type Cobranca, type Evento } from '../shared/model.js';
import { smtpConfigDoEnv, criarRemetente, type Remetente } from './smtp.js';
import type { EscopoCobranca, LedgerStore } from './store.js';

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
// visivel e o operador corrige a agenda antes de enviar (RF1). casoId e o
// caso de pendencia que pediu a cobranca (spec 0017, T705).
export async function criarCobrancaParaPendencia(
  store: LedgerStore,
  pedidoId: string,
  expiraHoras: number,
  casoId: string | null = null,
): Promise<{ cobranca: Cobranca; criada: boolean }> {
  const email = await store.contatoDaParte('transportadora', 'email');
  // Sem e-mail, o contato de outro canal so explica o motivo.
  const contato = email ?? (await store.contatoDaParte('transportadora', CANAIS_CONTATO));
  const r = await store.criarCobrancaPendente(
    pedidoId,
    contato?.id ?? null,
    email?.destino ?? null,
    new Date(Date.now() + expiraHoras * 3_600_000),
    casoId,
  );
  if (r.criada && contato && !email) {
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

// Message-ID da tentativa (spec 0017, T712): a mesma cobranca e a mesma
// tentativa dao sempre o mesmo id, entao repetir um envio que caiu no meio
// manda a mesma mensagem e o servidor de destino descarta a copia. O segredo
// da cobranca impede que alguem monte o id de outra cobranca pela sequencia
// e responda por ela, ja que a resposta casa em qualquer workspace (RF27).
export function messageIdDaCobranca(cobrancaId: number, tentativa: number, segredo: string, dominio: string): string {
  return `<cobranca.${cobrancaId}.${tentativa}.${segredo}@${dominio}>`;
}

const RE_MESSAGE_ID_COBRANCA = /^<cobranca\.(\d{1,18})\.(\d{1,9})\.([0-9a-f]{16})@[^<>@\s]+>$/i;

export function lerMessageIdDaCobranca(
  messageId: string,
): { cobrancaId: number; tentativa: number; segredo: string } | null {
  const m = RE_MESSAGE_ID_COBRANCA.exec(messageId.trim());
  if (!m) return null;
  return { cobrancaId: Number(m[1]), tentativa: Number(m[2]), segredo: m[3]!.toLowerCase() };
}

// Cobranca citada por um Message-ID do In-Reply-To/References: o ultimo
// envio esta na coluna message_id; tentativa anterior casa pelo id e pelo
// segredo lidos do proprio Message-ID.
export async function cobrancaDaReferencia(
  store: LedgerStore,
  referencia: string,
  escopo: EscopoCobranca,
): Promise<Cobranca | null> {
  const ref = referencia.trim();
  if (!ref) return null;
  const exata = await store.cobrancaPorMessageId(ref, escopo);
  if (exata) return exata;
  const lido = lerMessageIdDaCobranca(ref);
  return lido ? store.cobrancaPorSegredo(lido.cobrancaId, lido.segredo, escopo) : null;
}

export interface ResultadoEnvio {
  ok: boolean;
  status: Cobranca['status'];
  motivo?: string;
  // cobranca_enviada gravado no pedido; quem chama repassa ao SSE.
  evento?: Evento;
}

// Envia a cobranca pendente. Sem SMTP configurado, marca pendente_envio sem
// erro; falha de envio vira erro_envio com o motivo, nunca retry cego.
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
  const email = await store.contatoDaParte('transportadora', 'email');
  const contato = email ?? (await store.contatoDaParte('transportadora', CANAIS_CONTATO));
  const destinatario = email ? email.destino : cobranca.destinatario;
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
  // Tentativa = envios confirmados no ledger + 1: envio que falhou repete o
  // mesmo Message-ID; reenvio depois de um envio confirmado ganha outro.
  const tentativa = (await store.enviosDaCobranca(cobranca)) + 1;
  const segredo = await store.segredoDaCobranca(cobranca.id);
  if (!segredo) return { ok: false, status: cobranca.status, motivo: 'cobranca nao encontrada' };
  const messageId = messageIdDaCobranca(cobranca.id, tentativa, segredo, cfg.dominio);
  // Gravado antes do envio: resposta a um envio que saiu e nao foi
  // confirmado (queda entre o SMTP e o UPDATE) ainda casa.
  await store.atualizarCobranca(cobranca.id, { messageId });
  const { assunto, corpo } = assuntoECorpo(cobranca.pedidoId);
  try {
    await enviar.enviar({ para: destinatario, assunto, corpo, messageId, de: cfg.from });
  } catch (e) {
    const motivo = (e as Error).message.slice(0, 200);
    await store.atualizarCobranca(cobranca.id, { status: 'erro_envio', motivo });
    return { ok: false, status: 'erro_envio', motivo };
  }
  await store.atualizarCobranca(cobranca.id, { status: 'enviada', messageId });
  // Payload so com ids (spec 0017, RF25): nada de endereco de e-mail.
  const evento = await store.append(cobranca.pedidoId, 'cobranca_enviada', {
    cobrancaId: cobranca.id,
    ...(cobranca.casoId ? { casoId: cobranca.casoId } : {}),
    tentativa,
  });
  return { ok: true, status: 'enviada', evento };
}

// Janela anti-spam (RF5): o ultimo envio deste pedido precisa respeitar
// COBRANCA_INTERVALO_HORAS antes de reenviar.
export function dentroDaJanela(cobranca: Cobranca, intervaloHoras: number, agora = new Date()): boolean {
  if (!cobranca.enviadaEm) return false;
  return agora.getTime() - new Date(cobranca.enviadaEm).getTime() < intervaloHoras * 3_600_000;
}
