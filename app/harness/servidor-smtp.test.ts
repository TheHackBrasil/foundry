// SMTP sink: recebe e-mail enviado pelo remetente REAL do sistema
// (criarRemetente de server/smtp.ts, nodemailer) sem auth e sem TLS.

import { describe, expect, it } from 'vitest';
import { criarRemetente } from '../server/smtp.js';
import { criarServidorSmtp } from './servidor-smtp.js';
import { lerCobranca } from './mensagens.js';

const PEDIDO = '35260211222333000181550010000048211000004821';

describe('servidor-smtp', () => {
  it('captura mensagem enviada pelo nodemailer do sistema', async () => {
    const srv = await criarServidorSmtp({ porta: 0 });
    try {
      const remetente = criarRemetente({
        host: '127.0.0.1',
        port: srv.porta(),
        from: 'sistema@forseti.local',
        dominio: 'forseti.local',
        timeoutMs: 5_000,
      });
      await remetente.enviar({
        para: 'ops@transp-sim.dev',
        assunto: `Status de entrega - NF-e ${PEDIDO}`,
        corpo: `Sobre a entrega referente a NF-e ${PEDIDO}: qual a previsao?`,
        messageId: '<cobranca.1.1.0123456789abcdef@forseti.local>',
        de: 'sistema@forseti.local',
      });
      expect(srv.recebidas).toHaveLength(1);
      const env = srv.recebidas[0]!;
      expect(env.de).toBe('sistema@forseti.local');
      expect(env.para).toEqual(['ops@transp-sim.dev']);
      const cb = await lerCobranca(env.de, env.para, env.raw);
      expect(cb.pedidoId).toBe(PEDIDO);
      expect(cb.lida.cabecalho.messageId).toBe('<cobranca.1.1.0123456789abcdef@forseti.local>');
    } finally {
      await srv.encerrar();
    }
  });
});
