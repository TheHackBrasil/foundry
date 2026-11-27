// Parser de mensagem .eml (spec 0004, T029/RF28): desembrulha anexos
// .xml/.csv/.pdf para o mesmo pipeline do upload. Cabecalho nao
// e registrado em lugar nenhum (RF27).

import { simpleParser } from 'mailparser';
import { ErroParser } from './nfe.js';

// .xlsx fica no filtro e segue o mesmo caminho do CSV pelo pipeline (D-041);
// .xls (formato antigo) o detectarTipo responde com o 422 proprio.
const ANEXO_OK = /\.(xml|csv|xlsx|pdf)$/i;

export interface AnexoEml {
  nome: string;
  conteudo: Buffer;
}

// Cabecalho em memoria (spec 0010): so serve para o matching resposta ->
// cobranca e para os campos derivados do claim (remetente, messageId).
// Continua fora do ledger, da fila e do log (RF27).
export interface CabecalhoEml {
  remetente?: string;
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  assunto?: string;
  // Resposta automatica (RFC 3834 e derivados): out-of-office, bounce do
  // mailer-daemon, auto-resposta de helpdesk. Nao e resposta da
  // transportadora: nao fecha cobranca, nao vira claim nem revisao.
  automatica?: boolean;
}

export interface EmlLido {
  anexos: AnexoEml[];
  // Corpo de texto da mensagem: so alimenta a extracao de sinais (T140),
  // o claim status_declarado (spec 0010) e nunca vai para o ledger, para
  // a fila nem para o log (RF27).
  corpo: string;
  cabecalho: CabecalhoEml;
}

export async function extrairEml(conteudo: Buffer): Promise<EmlLido> {
  let parsed;
  try {
    parsed = await simpleParser(conteudo);
  } catch (e) {
    throw new ErroParser(`EML: mensagem malformada (${(e as Error).message})`);
  }
  const refs = parsed.references;
  const cabecalho: CabecalhoEml = {
    remetente: parsed.from?.value?.[0]?.address ?? undefined,
    messageId: parsed.messageId ?? undefined,
    inReplyTo: parsed.inReplyTo ?? undefined,
    references: Array.isArray(refs) ? refs : refs ? [refs] : [],
    assunto: parsed.subject ?? undefined,
    automatica: respostaAutomatica(parsed),
  };
  const corpo = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  return {
    anexos: parsed.attachments
      .filter((a) => a.filename && ANEXO_OK.test(a.filename))
      .map((a) => ({ nome: a.filename as string, conteudo: a.content })),
    corpo,
    cabecalho,
  };
}

// Sinais mecanicos de resposta automatica (RFC 3834): Auto-Submitted com
// valor diferente de 'no', cabecalhos X-Autoreply/X-Autorespond, Precedence
// de maquina, remetente mailer-daemon/postmaster ou Return-Path vazio de
// bounce. Qualquer um basta; humano nao emite nenhum deles.
function respostaAutomatica(parsed: {
  headers?: { get(nome: string): unknown } | null;
  from?: { value?: Array<{ address?: string }> };
}): boolean {
  const h = parsed.headers;
  const texto = (v: unknown): string => {
    if (typeof v === 'string') return v.toLowerCase();
    if (v && typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text).toLowerCase();
    if (v && typeof v === 'object' && 'value' in v) return JSON.stringify((v as { value: unknown }).value).toLowerCase();
    return v == null ? '' : String(v).toLowerCase();
  };
  const auto = h ? texto(h.get('auto-submitted')) : '';
  if (auto && auto !== 'no') return true;
  if (h?.get('x-autoreply') != null || h?.get('x-autorespond') != null) return true;
  const prec = h ? texto(h.get('precedence') ?? h.get('x-precedence')) : '';
  if (['auto_reply', 'bulk', 'junk'].includes(prec.trim())) return true;
  const de = parsed.from?.value?.[0]?.address?.toLowerCase() ?? '';
  if (/^(mailer-daemon|postmaster)@/.test(de)) return true;
  // Return-Path vazio e a marca canonica de bounce (RFC 3464).
  if (h && texto(h.get('return-path')) === '<>') return true;
  return false;
}
