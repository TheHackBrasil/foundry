// Parser de mensagem .eml (spec 0004, T029/RF28): desembrulha anexos
// .xml/.csv/.xlsx/.pdf para o mesmo pipeline do upload. Cabecalho nao
// e registrado em lugar nenhum (RF27).

import { simpleParser } from 'mailparser';
import { ErroParser } from './nfe.js';

const ANEXO_OK = /\.(xml|csv|xlsx|pdf)$/i;

export interface AnexoEml {
  nome: string;
  conteudo: Buffer;
}

export async function extrairAnexosEml(conteudo: Buffer): Promise<AnexoEml[]> {
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
  return anexos;
}
