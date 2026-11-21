// Upload de .eml (spec 0004, RF28, D-021): o e-mail entra como formato,
// sem credencial nem caixa postal. Devolve so os anexos aproveitaveis;
// o resto da mensagem nao sai daqui. Cabecalhos (From, To, Subject,
// Message-ID...) trazem endereco de pessoa e nao podem ir para log,
// payload, erro nem tela (RF27): este modulo nunca os le nem os repete.
// A entrada e nao confiavel (a demo recebe arquivo de qualquer visitante).

import { simpleParser, type ParsedMail } from 'mailparser';
import { detectarTipo, pareceMensagemMime, type TipoDoc } from './detect.js';
import { ErroParser } from './nfe.js';

export const MAX_ANEXOS = 10;
// Abaixo do teto de 10 MB do upload (index.ts), para o limite valer de fato:
// um anexo nunca e maior que o e-mail que o carrega.
export const MAX_BYTES_ANEXO = 5 * 1024 * 1024;

export interface AnexoEml {
  nome: string;
  conteudo: Buffer;
}

const EXT_ACEITA = new Set(['xml', 'csv', 'xlsx', 'pdf']);
const EXT_POR_MIME: Record<string, string> = {
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/csv': 'csv',
  'application/csv': 'csv',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

// NF-e cria o pedido; CT-e e eventos so se ligam a um pedido que ja existe.
// Mesma ordem do seed: o anexo da NF-e vai primeiro, senao o CT-e do mesmo
// e-mail cairia na fila de revisao.
const PRIORIDADE_TIPO: Partial<Record<TipoDoc, number>> = {
  nfe: 0,
  cte: 1,
  eventoNFe: 2,
  csv: 3,
  xlsx: 3,
  pdf: 4,
};

const ERRO_MALFORMADA = 'E-mail (.eml): mensagem malformada ou ilegivel';

function extensaoDoAnexo(filename: string | undefined, contentType: string): string | null {
  const nome = filename ?? '';
  const i = nome.lastIndexOf('.');
  const ext = i >= 0 ? nome.slice(i + 1).toLowerCase() : '';
  if (EXT_ACEITA.has(ext)) return ext;
  return EXT_POR_MIME[contentType.toLowerCase().split(';')[0]!.trim()] ?? null;
}

export async function extrairAnexos(conteudo: Buffer): Promise<AnexoEml[]> {
  let msg: ParsedMail;
  try {
    // So os anexos interessam: nada de converter corpo em texto ou HTML,
    // nem embutir imagem inline como data URL.
    msg = await simpleParser(conteudo, {
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipTextLinks: true,
      skipImageLinks: true,
      checksumAlgo: false,
    });
  } catch {
    // Mensagem fixa: o texto do erro do parser pode trazer pedaco da mensagem.
    throw new ErroParser(ERRO_MALFORMADA);
  }
  // Arquivo que nao e mensagem (sem nenhum cabecalho) nao deve virar "sem anexo".
  if (msg.headers.size === 0) throw new ErroParser(ERRO_MALFORMADA);
  const anexos = msg.attachments;

  // E-mail dentro de e-mail e rejeitado antes do filtro: sem recursao, e
  // para o usuario nao achar que o anexo aninhado foi lido e ficou de fora.
  for (const a of anexos) {
    const ext = (a.filename ?? '').toLowerCase().endsWith('.eml');
    const mime = a.contentType.toLowerCase().startsWith('message/rfc822');
    if (ext || mime || pareceMensagemMime(a.content.subarray(0, 2048).toString('utf8'))) {
      throw new ErroParser('E-mail (.eml): anexo que e outro e-mail nao e aceito, envie o .eml original com os documentos em anexo');
    }
  }

  const aproveitaveis = anexos.flatMap((a) => {
    if (a.related || a.contentType.toLowerCase().startsWith('image/')) return [];
    if (a.content.length === 0) return [];
    const ext = extensaoDoAnexo(a.filename, a.contentType);
    return ext ? [{ ext, conteudo: a.content }] : [];
  });

  if (aproveitaveis.length === 0) {
    throw new ErroParser('E-mail (.eml): nenhum anexo aproveitavel (esperado .xml, .csv, .xlsx ou .pdf)');
  }
  if (aproveitaveis.length > MAX_ANEXOS) {
    throw new ErroParser(`E-mail (.eml): ${aproveitaveis.length} anexos aproveitaveis, o maximo e ${MAX_ANEXOS}`);
  }

  // Nome sintetico: o nome original pode carregar nome de pessoa e nunca
  // chega ao pipeline, ao ledger nem a uma mensagem de erro.
  const nomeados = aproveitaveis.map((a, i) => {
    if (a.conteudo.length > MAX_BYTES_ANEXO) {
      throw new ErroParser(`E-mail (.eml): o anexo ${i + 1} passa de ${MAX_BYTES_ANEXO / (1024 * 1024)} MB, o limite por anexo`);
    }
    return { nome: `anexo-${i + 1}.${a.ext}`, conteudo: a.conteudo };
  });

  // Tipo reconhecido antes de gravar qualquer coisa: anexo de tipo
  // desconhecido derruba o e-mail inteiro com 422, sem ingestao parcial.
  const comPrioridade = nomeados.map((a) => ({
    a,
    prioridade: PRIORIDADE_TIPO[detectarTipo(a.nome, a.conteudo)] ?? 9,
  }));
  return comPrioridade.sort((x, y) => x.prioridade - y.prioridade).map((x) => x.a);
}
