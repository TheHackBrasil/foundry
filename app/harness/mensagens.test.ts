// Composicao de .eml: a resposta montada passa pelo parser REAL do sistema
// (server/ingest/eml.ts) e sai com threading, corpo decodificado e flag de
// resposta-automatica desligada. Dados sinteticos, dominio transp-sim.dev.

import { describe, expect, it } from 'vitest';
import { assuntoECorpo } from '../server/cobranca.js';
import { extrairEml } from '../server/ingest/eml.js';
import { comporResposta, lerCobranca, quotedPrintable } from './mensagens.js';

const PEDIDO = '35260211222333000181550010000048211000004821';
const MSGID_COBRANCA = '<cobranca.7.1.abcdef0123456789@forseti.local>';

// Cobranca como o servidor a monta: assunto fixo + Message-ID gravado.
function emlCobranca(): Buffer {
  const { assunto, corpo } = assuntoECorpo(PEDIDO);
  return Buffer.from(
    [
      'From: sistema@forseti.local',
      'To: ops@transp-sim.dev',
      `Subject: ${assunto}`,
      `Message-ID: ${MSGID_COBRANCA}`,
      '',
      corpo,
    ].join('\r\n'),
  );
}

describe('lerCobranca', () => {
  it('extrai pedidoId, message-id e assunto pelo parser real', async () => {
    const cb = await lerCobranca('sistema@forseti.local', ['ops@transp-sim.dev'], emlCobranca());
    expect(cb.pedidoId).toBe(PEDIDO);
    expect(cb.lida.cabecalho.messageId).toBe(MSGID_COBRANCA);
    expect(cb.lida.cabecalho.assunto).toContain(PEDIDO);
  });
});

describe('comporResposta', () => {
  it('threading casa com a cobranca e o corpo sobrevive ao parser real', async () => {
    const resp = comporResposta({
      de: 'Ops Rodovia <ops@transp-sim.dev>',
      para: 'sistema@forseti.local',
      assuntoOriginal: `Status de entrega - NF-e ${PEDIDO}`,
      inReplyTo: MSGID_COBRANCA,
      references: [],
      corpo: 'Ola,\n\na carga segue em transito, previsao de entrega 30/11/2026.\nacentos: trânsito, previsão, coração.',
      dominio: 'transp-sim.dev',
      sequencia: 1,
      data: new Date('2026-11-28T15:00:00Z'),
    });
    const lida = await extrairEml(resp.raw);
    expect(lida.cabecalho.inReplyTo).toBe(MSGID_COBRANCA);
    expect(lida.cabecalho.references).toContain(MSGID_COBRANCA);
    expect(lida.cabecalho.remetente).toBe('ops@transp-sim.dev');
    expect(lida.cabecalho.assunto).toBe(`Re: Status de entrega - NF-e ${PEDIDO}`);
    expect(lida.cabecalho.automatica).toBe(false); // nunca resposta automatica
    expect(lida.corpo).toContain('em transito');
    expect(lida.corpo).toContain('30/11/2026');
    expect(lida.corpo).toContain('trânsito'); // quoted-printable decodificado
    expect(lida.corpo).toContain('previsão');
    // A7: rotulada como simulacao no cabecalho da mensagem.
    expect(resp.raw.toString('utf8')).toContain('X-Forseti-Simulacao: harness');
    expect(resp.messageId).toMatch(/^<resp\.1\.[0-9a-f]{12}@transp-sim\.dev>$/);
  });

  it('quoted-printable escapa =, acentos e quebra linha longa', () => {
    const qp = quotedPrintable('a=b ção ' + 'x'.repeat(120));
    expect(qp).toContain('a=3Db');
    expect(qp).toContain('=C3=A7=C3=A3o');
    for (const l of qp.split('\r\n')) expect(l.length).toBeLessThanOrEqual(76);
  });
});
