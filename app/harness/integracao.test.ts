// Loop ponta a ponta da transportadora simulada contra o sistema real:
// cobranca sai por enviarCobranca -> nodemailer -> SMTP sink -> persona ->
// .eml composto -> processarRespostaEml real. Prova: threading fecha so a
// cobranca certa e o roteiro evasivo gera divergencia de previsaoEntrega na
// projecao. PGlite em memoria; nenhum dado real.

import { generateKeyPairSync } from 'node:crypto';
import { dkimSign } from 'mailauth';
import { describe, expect, it } from 'vitest';
import { projetar } from '../shared/projection.js';
import { criarCobrancaParaPendencia, enviarCobranca } from '../server/cobranca.js';
import { createLiteDb } from '../server/db.js';
import { extrairEml } from '../server/ingest/eml.js';
import { processarRespostaEml, type DepsResposta } from '../server/pipeline.js';
import { CanalSSE } from '../server/sse.js';
import { criarRemetente } from '../server/smtp.js';
import { LedgerStore } from '../server/store.js';
import { comporResposta, lerCobranca } from './mensagens.js';
import { EstadoPersonas, dataRelativa, decidir } from './personas.js';
import { roteiro } from './cenarios.js';
import { criarServidorSmtp } from './servidor-smtp.js';

const PEDIDO = '35260211222333000181550010000048211000004821';
const EMAIL_TRANSP = 'ops@transp-sim.dev';

// DKIM assinado no proprio teste com resolver falso: prova o caminho de
// confianca alta; ao vivo, sem DNS, a resposta vai para a revisao (RF9).
const kp = generateKeyPairSync('rsa', { modulusLength: 2048 });
const DKIM_PRIV = kp.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const DKIM_PUB = kp.publicKey
  .export({ format: 'pem', type: 'spki' })
  .toString()
  .replace(/-----(BEGIN|END) PUBLIC KEY-----|\n/g, '');
const resolverDkim = async (_n: string, rr: string): Promise<unknown> => {
  if (rr === 'TXT') return [[`v=DKIM1; k=rsa; p=${DKIM_PUB}`]];
  const e = new Error('ENOTFOUND') as NodeJS.ErrnoException;
  e.code = 'ENOTFOUND';
  throw e;
};
const assinarDkim = async (eml: Buffer): Promise<Buffer> => {
  const r = await dkimSign(eml, {
    signatureData: [{ signingDomain: 'transp-sim.dev', selector: 's1', privateKey: DKIM_PRIV }],
  });
  return Buffer.concat([Buffer.from(r.signatures), eml]);
};

// Extrator fiel ao que a LLM devolveria ao ler "previsao DD/MM/AAAA".
const extrator = async (corpo: string) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(corpo);
  if (!m) return { campos: {}, confianca: 0.5 };
  return {
    campos: { previsaoEntrega: `${m[3]}-${m[2]}-${m[1]}`, status: 'em_transito' as const },
    confianca: 0.9,
  };
};

async function storeNova(): Promise<LedgerStore> {
  const store = new LedgerStore(await createLiteDb(), 'ws-demo');
  await store.init();
  // Pedido com previsao antiga declarada pela NF-e: a divergencia nasce da
  // comparacao com o que a transportadora declara depois.
  await store.append(PEDIDO, 'nfe', {
    fonte: 'nfe',
    campos: { status: 'emitida', previsaoEntrega: '2026-01-30' },
    dados: {},
  });
  await store.upsertContato({
    parte: 'transportadora',
    nome: 'Ops Sim',
    canal: 'email',
    destino: EMAIL_TRANSP,
    fonte: 'manual',
  });
  return store;
}

describe('integracao: loop real SMTP -> persona -> resposta .eml', () => {
  it('evasiva: 1a cobranca enrola, 2a diverge e aparece na projecao', async () => {
    const store = await storeNova();
    const canal = new CanalSSE();
    const smtp = await criarServidorSmtp({ porta: 0 });
    const r = roteiro('evasiva');
    const estado = new EstadoPersonas();
    const deps: DepsResposta = { extrator, resolverDkim };

    // Idem ao harness.ts: cobranca real -> SMTP sink -> persona -> .eml.
    const rodarCobranca = async (): Promise<{ eml: Buffer; cobrancaId: number }> => {
      const { cobranca } = await criarCobrancaParaPendencia(store, PEDIDO, 72);
      const cfg = {
        host: '127.0.0.1',
        port: smtp.porta(),
        from: 'sistema@forseti.local',
        dominio: 'forseti.local',
        timeoutMs: 5_000,
      };
      const envio = await enviarCobranca(store, cobranca, criarRemetente(cfg), cfg);
      expect(envio.ok).toBe(true);
      const env = smtp.recebidas.at(-1)!;
      const cb = await lerCobranca(env.de, env.para, env.raw);
      expect(cb.pedidoId).toBe(PEDIDO);
      const sequencia = estado.proximaSequencia(cb.pedidoId!);
      const decisao = decidir(r, { sequencia, pedidoId: cb.pedidoId, agora: new Date() });
      if (decisao.tipo !== 'responder') throw new Error('esperava resposta');
      const resp = comporResposta({
        de: r.remetente,
        para: env.de,
        assuntoOriginal: cb.lida.cabecalho.assunto,
        inReplyTo: cb.lida.cabecalho.messageId,
        references: cb.lida.cabecalho.references,
        corpo: decisao.corpo,
        dominio: r.dominio,
        sequencia,
      });
      return { eml: await assinarDkim(resp.raw), cobrancaId: cobranca.id };
    };

    try {
      // 1a cobranca: a resposta evasiva fecha a cobranca e vai para revisao
      // (sem campos declarados, mesmo com DKIM).
      const c1 = await rodarCobranca();
      const lida1 = await extrairEml(c1.eml);
      expect(lida1.corpo).toContain('verificar');
      expect(await processarRespostaEml(store, canal, c1.eml, lida1, deps)).toBe(true);
      expect((await store.cobrancaPorId(c1.cobrancaId))!.status).toBe('respondida');
      expect(await store.listarRevisao()).toHaveLength(1);

      // 2a cobranca (segundo caso de pendencia na demo): resposta otimista
      // declara hoje+2 e diverge da NF-e (2026-01-30).
      const c2 = await rodarCobranca();
      expect(c2.cobrancaId).not.toBe(c1.cobrancaId);
      const lida2 = await extrairEml(c2.eml);
      expect(lida2.corpo).toContain('em transito');
      expect(await processarRespostaEml(store, canal, c2.eml, lida2, deps)).toBe(true);
      expect((await store.cobrancaPorId(c2.cobrancaId))!.status).toBe('respondida');

      const eventos = await store.eventosDoPedido(PEDIDO);
      const claim = eventos.find((e) => e.tipo === 'status_declarado');
      expect(claim).toBeTruthy();
      // A previsao declarada e hoje+2 (livro otimista do roteiro).
      expect((claim!.payload['campos'] as { previsaoEntrega?: string }).previsaoEntrega).toBe(
        dataRelativa(new Date(), r.declarado.previsaoDias).iso,
      );

      const proj = projetar(eventos);
      const div = proj.divergencias.find((d) => d.campo === 'previsaoEntrega');
      expect(div).toBeTruthy();
      expect([div!.fonteA, div!.fonteB]).toContain('email_transportadora');

      // Resposta com Message-ID desconhecido nao fecha nada (threading).
      const emlErrada = comporResposta({
        de: r.remetente,
        para: 'sistema@forseti.local',
        assuntoOriginal: 'oi',
        inReplyTo: '<ninguem@outro.dev>',
        corpo: 'texto qualquer',
        dominio: r.dominio,
        sequencia: 9,
      });
      const lidaErrada = await extrairEml(emlErrada.raw);
      expect(await processarRespostaEml(store, canal, emlErrada.raw, lidaErrada, deps)).toBe(false);
    } finally {
      await smtp.encerrar();
    }
  });
});
