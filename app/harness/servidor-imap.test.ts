// Caixa IMAP TLS: prova contra o cliente REAL do sistema (ImapFlow). A
// sequencia replica coletarEIngerir de server/ingest/imap.ts verbatim:
// getMailboxLock -> fetch({seen:false, since}, {source, uid}) -> flagsAdd.
// Em teste, tls.rejectUnauthorized=false substitui o NODE_EXTRA_CA_CERTS
// que o app usaria em producao (env, sem mudanca de codigo).

import { ImapFlow } from 'imapflow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extrairEml } from '../server/ingest/eml.js';
import { comporResposta } from './mensagens.js';
import { criarServidorImap, type ServidorImap } from './servidor-imap.js';
import { garantirCertificado } from './tls-dev.js';

const PEDIDO = '35260211222333000181550010000048211000004821';

let srv: ServidorImap;

function cliente(): ImapFlow {
  const c = new ImapFlow({
    host: 'localhost',
    port: srv.porta(),
    secure: true, // igual ao sistema
    tls: { rejectUnauthorized: false }, // NODE_EXTRA_CA_CERTS fora do teste
    auth: { user: 'caixa', pass: 'caixa' },
    logger: false,
  });
  c.on('error', () => undefined);
  return c;
}

beforeAll(async () => {
  const cert = garantirCertificado();
  srv = await criarServidorImap({ porta: 0, cert: cert.cert, key: cert.key });
  const resp = comporResposta({
    de: 'Ops <ops@transp-sim.dev>',
    para: 'sistema@forseti.local',
    assuntoOriginal: `Status de entrega - NF-e ${PEDIDO}`,
    inReplyTo: '<cobranca.3.1.0123456789abcdef@forseti.local>',
    corpo: 'em transito, entrega prevista para 30/11/2026',
    dominio: 'transp-sim.dev',
    sequencia: 1,
  });
  srv.depositar(resp.raw);
});

afterAll(async () => {
  await srv.encerrar();
});

describe('servidor-imap', () => {
  it('ImapFlow consome a mensagem e marca como lida (fluxo do sistema)', async () => {
    const c = cliente();
    await c.connect();
    try {
      const lock = await c.getMailboxLock('INBOX');
      const fontes: Buffer[] = [];
      let uid = 0;
      try {
        // Mesma chamada de server/ingest/imap.ts.
        for await (const msg of c.fetch({ seen: false, since: new Date() }, { source: true, uid: true })) {
          if (msg.source) {
            fontes.push(msg.source);
            uid = msg.uid;
          }
        }
        await c.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
      } finally {
        lock.release();
      }
      expect(fontes).toHaveLength(1);
      const lida = await extrairEml(fontes[0]!);
      expect(lida.cabecalho.inReplyTo).toBe('<cobranca.3.1.0123456789abcdef@forseti.local>');
      expect(lida.corpo).toContain('em transito');
      // A flag \Seen ficou gravada: novo ciclo nao devolve a mensagem.
      expect(srv.caixa[0]!.visto).toBe(true);
    } finally {
      await c.logout();
    }
  });

  it('segundo ciclo nao devolve mensagem ja lida', async () => {
    const c = cliente();
    await c.connect();
    try {
      const lock = await c.getMailboxLock('INBOX');
      const uids: number[] = [];
      try {
        for await (const msg of c.fetch({ seen: false, since: new Date() }, { source: true, uid: true })) {
          uids.push(msg.uid);
        }
      } finally {
        lock.release();
      }
      expect(uids).toHaveLength(0);
    } finally {
      await c.logout();
    }
  });
});
