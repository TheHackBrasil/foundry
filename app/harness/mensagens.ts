// Composicao de mensagens .eml da transportadora simulada (frente
// harness-transp, spec 0018): resposta a cobranca com threading correto
// (In-Reply-To + References no Message-ID da cobranca), quoted-printable
// pt-BR e rotulo de simulacao (A7). A cobranca recebida e lida pelo parser
// real do sistema (server/ingest/eml.ts): a harness so fala pelas bordas.

import { randomBytes } from 'node:crypto';
import { extrairEml, type EmlLido } from '../server/ingest/eml.js';

const CRLF = '\r\n';

// Mensagem de cobranca capturada pelo servidor-smtp: envelope SMTP mais os
// campos do cabecalho que a persona precisa (thread e pedido).
export interface CobrancaRecebida {
  envelopeDe: string;
  envelopePara: string[];
  raw: Buffer;
  lida: EmlLido;
  // Chave de 44 digitos da NF-e citada no assunto ou no corpo, quando ha.
  pedidoId: string | null;
  recebidaEm: Date;
}

// Le a cobranca capturada pelo parser real. Lanca se o .eml nao abrir.
export async function lerCobranca(
  envelopeDe: string,
  envelopePara: string[],
  raw: Buffer,
): Promise<CobrancaRecebida> {
  const lida = await extrairEml(raw);
  const texto = `${lida.cabecalho.assunto ?? ''}\n${lida.corpo}`;
  const pedidoId = /\b(\d{44})\b/.exec(texto)?.[1] ?? null;
  return { envelopeDe, envelopePara, raw, lida, pedidoId, recebidaEm: new Date() };
}

export interface OpcoesResposta {
  de: string; // From da transportadora, ex.: "Ops <ops@transp-sim.dev>"
  para: string; // remetente da cobranca (envelope MAIL FROM)
  assuntoOriginal: string | undefined;
  inReplyTo: string | undefined; // Message-ID da cobranca
  references?: string[]; // References originais (thread completa)
  corpo: string; // texto puro pt-BR
  dominio: string; // dominio do Message-ID da resposta
  sequencia: number; // sufixo unico por resposta da sessao
  data?: Date;
}

export interface RespostaComposta {
  raw: Buffer;
  messageId: string;
}

// quoted-printable: bytes UTF-8 fora de 33..126 (menos espaco/tab) viram
// =XX, '=' vira =3D e a linha quebra com soft break em 75 colunas.
export function quotedPrintable(texto: string): string {
  const bytes = Buffer.from(texto, 'utf8');
  let linha = '';
  const linhas: string[] = [];
  const empurrar = (token: string): void => {
    if (linha.length + token.length > 75) {
      linhas.push(`${linha}=`);
      linha = '';
    }
    linha += token;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x0d && bytes[i + 1] === 0x0a) {
      linhas.push(linha);
      linha = '';
      i += 1;
      continue;
    }
    if (b === 0x0a) {
      linhas.push(linha);
      linha = '';
      continue;
    }
    const imprimivel = (b >= 0x21 && b <= 0x7e && b !== 0x3d) || b === 0x20 || b === 0x09;
    if (imprimivel) {
      // Espaco ou tab no fim de linha precisa ir escapado.
      const ultimo = i === bytes.length - 1 || bytes[i + 1] === 0x0d || bytes[i + 1] === 0x0a;
      empurrar(ultimo && (b === 0x20 || b === 0x09) ? `=${b.toString(16).toUpperCase().padStart(2, '0')}` : String.fromCharCode(b));
    } else {
      empurrar(`=${b.toString(16).toUpperCase().padStart(2, '0')}`);
    }
  }
  if (linha) linhas.push(linha);
  return linhas.join(CRLF);
}

// Data no formato RFC 2822 ("Fri, 28 Nov 2026 12:00:00 +0000"): toUTCString
// devolve GMT, que o mailparser aceita igual.
function dataRfc2822(d: Date): string {
  return d.toUTCString().replace('GMT', '+0000');
}

// Assunto de resposta: "Re:" uma vez, sem empilhar.
function assuntoRe(original: string | undefined): string {
  const base = (original ?? '').trim() || 'Status de entrega';
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

// Monta o .eml da resposta. O X-Forseti-Simulacao marca a mensagem como
// simulacao sem poluir o corpo (A7): o parser nao guarda cabecalho (RF27),
// mas a evidencia .eml guardada por hash fica distinguivel de um e-mail real.
export function comporResposta(o: OpcoesResposta): RespostaComposta {
  const messageId = `<resp.${o.sequencia}.${randomBytes(6).toString('hex')}@${o.dominio}>`;
  const referencias = [...(o.references ?? []), ...(o.inReplyTo ? [o.inReplyTo] : [])];
  const linhas = [
    `From: ${o.de}`,
    `To: ${o.para}`,
    `Subject: ${assuntoRe(o.assuntoOriginal)}`,
    `Date: ${dataRfc2822(o.data ?? new Date())}`,
    `Message-ID: ${messageId}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`] : []),
    ...(referencias.length > 0 ? [`References: ${referencias.join(' ')}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    'X-Forseti-Simulacao: harness',
    '',
    quotedPrintable(o.corpo),
    '',
  ];
  return { raw: Buffer.from(linhas.join(CRLF), 'utf8'), messageId };
}
