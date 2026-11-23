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

export interface EmlLido {
  anexos: AnexoEml[];
  // Corpo de texto da mensagem: so alimenta a extracao de sinais (T140) e
  // nunca vai para o ledger, para a fila nem para o log (RF27).
  corpo: string;
}

export async function extrairEml(conteudo: Buffer): Promise<EmlLido> {
  let parsed;
  try {
    parsed = await simpleParser(conteudo);
  } catch (e) {
    throw new ErroParser(`EML: mensagem malformada (${(e as Error).message})`);
  }
  const anexos = parsed.attachments
    .filter((a) => a.filename && ANEXO_OK.test(a.filename))
    .map((a) => ({ nome: a.filename as string, conteudo: a.content }));
  if (anexos.length === 0) {
    throw new ErroParser('EML: sem anexo elegivel (.xml/.csv/.xlsx/.pdf)');
  }
  const corpo = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  return { anexos, corpo };
}
