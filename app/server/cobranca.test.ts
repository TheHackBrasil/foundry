// Cobranca de status a transportadora (spec 0010): ciclo de vida, envio
// SMTP injetado, resposta .eml virando claim status_declarado com selo
// DKIM, matching por In-Reply-To e por chave de 44 digitos, e as rotas
// /api/cobrancas. E-mail sintetico em transp.dev; chave RSA gerada no
// proprio teste — nenhum dado real. Banco PGlite em memoria.

import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dkimSign } from 'mailauth';
import type { Cobranca } from '../shared/model.js';
import {
  assuntoECorpo,
  criarCobrancaParaPendencia,
  dentroDaJanela,
  enviarCobranca,
} from './cobranca.js';
import { createLiteDb } from './db.js';
import { buildServer } from './index.js';
import { extrairEml } from './ingest/eml.js';
import { processarRespostaEml } from './pipeline.js';
import { CanalSSE } from './sse.js';
import { LedgerStore } from './store.js';
import type { Remetente } from './smtp.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = (f: string): string => readFileSync(join(FIX, f), 'utf8');
const CHAVE = '35260123456789000123550010000000011000000019';
const EMAIL_TRANSP = 'ops@transp.dev';
const CRLF = '\r\n';

// Par RSA do dominio transp.dev para assinar a resposta de teste; o
// resolver DNS falso devolve a chave publica como registro DKIM.
const kp = generateKeyPairSync('rsa', { modulusLength: 2048 });
const DKIM_PRIV = kp.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const DKIM_PUB = kp.publicKey
  .export({ format: 'pem', type: 'spki' })
  .toString()
  .replace(/-----(BEGIN|END) PUBLIC KEY-----|\n/g, '');
const resolverDkim = async (_name: string, rr: string): Promise<unknown> => {
  if (rr === 'TXT') return [[`v=DKIM1; k=rsa; p=${DKIM_PUB}`]];
  const e = new Error('ENOTFOUND') as NodeJS.ErrnoException;
  e.code = 'ENOTFOUND';
  throw e;
};

async function assinarDkim(eml: Buffer): Promise<Buffer> {
  const r = await dkimSign(eml, {
    signatureData: [{ signingDomain: 'transp.dev', selector: 's1', privateKey: DKIM_PRIV }],
  });
  expect(r.errors ?? []).toHaveLength(0);
  return Buffer.concat([Buffer.from(r.signatures), eml]);
}

// Resposta .eml da transportadora: texto puro, sem anexo.
function emlResposta(opts: { inReplyTo?: string; corpo?: string; assunto?: string }): Buffer {
  return Buffer.from(
    [
      `From: Ops Transportadora <${EMAIL_TRANSP}>`,
      'To: sistema@foundry.dev',
      `Subject: ${opts.assunto ?? 'Re: Status de entrega'}`,
      'Message-ID: <resp-1@transp.dev>',
      ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
      '',
      opts.corpo ?? 'entrega prevista para 30/01, em transito',
    ].join(CRLF),
  );
}

async function storeNova(workspace: string) {
  const db = await createLiteDb();
  const store = new LedgerStore(db, workspace);
  await store.init();
  // O pedido existe: cobranca e claim presupodem a NF-e gravada.
  await store.append(CHAVE, 'nfe', {
    fonte: 'nfe',
    campos: { status: 'emitida', previsaoEntrega: '2026-01-30' },
    dados: {},
  });
  return store;
}

async function contatoEmail(store: LedgerStore) {
  await store.upsertContato({
    parte: 'transportadora',
    nome: 'Ops Transp',
    canal: 'email',
    destino: EMAIL_TRANSP,
    fonte: 'manual',
  });
}

describe('spec 0010: ciclo de vida da cobranca', () => {
  it('nasce pendente com destinatario da agenda e e idempotente por pedido', async () => {
    const store = await storeNova('ws-cob-1');
    await contatoEmail(store);
    const a = await criarCobrancaParaPendencia(store, CHAVE, 72);
    expect(a.criada).toBe(true);
    expect(a.cobranca.status).toBe('pendente');
    expect(a.cobranca.destinatario).toBe(EMAIL_TRANSP);
    const b = await criarCobrancaParaPendencia(store, CHAVE, 72);
    expect(b.criada).toBe(false);
    expect(b.cobranca.id).toBe(a.cobranca.id);
  });

  it('sem canal de e-mail na agenda nasce pendente_envio com motivo visivel', async () => {
    const store = await storeNova('ws-cob-2');
    const r = await criarCobrancaParaPendencia(store, CHAVE, 72);
    const atual = await store.cobrancaPorId(r.cobranca.id);
    expect(r.criada).toBe(true);
    expect(atual?.destinatario).toBeUndefined();
  });

  it('envio sem SMTP marca pendente_envio; com remetente, enviada + Message-Id', async () => {
    const store = await storeNova('ws-cob-3');
    await contatoEmail(store);
    const { cobranca } = await criarCobrancaParaPendencia(store, CHAVE, 72);

    delete process.env['SMTP_HOST'];
    delete process.env['SMTP_FROM'];
    const semSmtp = await enviarCobranca(store, cobranca, null);
    expect(semSmtp.ok).toBe(false);
    expect(semSmtp.status).toBe('pendente_envio');

    const enviadas: Array<{ para: string; assunto: string; messageId: string }> = [];
    const remetenteFalso: Remetente = {
      async enviar(m) {
        enviadas.push(m);
      },
    };
    process.env['SMTP_HOST'] = 'smtp.teste.dev';
    process.env['SMTP_FROM'] = 'sistema@foundry.dev';
    try {
      const comSmtp = await enviarCobranca(store, cobranca, remetenteFalso);
      expect(comSmtp.ok).toBe(true);
      expect(enviadas).toHaveLength(1);
      expect(enviadas[0]!.para).toBe(EMAIL_TRANSP);
      expect(enviadas[0]!.assunto).toContain(CHAVE);
      const atual = (await store.cobrancaPorId(cobranca.id))!;
      expect(atual.status).toBe('enviada');
      expect(atual.messageId).toBe(enviadas[0]!.messageId);
      expect(atual.messageId).toMatch(/^<.+@smtp\.teste\.dev>$/);
    } finally {
      delete process.env['SMTP_HOST'];
      delete process.env['SMTP_FROM'];
    }
  });

  it('janela anti-spam usa o ultimo envio', () => {
    const base = { enviadaEm: new Date().toISOString() } as Cobranca;
    expect(dentroDaJanela(base, 24)).toBe(true);
    const velha = { enviadaEm: new Date(Date.now() - 25 * 3_600_000).toISOString() } as Cobranca;
    expect(dentroDaJanela(velha, 24)).toBe(false);
    expect(dentroDaJanela({} as Cobranca, 24)).toBe(false);
  });

  it('assunto do servidor carrega a chave de 44 digitos para matching', () => {
    const { assunto, corpo } = assuntoECorpo(CHAVE);
    expect(assunto).toContain(CHAVE);
    expect(corpo).toContain(CHAVE);
  });
});

describe('spec 0010: resposta vira claim verificavel', () => {
  let store: LedgerStore;
  let canal: CanalSSE;
  let cobranca: Cobranca;
  const MSG_ID = '<cobranca-1@foundry.dev>';

  beforeAll(async () => {
    store = await storeNova('ws-cob-resp');
    canal = new CanalSSE();
    await contatoEmail(store);
    const r = await criarCobrancaParaPendencia(store, CHAVE, 72);
    cobranca = r.cobranca;
    // Marca como enviada com Message-Id conhecido: e a ponte do In-Reply-To.
    await store.atualizarCobranca(cobranca.id, { status: 'enviada', messageId: MSG_ID });
    cobranca = (await store.cobrancaPorId(cobranca.id))!;
  });

  const extratorAlto = async () => ({
    campos: { previsaoEntrega: '2026-02-01', status: 'em_transito' as const },
    confianca: 0.9,
  });

  it('resposta com DKIM valido e confianca alta vira claim status_declarado', async () => {
    const raw = await assinarDkim(emlResposta({ inReplyTo: MSG_ID }));
    const lido = await extrairEml(raw);
    const ok = await processarRespostaEml(store, canal, raw, lido, {
      extrator: extratorAlto,
      resolverDkim,
    });
    expect(ok).toBe(true);

    const eventos = await store.eventosDoPedido(CHAVE);
    const claim = eventos.find((e) => e.tipo === 'status_declarado')!;
    expect(claim).toBeTruthy();
    const dados = claim.payload['dados'] as Record<string, unknown>;
    expect(dados['dkim']).toBe('pass');
    expect(dados['dkimAssinante']).toBe('transp.dev');
    expect(dados['cobrancaId']).toBe(cobranca.id);
    expect(dados['remetente']).toBe(EMAIL_TRANSP);
    expect(dados['emlHash']).toMatch(/^[0-9a-f]{64}$/);
    // A evidencia bruta fica enderecada pelo hash: fora circula so ele.
    expect(await store.evidencia(dados['emlHash'] as string)).not.toBeNull();

    // A cobranca fecha ao receber a resposta.
    expect((await store.cobrancaPorId(cobranca.id))!.status).toBe('respondida');
  });

  it('resposta sem assinatura DKIM vai para revisao, nao vira claim', async () => {
    const store2 = await storeNova('ws-cob-sem-dkim');
    await contatoEmail(store2);
    const r = await criarCobrancaParaPendencia(store2, CHAVE, 72);
    await store2.atualizarCobranca(r.cobranca.id, { status: 'enviada', messageId: '<c2@foundry.dev>' });

    const raw = emlResposta({ inReplyTo: '<c2@foundry.dev>' });
    const lido = await extrairEml(raw);
    const ok = await processarRespostaEml(store2, new CanalSSE(), raw, lido, {
      extrator: extratorAlto,
      resolverDkim,
    });
    expect(ok).toBe(true);
    const eventos = await store2.eventosDoPedido(CHAVE);
    expect(eventos.every((e) => e.tipo !== 'status_declarado')).toBe(true);
    const fila = await store2.listarRevisao();
    expect(fila).toHaveLength(1);
    expect(fila[0]!['motivo']).toBe('dkim_nao_verificado');
    expect((await store2.cobrancaPorId(r.cobranca.id))!.status).toBe('respondida');
  });

  it('sem In-Reply-To, a chave de 44 digitos no corpo ainda acha a cobranca aberta', async () => {
    const store3 = await storeNova('ws-cob-chave');
    await contatoEmail(store3);
    const r = await criarCobrancaParaPendencia(store3, CHAVE, 72);
    await store3.atualizarCobranca(r.cobranca.id, { status: 'enviada', messageId: '<c3@foundry.dev>' });

    const raw = await assinarDkim(
      emlResposta({ corpo: `Sobre a NF ${CHAVE}: entrega prevista 02/02, em transito.` }),
    );
    const lido = await extrairEml(raw);
    const ok = await processarRespostaEml(store3, new CanalSSE(), raw, lido, {
      extrator: extratorAlto,
      resolverDkim,
    });
    expect(ok).toBe(true);
    const eventos = await store3.eventosDoPedido(CHAVE);
    expect(eventos.some((e) => e.tipo === 'status_declarado')).toBe(true);
  });

  it('e-mail que nao responde cobranca conhecida devolve false (fluxo generico)', async () => {
    const raw = emlResposta({ inReplyTo: '<ninguem@outro.dev>', corpo: 'bom dia, segue tabela' });
    const lido = await extrairEml(raw);
    expect(await processarRespostaEml(store, new CanalSSE(), raw, lido)).toBe(false);
  });
});

describe('spec 0010: rotas /api/cobrancas', () => {
  let s: Awaited<ReturnType<typeof buildServer>>;
  let cookie = '';
  let ws = '';
  let cobrancaId = 0;

  beforeAll(async () => {
    s = await buildServer(await createLiteDb());
    await s.app.ready();
    const res = await s.app.inject({ method: 'GET', url: '/api/pedidos' });
    const bruto = res.headers['set-cookie'];
    cookie = (Array.isArray(bruto) ? String(bruto[0]) : String(bruto)).split(';')[0]!;
    ws = cookie.split('=')[1]!;

    // Pedido da sessao + contato de e-mail na agenda.
    await s.app.inject({
      method: 'POST',
      url: '/api/ingest',
      headers: { cookie },
      payload: { nome: 'nfe-ok.xml', conteudoBase64: Buffer.from(ler('nfe-ok.xml')).toString('base64') },
    });
    await s.app.inject({
      method: 'PUT',
      url: '/api/contatos',
      headers: { cookie },
      payload: { parte: 'transportadora', nome: 'Ops Transp', canal: 'email', destino: EMAIL_TRANSP },
    });
    const sessao = s.store.paraWorkspace(ws);
    const r = await criarCobrancaParaPendencia(sessao, CHAVE, 72);
    cobrancaId = r.cobranca.id;
  });

  afterAll(async () => {
    await s.app.close();
  });

  it('GET lista a cobranca da sessao', async () => {
    const r = await s.app.inject({ method: 'GET', url: '/api/cobrancas', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const { cobrancas } = r.json() as { cobrancas: Cobranca[] };
    expect(cobrancas.some((c) => c.id === cobrancaId)).toBe(true);
  });

  it('POST enviar sem SMTP responde 503 e marca pendente_envio', async () => {
    delete process.env['SMTP_HOST'];
    delete process.env['SMTP_FROM'];
    const r = await s.app.inject({
      method: 'POST',
      url: `/api/cobrancas/${cobrancaId}/enviar`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(503);
    const corpo = r.json() as { cobranca: Cobranca };
    expect(corpo.cobranca.status).toBe('pendente_envio');
  });

  it('POST enviar em cobranca ja respondida responde 409', async () => {
    const sessao = s.store.paraWorkspace(ws);
    await sessao.atualizarCobranca(cobrancaId, { respondida: true });
    const r = await s.app.inject({
      method: 'POST',
      url: `/api/cobrancas/${cobrancaId}/enviar`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(409);
  });

  it('POST enviar dentro da janela anti-spam responde 409', async () => {
    const sessao = s.store.paraWorkspace(ws);
    // Uma segunda cobranca enviada agora: reenviar na hora bate na janela.
    const r2 = await sessao.criarCobrancaPendente(
      '35260100000000000100550010000099991000099991',
      null,
      EMAIL_TRANSP,
      new Date(Date.now() + 72 * 3_600_000),
    );
    await sessao.atualizarCobranca(r2.cobranca.id, { status: 'enviada', messageId: '<j@x.dev>' });
    const r = await s.app.inject({
      method: 'POST',
      url: `/api/cobrancas/${r2.cobranca.id}/enviar`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(409);
    expect(r.body).toContain('anti-spam');
  });

  it('POST enviar em id desconhecido responde 404', async () => {
    const r = await s.app.inject({
      method: 'POST',
      url: '/api/cobrancas/999999/enviar',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
  });

  it('POST /api/simulate com pendenciaHoras mostra pendencia e cobranca sugerida', async () => {
    // T431: "e se o pedido ficar 48h sem evento?" — a deteccao real roda
    // com o relogio adiantado e nada grava.
    const r = await s.app.inject({
      method: 'POST',
      url: '/api/simulate',
      headers: { cookie },
      payload: { pedidoId: CHAVE, pendenciaHoras: 48 },
    });
    expect(r.statusCode).toBe(200);
    const corpo = r.json() as {
      simulacao: boolean;
      pendencias: Array<{ motivo: string }>;
      cobrancaSugerida: { destinatario: string | null; assunto: string };
    };
    expect(corpo.simulacao).toBe(true);
    expect(corpo.pendencias.map((p) => p.motivo)).toContain('sem_atualizacao');
    expect(corpo.cobrancaSugerida.destinatario).toBe(EMAIL_TRANSP);
    expect(corpo.cobrancaSugerida.assunto).toContain(CHAVE);
    // Simulacao nao persiste: nem pendencia nem cobranca nova nascem.
    const sessao = s.store.paraWorkspace(ws);
    expect(await sessao.pendenciaExiste(CHAVE, 'sem_atualizacao')).toBe(false);

    // Sem campos nem pendenciaHoras, o contrato antigo responde 400.
    const vazio = await s.app.inject({
      method: 'POST',
      url: '/api/simulate',
      headers: { cookie },
      payload: { pedidoId: CHAVE },
    });
    expect(vazio.statusCode).toBe(400);
    const invalido = await s.app.inject({
      method: 'POST',
      url: '/api/simulate',
      headers: { cookie },
      payload: { pedidoId: CHAVE, pendenciaHoras: -1 },
    });
    expect(invalido.statusCode).toBe(400);
  });

  it('resposta .eml pelo /api/ingest fecha a cobranca e abre revisao sem DKIM', async () => {
    const sessao = s.store.paraWorkspace(ws);
    const r3 = await sessao.criarCobrancaPendente(
      '35260100000000000100550010000099993000099993',
      null,
      EMAIL_TRANSP,
      new Date(Date.now() + 72 * 3_600_000),
    );
    await sessao.atualizarCobranca(r3.cobranca.id, { status: 'enviada', messageId: '<r3@foundry.dev>' });

    const raw = emlResposta({ inReplyTo: '<r3@foundry.dev>' });
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/ingest',
      headers: { cookie },
      payload: { nome: 'resposta.eml', conteudoBase64: raw.toString('base64') },
    });
    expect(res.statusCode).toBe(200);
    const atual = (await sessao.cobrancaPorId(r3.cobranca.id))!;
    expect(atual.status).toBe('respondida');
    // Sem DKIM e sem LLM no teste: revisao, nunca claim silencioso.
    const fila = await sessao.listarRevisao();
    expect(fila.some((i) => i['motivo'] === 'dkim_nao_verificado')).toBe(true);
  });
});
