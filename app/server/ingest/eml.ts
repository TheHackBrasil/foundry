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
