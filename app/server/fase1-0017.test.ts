// Spec 0017, Fase 1 (T712 a T716) e correcoes da revisao: eventos e
// Message-ID da cobranca (RF13), resposta tardia pela caixa IMAP do sistema
// (RF27), nenhum envio paralelo com o operador ativo (RF20), comprovante sem
// dado pessoal (RF25), fechamento pelo motor (RF5), naoContatarIa na rota
// da agenda e log sem contato quando a resposta IMAP falha. PGlite em
// memoria; e-mail e telefone sinteticos (transp.dev, 11 9xxxx-xxxx).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { projetarCasos } from '../shared/casos.js';
import { montarComprovante } from '../shared/comprovante.js';
import { PARTES, type Evento } from '../shared/model.js';
import { criarCobrancaParaPendencia, enviarCobranca, lerMessageIdDaCobranca } from './cobranca.js';
import { createLiteDb } from './db.js';
import { buildServer } from './index.js';
import { extrairEml } from './ingest/eml.js';
import { expirarCobrancasComEvento, verificarWorkspace } from './pendencia.js';
import { aprovarRevisao, ingerir, processarRespostaEml, responderImap } from './pipeline.js';
import type { Remetente } from './smtp.js';
import { CanalSSE } from './sse.js';
import { LedgerStore } from './store.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = (f: string): Buffer => readFileSync(join(FIX, f));
const CHAVE = '35260123456789000123550010000000011000000019';
const EMAIL_TRANSP = 'ops@transp.dev';
const H = 3_600_000;
const CRLF = '\r\n';
const ENVS = [
  'COBRANCA_AUTO',
  'COBRANCA_EXPIRA_HORAS',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_FROM',
  'SMTP_DOMAIN',
  'SMTP_TIMEOUT_MS',
  'NVOIP_NOTIFY_ON_TASK',
  'NVOIP_API_URL',
  'NVOIP_API_KEY',
  'LLM_API_URL',
  'LLM_API_KEY',
  'OPERADOR_ATIVO',
  'OPERADOR_WORKSPACES',
];
const envAntes: Record<string, string | undefined> = {};
for (const k of ENVS) envAntes[k] = process.env[k];

function limparEnv(): void {
  for (const k of ENVS) delete process.env[k];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  limparEnv();
});

beforeAll(() => limparEnv());
afterAll(() => {
  for (const k of ENVS) if (envAntes[k] !== undefined) process.env[k] = envAntes[k];
});

// Resposta sem assinatura DKIM: vai para a revisao, o que basta para provar
// que casou a cobranca. O resolver nunca acha registro.
const resolverDkim = async (): Promise<unknown> => {
  const e = new Error('ENOTFOUND') as NodeJS.ErrnoException;
  e.code = 'ENOTFOUND';
  throw e;
};
const extrator = async () => ({ campos: { status: 'em_transito' as const, previsaoEntrega: '2026-12-01' }, confianca: 0.9 });

function emlResposta(opts: { inReplyTo?: string; corpo?: string }): Buffer {
  return Buffer.from(
    [
      `From: Ops Transportadora <${EMAIL_TRANSP}>`,
      'To: sistema@foundry.dev',
      'Subject: Re: Status de entrega',
      'Message-ID: <resp-0017@transp.dev>',
      ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
      '',
      opts.corpo ?? 'segue em transito, entrega em 01/12',
    ].join(CRLF),
  );
}

async function base(): Promise<LedgerStore> {
  const seed = new LedgerStore(await createLiteDb(), 'seed');
  await seed.init();
  return seed;
}

async function contatoEmail(store: LedgerStore): Promise<void> {
  await store.upsertContato({ parte: 'transportadora', nome: 'Ops Transp', canal: 'email', destino: EMAIL_TRANSP, fonte: 'manual' });
}

async function nfe(store: LedgerStore, ts?: string): Promise<void> {
  await store.append(CHAVE, 'nfe', { fonte: 'nfe', campos: { status: 'emitida' }, dados: {} }, ts);
}

function smtpFalso(): void {
  process.env['SMTP_HOST'] = 'smtp.teste.dev';
  process.env['SMTP_FROM'] = 'sistema@foundry.dev';
}

describe('spec 0017 T712: eventos da cobranca e Message-ID derivado', () => {
  it('Message-ID vem da cobranca e da tentativa, e gravado antes do envio; envio e expiracao viram eventos', async () => {
    const store = (await base()).paraWorkspace('ws-t712');
    await nfe(store);
    await contatoEmail(store);
    const { cobranca } = await criarCobrancaParaPendencia(store, CHAVE, 72);
    smtpFalso();

    const vistos: Array<{ enviado: string; gravado: string | undefined }> = [];
    let falhar = true;
    const remetente: Remetente = {
      async enviar(m) {
        // Na hora do envio o Message-ID ja esta na cobranca.
        vistos.push({ enviado: m.messageId, gravado: (await store.cobrancaPorId(cobranca.id))?.messageId });
        if (falhar) throw new Error('SMTP caiu');
      },
    };

    const r1 = await enviarCobranca(store, cobranca, remetente);
    expect(r1.ok).toBe(false);
    falhar = false;
    const r2 = await enviarCobranca(store, cobranca, remetente);
    expect(r2.ok).toBe(true);
    const r3 = await enviarCobranca(store, (await store.cobrancaPorId(cobranca.id))!, remetente);
    expect(r3.ok).toBe(true);

    expect(vistos.every((v) => v.enviado === v.gravado)).toBe(true);
    // Envio que falhou repete o mesmo id; depois de um envio confirmado, a
    // tentativa seguinte ganha outro.
    expect(vistos[0]!.enviado).toBe(vistos[1]!.enviado);
    expect(vistos[2]!.enviado).not.toBe(vistos[1]!.enviado);
    expect(lerMessageIdDaCobranca(vistos[1]!.enviado)).toMatchObject({ cobrancaId: cobranca.id, tentativa: 1 });
    expect(lerMessageIdDaCobranca(vistos[2]!.enviado)).toMatchObject({ cobrancaId: cobranca.id, tentativa: 2 });
    expect(vistos[1]!.enviado).toMatch(new RegExp(`^<cobranca\\.${cobranca.id}\\.1\\.[0-9a-f]{16}@smtp\\.teste\\.dev>$`));

    const enviadas = (await store.eventosDoPedido(CHAVE)).filter((e) => e.tipo === 'cobranca_enviada');
    expect(enviadas.map((e) => e.payload)).toEqual([
      { cobrancaId: cobranca.id, tentativa: 1 },
      { cobrancaId: cobranca.id, tentativa: 2 },
    ]);
    expect(r2.evento?.tipo).toBe('cobranca_enviada');
    // Payload so com ids: nenhum endereco.
    expect(JSON.stringify(enviadas)).not.toContain('@');

    const expiradas = await expirarCobrancasComEvento(store, new Date(Date.now() + 100 * H));
    expect(expiradas.map((e) => [e.tipo, e.payload])).toEqual([['cobranca_expirada', { cobrancaId: cobranca.id }]]);
    expect((await store.cobrancaPorId(cobranca.id))!.status).toBe('expirada');
    expect((await store.eventosDoPedido(CHAVE)).filter((e) => e.tipo === 'cobranca_expirada')).toHaveLength(1);
    // Segunda rodada nao grava de novo.
    expect(await expirarCobrancasComEvento(store, new Date(Date.now() + 200 * H))).toHaveLength(0);
  });

  it('cobranca do caso leva o casoId nos eventos', async () => {
    const store = (await base()).paraWorkspace('ws-t712-caso');
    await nfe(store);
    await contatoEmail(store);
    const { cobranca } = await criarCobrancaParaPendencia(store, CHAVE, 72, `${CHAVE}:1`);
    smtpFalso();
    const r = await enviarCobranca(store, cobranca, { async enviar() {} });
    expect(r.evento?.payload).toEqual({ cobrancaId: cobranca.id, casoId: `${CHAVE}:1`, tentativa: 1 });
    const [exp] = await expirarCobrancasComEvento(store, new Date(Date.now() + 100 * H));
    expect(exp!.payload).toEqual({ cobrancaId: cobranca.id, casoId: `${CHAVE}:1` });
  });
});

describe('spec 0017 T713: IMAP casa a cobranca de qualquer workspace so pelo Message-ID', () => {
  it('resposta tardia a cobranca expirada de um workspace de sessao grava no workspace dono', async () => {
    const seed = await base();
    const sessao = seed.paraWorkspace('00000000-0000-4000-8000-0000000017b1');
    await nfe(sessao);
    await contatoEmail(sessao);
    const { cobranca } = await criarCobrancaParaPendencia(sessao, CHAVE, 72);
    smtpFalso();
    let messageId = '';
    await enviarCobranca(sessao, cobranca, {
      async enviar(m) {
        messageId = m.messageId;
      },
    });
    await expirarCobrancasComEvento(sessao, new Date(Date.now() + 100 * H));
    expect((await sessao.cobrancaPorId(cobranca.id))!.status).toBe('expirada');

    // A caixa IMAP e do sistema: chega pelo store da seed.
    const ok = await responderImap(seed, new CanalSSE(), emlResposta({ inReplyTo: messageId }), { resolverDkim, extrator });
    expect(ok).toBe(true);
    expect((await sessao.cobrancaPorId(cobranca.id))!.status).toBe('respondida');
    const fila = await sessao.listarRevisao();
    expect(fila).toHaveLength(1);
    expect(fila[0]!['motivo']).toBe('dkim_nao_verificado');
    // Nada vai para a seed.
    expect(await seed.listarRevisao()).toHaveLength(0);
  });

  it('sem Message-ID, a chave de 44 digitos no corpo nao casa cobranca de outro workspace', async () => {
    const seed = await base();
    const sessao = seed.paraWorkspace('00000000-0000-4000-8000-0000000017b2');
    await nfe(sessao);
    await contatoEmail(sessao);
    await criarCobrancaParaPendencia(sessao, CHAVE, 72);
    const raw = emlResposta({ corpo: `Sobre a NF ${CHAVE}: em transito.` });
    expect(await responderImap(seed, new CanalSSE(), raw, { resolverDkim, extrator })).toBe(false);
    expect(await sessao.listarRevisao()).toHaveLength(0);
  });
});

describe('correcao: falha na resposta IMAP vai para o log sem contato', () => {
  it('loga o erro sem endereco nem corpo e devolve false', async () => {
    const seed = await base();
    vi.spyOn(seed, 'cobrancaPorMessageId').mockRejectedValue(new Error(`consulta falhou para ${EMAIL_TRANSP}`));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const corpo = 'texto sigiloso da resposta';
    const ok = await responderImap(seed, new CanalSSE(), emlResposta({ inReplyTo: '<x@foundry.dev>', corpo }));
    expect(ok).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    const linha = String(log.mock.calls[0]![0]);
    expect(linha).toContain('imap: resposta de cobranca falhou');
    expect(linha).toContain('consulta falhou');
    expect(linha).not.toContain('@');
    expect(linha).not.toContain(corpo);
  });
});

describe('spec 0017 T714: com o operador ativo nada sai em paralelo (RF20)', () => {
  const planilha = (data: string): Buffer =>
    Buffer.from(`chave_nf;data_prevista;peso_total;volumes;status\n${CHAVE};${data};12000;40;em_transito`);

  async function rodada(workspace: string): Promise<{ eventos: Evento[]; posts: string[]; smtp: number }> {
    const store = (await base()).paraWorkspace(workspace);
    const canal = new CanalSSE();
    for (const parte of PARTES) {
      await store.upsertContato({ parte, nome: `Hook ${parte}`, canal: 'webhook', destino: `https://webhook.site/${parte}`, fonte: 'manual' });
    }
    // Transportadora tambem tem e-mail, salvo antes: a cobranca acha o
    // e-mail e a tarefa acha o webhook (o salvo por ultimo).
    await store.upsertContato({ parte: 'transportadora', nome: 'Ops Transp', canal: 'email', destino: EMAIL_TRANSP, fonte: 'manual' });
    await store.upsertContato({ parte: 'transportadora', nome: 'Hook', canal: 'webhook', destino: 'https://webhook.site/transportadora', fonte: 'manual' });
    const posts: string[] = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request) => {
      posts.push(String(url));
      return new Response('ok', { status: 200 });
    });
    process.env['NVOIP_NOTIFY_ON_TASK'] = '1';
    process.env['COBRANCA_AUTO'] = '1';
    // SMTP recusando no loopback: tentativa de envio vira erro_envio.
    process.env['SMTP_HOST'] = '127.0.0.1';
    process.env['SMTP_PORT'] = '1';
    process.env['SMTP_FROM'] = 'sistema@foundry.dev';
    process.env['SMTP_TIMEOUT_MS'] = '1000';

    await ingerir(store, canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    await ingerir(store, canal, 'planilha.csv', planilha('2026-01-20'));
    await verificarWorkspace(store, canal, new Date(), { horasSemAtualizacao: 24 });
    const cobrancas = (await store.listarCobrancas()).filter((c) => c.workspaceId === workspace);
    expect(cobrancas.length).toBeGreaterThan(0);
    return {
      eventos: await store.eventosDoPedido(CHAVE),
      posts,
      smtp: cobrancas.filter((c) => c.status === 'erro_envio' || c.status === 'enviada').length,
    };
  }

  it('NVOIP_NOTIFY_ON_TASK e COBRANCA_AUTO ligados, operador ativo: nenhum webhook, nenhuma cobranca enviada', async () => {
    process.env['OPERADOR_ATIVO'] = '1';
    process.env['OPERADOR_WORKSPACES'] = 'ws-outro, ws-rf20';
    const r = await rodada('ws-rf20');
    expect(r.eventos.some((e) => e.tipo === 'tarefa')).toBe(true);
    expect(r.eventos.some((e) => e.tipo === 'pendencia_aberta')).toBe(true);
    expect(r.posts).toEqual([]);
    expect(r.eventos.filter((e) => e.tipo === 'notificacao')).toHaveLength(0);
    expect(r.smtp).toBe(0);
    expect(r.eventos.filter((e) => e.tipo === 'cobranca_enviada')).toHaveLength(0);
  }, 15_000);

  it('controle: workspace fora de OPERADOR_WORKSPACES segue avisando e tentando o envio', async () => {
    process.env['OPERADOR_ATIVO'] = '1';
    process.env['OPERADOR_WORKSPACES'] = 'ws-outro';
    const r = await rodada('ws-rf20-controle');
    expect(r.posts.length).toBeGreaterThan(0);
    expect(r.eventos.some((e) => e.tipo === 'notificacao')).toBe(true);
    expect(r.smtp).toBeGreaterThan(0);
  }, 15_000);
});

describe('spec 0017 T715: comprovante de caso trabalhado sem dado pessoal (RF25)', () => {
  it('trilha e casos sem telefone, e-mail nem transcricao, com a cadeia conferindo', async () => {
    const store = (await base()).paraWorkspace('ws-t715');
    const FONE = '+55 11 98888-7777';
    await store.append(CHAVE, 'nfe', {
      fonte: 'nfe',
      campos: { status: 'emitida' },
      dados: { emitente: { nome: 'Fornecedor Ficticio', fone: FONE } },
    });
    const aberta = await store.append(CHAVE, 'pendencia_aberta', { motivo: 'sem_atualizacao', detalhe: 'sem documento ha 30h', token: 't1' });
    const casoId = `${CHAVE}:${aberta.seq}`;
    await store.append(CHAVE, 'notificacao', { parte: 'transportadora', canal: 'whatsapp', destino: FONE, mensagem: 'cobrando status', status: 'entregue' });
    const operador = 'ligacao_concluida' as Evento['tipo'];
    await store.append(CHAVE, operador, { casoId, contatoId: 7, transcricao: 'motorista disse que chega amanha', audioHash: 'a'.repeat(64) });
    await store.append(CHAVE, 'status_declarado', {
      fonte: 'email_transportadora',
      campos: { status: 'em_transito' },
      dados: { remetente: EMAIL_TRANSP, dkim: 'pass' },
    });
    await store.append(CHAVE, 'caso_resolvido', { casoId, texto: `confirmado por telefone ${FONE}` });

    const eventos = await store.eventosDoPedido(CHAVE);
    const c = montarComprovante(CHAVE, eventos, null);
    const json = JSON.stringify(c);
    expect(c.cadeiaIntegra).toBe(true);
    expect(c.trilha).toHaveLength(eventos.length);
    expect(json).not.toContain('98888');
    expect(json).not.toContain(EMAIL_TRANSP);
    expect(json).not.toContain('motorista disse');
    expect(json).not.toMatch(/transcri/i);
    // Os eventos sem payload ainda provam a ordem pelo hash.
    for (const t of c.trilha.filter((e) => e.payloadOmitido)) expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.trilha.find((e) => e.tipo === 'pendencia_aberta')!.payload).toBeDefined();
    expect(c.casos.find((k) => k.id === casoId)!.status).toBe('resolvido');
  });
});

describe('spec 0017 T716: fechamento deterministico pelo motor (RF5)', () => {
  it('sem_atualizacao fecha com declaracao aceita posterior; documento comum nao fecha', async () => {
    const store = (await base()).paraWorkspace('ws-t716-a');
    const canal = new CanalSSE();
    await nfe(store, new Date(Date.now() - 48 * H).toISOString());
    await verificarWorkspace(store, canal, new Date(), { horasSemAtualizacao: 24 });
    const caso = projetarCasos(await store.eventosDoPedido(CHAVE)).find((k) => k.pendencia?.motivo === 'sem_atualizacao')!;
    expect(caso.status).not.toBe('resolvido');

    // Planilha nova nao e declaracao: o caso segue aberto.
    await ingerir(store, canal, 'planilha.csv', Buffer.from(`chave_nf;status\n${CHAVE};em_transito`));
    expect(projetarCasos(await store.eventosDoPedido(CHAVE)).find((k) => k.id === caso.id)!.status).not.toBe('resolvido');

    // Resposta sem DKIM vai a revisao; o analista aceita e o motor fecha.
    await contatoEmail(store);
    const { cobranca } = await criarCobrancaParaPendencia(store, CHAVE, 72, caso.id);
    await store.atualizarCobranca(cobranca.id, { status: 'enviada', messageId: '<c716@foundry.dev>' });
    const raw = emlResposta({ inReplyTo: '<c716@foundry.dev>' });
    expect(await processarRespostaEml(store, canal, raw, await extrairEml(raw), { resolverDkim, extrator })).toBe(true);
    const [item] = await store.listarRevisao();
    const gravados = await aprovarRevisao(store, canal, item!.id);
    const fechou = gravados!.find((e) => e.tipo === 'caso_resolvido')!;
    expect(fechou.payload).toMatchObject({ casoId: caso.id, resolvidoPor: 'motor', regra: 'declaracao_aceita' });
    const depois = projetarCasos(await store.eventosDoPedido(CHAVE)).find((k) => k.id === caso.id)!;
    expect(depois.status).toBe('resolvido');
    expect(depois.resolvidoPor).toBe('motor');
  });

  it('entrega_sem_confirmacao fecha so com status entregue, uma vez', async () => {
    const store = (await base()).paraWorkspace('ws-t716-b');
    const canal = new CanalSSE();
    await ingerir(store, canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    // A previsao honesta vem da planilha (a NF-e nao declara mais data):
    // sem ela a regra entrega_sem_confirmacao nao tem relogio para disparar.
    await ingerir(store, canal, 'planilha.csv', Buffer.from(`chave_nf;data_prevista\n${CHAVE};2026-01-25`));
    await verificarWorkspace(store, canal, new Date(), { horasSemAtualizacao: 24 });
    const caso = projetarCasos(await store.eventosDoPedido(CHAVE)).find((k) => k.pendencia?.motivo === 'entrega_sem_confirmacao')!;
    expect(caso).toBeDefined();

    await ingerir(store, canal, 'planilha.csv', Buffer.from(`chave_nf;status\n${CHAVE};em_transito`));
    expect((await store.eventosDoPedido(CHAVE)).some((e) => e.tipo === 'caso_resolvido')).toBe(false);

    await ingerir(store, canal, 'planilha.csv', Buffer.from(`chave_nf;status\n${CHAVE};entregue`));
    const fechamentos = (await store.eventosDoPedido(CHAVE)).filter((e) => e.tipo === 'caso_resolvido');
    expect(fechamentos).toHaveLength(1);
    expect(fechamentos[0]!.payload).toMatchObject({ casoId: caso.id, resolvidoPor: 'motor', regra: 'entrega_confirmada' });

    // Outro documento depois do fechamento nao duplica.
    await ingerir(store, canal, 'planilha.csv', Buffer.from(`chave_nf;status;volumes\n${CHAVE};entregue;41`));
    expect((await store.eventosDoPedido(CHAVE)).filter((e) => e.tipo === 'caso_resolvido')).toHaveLength(1);
  });
});

describe('correcao: rota da agenda aceita e devolve naoContatarIa', () => {
  let s: Awaited<ReturnType<typeof buildServer>>;
  let cookie = '';

  beforeAll(async () => {
    s = await buildServer(await createLiteDb());
    await s.app.ready();
    const res = await s.app.inject({ method: 'GET', url: '/api/pedidos' });
    const bruto = res.headers['set-cookie'];
    cookie = (Array.isArray(bruto) ? String(bruto[0]) : String(bruto)).split(';')[0]!;
  });

  const put = (payload: Record<string, unknown>) =>
    s.app.inject({ method: 'PUT', url: '/api/contatos', headers: { cookie }, payload });
  const agenda = async () =>
    (await s.app.inject({ method: 'GET', url: '/api/contatos', headers: { cookie } })).json() as Array<Record<string, unknown>>;
  const cd = { parte: 'cd', nome: 'CD', canal: 'ligacao', destino: '+55 11 94444-0000' };

  it('grava true, devolve na agenda e o PUT sem o campo mantem o valor', async () => {
    const r = await put({ ...cd, naoContatarIa: true });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ naoContatarIa: true });
    expect((await agenda()).find((c) => c['parte'] === 'cd')).toMatchObject({ naoContatarIa: true });

    expect((await put({ ...cd, nome: 'CD novo' })).statusCode).toBe(200);
    expect((await agenda()).find((c) => c['parte'] === 'cd')).toMatchObject({ nome: 'CD novo', naoContatarIa: true });

    expect((await put({ ...cd, naoContatarIa: false })).statusCode).toBe(200);
    expect((await agenda()).find((c) => c['parte'] === 'cd')).toMatchObject({ naoContatarIa: false });
  });

  it('valor que nao e booleano responde 400', async () => {
    const r = await put({ ...cd, naoContatarIa: 'sim' });
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json())).toContain('naoContatarIa');
  });
});

